// Adapted from the existing RunStats dashboard; source project remains unchanged.
// ── Theme ──────────────────────────────────────────────────────────────────

let _lastSorted = null;
let _demoMode = true;
let _report = null;
let _dataRequest = 0;
let _authRequest = 0;
let _modalRequest = 0;
let _modalOpener = null;

function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

function chartLineColor() {
  return isDark() ? '#22d3ee' : '#087f99';
}

function chartFillColor() {
  return isDark() ? 'rgba(34,211,238,.08)' : 'rgba(8,127,153,.08)';
}

(function initTheme() {
  try {
    const saved = localStorage.getItem('runform-analytics-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch { /* Storage is optional. */ }
})();

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle');
  btn.textContent = isDark() ? 'Light theme' : 'Dark theme';
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('runform-analytics-theme', next); } catch { /* Storage is optional. */ }
    btn.textContent = next === 'dark' ? 'Light theme' : 'Dark theme';
    if (_lastSorted) renderCharts(_lastSorted);
  });

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showPage(tab.dataset.page));
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────

// Parse "M:SS" pace string → decimal minutes
function paceToDecimal(str) {
  if (!str) return null;
  const parts = String(str).split(':');
  if (parts.length === 2) return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  return null;
}

// Decimal minutes → "M:SS" string
function formatPace(dec) {
  if (!dec) return '—';
  const total = Math.round(dec * 60);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Format a date string — 'short' = "May 19", 'full' = "May 19, 2026"
function formatDate(str, style = 'full') {
  if (!str || str === '—') return '—';
  const d = new Date(str.replace(' ', 'T'));
  if (isNaN(d)) return '—';
  if (style === 'short') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format "HH:MM:SS" duration string for display
function formatDuration(str) {
  if (!str) return '—';
  const parts = String(str).split(':').map(Number);
  if (parts.length === 3) {
    if (parts[0] === 0) return `${parts[1]}:${String(parts[2]).padStart(2, '0')}`;
    return `${parts[0]}:${String(parts[1]).padStart(2, '0')}:${String(parts[2]).padStart(2, '0')}`;
  }
  return str;
}

function fmt1(n) { return n != null ? Number(n).toFixed(1) : '—'; }
function fmt0(n) { return n != null ? Math.round(Number(n)).toString() : '—'; }

// ── Garmin percentile zone system ─────────────────────────────────────────
// Zone 4 = top 5% (green), Zone 0 = bottom 5% (red)

function _zone(metric, v) {
  if (v == null) return -1;
  switch (metric) {
    case 'cadence':   return v > 185 ? 4 : v >= 174 ? 3 : v >= 163 ? 2 : v >= 151 ? 1 : 0;
    case 'gct':       return v < 208 ? 4 : v <= 240 ? 3 : v <= 272 ? 2 : v <= 305 ? 1 : 0;
    case 'vertOsc':   return v < 6.4 ? 4 : v <= 8.1 ? 3 : v <= 9.7 ? 2 : v <= 11.5 ? 1 : 0;
    case 'vertRatio': return v < 6.1 ? 4 : v <= 7.5 ? 3 : v <= 9.0 ? 2 : v <= 10.9 ? 1 : 0;
    default: return -1;
  }
}
const ZONE_COLORS  = ['#e03131', '#e8590c', '#f08c00', '#099268', '#2f9e44'];
const ZONE_CLASSES = ['zone-1', 'zone-2', 'zone-3', 'zone-4', 'zone-5'];

function zoneColor(metric, v) {
  const i = _zone(metric, v);
  return i >= 0 ? ZONE_COLORS[i] : '#8b90a7';
}
function zoneClass(metric, v) {
  const i = _zone(metric, v);
  return i >= 0 ? ZONE_CLASSES[i] : '';
}
const ZONE_LABELS = ['bottom 5%', '5–29th pct', '30–69th pct', '70–95th pct', 'top 5%'];
function _zoneLabel(metric, v) {
  const i = _zone(metric, v);
  return i >= 0 ? ZONE_LABELS[i] : '';
}

// ── Avatar ─────────────────────────────────────────────────────────────────

const AVATAR_STATUS = {
  hyped:     "You're crushing it!",
  happy:     "Keep it up!",
  restless:  "It's been a few days…",
  sad:       "Your shoes miss you.",
  desperate: "Come on… just one run.",
};

const AVATAR_SVGS = {
  // Blob style: single ellipse body, bezier arms/legs, expressive face
  hyped: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="55" rx="35" ry="42" fill="currentColor"/>
  <path d="M 25 46 Q 4 32 8 18" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 75 46 Q 96 32 92 18" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 36 93 Q 28 107 24 120" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 64 93 Q 72 107 76 120" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <circle cx="22" cy="60" r="10" fill="rgba(255,182,193,0.28)"/>
  <circle cx="78" cy="60" r="10" fill="rgba(255,182,193,0.28)"/>
  <path d="M 32 43 Q 38 35 44 43" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M 56 43 Q 62 35 68 43" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M 27 60 Q 50 80 73 60" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`,
  happy: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="62" rx="35" ry="44" fill="currentColor"/>
  <path d="M 24 66 Q 6 80 8 96" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 76 66 Q 94 80 92 96" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 37 103 Q 30 115 26 126" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 63 103 Q 70 115 74 126" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <circle cx="39" cy="51" r="4.5" fill="white"/>
  <circle cx="61" cy="51" r="4.5" fill="white"/>
  <path d="M 34 66 Q 50 80 66 66" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`,
  restless: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="65" rx="34" ry="43" fill="currentColor"/>
  <path d="M 25 66 Q 8 64 4 68" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 75 66 Q 92 64 96 68" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 37 105 Q 30 117 26 127" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 63 105 Q 70 117 74 127" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <circle cx="39" cy="54" r="4.5" fill="white"/>
  <circle cx="61" cy="54" r="4.5" fill="white"/>
  <line x1="38" y1="70" x2="62" y2="70" stroke="white" stroke-width="3" stroke-linecap="round"/>
</svg>`,
  sad: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="70" rx="34" ry="42" fill="currentColor"/>
  <path d="M 25 74 Q 8 90 10 106" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 75 74 Q 92 90 90 106" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 37 109 Q 30 119 27 128" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 63 109 Q 70 119 73 128" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 35 58 Q 40 54 45 58" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M 55 58 Q 60 54 65 58" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M 35 77 Q 50 68 65 77" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M 37 65 Q 34 70 37 74 Q 40 70 37 65 Z" fill="rgba(173,216,230,0.9)"/>
</svg>`,
  desperate: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="84" rx="40" ry="34" fill="currentColor"/>
  <path d="M 22 80 Q 6 98 8 114" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <path d="M 78 80 Q 94 98 92 114" stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/>
  <line x1="37" y1="72" x2="45" y2="80" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="45" y1="72" x2="37" y2="80" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="55" y1="72" x2="63" y2="80" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="63" y1="72" x2="55" y2="80" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <path d="M 28 94 Q 50 82 72 94" stroke="white" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`,
};

function getAvatarState(runs) {
  if (!runs || runs.length === 0) return 'desperate';
  const sorted = [...runs].sort((a, b) =>
    new Date(b.date.replace(' ', 'T')) - new Date(a.date.replace(' ', 'T'))
  );
  const latest   = sorted[0];
  const lastDate = new Date(latest.date.replace(' ', 'T'));
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((today - lastDate) / 86_400_000);
  if (daysSince === 0) {
    const cadenceGood = latest.cadence   && _zone('cadence', latest.cadence) >= 3;
    const teGood      = latest.aerobicTE && latest.aerobicTE >= 4;
    return (cadenceGood || teGood) ? 'hyped' : 'happy';
  }
  if (daysSince <= 2) return 'happy';
  if (daysSince <= 4) return 'restless';
  if (daysSince <= 6) return 'sad';
  return 'desperate';
}

const HAPPINESS_LEVEL = { hyped: 100, happy: 80, restless: 50, sad: 30, desperate: 10 };
const HAPPINESS_COLOR = {
  hyped:     '#2f9e44',
  happy:     '#099268',
  restless:  '#f08c00',
  sad:       '#e8590c',
  desperate: '#e03131',
};

function renderAvatar(runs) {
  const state = getAvatarState(runs);
  const wrap  = document.getElementById('avatar-wrap');
  wrap.className = `avatar-state avatar-${state}`;
  wrap.innerHTML  = AVATAR_SVGS[state];
  document.getElementById('avatar-status').textContent = AVATAR_STATUS[state];

  const fill = document.getElementById('happiness-bar-fill');
  fill.style.width           = HAPPINESS_LEVEL[state] + '%';
  fill.style.backgroundColor = HAPPINESS_COLOR[state];

  renderMoodStats(runs);
}

function renderMoodStats(runs) {
  // Totals
  let totalDist = 0, totalMinutes = 0;
  (runs || []).forEach(r => {
    if (r.distance) totalDist += r.distance;
    if (r.time) {
      const parts = r.time.split(':').map(Number);
      if (parts.length === 3) totalMinutes += parts[0] * 60 + parts[1] + parts[2] / 60;
    }
  });
  const roundedMinutes = Math.round(totalMinutes);
  const h = Math.floor(roundedMinutes / 60);
  const m = roundedMinutes % 60;

  document.getElementById('mood-total-dist').textContent = totalDist.toFixed(1);
  document.getElementById('mood-total-time').textContent = `${h}h ${m}m`;
  document.getElementById('mood-total-runs').textContent = (runs || []).length;

  // Time since last run
  const lastRunEl = document.getElementById('mood-last-run');
  if (!runs || runs.length === 0) {
    lastRunEl.textContent = '—';
    return;
  }
  const lastDate = new Date(
    [...runs].sort((a, b) =>
      new Date(b.date.replace(' ', 'T')) - new Date(a.date.replace(' ', 'T'))
    )[0].date.replace(' ', 'T')
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((today - lastDate) / 86_400_000);
  lastRunEl.textContent =
    daysSince === 0 ? 'Today'
    : daysSince === 1 ? '1 day'
    : `${daysSince} days`;
}

// ── AI state ───────────────────────────────────────────────────────────────
const _runAnalysisCache = {};   // keyed by run id — avoids re-calling API for same run
let   _allRuns          = [];   // set in renderDashboard, read by trends button


// ── AI: per-run analysis ───────────────────────────────────────────────────

async function fetchRunAnalysis(r) {
  const generation = _modalRequest;
  const resultEl = document.getElementById('run-analysis-result');
  const btn      = document.getElementById('analyze-run-btn');
  if (!resultEl || !btn) return;

  // Cache hit — show instantly
  if (_runAnalysisCache[r.id]) {
    resultEl.textContent = _runAnalysisCache[r.id];
    resultEl.classList.remove('hidden', 'ai-result--error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Analyzing…';
  resultEl.classList.remove('hidden', 'ai-result--error');
  resultEl.innerHTML = '<div class="ai-loading"><div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div><span>Getting coaching feedback…</span></div>';

  try {
    const res  = await fetch('/api/garmin/analyze/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({...r, demo: _demoMode}),
    });
    const data = await res.json();
    if (generation !== _modalRequest) return;

    if (data.error) {
      resultEl.classList.add('ai-result--error');
      resultEl.textContent = 'Could not get analysis: ' + data.error;
    } else {
      _runAnalysisCache[r.id] = data.analysis;
      resultEl.textContent = data.analysis;
    }
  } catch {
    if (generation !== _modalRequest) return;
    resultEl.classList.add('ai-result--error');
    resultEl.textContent = 'Failed to reach the server. Try again.';
  } finally {
    if (generation !== _modalRequest) return;
    btn.disabled    = false;
    btn.textContent = _demoMode ? 'Show sample coaching' : 'Ask Gemini about this run';
  }
}


// ── AI: training trends analysis ───────────────────────────────────────────

async function fetchTrendsAnalysis(runs) {
  const generation = _dataRequest;
  const resultEl = document.getElementById('trends-analysis-result');
  const btn      = document.getElementById('analyze-trends-btn');
  if (!resultEl || !btn) return;

  const recentRuns = [...runs]
    .sort((a, b) => new Date(b.date.replace(' ', 'T')) - new Date(a.date.replace(' ', 'T')))
    .slice(0, 30);

  btn.disabled    = true;
  btn.textContent = 'Analyzing…';
  resultEl.classList.remove('hidden', 'ai-result--error');
  resultEl.innerHTML = '<div class="ai-loading"><div class="loading-spinner" style="width:20px;height:20px;border-width:2px"></div><span>Analyzing your training trends…</span></div>';

  try {
    const res  = await fetch('/api/garmin/analyze/trends', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ runs: recentRuns, demo: _demoMode }),
    });
    const data = await res.json();
    if (generation !== _dataRequest) return;

    if (data.error) {
      resultEl.classList.add('ai-result--error');
      resultEl.textContent = 'Could not get analysis: ' + data.error;
    } else {
      resultEl.textContent = data.analysis;
    }
  } catch {
    if (generation !== _dataRequest) return;
    resultEl.classList.add('ai-result--error');
    resultEl.textContent = 'Failed to reach the server. Try again.';
  } finally {
    if (generation !== _dataRequest) return;
    btn.disabled    = false;
    btn.textContent = _demoMode ? 'Show sample coaching' : 'Analyze my training with Gemini';
  }
}


// ── Screen management ──────────────────────────────────────────────────────

function showScreen(id) {
  ['login-screen', 'mfa-screen', 'loading-screen', 'dashboard'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function showPage(name) {
  document.getElementById('page-dashboard').classList.toggle('hidden', name !== 'dashboard');
  document.getElementById('page-advanced').classList.toggle('hidden', name !== 'dashboard');
  document.getElementById('page-mood').classList.toggle('hidden', name !== 'mood');
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === name);
  });
}

function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('mfa-screen').classList.add('hidden');
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('header-nav').classList.remove('hidden');
  showPage('dashboard');
}


// ── Login ──────────────────────────────────────────────────────────────────

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const authGeneration = ++_authRequest;
  const email    = document.getElementById('email-input').value.trim();
  const password = document.getElementById('password-input').value;
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');

  btn.textContent = 'Signing in…';
  btn.disabled    = true;
  errEl.classList.add('hidden');

  try {
    const res  = await fetch('/api/garmin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (authGeneration !== _authRequest) return;

    if (data.status === 'mfa_required') {
      showScreen('mfa-screen');
      document.getElementById('mfa-input').focus();
      return;
    }
    if (data.status === 'ok') {
      await loadActivities();
      return;
    }
    // Error
    errEl.textContent = data.message || 'Login failed. Check your credentials.';
    errEl.classList.remove('hidden');
  } catch {
    if (authGeneration !== _authRequest) return;
    errEl.textContent = 'Could not reach Runform. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    if (authGeneration !== _authRequest) return;
    document.getElementById('password-input').value = '';
    btn.textContent = 'Sign in';
    btn.disabled    = false;
  }
});


// ── MFA ────────────────────────────────────────────────────────────────────

document.getElementById('mfa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const authGeneration = ++_authRequest;
  const code  = document.getElementById('mfa-input').value.trim();
  const btn   = document.getElementById('mfa-btn');
  const errEl = document.getElementById('mfa-error');

  btn.textContent = 'Verifying…';
  btn.disabled    = true;
  errEl.classList.add('hidden');

  try {
    const res  = await fetch('/api/garmin/mfa', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    const data = await res.json();
    if (authGeneration !== _authRequest) return;

    if (data.status === 'ok') {
      await loadActivities();
      return;
    }
    errEl.textContent = data.message || 'Invalid code. Try again.';
    errEl.classList.remove('hidden');
  } catch {
    if (authGeneration !== _authRequest) return;
    errEl.textContent = 'Server error. Try again.';
    errEl.classList.remove('hidden');
  } finally {
    if (authGeneration !== _authRequest) return;
    document.getElementById('mfa-input').value = '';
    btn.textContent = 'Verify';
    btn.disabled    = false;
  }
});


// ── Logout ─────────────────────────────────────────────────────────────────

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await fetch('/api/garmin/logout', {method: 'POST'}); }
  catch { /* Returning to demo also removes private data from the UI. */ }
  await loadDemo();
});

document.getElementById('connect-garmin').addEventListener('click', () => {
  closeModal();
  ++_authRequest;
  ++_dataRequest;
  showScreen('login-screen');
  document.getElementById('header-nav').classList.add('hidden');
  document.getElementById('email-input').focus();
});
document.querySelectorAll('.return-demo').forEach(button => button.addEventListener('click', loadDemo));

function setDataMode(demo, report) {
  _demoMode = demo;
  _report = report;
  Object.keys(_runAnalysisCache).forEach(key => delete _runAnalysisCache[key]);
  document.getElementById('trends-analysis-result').classList.add('hidden');
  document.getElementById('header-auth').classList.toggle('hidden', demo);
  document.getElementById('connect-garmin').classList.toggle('hidden', !demo);
  document.getElementById('data-mode').textContent = demo ? 'SAMPLE DATA' : 'GARMIN CONNECTED';
  document.getElementById('data-description').textContent = demo
    ? 'An invented training history. Explore the dashboard or connect your Garmin account.'
    : 'Your running history, loaded locally from Garmin Connect. Disconnect to return to the demo.';
  document.getElementById('analyze-trends-btn').disabled = false;
  document.getElementById('analyze-trends-btn').textContent = demo
    ? 'Show sample coaching' : 'Analyze my training with Gemini';
}

async function loadDemo() {
  closeModal();
  ++_authRequest;
  for (const id of ['login-btn', 'mfa-btn']) document.getElementById(id).disabled = false;
  document.getElementById('login-btn').textContent = 'Sign in';
  document.getElementById('mfa-btn').textContent = 'Verify';
  const generation = ++_dataRequest;
  document.getElementById('password-input').value = '';
  document.getElementById('mfa-input').value = '';
  document.getElementById('header-user').textContent = '';
  showScreen('loading-screen');
  try {
    const response = await fetch('/api/garmin/demo');
    const payload = await response.json();
    if (generation !== _dataRequest) return;
    if (!response.ok || payload.error) throw new Error(payload.error || 'Demo unavailable.');
    setDataMode(true, payload.report);
    renderDashboard(payload.activities);
  } catch {
    if (generation !== _dataRequest) return;
    showScreen('login-screen');
    const error = document.getElementById('login-error');
    error.textContent = 'Unable to load the sample dashboard. Check that Runform is running and try again.';
    error.classList.remove('hidden');
  }
}

document.getElementById('analyze-trends-btn').addEventListener('click', () => {
  fetchTrendsAnalysis(_allRuns);
});


// ── Load activities from backend ───────────────────────────────────────────

async function loadActivities() {
  const generation = ++_dataRequest;
  showScreen('loading-screen');
  try {
    const response = await fetch('/api/garmin/activities');
    const payload = await response.json();
    if (generation !== _dataRequest) return;
    if (!response.ok || payload.error) throw new Error(payload.error || 'Unable to load activities.');
    setDataMode(false, payload.report);
    document.getElementById('header-user').textContent = 'Garmin connected';
    renderDashboard(payload.activities);
  } catch (error) {
    if (generation !== _dataRequest) return;
    showScreen('login-screen');
    const element = document.getElementById('login-error');
    element.textContent = error.message;
    element.classList.remove('hidden');
  }
}

// ── Dashboard render ───────────────────────────────────────────────────────

function renderDashboard(runs) {
  _allRuns = runs;

  // Sort oldest → newest for charts
  const sorted = [...runs].sort((a, b) =>
    new Date(a.date.replace(' ', 'T')) - new Date(b.date.replace(' ', 'T'))
  );

  renderSummaryCards(runs);
  renderTable(sorted.slice().reverse()); // newest first in table
  document.getElementById('run-count').textContent = `(${runs.length})`;
  showDashboard();          // show dashboard first so canvases have real dimensions
  renderCharts(sorted);     // draw charts into visible canvases
  renderAvatar(runs);       // draw avatar last (isolated from chart rendering)
}


// ── Summary Cards ──────────────────────────────────────────────────────────

function renderSummaryCards(runs) {
  let totalDist = 0, totalPace = 0, paceCount = 0;
  let totalHR = 0, hrCount = 0;
  let totalCadence = 0, cadCount = 0;
  let totalVR = 0, vrCount = 0;
  let totalGCT = 0, gctCount = 0;
  let totalMinutes = 0;

  runs.forEach(r => {
    if (r.distance)  totalDist += r.distance;

    const p = paceToDecimal(r.avgPace);
    if (p) { totalPace += p; paceCount++; }

    if (r.avgHR)    { totalHR      += r.avgHR;    hrCount++;  }
    if (r.cadence)  { totalCadence += r.cadence;  cadCount++; }
    if (r.vertRatio){ totalVR      += r.vertRatio; vrCount++;  }
    if (r.gct)      { totalGCT     += r.gct;       gctCount++; }

    if (r.time) {
      const parts = r.time.split(':').map(Number);
      if (parts.length === 3) totalMinutes += parts[0] * 60 + parts[1] + parts[2] / 60;
    }
  });

  const totalRunsVal = runs.length;
  const totalDistVal = totalDist.toFixed(1);
  const roundedMinutes = Math.round(totalMinutes);
  const h = Math.floor(roundedMinutes / 60);
  const m = roundedMinutes % 60;
  const totalTimeVal = `${h}h ${m}m`;

  document.getElementById('stat-total-runs').textContent = totalRunsVal;
  document.getElementById('stat-total-dist').textContent = totalDistVal;
  document.getElementById('stat-total-time').textContent = totalTimeVal;

  document.getElementById('stat-avg-pace').textContent =
    _report?.avg_pace || (paceCount ? formatPace(totalPace / paceCount) : '—');
  document.getElementById('stat-avg-hr').textContent =
    hrCount ? fmt0(totalHR / hrCount) : '—';

  const avgCad = cadCount ? totalCadence / cadCount : null;
  const avgVR  = vrCount  ? totalVR  / vrCount  : null;
  const avgGCT = gctCount ? totalGCT / gctCount : null;

  const cadEl = document.getElementById('stat-avg-cadence');
  cadEl.textContent = avgCad ? fmt0(avgCad) : '—';
  cadEl.className   = 'adv-card-value ' + zoneClass('cadence', avgCad);
  document.getElementById('card-avg-cadence').className = 'adv-card ' + zoneClass('cadence', avgCad);

  const vrEl = document.getElementById('stat-avg-vr');
  vrEl.textContent = avgVR ? fmt1(avgVR) : '—';
  vrEl.className   = 'adv-card-value ' + zoneClass('vertRatio', avgVR);
  document.getElementById('card-avg-vr').className = 'adv-card ' + zoneClass('vertRatio', avgVR);

  const gctEl = document.getElementById('stat-avg-gct');
  gctEl.textContent = avgGCT ? fmt0(avgGCT) : '—';
  gctEl.className   = 'adv-card-value ' + zoneClass('gct', avgGCT);
  document.getElementById('card-avg-gct').className = 'adv-card ' + zoneClass('gct', avgGCT);
}


// ── Charts ─────────────────────────────────────────────────────────────────

const chartInstances = {};

function makeChart(id, type, labels, datasets, extraOptions = {}) {
  if (!window.Chart) { document.getElementById('chart-notice').classList.remove('hidden'); return; }
  if (chartInstances[id]) chartInstances[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  const tickColor  = isDark() ? '#91a5b5' : '#526b7a';
  const gridColor  = isDark() ? '#263442' : '#c8d7e1';
  chartInstances[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 8, font: { size: 12 } }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { size: 12 } },                   grid: { color: gridColor } },
      },
      ...extraOptions,
    },
  });
}

function renderCharts(sorted) {
  _lastSorted = sorted;
  // Weekly mileage
  const weekMap = {};
  sorted.forEach(r => {
    const d = new Date(r.date.replace(' ', 'T'));
    if (isNaN(d)) return;
    const mon = new Date(d);
    mon.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
    const key = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
    weekMap[key] = (weekMap[key] || 0) + (r.distance || 0);
  });
  const weekKeys   = Object.keys(weekMap).sort();
  const weekLabels = weekKeys.map(k => formatDate(k, 'short'));
  const weekMiles  = weekKeys.map(k => +weekMap[k].toFixed(2));

  makeChart('chart-weekly-miles', 'bar', weekLabels, [{
    data: weekMiles,
    backgroundColor: chartLineColor(),
    borderColor: chartLineColor(),
    borderWidth: 1.5,
    borderRadius: 4,
  }], {
    scales: {
      x: { ticks: { color: isDark() ? '#91a5b5' : '#526b7a', maxTicksLimit: 8, font: { size: 12 } }, grid: { display: false } },
      y: { ticks: { color: isDark() ? '#91a5b5' : '#526b7a', font: { size: 12 } },                   grid: { display: false } },
    },
  });

  // Pace over time
  const paceData = sorted
    .map(r => ({ label: formatDate(r.date, 'short'), val: paceToDecimal(r.avgPace) }))
    .filter(x => x.val);

  makeChart('chart-pace', 'line', paceData.map(x => x.label), [{
    data: paceData.map(x => x.val),
    borderColor: chartLineColor(),
    backgroundColor: chartFillColor(),
    tension: 0.3, pointRadius: 2, fill: true,
  }], {
    scales: {
      x: { ticks: { color: isDark() ? '#91a5b5' : '#526b7a', maxTicksLimit: 8, font: { size: 12 } }, grid: { display: false } },
      y: {
        ticks: { color: isDark() ? '#91a5b5' : '#526b7a', font: { size: 12 }, callback: v => formatPace(v) },
        grid:  { display: false },
      },
    },
  });

  // Cadence over time
  const cadData = sorted
    .map(r => ({ label: formatDate(r.date, 'short'), val: r.cadence }))
    .filter(x => x.val);

  makeChart('chart-cadence', 'line', cadData.map(x => x.label), [{
    data: cadData.map(x => x.val),
    borderColor: '#8b90a7',
    backgroundColor: 'rgba(0,0,0,0)',
    tension: 0.3, fill: false,
    pointRadius: 3,
    pointBackgroundColor: cadData.map(x => zoneColor('cadence', x.val)),
    pointBorderColor:     cadData.map(x => zoneColor('cadence', x.val)),
    segment: { borderColor: ctx => zoneColor('cadence', ctx.p1.parsed.y) },
  }]);

  // Vertical ratio over time
  const vrData = sorted
    .map(r => ({ label: formatDate(r.date, 'short'), val: r.vertRatio }))
    .filter(x => x.val);

  makeChart('chart-vr', 'line', vrData.map(x => x.label), [{
    data: vrData.map(x => x.val),
    borderColor: '#8b90a7',
    backgroundColor: 'rgba(0,0,0,0)',
    tension: 0.3, fill: false,
    pointRadius: 3,
    pointBackgroundColor: vrData.map(x => zoneColor('vertRatio', x.val)),
    pointBorderColor:     vrData.map(x => zoneColor('vertRatio', x.val)),
    segment: { borderColor: ctx => zoneColor('vertRatio', ctx.p1.parsed.y) },
  }]);
}


// ── Activity Table ──────────────────────────────────────────────────────────

function renderTable(runs) {
  const tbody = document.getElementById('activity-tbody');
  tbody.innerHTML = '';
  if (!runs.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 9; cell.textContent = 'No running activities found yet.'; row.append(cell); tbody.append(row);
  }

  runs.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(r.date)}</td>
      <td>${r.distance != null ? r.distance.toFixed(2) : '—'} mi</td>
      <td>${formatDuration(r.time)}</td>
      <td>${r.avgPace || '—'}</td>
      <td>${r.avgHR ? fmt0(r.avgHR) : '—'}</td>
      <td class="${zoneClass('cadence', r.cadence)}">${r.cadence ? fmt0(r.cadence) : '—'}</td>
      <td class="${zoneClass('vertRatio', r.vertRatio)}">${r.vertRatio != null ? fmt1(r.vertRatio) + '%' : '—'}</td>
      <td class="${zoneClass('gct', r.gct)}">${r.gct ? fmt0(r.gct) + ' ms' : '—'}</td>
      <td>${r.calories ? fmt0(r.calories) : '—'}</td>
    `;
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `Open ${r.title || 'run'} on ${formatDate(r.date)}`);
    tr.addEventListener('click', () => openModal(r));
    tr.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openModal(r); } });
    tbody.appendChild(tr);
  });
}


// ── Per-run Modal ───────────────────────────────────────────────────────────

// Track modal-specific chart instances so we can destroy on re-open
const modalCharts = {};
let   modalMap    = null;   // Leaflet map instance for the open run modal

function destroyModalCharts() {
  Object.values(modalCharts).forEach(c => c.destroy());
  Object.keys(modalCharts).forEach(k => delete modalCharts[k]);
  if (modalMap) { modalMap.remove(); modalMap = null; }
}

// Draw the run's GPS route on a Leaflet map. No-op (stays hidden) without GPS.
function renderRunMap(route) {
  const el = document.getElementById('modal-map');
  if (!el || !route || route.length < 2) return;

  el.classList.remove('hidden');
  if (!window.L) { el.textContent = 'Route map unavailable. Check your connection and reload to load the map library.'; return; }
  modalMap = L.map(el, { attributionControl: true, zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(modalMap);

  const line = L.polyline(route, { color: '#22d3ee', weight: 4 }).addTo(modalMap);
  modalMap.fitBounds(line.getBounds(), { padding: [20, 20] });
  L.circleMarker(route[0],              { radius: 6, color: '#2f9e44', fillOpacity: 1 }).addTo(modalMap);
  L.circleMarker(route[route.length-1], { radius: 6, color: '#e03131', fillOpacity: 1 }).addTo(modalMap);

  // Map was created while the modal was painting — recalc size once visible
  setTimeout(() => modalMap && modalMap.invalidateSize(), 0);
}

function makeModalChart(id, label, color, labels, data, yFormatter, metric = null) {
  if (!window.Chart || !data || data.every(v => v == null)) return;
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (modalCharts[id]) modalCharts[id].destroy();

  const opts = {
    responsive: true,
    animation: false,
    plugins: { legend: { display: false }, tooltip: {
      callbacks: { label: ctx => yFormatter ? yFormatter(ctx.parsed.y) : ctx.parsed.y }
    }},
    scales: {
      x: { ticks: { color: isDark() ? '#91a5b5' : '#526b7a', maxTicksLimit: 7, font: { size: 12 } }, grid: { color: isDark() ? '#263442' : '#c8d7e1' } },
      y: { ticks: { color: isDark() ? '#91a5b5' : '#526b7a', font: { size: 12 },
             callback: v => yFormatter ? yFormatter(v) : v },
           grid: { color: isDark() ? '#263442' : '#c8d7e1' } },
    },
  };
  if (yFormatter === formatPace) opts.scales.y.reverse = true;

  const dataset = metric
    ? {
        data, spanGaps: true, tension: 0.3, pointRadius: 0, fill: false,
        borderColor: color,
        segment: { borderColor: ctx => zoneColor(metric, ctx.p1.parsed.y) },
      }
    : {
        data, spanGaps: true, tension: 0.3, pointRadius: 0, fill: true,
        borderColor: color, backgroundColor: color + '18',
      };

  modalCharts[id] = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [dataset] },
    options: opts,
  });
}

async function fetchChartExplanations(r, generation = _modalRequest) {
  try {
    const res  = await fetch('/api/garmin/analyze/charts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({...r, demo: _demoMode}),
    });
    const data = await res.json();
    if (generation !== _modalRequest) return;
    if (data.error) throw new Error(data.error);

    const keyMap = {
      pace: 'ce-pace', hr: 'ce-hr', cadence: 'ce-cadence',
      vertOsc: 'ce-vertOsc', vertRatio: 'ce-vertRatio',
      gct: 'ce-gct', strideLength: 'ce-strideLength', elevation: 'ce-elevation',
    };
    for (const [key, id] of Object.entries(keyMap)) {
      const el = document.getElementById(id);
      if (el && data[key]) {
        el.textContent = data[key];
        el.classList.remove('chart-explanation--loading');
      }
    }
  } catch {
    if (generation !== _modalRequest) return;
    document.querySelectorAll('.chart-explanation--loading').forEach(el => {
      el.textContent = 'Chart insights unavailable. Check your coaching configuration.';
      el.classList.remove('chart-explanation--loading');
    });
  }
}

async function openModal(r) {
  const generation = ++_modalRequest;
  _modalOpener = document.activeElement;
  destroyModalCharts();
  document.getElementById('modal-title').textContent =
    `${r.title || 'Run'} — ${formatDate(r.date)}`;

  document.getElementById('modal-body').innerHTML = `
    <div id="modal-map" class="modal-map hidden"></div>

    <div class="modal-grid">
      <div class="modal-section-header">Core</div>
      <div class="modal-metric">
        <div class="modal-metric-label">Distance</div>
        <div class="modal-metric-value">${r.distance != null ? r.distance.toFixed(2) : '—'} mi</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Duration</div>
        <div class="modal-metric-value">${formatDuration(r.time)}</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Avg Pace</div>
        <div class="modal-metric-value">${r.avgPace || '—'}</div>
        <div class="modal-metric-note">min/mile</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Best Pace</div>
        <div class="modal-metric-value">${r.bestPace || '—'}</div>
        <div class="modal-metric-note">min/mile</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Avg Heart Rate</div>
        <div class="modal-metric-value">${r.avgHR ? fmt0(r.avgHR) : '—'}</div>
        <div class="modal-metric-note">bpm</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Max Heart Rate</div>
        <div class="modal-metric-value">${r.maxHR ? fmt0(r.maxHR) : '—'}</div>
        <div class="modal-metric-note">bpm</div>
      </div>

      <div class="modal-section-header">Running Form</div>
      <div class="modal-metric">
        <div class="modal-metric-label">Cadence</div>
        <div class="modal-metric-value ${zoneClass('cadence', r.cadence)}">${r.cadence ? fmt0(r.cadence) : '—'}</div>
        <div class="modal-metric-note">spm · ${_zoneLabel('cadence', r.cadence)}</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Stride Length</div>
        <div class="modal-metric-value">${r.strideLength != null ? fmt1(r.strideLength) : '—'}</div>
        <div class="modal-metric-note">m</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Ground Contact Time</div>
        <div class="modal-metric-value ${zoneClass('gct', r.gct)}">${r.gct ? fmt0(r.gct) : '—'}</div>
        <div class="modal-metric-note">ms · ${_zoneLabel('gct', r.gct)}</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Vertical Oscillation</div>
        <div class="modal-metric-value ${zoneClass('vertOsc', r.vertOsc)}">${r.vertOsc != null ? fmt1(r.vertOsc) : '—'}</div>
        <div class="modal-metric-note">cm · ${_zoneLabel('vertOsc', r.vertOsc)}</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Vertical Ratio</div>
        <div class="modal-metric-value ${zoneClass('vertRatio', r.vertRatio)}">${r.vertRatio != null ? fmt1(r.vertRatio) + '%' : '—'}</div>
        <div class="modal-metric-note">${_zoneLabel('vertRatio', r.vertRatio)}</div>
      </div>

      <div class="modal-section-header">Effort & Terrain</div>
      <div class="modal-metric">
        <div class="modal-metric-label">Aerobic TE</div>
        <div class="modal-metric-value">${r.aerobicTE != null ? fmt1(r.aerobicTE) : '—'}</div>
        <div class="modal-metric-note">1–5 scale</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Anaerobic TE</div>
        <div class="modal-metric-value">${r.anaerobicTE != null ? fmt1(r.anaerobicTE) : '—'}</div>
        <div class="modal-metric-note">1–5 scale</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Calories</div>
        <div class="modal-metric-value">${r.calories ? fmt0(r.calories) : '—'}</div>
        <div class="modal-metric-note">kcal</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Total Ascent</div>
        <div class="modal-metric-value">${r.ascent != null ? fmt0(r.ascent) : '—'}</div>
        <div class="modal-metric-note">ft</div>
      </div>
      <div class="modal-metric">
        <div class="modal-metric-label">Total Descent</div>
        <div class="modal-metric-value">${r.descent != null ? fmt0(r.descent) : '—'}</div>
        <div class="modal-metric-note">ft</div>
      </div>
    </div>

    <!-- During-run charts -->
    <div class="modal-charts-section">
      <div class="modal-section-header" style="margin-bottom:14px">During This Run</div>
      <div id="modal-charts-loading" class="modal-charts-loading">
        <div class="loading-spinner" style="width:28px;height:28px;border-width:2px"></div>
        <span>Loading run data…</span>
      </div>
      <div id="modal-charts-grid" class="modal-charts-grid hidden">
        <div class="modal-chart-wrap"><div class="modal-chart-label">Pace (min/mi)</div><canvas id="mc-pace"></canvas><div id="ce-pace" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Heart Rate (bpm)</div><canvas id="mc-hr"></canvas><div id="ce-hr" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Cadence (spm)</div><canvas id="mc-cadence"></canvas><div id="ce-cadence" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Vertical Oscillation (cm)</div><canvas id="mc-vertOsc"></canvas><div id="ce-vertOsc" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Vertical Ratio (%)</div><canvas id="mc-vertRatio"></canvas><div id="ce-vertRatio" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Ground Contact Time (ms)</div><canvas id="mc-gct"></canvas><div id="ce-gct" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Stride Length (m)</div><canvas id="mc-strideLength"></canvas><div id="ce-strideLength" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
        <div class="modal-chart-wrap"><div class="modal-chart-label">Elevation (ft)</div><canvas id="mc-elevation"></canvas><div id="ce-elevation" class="chart-explanation chart-explanation--loading">${_demoMode ? "Loading sample insight…" : "Request chart insights below."}</div></div>
      </div>
      <div id="modal-charts-error" class="modal-charts-error hidden"></div>
    </div>

    <!-- AI Run Analysis -->
    <div class="modal-ai-section">
      <p class="coaching-privacy">${_demoMode ? "Prewritten sample insights for synthetic data." : "Optional: these buttons send this run’s displayed metrics to Google Gemini. GPS routes are excluded."}</p><button id="analyze-run-btn" class="btn-ai">${_demoMode ? "Show sample coaching" : "Ask Gemini about this run"}</button><button id="explain-charts-btn" class="btn-ai">${_demoMode ? "Show sample chart insights" : "Explain charts with Gemini"}</button>
      <div id="run-analysis-result" class="ai-result hidden"></div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.remove('hidden');

  document.getElementById('analyze-run-btn').addEventListener('click', () => {
    fetchRunAnalysis(r);
  });

  // Fetch and render per-run charts
  if (!r.id) return;

  document.getElementById('explain-charts-btn').addEventListener('click', () => fetchChartExplanations(r, generation));
  document.getElementById('modal-close').focus();
  document.body.style.overflow = 'hidden';
  // Only the synthetic demo loads prewritten insights automatically.
  if (_demoMode) fetchChartExplanations(r, generation);
  try {
    const res  = await fetch(`/api/garmin/${_demoMode ? 'demo/' : ''}activity/${r.id}/details`);
    const data = await res.json();

    if (generation !== _modalRequest) return;
    document.getElementById('modal-charts-loading').classList.add('hidden');

    if (data.error) {
      const el = document.getElementById('modal-charts-error');
      el.textContent = 'Could not load run details: ' + data.error;
      el.classList.remove('hidden');
      return;
    }

    const labels = (data.elapsed || []).map(m => {
      if (m == null) return '';
      const seconds = Math.round(m * 60);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${String(secs).padStart(2,'0')}`;
    });

    renderRunMap(data.route);

    document.getElementById('modal-charts-grid').classList.remove('hidden');

    makeModalChart('mc-pace',        'Pace',      '#7950f2', labels, data.pace,        formatPace);
    makeModalChart('mc-hr',          'HR',        '#e03131', labels, data.hr,          v => Math.round(v) + ' bpm');
    makeModalChart('mc-cadence',     'Cadence',   '#099268', labels, data.cadence,     v => Math.round(v) + ' spm', 'cadence');
    makeModalChart('mc-vertOsc',     'Vert Osc',  '#1971c2', labels, data.vertOsc,     v => v.toFixed(1) + ' cm',  'vertOsc');
    makeModalChart('mc-vertRatio',   'Vert Ratio','#e67700', labels, data.vertRatio,   v => v.toFixed(1) + '%',    'vertRatio');
    makeModalChart('mc-gct',         'GCT',       '#3b5bdb', labels, data.gct,         v => Math.round(v) + ' ms', 'gct');
    makeModalChart('mc-strideLength','Stride',    '#862e9c', labels, data.strideLength,v => v.toFixed(2) + ' m');
    makeModalChart('mc-elevation',   'Elevation', '#2f9e44', labels, data.elevation,   v => Math.round(v) + ' ft');

  } catch {
    if (generation !== _modalRequest) return;
    document.getElementById('modal-charts-loading').classList.add('hidden');
    const el = document.getElementById('modal-charts-error');
    el.textContent = 'Failed to load run details.';
    el.classList.remove('hidden');
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  ++_modalRequest;
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  destroyModalCharts();
  if (_modalOpener?.isConnected) _modalOpener.focus();
  _modalOpener = null;
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', event => {
  if (event.target === document.getElementById('modal-overlay')) closeModal();
});
document.getElementById('modal').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
  if (event.key !== 'Tab') return;
  const focusable = [...document.getElementById('modal').querySelectorAll('button, a, input, [tabindex="0"]')]
    .filter(element => !element.disabled && element.getClientRects().length);
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
loadDemo();
