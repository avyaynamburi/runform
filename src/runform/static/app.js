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
  const id = intro ? "intro" : scene?.id;
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
    id: "trunk-lean", title: "Trunk lean", accent: "#f59e0b",
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

const chartPanel = document.querySelector("#chart-panel");
const chartCanvas = document.querySelector("#measurement-chart");
const chartCtx = chartCanvas.getContext("2d");
let chartHover = null;
let chartData = null;
const currentBeat = () => !scene ? null : scene.id === "summary" || sceneElapsed >= 4000 ? "video" : "chart";
const chartProgress = document.querySelector("#chart-progress");
let displayedBeat = null;
let touchStart = null;

function plotBounds() {
  const small = stageWidth < 540;
  return {left: small ? 46 : 56, right: stageWidth - (small ? 12 : 24),
    top: (small ? 100 : 76) + (chartData?.id === "bounce" ? 24 : 0), bottom: stageHeight - 40};
}
function resetChartHover() {
  chartHover = null;
  touchStart = null;
}
function updateChartHover(event, touch = false) {
  resetChartHover();
  if (currentBeat() !== "chart") return;
  const rect = chartCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const bounds = plotBounds();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
  chartHover = {x, y, expiresAt: touch ? performance.now() + 2000 : null};
}
for (const type of ["pointerenter", "pointermove"]) {
  chartPanel.addEventListener(type, event => {
    if (event.pointerType !== "touch") updateChartHover(event);
  });
}
chartPanel.addEventListener("pointerleave", event => {
  if (event.pointerType !== "touch") resetChartHover();
});
chartPanel.addEventListener("pointerdown", event => {
  if (event.pointerType === "touch") {
    resetChartHover();
    touchStart = {x: event.clientX, y: event.clientY};
  }
});
chartPanel.addEventListener("pointerup", event => {
  if (event.pointerType !== "touch") return;
  const tap = touchStart && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) < 12;
  if (tap) updateChartHover(event, true);
  else resetChartHover();
});
chartPanel.addEventListener("pointercancel", resetChartHover);

function syncBeat() {
  const beat = currentBeat();
  if (displayedBeat !== beat) resetChartHover();
  displayedBeat = beat;
  sceneCard.classList.toggle("chart-beat", beat === "chart");
  sceneCard.setAttribute("aria-hidden", String(!scene || beat === "chart"));
}

function buildChart(id) {
  const report = measurement.report, series = measurement.series;
  const points = [];
  const add = (frame, value, foot = null) => points.push({
    t: frame / pose.fps, value, color: foot ? (foot === "left" ? "#0e9fbf" : "#8b5cf6") :
      id === "bounce" ? "#34d399" : "#f59e0b"
  });
  let title, unit, reference = null, referenceLabel = "", band = null;
  if (id === "cadence") {
    title = "Step rate, stride by stride"; unit = "steps per minute";
    for (const foot of ["left", "right"]) {
      const strikes = measurement.strikes.filter(s => s.foot === foot).sort((a, b) => a.frame - b.frame);
      strikes.slice(1).forEach((s, i) => {
        if (s.frame > strikes[i].frame) add(s.frame, 120 * pose.fps / (s.frame - strikes[i].frame), foot);
      });
    }
    reference = report.cadence_spm;
    referenceLabel = `median ${reference} spm`;
  } else if (id === "trunk-lean") {
    title = "Trunk lean over time"; unit = "degrees";
    series.trunk_lean_deg.forEach((v, i) => add(i, v));
    reference = report.trunk_lean_deg;
    referenceLabel = `average ${reference}°`;
  } else if (id === "knee") {
    title = "Knee angle at each foot strike"; unit = "degrees";
    measurement.strikes.forEach((s, i) => add(s.frame, series.knee_at_strike_deg[i], s.foot));
    reference = report.knee_flexion_at_strike_deg?.mean;
    const std = report.knee_flexion_at_strike_deg?.std;
    if (reference != null && std != null) band = [reference - std, reference + std];
    referenceLabel = `${reference}° average`;
  } else {
    title = "Hip height through each stride"; unit = "% of body height";
    series.hip_height_rel.forEach((v, i) => add(i, v == null ? null : v * 100));
    referenceLabel = report.vertical_oscillation_rel == null ? "" :
      `average bounce ${(report.vertical_oscillation_rel * 100).toFixed(1)}% of body height`;
  }
  points.sort((a, b) => a.t - b.t);
  const clipDuration = Math.max(1 / pose.fps, (pose.frames.length - 1) / pose.fps);
  const duration = id === "bounce" ? Math.min(6, clipDuration) : clipDuration;
  const start = id === "bounce" ?
    Math.max(0, Math.min(Math.floor(Math.floor(video.currentTime * pose.fps) / pose.fps), clipDuration - duration)) : 0;
  const visiblePoints = points.filter(p => p.t >= start && p.t <= start + duration);
  const values = visiblePoints.filter(p => p.value != null && Number.isFinite(p.value)).map(p => p.value);
  if (reference != null) values.push(reference);
  if (band) values.push(...band);
  let min = values.length ? values.reduce((a, b) => Math.min(a, b)) : 0;
  let max = values.length ? values.reduce((a, b) => Math.max(a, b)) : 1;
  const padding = Math.max((max - min) * .1, id === "cadence" ? 10 : id === "bounce" ? .5 : 1);
  min -= padding; max += padding;
  // Round the domain outwards to a readable 1/2/5 tick interval.
  const raw = (max - min) / 3, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find(n => n * power >= raw) * power;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  return {id, title, unit, points, visiblePoints, start, duration, min, max, step, reference, referenceLabel, band,
    dual: id === "cadence" || id === "knee"};
}

function drawChart() {
  if (!chartData || !stageWidth || !stageHeight) return;
  const c = chartCtx, d = chartData, w = stageWidth, h = stageHeight;
  const small = w < 540;
  const {left, right, top, bottom} = plotBounds();
  const x = time => left + (time - d.start) / d.duration * (right - left);
  const y = value => bottom - (value - d.min) / (d.max - d.min) * (bottom - top);
  const reveal = reducedMotion.matches ? 1 : clamp(sceneElapsed / 2000);
  const fade = reducedMotion.matches ? 1 : clamp((sceneElapsed - 2000) / 400);
  c.clearRect(0, 0, w, h);
  c.textBaseline = "alphabetic"; c.textAlign = "left";
  const valueRight = right - (d.dual && !small ? 156 : 0);
  const value = scene.value(measurement.report);
  c.fillStyle = "#e6edf3"; c.font = "22px monospace"; c.textAlign = "right";
  c.fillText(value, valueRight, 28);
  const titleWidth = Math.max(12, valueRight - c.measureText(value).width - 32);
  c.font = "600 15px sans-serif"; c.textAlign = "left";
  let title = d.title;
  while (title.length && c.measureText(title).width > titleWidth) title = title.slice(0, -1);
  if (title !== d.title) {
    while (title.length && c.measureText(title + "…").width > titleWidth) title = title.slice(0, -1);
    title += "…";
  }
  c.fillText(title, 16, 26);
  c.font = "12px sans-serif"; c.fillStyle = "#8b98a5";
  c.fillText(d.unit, left, top - 12);
  if (d.dual) {
    const legendY = small ? 50 : 26;
    ["Left", "Right"].forEach((name, i) => {
      const lx = right - 132 + i * 70;
      c.fillStyle = i ? "#8b5cf6" : "#0e9fbf"; c.fillRect(lx, legendY - 8, 14, 3);
      c.fillStyle = "#e6edf3"; c.fillText(name, lx + 20, legendY);
    });
  }
  c.strokeStyle = "#1f2933"; c.lineWidth = 1;
  const tickStride = Math.max(1, Math.ceil((d.max - d.min) / d.step / (small ? 3 : 4)));
  for (let v = d.min; v <= d.max + d.step / 100; v += d.step * tickStride) {
    c.beginPath(); c.moveTo(left, y(v)); c.lineTo(right, y(v)); c.stroke();
    c.fillStyle = "#8b98a5"; c.textAlign = "right";
    c.fillText(String(Number(v.toFixed(2))), left - 8, y(v) + 4);
  }
  c.textAlign = "center";
  const ticks = small ? 3 : 4;
  for (let i = 0; i <= ticks; i++) {
    const time = d.start + d.duration * i / ticks;
    c.fillText(time.toFixed(1), x(time), bottom + 18);
  }
  c.fillText("Time (s)", (left + right) / 2, h - 5);
  const textPill = (text, px, py, align = "right", ink = "#8b98a5") => {
    c.font = "12px sans-serif";
    const width = c.measureText(text).width + 12;
    const tx = Math.max(4, Math.min(w - width - 4, align === "right" ? px - width : px));
    const ty = Math.max(4, Math.min(h - 26, py));
    c.fillStyle = "#0b0f14"; c.beginPath(); c.roundRect(tx, ty, width, 24, 5); c.fill();
    c.fillStyle = ink; c.textAlign = "left"; c.fillText(text, tx + 6, ty + 16);
  };
  c.save();
  c.beginPath(); c.rect(left, top, (right - left) * reveal, bottom - top); c.clip();
  if (d.band) {
    c.fillStyle = "rgba(230,237,243,.08)";
    c.fillRect(left, y(d.band[1]), right - left, y(d.band[0]) - y(d.band[1]));
  }
  const dot = (px, py, color) => {
    c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2);
    c.fillStyle = color; c.fill(); c.strokeStyle = "#0b0f14"; c.lineWidth = 2; c.stroke();
  };
  if (!d.dual) {
    c.strokeStyle = d.id === "bounce" ? "#34d399" : "#f59e0b"; c.lineWidth = 2;
    c.beginPath();
    let connected = false;
    d.visiblePoints.forEach(p => {
      if (p.value == null || !Number.isFinite(p.value)) { connected = false; return; }
      if (connected) c.lineTo(x(p.t), y(p.value)); else c.moveTo(x(p.t), y(p.value));
      connected = true;
    });
    c.stroke();
  } else d.visiblePoints.forEach(p => { if (p.value != null) dot(x(p.t), y(p.value), p.color); });
  if (d.id === "bounce") {
    const strides = measurement.strides;
    let previousLabelRight = -Infinity;
    const inWindow = p => p && p.t >= d.start && p.t <= d.start + d.duration;
    strides.filter(s => s.foot === strides[0]?.foot)
      .sort((a, b) => a.top - b.top).forEach(s => {
        const a = d.points[s.top], b = d.points[s.bottom];
        if (a?.value == null || b?.value == null || !(inWindow(a) || inWindow(b))) return;
        const px = x(a.t), ya = y(a.value), yb = y(b.value);
        c.strokeStyle = "#8b98a5"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(px, ya); c.lineTo(px, yb); c.stroke();
        if (inWindow(a)) dot(px, ya, "#34d399");
        if (inWindow(b)) dot(x(b.t), yb, "#34d399");
        if (!inWindow(a)) return;
        const text = `${(s.value * 100).toFixed(1)}%`;
        c.font = "12px sans-serif";
        const width = c.measureText(text).width + 12;
        const labelLeft = Math.max(left, Math.min(right - width, px - width / 2));
        // Skip labels that collide with the preceding visible stride label.
        const labelTop = Math.max(top + 2, ya - 27);
        if (labelLeft <= previousLabelRight + 6 || labelLeft + width > left + (right - left) * reveal) return;
        textPill(text, labelLeft, labelTop, "left", "#e6edf3");
        previousLabelRight = labelLeft + width;
      });
  }
  c.restore();
  c.globalAlpha = fade;
  if (d.reference != null) {
    c.strokeStyle = "#8b98a5"; c.lineWidth = 1.5; c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(left, y(d.reference)); c.lineTo(right, y(d.reference)); c.stroke();
    c.setLineDash([]);
    textPill(d.referenceLabel, right, y(d.reference) - 27);
  } else if (d.referenceLabel) textPill(d.referenceLabel, right, top - 44);
  c.globalAlpha = 1;
  if (!d.visiblePoints.some(p => p.value != null)) {
    c.fillStyle = "#e6edf3"; c.textAlign = "center";
    c.fillText("No measurement data available", (left + right) / 2, (top + bottom) / 2);
  }
  if (chartHover && currentBeat() === "chart") {
    const candidates = d.visiblePoints.filter(p => p.value != null && x(p.t) <= left + (right - left) * reveal);
    const nearest = candidates.reduce((a, b) => !a || Math.abs(x(b.t) - chartHover.x) < Math.abs(x(a.t) - chartHover.x) ? b : a, null);
    if (nearest) {
      c.strokeStyle = "#8b98a5"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x(nearest.t), top); c.lineTo(x(nearest.t), bottom); c.stroke();
      textPill(`${nearest.t.toFixed(2)} s · ${nearest.value.toFixed(1)} ${d.unit}`,
        x(nearest.t) + 8, chartHover.y - 30, "left", "#e6edf3");
    }
  }
}

function startScene(next) {
  if (freezeUntil) {
    freezeUntil = 0;
    if (!userPaused) video.play().catch(() => {});
  }
  previousFrame = pose ? Math.floor(video.currentTime * pose.fps) - 1 : -1;
  frozenStrikes.clear();
  scene = next;
  sceneElapsed = 0;
  resetChartHover();
  syncBeat();
  chartProgress.style.width = "0%";
  chartPanel.style.setProperty("--scene-accent", scene?.accent || "#22d3ee");
  chartData = scene && scene.id !== "summary" ? buildChart(scene.id) : null;
  chartCanvas.setAttribute("aria-label", chartData ? `${chartData.title}: ${scene.value(measurement.report)}` : "Measurement over time");
  chartPanel.hidden = !chartData;
  chartPanel.style.opacity = "1";
  chartPanel.style.pointerEvents = chartData ? "auto" : "none";
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
    ctx.arc(...project(heel), 7 + age * 2, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  const left = 12, width = Math.max(1, stageWidth - 24), top = stageHeight * .94 - 44;
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
  x = Math.max(0, Math.min(x, stageWidth - width));
  y = Math.max(0, Math.min(y, stageHeight - 27));
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
    const [hip, knee, ankle] = ids.map(id => project(frame[id]));
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
  return project([(frame[23][0] + frame[24][0]) / 2,
    (frame[23][1] + frame[24][1]) / 2]);
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
  get beat() { return currentBeat(); },
  get frameIndex() { return frameIndex; },
  get camera() { return {...camera}; }
});

function clearStage() {
  cancelAnimationFrame(animation);
  phase = "idle";
  titleCard.hidden = true;
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
  chartCanvas.width = Math.round(stageWidth * ratio);
  chartCanvas.height = Math.round(stageHeight * ratio);
  chartCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Ambient fill needs no high-DPI detail beneath its blur.
  backdrop.width = Math.max(1, Math.round(stageWidth / 2));
  backdrop.height = Math.max(1, Math.round(stageHeight / 2));
  backdropTick = 0;
  drawBackdrop();
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
  if (chartHover?.expiresAt != null && now >= chartHover.expiresAt) resetChartHover();
  if (chartHover) {
    const bounds = plotBounds();
    if (chartHover.x < bounds.left || chartHover.x > bounds.right ||
        chartHover.y < bounds.top || chartHover.y > bounds.bottom) resetChartHover();
  }
  if (scene && !userPaused && !(currentBeat() === "chart" && chartHover) &&
      (freezeUntil || (!video.paused && !video.seeking))) {
    sceneElapsed += wallDelta;
    const duration = scene.id === "summary" ? 8000 : 11000;
    if (sceneElapsed >= duration) startScene(scenes[scenes.indexOf(scene) + 1] || null);
    progressFill.style.width = `${clamp(sceneElapsed / (scene?.id === "summary" ? 8000 : 11000)) * 100}%`;
  }
  syncBeat();
  chartProgress.style.width = scene ? `${clamp(sceneElapsed / (scene.id === "summary" ? 8000 : 11000)) * 100}%` : "0%";
  if (chartData) {
    const fade = clamp((sceneElapsed - 4000) / 250);
    chartPanel.hidden = fade >= 1;
    chartPanel.style.opacity = String(1 - fade);
    chartPanel.style.pointerEvents = currentBeat() === "chart" ? "auto" : "none";
    if (currentBeat() !== "chart") resetChartHover();
    if (!chartPanel.hidden) drawChart();
  }
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
  if (scene?.id === "knee" && currentBeat() === "video" && !userPaused && !freezeUntil && !video.paused && !video.seeking) {
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
  updateCamera(frame, wallDelta, now);
  drawBackdrop();
  ctx.clearRect(0, 0, stageWidth, stageHeight);
  if (lastPose && !["title", "seeking"].includes(phase)) draw(lastPose,
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
