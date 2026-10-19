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
    startStage(file, payload);
    processing.hidden = true;
    document.querySelector("#video-stage").scrollIntoView({ behavior: "smooth", block: "start" });
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
let scene = null;
let sceneElapsed = 0;
let measurement = null;
let freezeUntil = 0;
let userPaused = false;
let previousFrame = -1;
const frozenStrikes = new Set();
const sceneCard = document.querySelector("#scene-card");
const stepCounter = document.querySelector("#step-counter");
const progressFill = document.querySelector("#scene-progress-fill");
const sceneChips = document.querySelector("#scene-chips");
const metricValue = (value, unit) => value == null ? "—" : `${value.toFixed(1)}${unit}`;
const scenes = [
  {
    id: "cadence", title: "Cadence",
    value: report => metricValue(report.cadence_spm, " spm"),
    caption: "Every time a heel hits its lowest point, that's a foot strike. The median time between strikes of the same foot gives your cadence.",
    draw: drawCadence
  },
  {
    id: "trunk-lean", title: "Trunk lean",
    value: report => metricValue(report.trunk_lean_deg, "°"),
    caption: "The angle between your hip-to-shoulder line and vertical, averaged over every frame.",
    draw: drawTrunkLean
  },
  {
    id: "knee", title: "Knee at strike", chip: "Knee", accent: "#f472b6",
    value: report => {
      const knee = report.knee_flexion_at_strike_deg;
      return knee == null ? "—" : `${metricValue(knee.mean, "")} ± ${metricValue(knee.std, "°")}`;
    },
    caption: "At each foot strike we freeze the frame and measure the hip–knee–ankle angle of the landing leg. 180° would be a straight leg.",
    draw: drawKnee
  },
  {
    id: "bounce", title: "Vertical oscillation", chip: "Bounce", accent: "#34d399",
    value: report => metricValue(report.vertical_oscillation_rel == null ? null : report.vertical_oscillation_rel * 100, "%"),
    caption: "We follow your hip midpoint through each stride. The gap between its highest and lowest point, divided by your shoulder-to-ankle height, is your vertical oscillation.",
    draw: drawBounce
  },
  {
    id: "summary", title: "Your stride", chip: "Summary",
    value: () => "",
    caption: "That's your stride. Scroll down for the full breakdown.",
    draw: () => {}
  }
];
scenes.forEach(item => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.textContent = item.chip || item.title;
  chip.dataset.scene = item.id;
  chip.setAttribute("aria-pressed", "false");
  chip.disabled = true;
  chip.addEventListener("click", () => startScene(item));
  sceneChips.append(chip);
});

function startScene(next) {
  if (freezeUntil) {
    freezeUntil = 0;
    if (!userPaused) video.play().catch(() => {});
  }
  previousFrame = pose ? Math.floor(video.currentTime * pose.fps) - 1 : -1;
  frozenStrikes.clear();
  scene = next;
  sceneElapsed = 0;
  sceneCard.hidden = !scene;
  document.querySelector("#video-stage").classList.toggle("has-scene", !!scene);
  label.hidden = !!scene;
  stepCounter.hidden = scene?.id !== "cadence";
  progressFill.style.width = "0%";
  sceneChips.querySelectorAll("button").forEach(chip => {
    chip.setAttribute("aria-pressed", String(chip.dataset.scene === scene?.id));
  });
  sceneCard.style.setProperty("--scene-accent", scene?.accent || "#22d3ee");
  const summary = document.querySelector("#scene-summary");
  summary.replaceChildren();
  summary.hidden = scene?.id !== "summary";
  document.querySelector("#scene-value").hidden = scene?.id === "summary";
  if (scene?.id === "summary") {
    scenes.slice(0, 4).forEach(item => {
      const cell = document.createElement("div");
      const name = document.createElement("small");
      name.textContent = item.chip || item.title;
      const value = document.createElement("strong");
      value.textContent = item.value(measurement.report);
      cell.append(name, value);
      summary.append(cell);
    });
  }
  if (scene) {
    document.querySelector("#scene-title").textContent = scene.title;
    document.querySelector("#scene-value").textContent = scene.value(measurement.report);
    document.querySelector("#scene-caption").textContent = scene.caption;
    setSpeed(0.5);
  }
}

function drawCadence(ctx, frame, index) {
  const strikes = measurement.strikes;
  stepCounter.textContent = `Steps: ${strikes.filter(strike => strike.frame <= index).length}`;
  strikes.forEach(strike => {
    const age = index - strike.frame;
    const heel = frame?.[strike.foot === "left" ? 29 : 30];
    if (age < 0 || age > 12 || !heel) return;
    ctx.globalAlpha = 1 - age / 13;
    ctx.strokeStyle = strike.foot === "left" ? "#22d3ee" : "#a78bfa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(heel[0] * pictureWidth, heel[1] * pictureHeight, 7 + age * 2, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  const left = 12, width = Math.max(1, pictureWidth - 24), top = pictureHeight - 40;
  const position = index => left + width * index / Math.max(1, pose.frames.length - 1);
  ctx.fillStyle = "#0b1725dd";
  ctx.fillRect(left - 4, top - 6, width + 8, 40);
  strikes.forEach(strike => {
    ctx.strokeStyle = strike.foot === "left" ? "#22d3ee" : "#a78bfa";
    const y = top + (strike.foot === "left" ? 0 : 16);
    ctx.beginPath(); ctx.moveTo(position(strike.frame), y); ctx.lineTo(position(strike.frame), y + 10); ctx.stroke();
  });
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath(); ctx.moveTo(position(index), top - 4); ctx.lineTo(position(index), top + 30); ctx.stroke();
}

function drawTrunkLean(ctx, frame, index) {
  if (!frame || ![11,12,23,24].every(i => frame[i])) return;
  const midpoint = (a, b) => [(frame[a][0] + frame[b][0]) * pictureWidth / 2,
    (frame[a][1] + frame[b][1]) * pictureHeight / 2];
  const hip = midpoint(23, 24), shoulder = midpoint(11, 12);
  const dx = shoulder[0] - hip[0], dy = shoulder[1] - hip[1];
  const length = Math.hypot(dx, dy);
  if (!length) return;
  ctx.strokeStyle = ctx.fillStyle = "#f59e0b";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(...hip); ctx.lineTo(...shoulder); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(...hip); ctx.lineTo(hip[0], hip[1] - length); ctx.stroke();
  ctx.setLineDash([]);
  const end = -Math.PI / 2 + Math.atan2(dx, -dy);
  const radius = .55 * length;
  ctx.beginPath();
  ctx.moveTo(...hip);
  ctx.arc(...hip, radius, -Math.PI / 2, end, dx < 0);
  ctx.closePath();
  ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
  ctx.fill();
  ctx.beginPath(); ctx.arc(...hip, radius, -Math.PI / 2, end, dx < 0); ctx.stroke();
  const value = measurement.series.trunk_lean_deg[index];
  if (value != null) {
    const text = `${value.toFixed(1)}°`;
    ctx.font = "bold 15px monospace";
    ctx.textBaseline = "top";
    const padding = 6;
    const width = ctx.measureText(text).width + padding * 2;
    const x = dx >= 0 ? hip[0] - 14 - width : hip[0] + 14;
    const y = hip[1] - length + 20;
    ctx.fillStyle = "rgba(11, 23, 37, 0.85)";
    ctx.beginPath();
    ctx.roundRect(x, y, width, 15 + padding * 2, 6);
    ctx.fill();
    ctx.fillStyle = "#f59e0b";
    ctx.fillText(text, x + padding, y + padding);
  }
}

function pill(ctx, text, x, y, accent) {
  ctx.font = "bold 15px monospace";
  ctx.textBaseline = "top";
  const width = ctx.measureText(text).width + 12;
  x = Math.max(0, Math.min(x, pictureWidth - width));
  y = Math.max(0, Math.min(y, pictureHeight - 27));
  ctx.fillStyle = "rgba(11, 23, 37, 0.85)";
  ctx.beginPath(); ctx.roundRect(x, y, width, 27, 6); ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillText(text, x + 6, y + 6);
}

function drawKnee(ctx, frame, index) {
  measurement.strikes.forEach((strike, i) => {
    const age = index - strike.frame;
    if (age < 0 || age > 15) return;
    const ids = strike.foot === "left" ? [23,25,27] : [24,26,28];
    if (!frame || !ids.every(id => frame[id])) return;
    const [hip, knee, ankle] = ids.map(id => [frame[id][0] * pictureWidth, frame[id][1] * pictureHeight]);
    ctx.globalAlpha = 1 - age / 16;
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(...hip); ctx.lineTo(...knee); ctx.lineTo(...ankle); ctx.stroke();
    const a = Math.atan2(hip[1] - knee[1], hip[0] - knee[0]);
    const b = Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0]);
    const sweep = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    const radius = Math.min(28, Math.hypot(hip[0] - knee[0], hip[1] - knee[1]) * .35);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(...knee, radius, a, a + sweep, sweep < 0); ctx.stroke();
    const value = measurement.series.knee_at_strike_deg[i];
    if (value != null) pill(ctx, `${Math.round(value)}°`, knee[0] + 34, knee[1] - 14, "#f472b6");
  });
}

function hipPoint(index) {
  const frame = pose.frames[index];
  if (!frame?.[23] || !frame[24]) return null;
  return [(frame[23][0] + frame[24][0]) * pictureWidth / 2,
    (frame[23][1] + frame[24][1]) * pictureHeight / 2];
}

function drawBounce(ctx, frame, index) {
  const hip = hipPoint(index);
  if (!hip) return;
  ctx.strokeStyle = ctx.shadowColor = "#34d399";
  ctx.shadowBlur = 12;
  ctx.lineWidth = 3;
  let previous = null;
  for (let i = Math.max(0, index - 59); i <= index; i++) {
    const point = hipPoint(i);
    if (!point) { previous = null; continue; }
    const x = hip[0] - (index - i) * 4;
    ctx.globalAlpha = 1 - (index - i) / 60;
    if (previous) {
      ctx.beginPath(); ctx.moveTo(...previous); ctx.lineTo(x, point[1]); ctx.stroke();
    }
    previous = [x, point[1]];
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  const strides = measurement.strides;
  const stride = strides.find(s => s.foot === strides[0].foot && s.start <= index && index <= s.end);
  if (!stride) return;
  const top = hipPoint(stride.top), bottom = hipPoint(stride.bottom);
  if (!top || !bottom) return;
  const left = hip[0] - pictureWidth * .22, right = hip[0] + pictureWidth * .22;
  ctx.lineWidth = 2;
  ctx.setLineDash([6,5]);
  [top[1], bottom[1]].forEach(y => {
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  });
  ctx.setLineDash([]);
  const x = right + 12;
  ctx.beginPath(); ctx.moveTo(x - 5, top[1]); ctx.lineTo(x + 5, top[1]);
  ctx.moveTo(x, top[1]); ctx.lineTo(x, bottom[1]);
  ctx.moveTo(x - 5, bottom[1]); ctx.lineTo(x + 5, bottom[1]); ctx.stroke();
  pill(ctx, `${(stride.value * 100).toFixed(1)}% of body height`, x + 10, bottom[1] + 10, "#34d399");
}

window.__runform = Object.freeze({
  get phase() { return phase; },
  get scene() { return scene?.id ?? null; },
  get frameIndex() { return frameIndex; }
});

function clearStage() {
  cancelAnimationFrame(animation);
  phase = "idle";
  startScene(null);
  sceneChips.querySelectorAll("button").forEach(chip => { chip.disabled = true; });
  measurement = null;
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
  sceneChips.querySelectorAll("button").forEach(chip => { chip.disabled = false; });
  startScene(scenes[0]);
  playButton.disabled = false;
  replayButton.disabled = false;
  video.play().catch(() => { playButton.textContent = "Play"; });
}

function beginIntro() {
  startScene(null);
  sceneChips.querySelectorAll("button").forEach(chip => { chip.disabled = true; });
  userPaused = false;
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
  measurement = data;
  pose = data.pose;
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
  ctx.globalAlpha = opacity * (scene && scene.id !== "summary" ? .4 : 1);
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
  const wallDelta = Math.max(0, now - lastTime);
  const delta = Math.min(100, wallDelta);
  if (scene && !userPaused && (freezeUntil || (!video.paused && !video.seeking))) {
    sceneElapsed += wallDelta;
    if (sceneElapsed >= 8000) startScene(scenes[scenes.indexOf(scene) + 1] || null);
    progressFill.style.width = `${clamp(sceneElapsed / 8000) * 100}%`;
  }
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
  if (freezeUntil && now >= freezeUntil) {
    freezeUntil = 0;
    if (!userPaused) video.play().catch(() => {});
  }
  if (scene?.id === "knee" && !userPaused && !freezeUntil && !video.paused && !video.seeking) {
    // A natural loop starts a new pass; explicit seeks only move the cursor.
    if (frameIndex < previousFrame) frozenStrikes.clear();
    const strikeIndex = measurement.strikes.findIndex((strike, i) =>
      strike.frame > previousFrame && strike.frame <= frameIndex && !frozenStrikes.has(i));
    if (strikeIndex >= 0) {
      frozenStrikes.add(strikeIndex);
      frameIndex = measurement.strikes[strikeIndex].frame;
      freezeUntil = now + 1000;
      video.pause();
      video.currentTime = (frameIndex + .5) / pose.fps;
    }
  }
  previousFrame = frameIndex;
  const frame = pose.frames[frameIndex];
  if (frame) { lastPose = frame; opacity = Math.min(1, opacity + delta / 120); }
  else opacity = Math.max(0, opacity - delta / 250);
  ctx.clearRect(0, 0, pictureWidth, pictureHeight);
  if (lastPose && phase !== "seeking") draw(lastPose,
    phase === "joints" ? clamp(elapsed / 1100) : 1,
    phase === "joints" ? 0 : phase === "bones" ? clamp(elapsed / 1400) : 1);
  if (scene) {
    ctx.save();
    scene.draw(ctx, frame, frameIndex);
    ctx.restore();
  }
  animation = requestAnimationFrame(tick);
}

playButton.addEventListener("click", () => {
  userPaused = !userPaused;
  if (userPaused) video.pause();
  else if (!freezeUntil) video.play().catch(() => {});
  playButton.textContent = userPaused ? "Play" : "Pause";
});
video.addEventListener("play", () => { playButton.textContent = "Pause"; });
video.addEventListener("pause", () => { if (!freezeUntil) playButton.textContent = "Play"; });
video.addEventListener("seeking", () => {
  // Preserve consumed strikes across seeks, including our own freeze seek.
  const target = Math.floor(video.currentTime * (pose?.fps || 1));
  if (!freezeUntil && pose && previousFrame >= pose.frames.length - 3 && target <= 2) {
    frozenStrikes.clear();
  }
  previousFrame = target;
});
replayButton.addEventListener("click", beginIntro);
document.querySelectorAll("[data-speed]").forEach(button => {
  button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
});
})();
