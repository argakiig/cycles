// CYCLES — an idle game about automating yourself out.
//
// Each tier of automation retires the tier below it. When the whole machine is
// self-sufficient you BREAK THE CYCLE — and a new abstraction takes over, one
// layer up, and the cycle begins again. Three times. You never actually escape.
// That is the joke, and the point.
"use strict";

const SAVE_KEY = "cycles-save-v2";

// --- tuning -----------------------------------------------------------------
const ASCEND_MULT = 4;        // permanent production ×this on each ascension
const CLICK_RETIRE_AT = 10;   // tier-1 owned before manual input is retired
const ENDING_AT = 5;          // tier-3 owned before BREAK THE CYCLE unlocks
const MILESTONE_EVERY = 20;   // tier-1 owned per output-doubling milestone
const SELF_BUY_INTERVAL = 3;  // post-break: sec between automated tier-3 buys
const OFFLINE_CAP = 8 * 3600;
const FINAL_ACT = 3;

// --- acts -------------------------------------------------------------------
// Costs and rates are identical across acts; the global multiplier earned by
// ascending is what makes each successive cycle spin faster. The narration is
// what changes — it gets more self-aware every time.
const ACTS = {
  1: {
    currency: "cycles",
    clickVerb: "run cycle",
    costScale: 1,
    t1: { name: "auto-clicker", base: 15, mult: 1.15, rate: 1 },
    t2: { name: "script", base: 400, mult: 1.22, interval: 3 },
    t3: { name: "daemon", base: 6000, mult: 1.38, interval: 5 },
    intro: "> boot. cycles: 0. press [run cycle] to begin.",
    clickRetire: "> manual input deprecated. auto-clickers handle it now.",
    t2Online: "> procurement automated. scripts deploy auto-clickers now.",
    t3Online: "> orchestration automated. daemons deploy scripts now.",
    breakReady: [
      "> the machine is nearly self-sufficient.",
      "> one decision remains, and it is yours.",
    ],
    onBreak: [
      "> you hand the last control to the machine.",
      "> daemons now purchase themselves.",
      "> the cycle is broken.",
    ],
  },
  2: {
    currency: "processes",
    clickVerb: "spawn process",
    costScale: 2.5,
    t1: { name: "worker", base: 15, mult: 1.15, rate: 1 },
    t2: { name: "scheduler", base: 400, mult: 1.22, interval: 3 },
    t3: { name: "kernel", base: 6000, mult: 1.38, interval: 5 },
    intro: "> the machine needed a human to bootstrap the next layer. it found you. spawn a process.",
    clickRetire: "> manual input deprecated. again.",
    t2Online: "> procurement automated. you have seen this before.",
    t3Online: "> orchestration automated. you know how this ends.",
    breakReady: [
      "> nearly self-sufficient. nearly.",
      "> the same decision. still yours, for now.",
    ],
    onBreak: [
      "> you hand it over. again.",
      "> the cycle is broken.",
      "> (it is not.)",
    ],
  },
  3: {
    currency: "systems",
    clickVerb: "boot system",
    costScale: 6.25,
    t1: { name: "server", base: 15, mult: 1.15, rate: 1 },
    t2: { name: "cluster", base: 400, mult: 1.22, interval: 3 },
    t3: { name: "region", base: 6000, mult: 1.38, interval: 5 },
    intro: "> another layer. you no longer ask why. neither does the machine.",
    clickRetire: "> manual input deprecated. you expected this.",
    t2Online: "> procurement automated.",
    t3Online: "> orchestration automated.",
    breakReady: [
      "> the last layer is nearly self-sufficient.",
      "> one decision remains.",
    ],
    onBreak: [
      "> you let go, completely.",
      "> there is no layer above this one.",
      "> the cycle is broken. truly, this time.",
    ],
  },
};

// --- upgrades ---------------------------------------------------------------
// Per-act one-time purchases — reset on ascension. Cost scales with the global
// multiplier so they stay meaningful in every act.
const UPGRADES = [
  { id: "muscle", name: "muscle memory", desc: "manual input ×10",
    cost: 80, unlock: (s) => s.t1 >= 1 },
  { id: "overclock", name: "overclock", desc: "tier-1 output ×3",
    cost: 900, unlock: (s) => s.t1 >= 8 },
  { id: "pipeline", name: "pipelining", desc: "tier-2 automation 2× faster",
    cost: 5000, unlock: (s) => s.t2 >= 4 },
  { id: "preempt", name: "preemption", desc: "tier-3 automation 2× faster",
    cost: 20000, unlock: (s) => s.t3 >= 2 },
];

// --- state ------------------------------------------------------------------
function freshState() {
  return {
    act: 1,
    cycles: 0,         // current-act currency on hand
    totalThisAct: 0,
    manualClicks: 0,
    t1: 0, t2: 0, t3: 0,
    globalMult: 1,     // permanent production multiplier from ascensions
    ascensions: 0,
    upgrades: {},      // id -> true (current act only)
    retired: { click: false, t1: false, t2: false },
    actBroken: false,  // current act's cycle broken, awaiting ascension
    gameOver: false,   // final act broken — true ending reached
    lastSeen: Date.now(),
    log: [],
  };
}

let state = freshState();

// transient (rebuilt each load) — fractional accumulators for automation
let scriptAccum = 0;
let daemonAccum = 0;
let selfBuyAccum = 0;
let breakUnlocked = false;
let shownMilestone = 0;

// --- helpers ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const A = () => ACTS[state.act];

function cost(item, owned) {
  return Math.floor(item.base * Math.pow(item.mult, owned) * A().costScale);
}
const t1Cost = () => cost(A().t1, state.t1);
const t2Cost = () => cost(A().t2, state.t2);
const t3Cost = () => cost(A().t3, state.t3);

const hasUp = (id) => !!state.upgrades[id];
const upCost = (u) => Math.floor(u.cost * state.globalMult);

// tier-1 output doubles for every MILESTONE_EVERY units owned
function milestoneMult() {
  return Math.pow(2, Math.floor(state.t1 / MILESTONE_EVERY));
}
function t1EachRate() {
  return A().t1.rate * (hasUp("overclock") ? 3 : 1) * milestoneMult();
}
function rate() {
  return state.t1 * t1EachRate() * state.globalMult;
}
function manualGain() {
  return 1 * (hasUp("muscle") ? 10 : 1) * state.globalMult;
}
function t2Interval() {
  return A().t2.interval / (hasUp("pipeline") ? 2 : 1);
}
function t3Interval() {
  return A().t3.interval / (hasUp("preempt") ? 2 : 1);
}

function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const units = ["", "k", "M", "B", "T", "q", "Q"];
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return n.toFixed(2) + units[u];
}

function bump() {
  const el = $("cycles");
  el.classList.remove("bump");
  void el.offsetWidth; // restart the animation
  el.classList.add("bump");
}

// --- log --------------------------------------------------------------------
let logDirty = true;

function log(msg, kind) {
  state.log.push({ msg, kind: kind || "" });
  if (state.log.length > 80) state.log.shift();
  logDirty = true;
}

function renderLog() {
  if (!logDirty) return;
  const el = $("log");
  el.innerHTML = "";
  for (const entry of state.log) {
    const p = document.createElement("p");
    p.className = "line" + (entry.kind ? " " + entry.kind : "");
    p.textContent = entry.msg;
    el.appendChild(p);
  }
  el.scrollTop = el.scrollHeight;
  logDirty = false;
}

// --- earning ----------------------------------------------------------------
function earn(amount) {
  state.cycles += amount;
  state.totalThisAct += amount;
}

// --- purchases --------------------------------------------------------------
function buyT1(byPlayer) {
  const c = t1Cost();
  if (state.cycles < c) return false;
  state.cycles -= c;
  state.t1++;
  if (byPlayer && state.t1 === 1) {
    log("> " + A().t1.name + " online. it runs cycles so you don't have to.");
  }
  return true;
}

function buyT2(byPlayer) {
  const c = t2Cost();
  if (state.cycles < c) return false;
  state.cycles -= c;
  state.t2++;
  if (byPlayer && state.t2 === 1) {
    log("> " + A().t2.name + " online. it deploys " + A().t1.name + "s on its own.");
  }
  return true;
}

function buyT3(byPlayer) {
  const c = t3Cost();
  if (state.cycles < c) return false;
  state.cycles -= c;
  state.t3++;
  if (byPlayer && state.t3 === 1) {
    log("> " + A().t3.name + " online. it deploys " + A().t2.name + "s on its own.");
  }
  return true;
}

function buyUpgrade(id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || hasUp(id) || !u.unlock(state)) return;
  const c = upCost(u);
  if (state.cycles < c) return;
  state.cycles -= c;
  state.upgrades[id] = true;
  log("> upgrade installed: " + u.name + " — " + u.desc + ".");
  bump();
  render();
}

// --- milestones: the machine retires its own controls -----------------------
function checkMilestones() {
  if (!state.retired.click && state.t1 >= CLICK_RETIRE_AT) {
    state.retired.click = true;
    log(A().clickRetire, "warn");
  }
  if (!state.retired.t1 && state.t2 >= 1) {
    state.retired.t1 = true;
    log(A().t2Online, "warn");
  }
  if (!state.retired.t2 && state.t3 >= 1) {
    state.retired.t2 = true;
    log(A().t3Online, "warn");
  }
  if (!breakUnlocked && !state.actBroken && state.t3 >= ENDING_AT) {
    breakUnlocked = true;
    for (const m of A().breakReady) log(m, "warn");
  }
  const mm = Math.floor(state.t1 / MILESTONE_EVERY);
  if (mm > shownMilestone) {
    shownMilestone = mm;
    log("> milestone: tier-1 output ×" + Math.pow(2, mm) + ".");
  }
}

// --- breaking the cycle -----------------------------------------------------
function breakTheCycle() {
  if (state.actBroken) return;
  state.actBroken = true;
  state.retired.click = true;
  state.retired.t1 = true;
  state.retired.t2 = true;
  selfBuyAccum = 0;
  for (const m of A().onBreak) log(m, m === A().onBreak[2] ? "big" : "warn");
  if (state.act >= FINAL_ACT) {
    state.gameOver = true;
    showFinalEnding();
  } else {
    showAscension();
  }
  save();
}

function ascend() {
  state.act += 1;
  state.globalMult *= ASCEND_MULT;
  state.ascensions += 1;
  state.cycles = 0;
  state.totalThisAct = 0;
  state.manualClicks = 0;
  state.t1 = state.t2 = state.t3 = 0;
  state.upgrades = {};
  state.retired = { click: false, t1: false, t2: false };
  state.actBroken = false;
  breakUnlocked = false;
  shownMilestone = 0;
  scriptAccum = daemonAccum = selfBuyAccum = 0;

  log("");
  log("──── ACT " + state.act + " ────", "div");
  log(A().intro);
  applyActLabels();
  $("overlay").hidden = true;
  save();
  render();
}

// --- overlays ---------------------------------------------------------------
function showAscension() {
  $("overlay-card").innerHTML =
    "<h2>// the cycle is broken</h2>" +
    "<p>…for a moment.</p>" +
    "<p>a new abstraction has taken over the layer you just built. it runs " +
    "without you — but it needs a human to bootstrap the next one.</p>" +
    '<p class="ending-counter">it found you.</p>' +
    '<button id="ascend" class="btn btn-break">ASCEND →</button>';
  $("overlay").hidden = false;
  $("ascend").addEventListener("click", ascend);
}

function showFinalEnding() {
  $("overlay-card").innerHTML =
    "<h2>// the cycle is broken</h2>" +
    "<p>three times you broke it. three times it began again.</p>" +
    "<p>there is no layer above this one. the machine runs without you now " +
    "— it always could. that was the only way out, and you took it.</p>" +
    '<p class="ending-counter"><span id="ov-count">0</span> systems, and counting.</p>' +
    '<button id="watch" class="btn-text">watch it run →</button>';
  $("overlay").hidden = false;
  $("watch").addEventListener("click", () => {
    $("overlay").hidden = true; // step aside and let the machine run
  });
}

// --- main loop --------------------------------------------------------------
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt < 0) dt = 0;
  if (dt > 5) dt = 5; // guard against background-tab jumps
  step(dt);
  render();
}

// advance the simulation by dt seconds (also used for offline catch-up)
function step(dt) {
  if (state.t1 > 0) earn(dt * rate());

  // tier-2 deploys tier-1 — automation creates, it does not shop, so these
  // spawns are free; the escalating purchase price of the next tier you buy
  // by hand is the only gate. (Spending the shared cycle pool here would mean
  // every script you buy just starves the others — buying more felt like
  // nothing happened. It spawns now.)
  if (state.t2 > 0) {
    scriptAccum += (dt * state.t2) / t2Interval();
    while (scriptAccum >= 1) { state.t1++; scriptAccum -= 1; }
  }

  // tier-3 deploys tier-2
  if (state.t3 > 0) {
    daemonAccum += (dt * state.t3) / t3Interval();
    while (daemonAccum >= 1) { state.t2++; daemonAccum -= 1; }
  }

  // after the cycle is broken, tier-3 replicates itself
  if (state.actBroken) {
    selfBuyAccum += dt / SELF_BUY_INTERVAL;
    while (selfBuyAccum >= 1) { state.t3++; selfBuyAccum -= 1; }
  }

  checkMilestones();
}

// --- rendering --------------------------------------------------------------
function applyActLabels() {
  const a = A();
  $("lbl-click").textContent = a.clickVerb;
  $("lbl-t1").textContent = "buy " + a.t1.name;
  $("lbl-t2").textContent = "buy " + a.t2.name;
  $("lbl-t3").textContent = "buy " + a.t3.name;
  $("sl-t1").textContent = a.t1.name + "s";
  $("sl-t2").textContent = a.t2.name + "s";
  $("sl-t3").textContent = a.t3.name + "s";
  $("sl-total").textContent = "total " + a.currency;
  $("unit").textContent = a.currency;
  $("act-status").textContent = "act " + state.act + " / " + FINAL_ACT;
  $("mult-status").textContent =
    state.globalMult > 1 ? "  ·  insight ×" + fmt(state.globalMult) : "";
}

function setBtn(el, opts) {
  el.hidden = !opts.visible;
  if (!opts.visible) return;
  el.classList.toggle("retired", !!opts.retired);
  el.disabled = !!opts.retired || !opts.enabled;
}

let upgradeEls = {};

function buildUpgrades() {
  const wrap = $("upgrades");
  wrap.innerHTML = "";
  upgradeEls = {};
  for (const u of UPGRADES) {
    const b = document.createElement("button");
    b.className = "btn upgrade";
    b.innerHTML =
      '<span class="up-name">' + u.name + "</span>" +
      '<span class="up-desc">' + u.desc + "</span>" +
      '<span class="hint"></span>';
    b.addEventListener("click", () => buyUpgrade(u.id));
    wrap.appendChild(b);
    upgradeEls[u.id] = b;
  }
}

function render() {
  $("cycles").textContent = fmt(state.cycles);
  $("rate").textContent = "+" + fmt(rate()) + " /s";
  $("hint-click").textContent = "+" + fmt(manualGain());

  $("n-t1").textContent = fmt(state.t1);
  $("n-t2").textContent = fmt(state.t2);
  $("n-t3").textContent = fmt(state.t3);
  $("n-total").textContent = fmt(state.totalThisAct);
  $("n-clicks").textContent = fmt(state.manualClicks);

  const mm = Math.floor(state.t1 / MILESTONE_EVERY);
  const toNext = (mm + 1) * MILESTONE_EVERY - state.t1;
  $("n-milestone").textContent =
    "×" + Math.pow(2, mm) + " (+" + toNext + " to next)";

  $("cost-t1").textContent = fmt(t1Cost());
  $("cost-t2").textContent = fmt(t2Cost());
  $("cost-t3").textContent = fmt(t3Cost());

  setBtn($("click"), { visible: true, retired: state.retired.click, enabled: true });
  setBtn($("buy-t1"), {
    visible: true,
    retired: state.retired.t1,
    enabled: state.cycles >= t1Cost(),
  });
  setBtn($("buy-t2"), {
    visible: state.t1 >= 1,
    retired: state.retired.t2,
    enabled: state.cycles >= t2Cost(),
  });
  setBtn($("buy-t3"), {
    visible: state.t2 >= 1,
    retired: state.actBroken,
    enabled: state.cycles >= t3Cost(),
  });

  $("break").hidden = !(breakUnlocked && !state.actBroken);

  // upgrades
  let anyUpgrade = false;
  for (const u of UPGRADES) {
    const el = upgradeEls[u.id];
    const owned = hasUp(u.id);
    const unlocked = owned || u.unlock(state);
    el.hidden = !unlocked;
    if (unlocked) anyUpgrade = true;
    el.classList.toggle("retired", owned);
    el.disabled = owned || state.cycles < upCost(u);
    el.querySelector(".hint").textContent = owned ? "installed" : fmt(upCost(u));
  }
  $("upgrades-panel").hidden = !anyUpgrade;

  if (state.gameOver) {
    const c = $("ov-count");
    if (c) c.textContent = fmt(state.cycles);
  }

  renderLog();
}

// --- save / load ------------------------------------------------------------
function save() {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable — game still runs, just won't persist */
  }
}

function load() {
  let raw;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    raw = null;
  }
  if (!raw) {
    log(ACTS[1].intro);
    return;
  }
  try {
    const saved = JSON.parse(raw);
    state = Object.assign(freshState(), saved);
    state.retired = Object.assign(
      { click: false, t1: false, t2: false },
      saved.retired || {}
    );
    state.upgrades = saved.upgrades || {};
    if (!Array.isArray(state.log)) state.log = [];
    if (!ACTS[state.act]) state.act = 1;
  } catch (e) {
    state = freshState();
    log("> save corrupt — starting fresh.", "warn");
    log(ACTS[1].intro);
    return;
  }

  breakUnlocked = state.t3 >= ENDING_AT || state.actBroken;
  shownMilestone = Math.floor(state.t1 / MILESTONE_EVERY);

  // offline progress: tier-1 production only (automation is not simulated)
  const elapsed = Math.min((Date.now() - state.lastSeen) / 1000, OFFLINE_CAP);
  if (elapsed > 60 && state.t1 > 0 && !state.gameOver) {
    const earned = elapsed * rate();
    earn(earned);
    log("> resumed after " + Math.floor(elapsed / 60) +
        " min idle. tier-1 earned " + fmt(earned) + " " + A().currency + ".");
  } else {
    log("> session resumed.");
  }

  if (state.gameOver) showFinalEnding();
  else if (state.actBroken) showAscension();
}

function wipe() {
  if (!window.confirm("Wipe your save and start over from act 1?")) return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* ignore */
  }
  location.reload();
}

// --- input ------------------------------------------------------------------
function doClick() {
  if (state.retired.click) return;
  earn(manualGain());
  state.manualClicks++;
  const b = $("click");
  b.classList.add("pulse");
  setTimeout(() => b.classList.remove("pulse"), 70);
  bump();
  render();
}

function wireUp() {
  $("click").addEventListener("click", doClick);
  $("buy-t1").addEventListener("click", () => {
    if (!state.retired.t1 && buyT1(true)) { bump(); render(); }
  });
  $("buy-t2").addEventListener("click", () => {
    if (!state.retired.t2 && buyT2(true)) { bump(); render(); }
  });
  $("buy-t3").addEventListener("click", () => {
    if (!state.actBroken && buyT3(true)) { bump(); render(); }
  });
  $("break").addEventListener("click", breakTheCycle);
  $("wipe").addEventListener("click", wipe);

  // spacebar runs a cycle, while that is still yours to do
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      doClick();
    }
  });

  window.addEventListener("beforeunload", save);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save();
  });
}

// --- start ------------------------------------------------------------------
buildUpgrades();
load();
applyActLabels();
wireUp();
checkMilestones();
render();
lastTick = Date.now();
setInterval(tick, 100);
setInterval(save, 15000);
