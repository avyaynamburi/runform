(() => {
"use strict";
const input = document.querySelector("#video-input");
const dropZone = document.querySelector("#drop-zone");
const uploadSection = document.querySelector("#upload-section");
const processing = document.querySelector("#processing");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
let busy = false;

function reset() {
  clearStage();
  input.value = "";
  results.hidden = true;
  processing.hidden = true;
  error.hidden = true;
  uploadSection.hidden = false;
}

function renderError(message) {
  results.hidden = true;
  uploadSection.hidden = false;
  error.textContent = message;
  error.hidden = false;
}

function renderResults(report) {
  const number = (value, suffix = "") => value == null ? "—" : `${value.toFixed(1)}${suffix}`;
  const knee = report.knee_flexion_at_strike_deg;
  const stats = [
    ["Cadence", number(report.cadence_spm), "spm", "The number of steps you take each minute."],
    ["Trunk lean", number(report.trunk_lean_deg, "°"), "", "Your average torso angle from vertical."],
    ["Knee at strike", knee == null ? "—" : `${number(knee.mean)} ± ${number(knee.std)}°`, "", "Your knee angle at landing, with its variation."],
    ["Vertical oscillation", number(report.vertical_oscillation_rel == null ? null : report.vertical_oscillation_rel * 100, "%"), "", "Your up-and-down movement as a share of body height."],
    ["Frames with pose", report.frames_with_pose == null || report.frames_total == null ? "—" : `${report.frames_with_pose} / ${report.frames_total}`, "", "Video frames where your full pose was detected."]
  ];
  const cards = document.querySelector("#cards");
  cards.replaceChildren();
  stats.forEach(([title, value, unit, caption], index) => {
    const card = document.createElement("article");
    card.className = "card";
    const label = document.createElement("h3");
    label.textContent = title;
    const metric = document.createElement("p");
    metric.className = "metric";
    metric.textContent = value;
    const unitLabel = document.createElement("span");
    unitLabel.textContent = unit;
    metric.append(unitLabel);
    const description = document.createElement("p");
    description.textContent = caption;
    const marker = document.createElement("span");
    marker.className = "card-index";
    marker.textContent = `0${index + 1}`;
    card.append(marker, label, metric, description);
    cards.append(card);
  });
  const warnings = document.querySelector("#warnings");
  warnings.replaceChildren();
  (report.warnings || []).forEach(message => {
    const line = document.createElement("p");
    line.textContent = message;
    warnings.append(line);
  });
  warnings.hidden = !report.warnings?.length;
  results.hidden = false;
}

async function upload(file) {
  if (!file || busy) return;
  busy = true;
  reset();
  uploadSection.hidden = true;
  processing.hidden = false;
  const data = new FormData();
  data.append("video", file);
  try {
    const response = await fetch("/api/analyze", { method: "POST", body: data });
    if (!response.ok) {
      let message = response.status === 413 ? "This video is too large. Choose a file under 300 MB." : "Unable to analyze this video. Please try again.";
      try { message = (await response.json()).error || message; } catch { /* Non-JSON server error. */ }
      throw new Error(message);
    }
    const payload = await response.json();
    renderResults(payload.report);
    startStage(file, payload.pose);
  } catch (failure) {
    renderError(failure.message || "Connection failed. Please try again.");
  } finally {
    processing.hidden = true;
    busy = false;
    input.value = "";
  }
}

input.addEventListener("change", () => upload(input.files[0]));
document.querySelector("#reset").addEventListener("click", reset);
["dragenter", "dragover"].forEach(eventName => dropZone.addEventListener(eventName, event => {
  event.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach(eventName => dropZone.addEventListener(eventName, event => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop", event => upload(event.dataTransfer.files[0]));

const video = document.querySelector("#runner-video");
const canvas = document.querySelector("#skeleton");
const ctx = canvas.getContext("2d");
const veil = document.querySelector("#intro-veil");
const label = document.querySelector("#tracking-label");
const playButton = document.querySelector("#play-pause");
const replayButton = document.querySelector("#replay-intro");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = value => Math.max(0, Math.min(1, value));
// Torso first, then limbs outward; odd indices are the runner's left side.
const bones = [[11,12],[11,23],[12,24],[23,24],[11,13],[12,14],
  [13,15],[14,16],[23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[31,27],[32,28]];
const joints = [11,12,23,24,13,14,25,26,15,16,27,28,29,30,31,32,
  ...Array.from({length: 11}, (_, i) => i),17,18,19,20,21,22];
let pose = null;
let objectURL = null;
let phase = "idle";
let phaseStart = 0;
let frameIndex = 0;
let animation = 0;
let lastTime = 0;
let lastPose = null;
let opacity = 0;
let pictureWidth = 0;
let pictureHeight = 0;
let firstFrame = 0;
let seekReady = false;

window.__runform = Object.freeze({
  get phase() { return phase; },
  get frameIndex() { return frameIndex; }
});

function clearStage() {
  cancelAnimationFrame(animation);
  phase = "idle";
  video.pause();
  video.onloadedmetadata = null;
  video.onseeked = null;
  video.removeAttribute("src");
  video.load();
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null;
  pose = null;
  lastPose = null;
  opacity = 0;
  playButton.disabled = true;
  replayButton.disabled = true;
  ctx.clearRect(0, 0, pictureWidth, pictureHeight);
}

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  const box = video.getBoundingClientRect();
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  pictureWidth = video.videoWidth * scale;
  pictureHeight = video.videoHeight * scale;
  canvas.style.width = `${pictureWidth}px`;
  canvas.style.height = `${pictureHeight}px`;
  canvas.style.left = `${(box.width - pictureWidth) / 2}px`;
  canvas.style.top = `${(box.height - pictureHeight) / 2}px`;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(pictureWidth * ratio);
  canvas.height = Math.round(pictureHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(video);

function setSpeed(speed) {
  video.playbackRate = speed;
  document.querySelectorAll("[data-speed]").forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
  });
}

function goLive() {
  phase = "live";
  veil.style.opacity = "0";
  label.textContent = "Live tracking";
  playButton.disabled = false;
  replayButton.disabled = false;
  video.play().catch(() => { playButton.textContent = "Play"; });
}

function beginIntro() {
  video.pause();
  phase = "seeking";
  playButton.disabled = true;
  replayButton.disabled = true;
  veil.style.opacity = ".65";
  label.textContent = "Tracking 33 body points...";
  lastPose = null;
  opacity = 0;
  setSpeed(0.5);
  const target = firstFrame / pose.fps;
  const ready = () => {
    if (phase !== "seeking") return;
    seekReady = true;
  };
  seekReady = false;
  video.onseeked = ready;
  if (Math.abs(video.currentTime - target) < 0.00001 && video.readyState >= 2) ready();
  else video.currentTime = target;
}

function startStage(file, data) {
  pose = data;
  firstFrame = Math.max(0, pose.frames.findIndex(frame => frame !== null));
  objectURL = URL.createObjectURL(file);
  video.muted = true;
  video.onloadedmetadata = () => { resizeCanvas(); beginIntro(); };
  video.onloadeddata = () => {
    if (phase === "seeking" && !video.seeking) seekReady = true;
  };
  video.src = objectURL;
  lastTime = performance.now();
  animation = requestAnimationFrame(tick);
}

function color(index) { return index % 2 ? "#22d3ee" : "#a78bfa"; }
function draw(frame, jointProgress, boneProgress) {
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.shadowBlur = 12;
  bones.forEach(([a,b], i) => {
    if (!frame[a] || !frame[b]) return;
    const progress = clamp(boneProgress * bones.length - i);
    if (!progress) return;
    const [x,y] = frame[a];
    const [endX,endY] = frame[b];
    ctx.strokeStyle = ctx.shadowColor = i === 0 || i === 3 ? "#b6f3fa" : color(a);
    ctx.beginPath();
    ctx.moveTo(x * pictureWidth, y * pictureHeight);
    ctx.lineTo((x + (endX-x) * progress) * pictureWidth, (y + (endY-y) * progress) * pictureHeight);
    ctx.stroke();
  });
  joints.forEach((index, i) => {
    if (!frame[index]) return;
    const progress = clamp(jointProgress * (joints.length + 4) - i);
    if (!progress) return;
    ctx.fillStyle = ctx.shadowColor = color(index);
    ctx.beginPath();
    ctx.arc(frame[index][0] * pictureWidth, frame[index][1] * pictureHeight, 3.2 * progress, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function tick(now) {
  const delta = Math.min(100, now - lastTime);
  lastTime = now;
  if (phase === "seeking" && seekReady) {
    phase = "joints";
    phaseStart = now;
    if (reducedMotion.matches) goLive();
  }
  let elapsed = now - phaseStart;
  if (phase === "joints" && elapsed >= 1100) {
    phase = "bones"; phaseStart += 1100; elapsed = now - phaseStart;
  }
  if (phase === "bones" && elapsed >= 1400) {
    phase = "reveal"; phaseStart += 1400; elapsed = now - phaseStart;
  }
  if (phase === "reveal") {
    veil.style.opacity = String(.65 * (1 - clamp(elapsed / 500)));
    if (elapsed >= 500) goLive();
  }
  frameIndex = Math.max(0, Math.min(pose.frames.length - 1, Math.floor(video.currentTime * pose.fps)));
  const frame = pose.frames[frameIndex];
  if (frame) { lastPose = frame; opacity = Math.min(1, opacity + delta / 120); }
  else opacity = Math.max(0, opacity - delta / 250);
  ctx.clearRect(0, 0, pictureWidth, pictureHeight);
  if (lastPose && phase !== "seeking") draw(lastPose,
    phase === "joints" ? clamp(elapsed / 1100) : 1,
    phase === "joints" ? 0 : phase === "bones" ? clamp(elapsed / 1400) : 1);
  animation = requestAnimationFrame(tick);
}

playButton.addEventListener("click", () => {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
});
video.addEventListener("play", () => { playButton.textContent = "Pause"; });
video.addEventListener("pause", () => { playButton.textContent = "Play"; });
replayButton.addEventListener("click", beginIntro);
document.querySelectorAll("[data-speed]").forEach(button => {
  button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
});
})();
