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
const backdrop = document.querySelector("#backdrop");
const backdropCtx = backdrop.getContext("2d");
let backdropTick = 0;
const titleCard = document.querySelector("#title-card");
const titleDetail = document.querySelector("#title-detail");
const stage = document.querySelector("#video-stage");
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
let stageWidth = 0;
let stageHeight = 0;
let pictureWidth = 0;
let pictureHeight = 0;
const camera = {cx: .5, cy: .5, scale: 1};
let focusBox = null;
let cameraTarget = {...camera};
let introStart = 0;
function project([x, y]) {
  return [stageWidth / 2 + (x - camera.cx) * camera.scale * pictureWidth,
    stageHeight / 2 + (y - camera.cy) * camera.scale * pictureHeight];
}
function applyCamera() {
  const [x, y] = project([0, 0]);
  video.style.transform = `translate(${x}px, ${y}px) scale(${camera.scale})`;
}
function limitCamera(cam) {
  // Large pictures cover the viewport; small pictures stay wholly inside it.
  for (const [key, viewport, picture] of [["cx", stageWidth, pictureWidth],
    ["cy", stageHeight, pictureHeight]]) {
    if (!picture) continue;
    const edge = viewport / (2 * picture * cam.scale);
    cam[key] = Math.max(Math.min(edge, 1 - edge), Math.min(Math.max(edge, 1 - edge), cam[key]));
  }
  return cam;
}
function drawBackdrop() {
  backdrop.hidden = phase === "title";
  if (backdrop.hidden || video.readyState < 2 || !stageWidth || !stageHeight) return;
  if (backdropTick++ % (reducedMotion.matches ? 8 : 2)) return;
  const scale = Math.max(backdrop.width / video.videoWidth, backdrop.height / video.videoHeight);
  const width = video.videoWidth * scale, height = video.videoHeight * scale;
  backdropCtx.drawImage(video, (backdrop.width - width) / 2, (backdrop.height - height) / 2, width, height);
}
function updateCamera(frame, dt, now, snap = false) {
  const intro = ["title", "seeking", "joints", "bones", "reveal"].includes(phase);
  const nextScene = scenes[scenes.indexOf(scene) + 1];
  const id = intro ? "intro" : scene && sceneElapsed > sceneDuration() - 600 ? nextScene?.id : scene?.id;
  const regions = {intro: [0,11,12,23,24], "trunk-lean": [0,11,12,23,24],
    cadence: [27,28,29,30,31,32], knee: [23,24,25,26,27,28,29,30,31,32], bounce: [11,12,23,24]};
  if (!regions[id]) {
    cameraTarget = {cx: .5, cy: .5, scale: 1};
    focusBox = null;
  } else if (frame) {
    const points = regions[id].map(i => frame[i]).filter(Boolean);
    if (points.length) {
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const w = Math.max(.01, Math.max(...xs) - Math.min(...xs));
      const h = Math.max(.01, Math.max(...ys) - Math.min(...ys));
      const box = {cx: (Math.max(...xs) + Math.min(...xs)) / 2,
        cy: (Math.max(...ys) + Math.min(...ys)) / 2, w: w * 1.5, h: h * (id === "bounce" ? 2.3 : 1.5)};
      const alpha = snap || reducedMotion.matches || !focusBox ? 1 : 1 - Math.exp(-dt / 250);
      if (!focusBox) focusBox = {...box};
      for (const key of Object.keys(box)) focusBox[key] += (box[key] - focusBox[key]) * alpha;
      // Compare box dimensions to the corresponding pixel viewport dimensions.
      const scale = Math.max(1, Math.min(2.6, .8 * Math.min(
        stageWidth / (focusBox.w * pictureWidth), stageHeight / (focusBox.h * pictureHeight))));
      cameraTarget = limitCamera({cx: focusBox.cx, cy: focusBox.cy, scale});
      if (intro && !["title", "seeking"].includes(phase)) {
        const t = clamp((now - introStart) / 2500);
        const pullback = t * t * (3 - 2 * t);
        cameraTarget = limitCamera({cx: cameraTarget.cx + (.5 - cameraTarget.cx) * pullback,
          cy: cameraTarget.cy + (.5 - cameraTarget.cy) * pullback,
          scale: cameraTarget.scale + (1 - cameraTarget.scale) * pullback});
      }
    }
  }
  if (scene?.id === "knee" && !reducedMotion.matches) {
    cameraTarget.scale *= 1 + .08 * (1 - ease(clamp((now - flashStart) / 600)));
    limitCamera(cameraTarget);
  }
  const alpha = snap || reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 350);
  for (const key of Object.keys(camera)) camera[key] += (cameraTarget[key] - camera[key]) * alpha;
  limitCamera(camera);
  applyCamera();
}
let firstFrame = 0;
let seekReady = false;
let scene = null;
let sceneElapsed = 0;
let measurement = null;
let freezeUntil = 0;
let userPaused = false;
let previousFrame = -1;
const frozenStrikes = new Set();
const lowerThird = document.querySelector("#lower-third");
let flashStart = -Infinity;
let leanEMA = null;
let drawDelta = 0;
let baseRate = .5;
let rate = video.playbackRate;
let lastWrittenRate = rate;
let transitionIn = false;
let tourStart = false;
let settledAt = null;
let markerActive = false;
const speedMarker = document.querySelector("#speed-marker");
const smoothstep = t => { t = clamp(t); return t * t * (3 - 2 * t); };

// All floating HUD coordinates are in stage pixels.
function safeArea() {
  const bar = scene ? document.querySelector("#letterbox-top").offsetHeight : 0;
  const bottomBar = scene ? document.querySelector("#letterbox-bottom").offsetHeight : 0;
  const lower = scene ? lowerThird.offsetTop : stageHeight - bottomBar;
  return {left: 8, right: stageWidth - 8, top: bar + 8,
    bottom: Math.max(bar + 8, Math.min(stageHeight - bottomBar, lower) - 8)};
}
function hudPosition(x, y, width, height) {
  const area = safeArea();
  return [Math.max(area.left, Math.min(area.right - width, x)),
    Math.max(area.top, Math.min(area.bottom - height, y))];
}
function rateMultiplier() {
  if (reducedMotion.matches || phase !== "live" || !scene) return 1;
  const ahead = frameIndex + 2;
  const proximity = (events, minimum, core) => {
    const distance = events.reduce((nearest, frame) => Math.min(nearest, Math.abs(frame - ahead)), Infinity);
    return minimum + (1 - minimum) * smoothstep((distance - core) / (6 - core));
  };
  let multiplier = 1;
  if (scene.id === "cadence") {
    multiplier = proximity(measurement.strikes.filter(s => s.foot === "left").map(s => s.frame), .35, 3);
  } else if (scene.id === "trunk-lean") multiplier = .8;
  else if (scene.id === "knee") multiplier = proximity(measurement.strikes.map(s => s.frame), .3, 0);
  else if (scene.id === "bounce") {
    multiplier = proximity(measurement.strides.filter(s => s.foot === measurement.strides[0]?.foot).map(s => s.top), .4, 3);
  } else if (scene.id === "summary") multiplier = 1 + smoothstep(sceneElapsed / 1000);
  if (tourStart) {
    // Finish the opening ramp before smoothly introducing landing slow motion.
    multiplier = sceneElapsed < 1500 ? .4 + .6 * smoothstep(sceneElapsed / 1500)
      : 1 + (multiplier - 1) * smoothstep((sceneElapsed - 1500) / 300);
  }
  const remaining = sceneDuration() - sceneElapsed;
  const bump = transitionIn && sceneElapsed < 700 ? 1 - smoothstep(sceneElapsed / 700)
    : remaining < 600 ? smoothstep(1 - remaining / 600) : 0;
  return multiplier + (3 - multiplier) * bump;
}
function updateRate(dt, now) {
  const target = Math.max(.0625, Math.min(3, baseRate * rateMultiplier()));
  if (!video.paused) {
    rate += (target - rate) * (1 - Math.exp(-dt / 180));
    if (Math.abs(rate - lastWrittenRate) > .01) {
      video.playbackRate = rate;
      lastWrittenRate = video.playbackRate;
    }
  }
  const effective = video.playbackRate;
  const visible = phase === "live" && !reducedMotion.matches;
  speedMarker.hidden = !visible;
  if (!visible) { settledAt = null; markerActive = false; }
  else if (Math.abs(rate - baseRate) > .05) { settledAt = null; markerActive = true; }
  else if (markerActive && settledAt === null) settledAt = now;
  else if (settledAt !== null && now - settledAt >= 600) markerActive = false;
  speedMarker.classList.toggle("visible", visible && markerActive);
  speedMarker.textContent = effective < .6 * baseRate ? `SLOW-MO ${effective.toFixed(2)}×` : `${effective.toFixed(1)}×`;
}
const ease = t => 1 - (1 - t) ** 3;
const sceneDuration = () => scene?.id === "summary" ? 7000 : 9000;
const sceneChips = document.querySelector("#scene-chips");
const metricValue = (value, unit) => value == null ? "—" : `${value.toFixed(1)}${unit}`;
const scenes = [
  {
    id: "cadence", title: "Cadence",
    value: report => metricValue(report.cadence_spm, " spm"),
    caption: "Each heel strike is a step — this is your rhythm.",
    draw: drawCadence
  },
  {
    id: "trunk-lean", title: "Trunk lean", accent: "#f59e0b",
    value: report => metricValue(report.trunk_lean_deg, "°"),
    caption: "How far your torso tips forward from vertical.",
    draw: drawTrunkLean
  },
  {
    id: "knee", title: "Knee at strike", chip: "Knee", accent: "#f472b6",
    value: report => {
      const knee = report.knee_flexion_at_strike_deg;
      return knee == null ? "—" : `${metricValue(knee.mean, "")} ± ${metricValue(knee.std, "°")}`;
    },
    caption: "Your knee angle the instant your foot lands. 180° is a straight leg.",
    draw: drawKnee
  },
  {
    id: "bounce", title: "Vertical oscillation", chip: "Bounce", accent: "#34d399",
    value: report => metricValue(report.vertical_oscillation_rel == null ? null : report.vertical_oscillation_rel * 100, "%"),
    caption: "How much your hips rise and fall with every stride.",
    draw: drawBounce
  },
  {
    id: "summary", title: "Your stride", chip: "Summary",
    value: () => "",
    caption: "That's your stride.",
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

function updateLowerThird() {
  if (!scene) return;
  const age = sceneElapsed - 400;
  const entrance = ease(clamp(age / 400));
  lowerThird.style.opacity = String(entrance * clamp((sceneDuration() - sceneElapsed) / 500));
  lowerThird.style.transform = `translateY(${12 * (1 - entrance)}px)`;
  const count = reducedMotion.matches ? 1 : ease(clamp(age / 900));
  const animatedValue = item => item.value(measurement.report).replace(/-?\d+(?:\.\d+)?/g,
    value => (Number(value) * count).toFixed(1));
  document.querySelector("#scene-value").textContent = animatedValue(scene);
  document.querySelectorAll("#scene-summary strong").forEach((node, i) => {
    node.textContent = animatedValue(scenes[i]);
  });
}

function startScene(next, incoming = true) {
  transitionIn = !!next && incoming;
  tourStart = !!next && !incoming;
  if (freezeUntil) {
    freezeUntil = 0;
    if (!userPaused) video.play().catch(() => {});
  }
  previousFrame = pose ? Math.floor(video.currentTime * pose.fps) - 1 : -1;
  frozenStrikes.clear();
  scene = next;
  sceneElapsed = 0;
  flashStart = -Infinity;
  leanEMA = null;
  lowerThird.hidden = !scene;
  lowerThird.style.opacity = "0";
  stage.classList.toggle("has-scene", !!scene);
  label.hidden = !!scene;
  sceneChips.querySelectorAll("button").forEach(chip => {
    chip.setAttribute("aria-pressed", String(chip.dataset.scene === scene?.id));
  });
  lowerThird.style.setProperty("--scene-accent", scene?.accent || "#22d3ee");
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
    document.querySelector("#scene-title").textContent = `0${scenes.indexOf(scene) + 1} · ${scene.id === "bounce" ? "Bounce" : scene.id === "summary" ? "Summary" : scene.title}`;
    document.querySelector("#scene-value").textContent = scene.value(measurement.report);
    document.querySelector("#scene-caption").textContent = scene.caption;
  }
}

function drawCadence(ctx, frame, index) {
  const strikes = measurement.strikes;
  const alpha = ctx.globalAlpha;
  strikes.forEach(strike => {
    const age = index - strike.frame;
    const heel = frame?.[strike.foot === "left" ? 29 : 30];
    if (age < 0 || age > 12 || !heel) return;
    ctx.globalAlpha = alpha * (1 - age / 13);
    ctx.strokeStyle = strike.foot === "left" ? "#22d3ee" : "#a78bfa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(...project(heel), 7 + age * 2, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = alpha;
  const feet = [27,28,29,30,31,32].map(i => frame?.[i]).filter(Boolean).map(project);
  if (!feet.length) return;
  const width = stageWidth * .6;
  const center = feet.reduce((sum, p) => sum + p[0], 0) / feet.length;
  const [left, boxTop] = hudPosition(center - width / 2, Math.max(...feet.map(p => p[1])), width, 62);
  const top = boxTop + 18;
  ctx.fillStyle = "rgba(11,23,37,.7)";
  ctx.beginPath(); ctx.roundRect(left, top, width, 44, 8); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, 44); ctx.clip();
  strikes.forEach(strike => {
    const distance = strike.frame - index;
    if (Math.abs(distance) > 2 * pose.fps) return;
    const x = left + width / 2 + distance * width / (4 * pose.fps);
    ctx.globalAlpha = alpha * (Math.abs(distance) <= 3 ? 1 : .45);
    ctx.strokeStyle = ctx.shadowColor = strike.foot === "left" ? "#22d3ee" : "#a78bfa";
    ctx.shadowBlur = Math.abs(distance) <= 3 ? 12 : 0;
    const y = top + (strike.foot === "left" ? 6 : 27);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 10); ctx.stroke();
  });
  ctx.restore(); ctx.globalAlpha = alpha; ctx.shadowBlur = 0;
  ctx.strokeStyle = "white"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left + width / 2, top + 3); ctx.lineTo(left + width / 2, top + 41); ctx.stroke();
  ctx.font = "11px monospace"; ctx.fillStyle = "#e6edf3";
  ctx.fillText(`steps ${strikes.filter(strike => strike.frame <= index).length}`, left + 6, top - 5);

}

function drawTrunkLean(ctx, frame, index) {
  if (!frame || ![11,12,23,24].every(i => frame[i])) return;
  const midpoint = (a, b) => project([(frame[a][0] + frame[b][0]) / 2,
    (frame[a][1] + frame[b][1]) / 2]);
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
  if (value != null) leanEMA = leanEMA == null ? value : leanEMA + (value - leanEMA) * (1 - Math.exp(-drawDelta / 150));
  const [left, top] = hudPosition(shoulder[0] + facing(frame) * 70 - 55, shoulder[1] - 85, 110, 110);
  const x = left + 55, y = top + 55;
  ctx.fillStyle = "rgba(11,23,37,.7)";
  ctx.beginPath(); ctx.arc(x, y, 55, 0, Math.PI * 2); ctx.fill();
  const angle = v => Math.PI + clamp(v / 20) * Math.PI;
  ctx.font = "10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let v = 0; v <= 20; v += 5) {
    const a = angle(v);
    ctx.strokeStyle = "#c9d4df"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 38 * Math.cos(a), y + 38 * Math.sin(a));
    ctx.lineTo(x + 44 * Math.cos(a), y + 44 * Math.sin(a)); ctx.stroke();
    if (v % 10 === 0) { ctx.fillStyle = "#c9d4df"; ctx.fillText(String(v), x + 30 * Math.cos(a), y + 30 * Math.sin(a)); }
  }
  const reference = measurement.report.trunk_lean_deg;
  if (reference != null) {
    const a = angle(reference); ctx.strokeStyle = "white"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + 43 * Math.cos(a), y + 43 * Math.sin(a));
    ctx.lineTo(x + 49 * Math.cos(a), y + 49 * Math.sin(a)); ctx.stroke();
  }
  if (leanEMA != null) {
    const a = angle(leanEMA); ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + 36 * Math.cos(a), y + 36 * Math.sin(a)); ctx.stroke();
    ctx.fillStyle = "#e6edf3"; ctx.font = "14px monospace"; ctx.fillText(`${leanEMA.toFixed(1)}°`, x, y + 18);
  }
  ctx.textAlign = "left";

}

function pill(ctx, text, x, y, accent) {
  ctx.font = "bold 15px monospace";
  ctx.textBaseline = "top";
  const width = ctx.measureText(text).width + 12;
  [x, y] = hudPosition(x, y, width, 27);
  ctx.fillStyle = "rgba(11, 23, 37, 0.85)";
  ctx.beginPath(); ctx.roundRect(x, y, width, 27, 6); ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillText(text, x + 6, y + 6);
}

function facing(frame) {
  const differences = [[31,29],[32,30]].filter(([a,b]) => frame?.[a] && frame[b])
    .map(([a,b]) => frame[a][0] - frame[b][0]).sort((a,b) => a-b);
  return Math.sign(differences.reduce((a,b) => a+b, 0)) || 1;
}

function drawKnee(ctx, frame, index) {
  const alpha = ctx.globalAlpha;
  const direction = facing(frame);
  const area = safeArea();
  const historyWidth = 85, pillWidth = 66, gap = 88;
  const latest = measurement.strikes.filter(s => s.frame <= index).at(-1);
  const anchor = frame?.[latest?.foot === "right" ? 26 : 25];
  const kneeX = anchor ? project(anchor)[0] : stageWidth / 2;
  const divider = Math.max(area.left + (direction > 0 ? historyWidth : pillWidth) + gap / 2,
    Math.min(area.right - (direction > 0 ? pillWidth : historyWidth) - gap / 2, kneeX));
  const pillX = direction > 0 ? divider + gap / 2 : divider - gap / 2 - pillWidth;
  const historyX = direction > 0 ? divider - gap / 2 - historyWidth : divider + gap / 2;
  measurement.strikes.forEach((strike, i) => {
    const age = index - strike.frame;
    if (age < 0 || age > 15) return;
    const ids = strike.foot === "left" ? [23,25,27] : [24,26,28];
    if (!frame || !ids.every(id => frame[id])) return;
    const [hip, knee, ankle] = ids.map(id => project(frame[id]));
    ctx.globalAlpha = alpha * (1 - age / 16);
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
    if (value != null) pill(ctx, `${Math.round(value)}°`, pillX, knee[1] - 14, "#f472b6");
  });
  ctx.globalAlpha = alpha;
  const history = measurement.strikes.map((strike, i) => ({...strike, value: measurement.series.knee_at_strike_deg[i]}))
    .filter(s => s.frame <= index && s.value != null).slice(-5).reverse();
  const kneeId = history[0]?.foot === "left" ? 25 : 26;
  if (frame?.[kneeId]) {
    const knee = project(frame[kneeId]);
    const [x, y] = hudPosition(historyX, knee[1], historyWidth, history.length * 19);
    ctx.textBaseline = "top";
    history.forEach((strike, i) => {
      ctx.globalAlpha = alpha * (1 - i * .18);
      ctx.font = `${i ? 13 : 15}px monospace`; ctx.fillStyle = i ? "#c9d4df" : "#f472b6";
      ctx.fillText(`${strike.value.toFixed(1)}°`, x, y + i * 19);
    });
  }

}

function hipPoint(index) {
  const frame = pose.frames[index];
  if (!frame?.[23] || !frame[24]) return null;
  return project([(frame[23][0] + frame[24][0]) / 2,
    (frame[23][1] + frame[24][1]) / 2]);
}

function drawBounce(ctx, frame, index) {
  const hip = hipPoint(index);
  if (!hip) return;
  const alpha = ctx.globalAlpha;
  const windowFrames = Math.max(1, Math.round(3 * pose.fps));
  const start = Math.max(0, index - windowFrames);
  const x = i => hip[0] - (index - i) * stageWidth * .5 / windowFrames;
  ctx.strokeStyle = ctx.shadowColor = "#34d399";
  ctx.shadowBlur = 12; ctx.lineWidth = 2.5;
  let previous = null;
  for (let i = start; i <= index; i++) {
    const point = hipPoint(i);
    if (!point) { previous = null; continue; }
    ctx.globalAlpha = alpha * (1 - .85 * (index - i) / windowFrames);
    if (previous) { ctx.beginPath(); ctx.moveTo(...previous); ctx.lineTo(x(i), point[1]); ctx.stroke(); }
    previous = [x(i), point[1]];
  }
  ctx.globalAlpha = alpha; ctx.shadowBlur = 0;
  const strides = measurement.strides.filter(s => s.foot === measurement.strides[0]?.foot);
  const current = strides.find(s => s.start <= index && index <= s.end);
  if (current) {
    ctx.strokeStyle = "rgba(52,211,153,.35)"; ctx.lineWidth = 1; ctx.setLineDash([6,5]);
    [current.top, current.bottom].forEach(i => {
      const point = hipPoint(i); if (!point) return;
      ctx.beginPath(); ctx.moveTo(x(index - windowFrames), point[1]); ctx.lineTo(hip[0], point[1]); ctx.stroke();
    });
    ctx.setLineDash([]);
  }
  let labelRight = -Infinity;
  strides.filter(s => s.top >= start && s.top <= index).sort((a,b) => a.top-b.top).forEach(s => {
    const top = hipPoint(s.top), bottom = hipPoint(s.bottom);
    if (!top || !bottom) return;
    const px = x(s.top);
    ctx.strokeStyle = "rgba(201,212,223,.6)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, bottom[1]); ctx.lineTo(px, top[1]); ctx.stroke();
    const text = `${(s.value * 100).toFixed(1)}%`;
    ctx.font = "12px monospace"; ctx.textBaseline = "top";
    const width = ctx.measureText(text).width + 12;
    const [left, y] = hudPosition(px - width / 2, top[1] - 26, width, 22);
    if (left <= labelRight + 6) return;
    ctx.fillStyle = "rgba(11,23,37,.85)";
    ctx.beginPath(); ctx.roundRect(left, y, width, 22, 5); ctx.fill();
    ctx.fillStyle = "#e6edf3"; ctx.fillText(text, left + 6, y + 5);
    labelRight = left + width;
  });
  ctx.fillStyle = ctx.shadowColor = "#34d399"; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(...hip, 5, 0, Math.PI * 2); ctx.fill();
}

window.__runform = Object.freeze({
  get phase() { return phase; },
  get scene() { return scene?.id ?? null; },
  get frameIndex() { return frameIndex; },
  get camera() { return {...camera}; },
  get rate() { return video.playbackRate; }
});

function clearStage() {
  cancelAnimationFrame(animation);
  phase = "idle";
  titleCard.hidden = true;
  speedMarker.hidden = true;
  speedMarker.classList.remove("visible");
  backdrop.hidden = true;
  backdropTick = 0;
  backdropCtx.clearRect(0, 0, backdrop.width, backdrop.height);
  focusBox = null;
  Object.assign(camera, {cx: .5, cy: .5, scale: 1});
  cameraTarget = {...camera};
  applyCamera();
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
  ctx.clearRect(0, 0, stageWidth, stageHeight);
}

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  const box = {width: stage.clientWidth, height: stage.clientHeight};
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  pictureWidth = video.videoWidth * scale;
  pictureHeight = video.videoHeight * scale;
  stageWidth = box.width;
  stageHeight = box.height;
  canvas.style.width = `${stageWidth}px`;
  canvas.style.height = `${stageHeight}px`;
  canvas.style.left = "0";
  canvas.style.top = "0";
  video.style.width = `${pictureWidth}px`;
  video.style.height = `${pictureHeight}px`;
  video.style.left = "0";
  video.style.top = "0";
  limitCamera(camera);
  applyCamera();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(stageWidth * ratio);
  canvas.height = Math.round(stageHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Ambient fill needs no high-DPI detail beneath its blur.
  backdrop.width = Math.max(1, Math.round(stageWidth / 2));
  backdrop.height = Math.max(1, Math.round(stageHeight / 2));
  backdropTick = 0;
  drawBackdrop();
}
window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(video);

function setSpeed(speed) {
  baseRate = speed;
  document.querySelectorAll("[data-speed]").forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
  });
}

function goLive() {
  phase = "live";
  veil.style.opacity = "0";
  label.textContent = "Live tracking";
  sceneChips.querySelectorAll("button").forEach(chip => { chip.disabled = false; });
  startScene(scenes[0], false);
  playButton.disabled = false;
  replayButton.disabled = false;
  video.play().catch(() => { playButton.textContent = "Play"; });
}

function beginIntro() {
  startScene(null);
  sceneChips.querySelectorAll("button").forEach(chip => { chip.disabled = true; });
  userPaused = false;
  video.pause();
  phase = reducedMotion.matches ? "seeking" : "title";
  phaseStart = performance.now();
  titleCard.hidden = reducedMotion.matches;
  backdrop.hidden = !reducedMotion.matches;
  backdropTick = 0;
  titleCard.style.opacity = "1";
  titleDetail.textContent = "";
  titleCard.querySelector("strong").style.opacity = "0";
  focusBox = null;
  updateCamera(pose.frames[firstFrame], 0, phaseStart, true);
  playButton.disabled = true;
  replayButton.disabled = true;
  veil.style.opacity = ".65";
  label.textContent = "Tracking 33 body points...";
  lastPose = null;
  opacity = 0;
  setSpeed(0.5);
  const target = firstFrame / pose.fps;
  const ready = () => {
    if (!["title", "seeking"].includes(phase)) return;
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
    if (["title", "seeking"].includes(phase) && !video.seeking) seekReady = true;
  };
  video.src = objectURL;
  lastTime = performance.now();
  animation = requestAnimationFrame(tick);
}

function color(index) { return index % 2 ? "#22d3ee" : "#a78bfa"; }
function overlayAlpha() {
  return scene ? ease(clamp(sceneElapsed / 700)) * ease(clamp((sceneDuration() - sceneElapsed) / 600)) : 0;
}

function draw(frame, jointProgress, boneProgress) {
  ctx.globalAlpha = opacity * (scene && scene.id !== "summary" ? 1 - .6 * overlayAlpha() : 1);
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
    ctx.moveTo(...project([x, y]));
    ctx.lineTo(...project([x + (endX-x) * progress, y + (endY-y) * progress]));
    ctx.stroke();
  });
  joints.forEach((index, i) => {
    if (!frame[index]) return;
    const progress = clamp(jointProgress * (joints.length + 4) - i);
    if (!progress) return;
    ctx.fillStyle = ctx.shadowColor = color(index);
    ctx.beginPath();
    ctx.arc(...project(frame[index]), 3.2 * progress, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function tick(now) {
  const wallDelta = Math.max(0, now - lastTime);
  const delta = Math.min(100, wallDelta);
  drawDelta = wallDelta;
  if (scene && !userPaused && (freezeUntil || (!video.paused && !video.seeking))) {
    sceneElapsed += wallDelta;
    if (sceneElapsed >= sceneDuration()) startScene(scenes[scenes.indexOf(scene) + 1] || null);
  }
  updateLowerThird();
  lastTime = now;
  label.style.visibility = phase === "title" ? "hidden" : "";
  if (phase === "title") {
    const age = now - phaseStart;
    const text = `${measurement.report.frames_total} frames · ${measurement.report.fps ?? pose.fps} fps · 33 points per frame`;
    titleCard.querySelector("strong").style.opacity = String(clamp(age / 450));
    titleDetail.textContent = text.slice(0, Math.floor(clamp((age - 350) / 850) * text.length));
    titleCard.style.opacity = String(1 - clamp((age - 1200) / 400));
    if (age >= 1600) { phase = "seeking"; titleCard.hidden = true; }
  }
  if (phase === "seeking" && seekReady) {
    phase = "joints";
    phaseStart = now;
    introStart = now;
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
      flashStart = now;
      video.pause();
      video.currentTime = (frameIndex + .5) / pose.fps;
    }
  }
  updateRate(wallDelta, now);
  previousFrame = frameIndex;
  const frame = pose.frames[frameIndex];
  if (frame) { lastPose = frame; opacity = Math.min(1, opacity + delta / 120); }
  else opacity = Math.max(0, opacity - delta / 250);
  updateCamera(frame, wallDelta, now);
  drawBackdrop();
  ctx.clearRect(0, 0, stageWidth, stageHeight);
  if (lastPose && !["title", "seeking"].includes(phase)) draw(lastPose,
    phase === "joints" ? clamp(elapsed / 1100) : 1,
    phase === "joints" ? 0 : phase === "bones" ? clamp(elapsed / 1400) : 1);
  if (scene) {
    ctx.save();
    ctx.globalAlpha = overlayAlpha();
    scene.draw(ctx, frame, frameIndex);
    ctx.restore();
  }
  if (scene?.id === "knee" && !reducedMotion.matches) {
    ctx.fillStyle = `rgba(255,255,255,${.22 * overlayAlpha() * (1 - clamp((now - flashStart) / 300))})`;
    ctx.fillRect(0, 0, stageWidth, stageHeight);
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
