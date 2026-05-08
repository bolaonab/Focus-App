// ─── State ────────────────────────────────────────────────────────────────────
const COLORS = ["#FF6B6B","#FF9F43","#FECA57","#48DBFB","#FF9FF3","#54A0FF","#00D2D3","#A29BFE"];

let state = {
  screen: "home",           // home | setup | running | done
  activity: "",
  totalMinutes: 60,
  subtasks: [],
  nextId: 1,

  // running
  currentIdx: 0,
  timeLeft: 0,
  running: false,
  completedCount: 0,
  startedAt: null,
  sessionId: null,

  // settings
  autoStart: true,

  // history
  history: [],
};

let timerInterval = null;
let audioCtx = null;

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveHistory(h) { localStorage.setItem("focus_history", JSON.stringify(h)); }
function loadHistory() {
  try { return JSON.parse(localStorage.getItem("focus_history") || "[]"); } catch { return []; }
}
function saveDraft() {
  localStorage.setItem("focus_draft", JSON.stringify({
    activity: state.activity,
    totalMinutes: state.totalMinutes,
    subtasks: state.subtasks,
    nextId: state.nextId,
  }));
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem("focus_draft") || "null");
    if (d) Object.assign(state, d);
  } catch {}
}
function saveRunning() {
  localStorage.setItem("focus_running", JSON.stringify({
    activity: state.activity,
    subtasks: state.subtasks,
    currentIdx: state.currentIdx,
    timeLeft: state.timeLeft,
    completedCount: state.completedCount,
    startedAt: state.startedAt,
    sessionId: state.sessionId,
    savedAt: Date.now(),
  }));
}
function clearRunning() { localStorage.removeItem("focus_running"); }
function loadRunning() {
  try {
    const r = JSON.parse(localStorage.getItem("focus_running") || "null");
    if (!r) return false;
    // Adjust timeLeft for elapsed time since last save
    const elapsed = Math.floor((Date.now() - r.savedAt) / 1000);
    let timeLeft = Math.max(0, r.timeLeft - elapsed);
    let currentIdx = r.currentIdx;
    let completedCount = r.completedCount;

    // Fast-forward through subtasks if needed
    while (timeLeft === 0 && currentIdx < r.subtasks.length - 1) {
      currentIdx++;
      completedCount++;
      timeLeft = r.subtasks[currentIdx].minutes * 60;
    }

    Object.assign(state, {
      screen: "running",
      activity: r.activity,
      subtasks: r.subtasks,
      currentIdx,
      timeLeft,
      completedCount,
      startedAt: r.startedAt,
      sessionId: r.sessionId,
      running: false,
    });
    return true;
  } catch { return false; }
}

// ─── Audio ────────────────────────────────────────────────────────────────────
function playSound(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const now = ctx.currentTime;

    if (type === "done") {
      // Rich triumphant fanfare — 6 notes, held longer with harmonics
      const melody = [523, 659, 784, 1047, 784, 1047, 1319];
      const timing  = [0,  0.22, 0.44, 0.66, 0.88, 1.05, 1.25];
      const dur     = [0.5, 0.5, 0.5,  0.5,  0.35, 0.35, 1.2];
      melody.forEach((f, i) => {
        ["sine","triangle"].forEach(type => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = f; o.type = type;
          const vol = type === "sine" ? 0.28 : 0.08;
          g.gain.setValueAtTime(vol, now + timing[i]);
          g.gain.setValueAtTime(vol, now + timing[i] + dur[i] - 0.08);
          g.gain.exponentialRampToValueAtTime(0.001, now + timing[i] + dur[i]);
          o.start(now + timing[i]); o.stop(now + timing[i] + dur[i] + 0.05);
        });
      });
    } else {
      // Subtask chime — 3 warm ascending notes, each held ~0.7s
      const notes  = [659, 784, 1047];
      const timing = [0, 0.3, 0.6];
      const dur    = [0.65, 0.65, 1.0];
      notes.forEach((f, i) => {
        ["sine","triangle"].forEach(wt => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value = f; o.type = wt;
          const vol = wt === "sine" ? 0.26 : 0.07;
          g.gain.setValueAtTime(vol, now + timing[i]);
          g.gain.setValueAtTime(vol, now + timing[i] + dur[i] - 0.1);
          g.gain.exponentialRampToValueAtTime(0.001, now + timing[i] + dur[i]);
          o.start(now + timing[i]); o.stop(now + timing[i] + dur[i] + 0.05);
        });
      });
    }
  } catch(e) {}
}

function vibrate(type) {
  if (!navigator.vibrate) return;
  if (type === "done") {
    // Long celebratory pattern
    navigator.vibrate([200, 100, 200, 100, 400]);
  } else {
    // Two firm pulses
    navigator.vibrate([150, 80, 150]);
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function ensurePermission() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  const r = await Notification.requestPermission();
  return r === "granted";
}
function notify(title, body) {
  if (Notification.permission === "granted") {
    try { new Notification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png" }); } catch {}
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!state.running) return;
    state.timeLeft = Math.max(0, state.timeLeft - 1);
    saveRunning();

    if (state.timeLeft === 0) {
      const next = state.currentIdx + 1;
      if (next >= state.subtasks.length) {
        // All done
        clearInterval(timerInterval);
        state.running = false;
        state.completedCount = state.subtasks.length;
        playSound("done");
        vibrate("done");
        notify("🎉 Session Complete!", `"${state.activity}" is done!`);
        finishSession();
        state.screen = "done";
        clearRunning();
        render();
      } else {
        // Subtask ended
        playSound("subtask");
        vibrate("subtask");
        notify("✅ Subtask done!", `Up next: "${state.subtasks[next].name}"`);
        state.completedCount = next;

        if (state.autoStart) {
          // Auto-advance
          state.currentIdx = next;
          state.timeLeft = state.subtasks[next].minutes * 60;
          render();
        } else {
          // Pause and wait for user to tap Next
          state.running = false;
          state.screen = "ready"; // waiting screen
          state.nextIdx = next;
          render();
        }
      }
    } else {
      const el = document.getElementById("timer-display");
      if (el) el.textContent = formatTime(state.timeLeft);
      updateRing();
      updateGlobalBar();
    }
  }, 1000);
}

function finishSession() {
  const session = {
    id: state.sessionId || Date.now(),
    activity: state.activity,
    subtasks: state.subtasks.map(s => ({ name: s.name, minutes: s.minutes })),
    totalMinutes: state.subtasks.reduce((a,s) => a + s.minutes, 0),
    completedAt: new Date().toISOString(),
    startedAt: state.startedAt,
  };
  state.history = [session, ...state.history].slice(0, 50);
  saveHistory(state.history);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(s) {
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}
function formatDuration(m) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60), mm = m%60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month:"short", day:"numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
}
function uid() { return Date.now() + Math.random().toString(36).slice(2); }
function allocatedMinutes() { return state.subtasks.reduce((a,s) => a+s.minutes, 0); }

// ─── Ring SVG update (in-place, no full re-render) ───────────────────────────
function updateRing() {
  const progress = state.subtasks[state.currentIdx]
    ? 1 - state.timeLeft / (state.subtasks[state.currentIdx].minutes * 60)
    : 0;
  const r = 88, circ = 2 * Math.PI * r;
  const arc = document.getElementById("timer-arc");
  const dot = document.getElementById("timer-dot");
  if (arc) {
    arc.setAttribute("stroke-dashoffset", circ * (1 - progress));
    arc.setAttribute("stroke", COLORS[state.currentIdx % COLORS.length]);
  }
  // Dot position
  if (dot) {
    const angle = -Math.PI/2 + progress * 2 * Math.PI;
    const cx = 110 + r * Math.cos(angle);
    const cy = 110 + r * Math.sin(angle);
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    dot.setAttribute("fill", COLORS[state.currentIdx % COLORS.length]);
  }
}
function updateGlobalBar() {
  const progress = state.subtasks[state.currentIdx]
    ? 1 - state.timeLeft / (state.subtasks[state.currentIdx].minutes * 60)
    : 0;
  const global = (state.completedCount + progress) / state.subtasks.length;
  const bar = document.getElementById("global-bar");
  if (bar) bar.style.width = `${global * 100}%`;
  const label = document.getElementById("global-label");
  if (label) label.textContent = `${state.completedCount} of ${state.subtasks.length} subtasks`;
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function screenHome() {
  const hist = state.history;
  return `
  <div class="screen fade-in">
    <div class="home-header">
      <div class="app-wordmark">FOCUS</div>
      <div class="app-sub">Activity Scheduler</div>
    </div>

    <button class="big-btn" onclick="goSetup()">
      <span class="big-btn-icon">+</span>
      New Session
    </button>

    ${hist.length > 0 ? `
    <div class="section-label">PAST SESSIONS</div>
    <div class="history-list">
      ${hist.map(s => `
      <div class="hist-card" onclick="rerunSession('${s.id}')">
        <div class="hist-top">
          <span class="hist-name">${esc(s.activity)}</span>
          <span class="hist-dur">${formatDuration(s.totalMinutes)}</span>
        </div>
        <div class="hist-meta">${formatDate(s.completedAt)}</div>
        <div class="hist-tags">
          ${s.subtasks.map((t,i) => `<span class="hist-tag" style="border-color:${COLORS[i%COLORS.length]};color:${COLORS[i%COLORS.length]}">${esc(t.name)}</span>`).join("")}
        </div>
        <div class="hist-rerun">Tap to rerun →</div>
      </div>`).join("")}
    </div>
    <button class="clear-hist" onclick="clearHistory()">Clear History</button>
    ` : `
    <div class="empty-hist">
      <div class="empty-icon">⏱</div>
      <div>No sessions yet.<br>Start your first one!</div>
    </div>`}
  </div>`;
}

function screenSetup() {
  const alloc = allocatedMinutes();
  const rem = state.totalMinutes - alloc;
  const pct = Math.min(100, (alloc / state.totalMinutes) * 100);
  const barColor = rem < 0 ? "#FF6B6B" : rem === 0 ? "#FECA57" : "#48DBFB";

  return `
  <div class="screen fade-in">
    <div class="top-bar">
      <button class="back-btn" onclick="goHome()">‹ Back</button>
      <div class="top-title">New Session</div>
    </div>

    <label class="field-label">ACTIVITY NAME</label>
    <input id="act-name" class="text-input" placeholder="e.g. Study Session…"
      value="${esc(state.activity)}"
      oninput="state.activity=this.value;saveDraft()" />

    <label class="field-label">TOTAL DURATION — <span style="color:#FF6B6B">${formatDuration(state.totalMinutes)}</span></label>
    <input type="range" class="slider" min="5" max="240" step="5"
      value="${state.totalMinutes}"
      oninput="state.totalMinutes=+this.value;saveDraft();render()" />
    <div class="slider-labels"><span>5m</span><span>4h</span></div>

    <div class="budget-row">
      <span>TIME ALLOCATED</span>
      <span style="color:${barColor}">${rem>=0 ? rem+"m free" : (-rem)+"m over"}</span>
    </div>
    <div class="budget-track">
      <div class="budget-fill" style="width:${pct}%;background:${barColor}"></div>
    </div>

    <div class="section-label" style="margin-top:24px">SUBTASKS</div>
    <div id="subtask-list">
      ${state.subtasks.map((t,i) => subtaskRow(t,i)).join("")}
    </div>
    <button class="add-sub-btn" onclick="addSubtask()" ${rem<=0?"disabled":""}>+ Add Subtask</button>

    <div class="toggle-row">
      <div>
        <div class="toggle-label">Auto-start next subtask</div>
        <div class="toggle-sub">When off, you tap to begin each subtask</div>
      </div>
      <div class="toggle-switch ${state.autoStart?"on":""}" onclick="toggleAutoStart()">
        <div class="toggle-thumb"></div>
      </div>
    </div>

    <button class="big-btn" style="margin-top:24px"
      onclick="startSession()"
      ${(!state.activity.trim() || state.subtasks.length===0 || rem<0) ? "disabled" : ""}>
      Start Session
    </button>
  </div>`;
}

function subtaskRow(t, i) {
  return `
  <div class="sub-row" id="sub-${t.id}">
    <div class="sub-dot" style="background:${COLORS[i%COLORS.length]}"></div>
    <input class="sub-name-input" value="${esc(t.name)}"
      oninput="updateSubtaskName('${t.id}',this.value)" />
    <div class="sub-mins">
      <button class="min-btn" onclick="adjustMins('${t.id}',-5)">−</button>
      <span class="min-val">${t.minutes}m</span>
      <button class="min-btn" onclick="adjustMins('${t.id}',5)">+</button>
    </div>
    <button class="del-btn" onclick="removeSubtask('${t.id}')">×</button>
  </div>`;
}

function screenRunning() {
  const cur = state.subtasks[state.currentIdx];
  const totalSec = cur ? cur.minutes * 60 : 1;
  const progress = 1 - state.timeLeft / totalSec;
  const r = 88, circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);
  const color = COLORS[state.currentIdx % COLORS.length];
  const globalPct = (state.completedCount + progress) / state.subtasks.length;

  // Dot on ring
  const angle = -Math.PI/2 + progress * 2 * Math.PI;
  const cx = 110 + r * Math.cos(angle);
  const cy = 110 + r * Math.sin(angle);

  const next = state.subtasks[state.currentIdx + 1];

  return `
  <div class="screen fade-in">
    <div class="top-bar">
      <button class="back-btn" onclick="confirmStop()">‹ Stop</button>
      <div class="top-title">${esc(state.activity)}</div>
    </div>

    <div class="ring-wrap">
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle cx="110" cy="110" r="${r}" fill="none" stroke="#1e1e24" stroke-width="14"/>
        <circle id="timer-arc" cx="110" cy="110" r="${r}" fill="none"
          stroke="${color}" stroke-width="14"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
          stroke-linecap="round"
          transform="rotate(-90 110 110)" />
        <circle id="timer-dot" cx="${cx}" cy="${cy}" r="7" fill="${color}" />
      </svg>
      <div class="ring-center">
        <div id="timer-display" class="timer-digits">${formatTime(state.timeLeft)}</div>
        <div class="timer-sub">remaining</div>
      </div>
    </div>

    <div class="cur-task-label">NOW</div>
    <div class="cur-task-pill" style="border-color:${color}">
      <div class="cur-dot" style="background:${color}"></div>
      ${esc(cur?.name || "")}
    </div>
    ${next ? `<div class="next-label">Next → ${esc(next.name)}</div>` : ""}

    <div class="global-track">
      <div id="global-bar" class="global-fill" style="width:${globalPct*100}%"></div>
    </div>
    <div id="global-label" class="global-label">${state.completedCount} of ${state.subtasks.length} subtasks</div>

    <div class="sub-dots">
      ${state.subtasks.map((_,i) => `
        <div class="sub-pip ${i===state.currentIdx?"active":i<state.currentIdx?"done":""}"
          style="${i===state.currentIdx?`background:${COLORS[i%COLORS.length]}`:i<state.currentIdx?"background:#48DBFB":""}"></div>
      `).join("")}
    </div>

    <div class="run-controls">
      <button class="ctrl-btn" onclick="skipSubtask()">Skip</button>
      <button class="ctrl-btn primary" onclick="togglePause()">
        ${state.running ? "⏸ Pause" : "▶ Resume"}
      </button>
    </div>
  </div>`;
}

function screenReady() {
  const done = state.subtasks[state.currentIdx];
  const next = state.subtasks[state.nextIdx];
  const color = COLORS[state.nextIdx % COLORS.length];
  return `
  <div class="screen fade-in" style="text-align:center">
    <div class="top-bar">
      <button class="back-btn" onclick="confirmStop()">‹ Stop</button>
      <div class="top-title">${esc(state.activity)}</div>
    </div>

    <div class="ready-wrap">
      <div class="ready-check">✓</div>
      <div class="ready-done">${esc(done?.name || "")} done!</div>
      <div class="ready-label">UP NEXT</div>
      <div class="ready-next" style="border-color:${color}">
        <div class="cur-dot" style="background:${color}"></div>
        ${esc(next?.name || "")}
        <span class="ready-dur">${next?.minutes}m</span>
      </div>
    </div>

    <div class="sub-dots" style="margin-bottom:32px">
      ${state.subtasks.map((_,i) => `
        <div class="sub-pip ${i===state.nextIdx?"active":i<state.nextIdx?"done":""}"
          style="${i===state.nextIdx?`background:${COLORS[i%COLORS.length]}`:i<state.nextIdx?"background:#48DBFB":""}"></div>
      `).join("")}
    </div>

    <button class="big-btn" onclick="beginNextSubtask()">
      ▶ Start ${esc(next?.name || "Next")}
    </button>
  </div>`;
}

function screenDone() {
  const total = state.subtasks.reduce((a,s)=>a+s.minutes,0);
  return `
  <div class="screen fade-in" style="text-align:center">
    <div class="done-emoji">🎉</div>
    <div class="done-title">Complete!</div>
    <div class="done-sub">${esc(state.activity)}</div>
    <div class="done-stat">${formatDuration(total)} · ${state.subtasks.length} subtask${state.subtasks.length!==1?"s":""}</div>

    <div class="done-tasks">
      ${state.subtasks.map((t,i) => `
        <div class="done-task-row">
          <div class="sub-dot" style="background:${COLORS[i%COLORS.length]}"></div>
          <span>${esc(t.name)}</span>
          <span class="done-check" style="color:${COLORS[i%COLORS.length]}">${t.minutes}m ✓</span>
        </div>`).join("")}
    </div>

    <button class="big-btn" onclick="goHome()" style="margin-top:32px">Home</button>
    <button class="ctrl-btn" onclick="rerunLast()" style="margin-top:12px;width:100%">Run Again</button>
  </div>`;
}

function esc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── Actions ──────────────────────────────────────────────────────────────────
window.beginNextSubtask = () => {
  state.currentIdx = state.nextIdx;
  state.timeLeft = state.subtasks[state.currentIdx].minutes * 60;
  state.running = true;
  state.screen = "running";
  render();
};

window.toggleAutoStart = () => {
  state.autoStart = !state.autoStart;
  saveDraft();
  render();
};

window.goHome = () => { state.screen = "home"; render(); };
window.goSetup = () => { state.screen = "setup"; render(); };

window.addSubtask = () => {
  const rem = state.totalMinutes - allocatedMinutes();
  if (rem <= 0) return;
  const mins = Math.min(rem, 15);
  state.subtasks.push({ id: uid(), name: `Subtask ${state.subtasks.length+1}`, minutes: mins });
  state.nextId++;
  saveDraft(); render();
};

window.removeSubtask = (id) => {
  state.subtasks = state.subtasks.filter(t => t.id !== id);
  saveDraft(); render();
};

window.updateSubtaskName = (id, val) => {
  const t = state.subtasks.find(t => t.id === id);
  if (t) { t.name = val; saveDraft(); }
};

window.adjustMins = (id, delta) => {
  const t = state.subtasks.find(t => t.id === id);
  if (!t) return;
  const others = state.subtasks.filter(x => x.id !== id).reduce((a,x)=>a+x.minutes,0);
  t.minutes = Math.max(1, Math.min(t.minutes + delta, state.totalMinutes - others));
  saveDraft(); render();
};

window.startSession = async () => {
  if (!state.activity.trim() || state.subtasks.length === 0) return;
  await ensurePermission();
  state.currentIdx = 0;
  state.timeLeft = state.subtasks[0].minutes * 60;
  state.completedCount = 0;
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.sessionId = uid();
  state.screen = "running";
  saveRunning();
  render();
  startTimer();
};

window.togglePause = () => {
  state.running = !state.running;
  const btn = document.querySelector(".ctrl-btn.primary");
  if (btn) btn.textContent = state.running ? "⏸ Pause" : "▶ Resume";
};

window.skipSubtask = () => {
  const next = state.currentIdx + 1;
  if (next >= state.subtasks.length) {
    playSound("done");
    finishSession();
    state.screen = "done";
    state.running = false;
    clearRunning();
    render();
  } else {
    playSound("subtask");
    state.currentIdx = next;
    state.completedCount = next;
    state.timeLeft = state.subtasks[next].minutes * 60;
    render();
  }
};

window.confirmStop = () => {
  if (confirm("Stop the current session?")) {
    clearInterval(timerInterval);
    state.running = false;
    clearRunning();
    state.screen = "home";
    render();
  }
};

window.rerunSession = (id) => {
  const s = state.history.find(h => h.id == id);
  if (!s) return;
  state.activity = s.activity;
  state.totalMinutes = s.totalMinutes;
  state.subtasks = s.subtasks.map(t => ({ ...t, id: uid() }));
  state.screen = "setup";
  render();
};

window.rerunLast = () => {
  if (state.history.length) rerunSession(state.history[0].id);
};

window.clearHistory = () => {
  if (confirm("Clear all session history?")) {
    state.history = [];
    saveHistory([]);
    render();
  }
};

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById("app");
  switch (state.screen) {
    case "home":    app.innerHTML = screenHome(); break;
    case "setup":   app.innerHTML = screenSetup(); break;
    case "running": app.innerHTML = screenRunning(); break;
    case "ready":   app.innerHTML = screenReady(); break;
    case "done":    app.innerHTML = screenDone(); break;
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  state.history = loadHistory();
  const resumed = loadRunning();
  if (!resumed) loadDraft();
  render();
  if (state.screen === "running") startTimer();

  // Register service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});

// Prevent accidental close while running
window.addEventListener("beforeunload", e => {
  if (state.running) { e.preventDefault(); e.returnValue = ""; }
});
