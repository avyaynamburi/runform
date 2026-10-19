const input = document.querySelector("#video-input");
const dropZone = document.querySelector("#drop-zone");
const uploadSection = document.querySelector("#upload-section");
const processing = document.querySelector("#processing");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
let busy = false;

function reset() {
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
    renderResults((await response.json()).report);
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
