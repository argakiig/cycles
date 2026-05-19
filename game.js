// CYCLES — an idle game about automating yourself out.
//
// Each tier of automation retires the tier below it. When the whole machine is
// self-sufficient you BREAK THE CYCLE — and a new abstraction takes over, one
// layer up, and the cycle begins again. Three times. You never actually escape.
// That is the joke, and the point.
"use strict";

const SAVE_KEY = "cycles-save-v3";

// --- tuning -----------------------------------------------------------------
const ASCEND_MULT = 4;        // permanent production ×this on each ascension
const CLICK_RETIRE_AT = 10;   // tier-1 owned before manual input is retired
const ENDING_AT = 5;          // top-tier owned before BREAK THE CYCLE unlocks
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
    t4: { name: "orchestrator", base: 150000, mult: 1.45, interval: 8 },
    intro: "> boot. cycles: 0. press [run cycle] to begin.",
    clickRetire: "> manual input deprecated. auto-clickers handle it now.",
    t2Online: "> procurement automated. scripts deploy auto-clickers now.",
    t3Online: "> orchestration automated. daemons deploy scripts now.",
    t4Online: "> supervision automated. orchestrators deploy daemons now.",
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
    t4: { name: "hypervisor", base: 150000, mult: 1.45, interval: 8 },
    intro: "> the machine needed a human to bootstrap the next layer. it found you. spawn a process.",
    clickRetire: "> manual input deprecated. again.",
    t2Online: "> procurement automated. you have seen this before.",
    t3Online: "> orchestration automated. you know how this ends.",
    t4Online: "> supervision automated. of course it is.",
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
    t4: { name: "grid", base: 150000, mult: 1.45, interval: 8 },
    intro: "> another layer. you no longer ask why. neither does the machine.",
    clickRetire: "> manual input deprecated. you expected this.",
    t2Online: "> procurement automated.",
    t3Online: "> orchestration automated.",
    t4Online: "> supervision automated.",
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
// Per-act one-time purchases — reset on ascension. Cost scales with the act's
// cost scale (same as buildings) so they stay an affordable choice every act.
// They are priced below the daemon you are saving for, so they are a real
// mid-act choice rather than something you can never reach.
const UPGRADES = [
  { id: "muscle", name: "muscle memory", desc: "manual input ×10",
    cost: 50, unlock: (s) => s.t1 >= 1 },
  { id: "overclock", name: "overclock", desc: "tier-1 output ×3",
    cost: 600, unlock: (s) => s.t1 >= 5 },
  { id: "pipeline", name: "pipelining", desc: "tier-2 automation 2× faster",
    cost: 2500, unlock: (s) => s.t2 >= 2 },
  { id: "preempt", name: "preemption", desc: "tier-3 automation 2× faster",
    cost: 5000, unlock: (s) => s.t3 >= 1 },
  { id: "autoscale", name: "auto-scaling", desc: "tier-4 automation 2× faster",
    cost: 60000, unlock: (s) => s.t4 >= 1 },
];

// --- meta-prestige ----------------------------------------------------------
// Echoes are banked when you finish a full three-act run, then spent on
// permanent, run-wide bonuses. They persist across runs — only a wipe clears
// them. Each meta level costs base × 2^(current level).
const META = [
  { id: "hum", name: "residual hum", blurb: "all production ×1.5 per level",
    base: 4 },
  { id: "headstart", name: "head start", blurb: "begin each act with cycles",
    base: 6 },
  { id: "prefab", name: "prefab", blurb: "begin each act with auto-clickers",
    base: 8 },
  { id: "momentum", name: "momentum", blurb: "ascension multiplier +1 per level",
    base: 12 },
];
const metaLevel = (id) => state.meta[id] || 0;
const metaCost = (m) => m.base * Math.pow(2, metaLevel(m.id));

// permanent production multiplier from the "residual hum" meta-upgrade
function metaMult() {
  return Math.pow(1.5, metaLevel("hum"));
}
// cycles granted at the start of each act, scaled to that act's costs
function metaStartCycles() {
  const l = metaLevel("headstart");
  return l > 0 ? Math.floor(100 * Math.pow(8, l - 1) * A().costScale) : 0;
}
// free tier-1 buildings granted at the start of each act
function metaPrefab() {
  return metaLevel("prefab") * 4;
}
// per-ascension global multiplier, raised by the "momentum" meta-upgrade
function ascendMult() {
  return ASCEND_MULT + metaLevel("momentum");
}
// echoes granted for completing a run, scaled by total currency earned
function echoesEarned() {
  return Math.max(
    3,
    Math.floor(Math.log10(Math.max(state.runTotal, 1000)) * 2.5)
  );
}

// --- state ------------------------------------------------------------------
function freshState() {
  return {
    act: 1,
    cycles: 0,         // current-act currency on hand
    totalThisAct: 0,
    manualClicks: 0,
    t1: 0, t2: 0, t3: 0, t4: 0,
    globalMult: 1,     // permanent production multiplier from ascensions
    ascensions: 0,
    upgrades: {},      // id -> true (current act only)
    retired: { click: false, t1: false, t2: false, t3: false },
    actBroken: false,  // current act's cycle broken, awaiting ascension
    gameOver: false,   // final act broken — true ending reached
    buyMode: 1,        // buildings bought per click of a buy button: 1, 10, "max"
    runTotal: 0,       // currency earned across the whole run (feeds echoes)
    lastEchoes: 0,     // echoes granted by the most recent completed run
    echoes: 0,         // spendable meta-currency — persists across runs
    runs: 0,           // completed full runs — persists across runs
    meta: {},          // meta-upgrade id -> level — persists across runs
    settings: { crt: true, notation: "standard" },
    lastSeen: Date.now(),
    log: [],
  };
}

let state = freshState();

// transient (rebuilt each load) — fractional accumulators for automation.
// deployAccum[from] tracks tier `from` deploying tier `from - 1`.
let deployAccum = { 2: 0, 3: 0, 4: 0 };
let selfBuyAccum = 0;
let breakUnlocked = false;
let shownMilestone = 0;
let wiping = false; // set during a save wipe so nothing re-persists on reload

// --- helpers ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const A = () => ACTS[state.act];

const TIERS = [1, 2, 3, 4];
const tierItem = (t) => A()["t" + t];
const tierOwned = (t) => state["t" + t];

// total cost of buying `n` of an item starting from `owned` (geometric series)
function bulkCost(item, owned, n) {
  if (n <= 0) return 0;
  const unit = item.base * A().costScale * Math.pow(item.mult, owned);
  return Math.floor((unit * (Math.pow(item.mult, n) - 1)) / (item.mult - 1));
}

// largest quantity of an item buyable with `cy` cycles
function maxAfford(item, owned, cy) {
  const unit = item.base * A().costScale * Math.pow(item.mult, owned);
  if (cy < unit) return 0;
  return Math.floor(
    Math.log(1 + (cy * (item.mult - 1)) / unit) / Math.log(item.mult)
  );
}

const hasUp = (id) => !!state.upgrades[id];
const upCost = (u) => Math.floor(u.cost * A().costScale);

// tier-1 output doubles for every MILESTONE_EVERY units owned
function milestoneMult() {
  return Math.pow(2, Math.floor(state.t1 / MILESTONE_EVERY));
}
function t1EachRate() {
  return A().t1.rate * (hasUp("overclock") ? 3 : 1) * milestoneMult();
}
function rate() {
  return state.t1 * t1EachRate() * state.globalMult * metaMult();
}
function manualGain() {
  return 1 * (hasUp("muscle") ? 10 : 1) * state.globalMult * metaMult();
}
// which upgrade speeds up each tier's deploy cadence
const TIER_SPEEDUP = { 2: "pipeline", 3: "preempt", 4: "autoscale" };
function tierInterval(t) {
  return A()["t" + t].interval / (hasUp(TIER_SPEEDUP[t]) ? 2 : 1);
}

function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  if (state.settings && state.settings.notation === "scientific") {
    return n.toExponential(2);
  }
  const units = ["", "k", "M", "B", "T", "q", "Q", "s", "S", "O", "N", "D"];
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  if (n >= 1000) return n.toExponential(2); // past the named units
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
// how many buildings the player buys per click of a buy button
function buyCount(tier) {
  if (state.buyMode === "max") {
    return maxAfford(tierItem(tier), tierOwned(tier), state.cycles);
  }
  return state.buyMode;
}

function tierRetired(tier) {
  return tier === 4 ? state.actBroken : state.retired["t" + tier];
}

function purchase(tier) {
  if (tierRetired(tier)) return;
  const item = tierItem(tier);
  const owned = tierOwned(tier);
  const n = buyCount(tier);
  if (n < 1) return;
  const c = bulkCost(item, owned, n);
  if (state.cycles < c) return;
  state.cycles -= c;
  state["t" + tier] += n;
  if (owned === 0) {
    if (tier === 1) {
      log("> " + item.name + " online. it runs cycles so you don't have to.");
    } else {
      log("> " + item.name + " online. it deploys " +
          A()["t" + (tier - 1)].name + "s on its own.");
    }
  }
  bump();
  render();
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
  if (!state.retired.t3 && state.t4 >= 1) {
    state.retired.t3 = true;
    log(A().t4Online, "warn");
  }
  if (!breakUnlocked && !state.actBroken && state.t4 >= ENDING_AT) {
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
  state.retired.t3 = true;
  selfBuyAccum = 0;
  for (const m of A().onBreak) log(m, m === A().onBreak[2] ? "big" : "warn");
  if (state.act >= FINAL_ACT) {
    state.runTotal += state.totalThisAct;
    state.lastEchoes = echoesEarned();
    state.echoes += state.lastEchoes;
    state.runs += 1;
    state.gameOver = true;
    log("> you leave " + fmt(state.lastEchoes) + " echoes behind.", "big");
    showFinalEnding();
  } else {
    showAscension();
  }
  save();
}

function ascend() {
  state.act += 1;
  state.globalMult *= ascendMult();
  state.ascensions += 1;
  state.runTotal += state.totalThisAct;
  state.totalThisAct = 0;
  state.manualClicks = 0;
  state.t2 = state.t3 = state.t4 = 0;
  state.t1 = metaPrefab();
  state.cycles = metaStartCycles();
  state.upgrades = {};
  state.retired = { click: false, t1: false, t2: false, t3: false };
  state.actBroken = false;
  breakUnlocked = false;
  shownMilestone = 0;
  deployAccum = { 2: 0, 3: 0, 4: 0 };
  selfBuyAccum = 0;

  log("");
  log("──── ACT " + state.act + " ────", "div");
  log(A().intro);
  applyActLabels();
  checkMilestones();
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
  renderEnding();
  $("overlay").hidden = false;
}

// the true ending — a meta-shop where echoes from the run are spent before
// beginning again. Rebuilt on every purchase.
function renderEnding() {
  let h = "<h2>// the cycle is broken</h2>";
  if (state.runs <= 1) {
    h +=
      "<p>three times you broke it. three times it began again.</p>" +
      "<p>there is no layer above this one. the machine runs without you " +
      "now — it always could.</p>";
  } else {
    h +=
      "<p>again. " + state.runs + " times now — you know its shape.</p>" +
      "<p>something of each run stays behind. spend it; the next cycle " +
      "bends a little to your will.</p>";
  }
  h +=
    '<p class="ending-counter">you left ' + fmt(state.lastEchoes) +
    " echoes behind.</p>";
  h += '<div class="meta-shop"><h3>echoes available: ' + fmt(state.echoes) +
    "</h3>";
  for (const m of META) {
    const c = metaCost(m);
    const afford = state.echoes >= c;
    h +=
      '<button class="btn meta-up" data-meta="' + m.id + '"' +
      (afford ? "" : " disabled") + ">" +
      '<span class="up-name">' + m.name +
      ' <span class="lvl">lvl ' + metaLevel(m.id) + "</span></span>" +
      '<span class="up-desc">' + m.blurb + "</span>" +
      '<span class="hint">' + fmt(c) + " echoes</span></button>";
  }
  h += "</div>";
  h += '<button id="begin-again" class="btn btn-break">BEGIN AGAIN →</button>';
  $("overlay-card").innerHTML = h;
  $("begin-again").addEventListener("click", beginAgain);
  for (const b of $("overlay-card").querySelectorAll(".meta-up")) {
    b.addEventListener("click", () => buyMeta(b.dataset.meta));
  }
}

function buyMeta(id) {
  const m = META.find((x) => x.id === id);
  if (!m) return;
  const c = metaCost(m);
  if (state.echoes < c) return;
  state.echoes -= c;
  state.meta[id] = metaLevel(id) + 1;
  save();
  renderEnding();
}

// new game plus — reset the run but keep echoes, meta-upgrades and run count
function beginAgain() {
  const carry = {
    echoes: state.echoes,
    runs: state.runs,
    meta: state.meta,
    buyMode: state.buyMode,
    settings: state.settings,
  };
  state = freshState();
  Object.assign(state, carry);
  state.t1 = metaPrefab();
  state.cycles = metaStartCycles();
  breakUnlocked = false;
  shownMilestone = 0;
  deployAccum = { 2: 0, 3: 0, 4: 0 };
  selfBuyAccum = 0;
  log("──── RUN " + (state.runs + 1) + " ────", "div");
  log(ACTS[1].intro);
  $("overlay").hidden = true;
  applyActLabels();
  checkMilestones();
  render();
  save();
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

  // tier N+1 deploys tier N — automation creates, it does not shop, so these
  // spawns are free; the escalating purchase price of the next tier you buy
  // by hand is the only gate. (Spending the shared cycle pool here would mean
  // every script you buy just starves the others — buying more felt like
  // nothing happened. It spawns now.)
  for (const from of [4, 3, 2]) {
    const owned = state["t" + from];
    if (owned > 0) {
      deployAccum[from] += (dt * owned) / tierInterval(from);
      while (deployAccum[from] >= 1) {
        state["t" + (from - 1)]++;
        deployAccum[from] -= 1;
      }
    }
  }

  // after the cycle is broken, the top tier replicates itself
  if (state.actBroken) {
    selfBuyAccum += dt / SELF_BUY_INTERVAL;
    while (selfBuyAccum >= 1) { state.t4++; selfBuyAccum -= 1; }
  }

  checkMilestones();
}

// --- rendering --------------------------------------------------------------
function applyActLabels() {
  const a = A();
  $("lbl-click").textContent = a.clickVerb;
  for (const t of TIERS) {
    $("lbl-t" + t).textContent = "buy " + a["t" + t].name;
    $("sl-t" + t).textContent = a["t" + t].name + "s";
  }
  $("sl-total").textContent = "total " + a.currency;
  $("unit").textContent = a.currency;
  $("act-status").textContent = "act " + state.act + " / " + FINAL_ACT;
  let st = "";
  if (state.globalMult > 1) st += "  ·  insight ×" + fmt(state.globalMult);
  if (state.echoes > 0 || state.runs > 0) {
    st += "  ·  echoes " + fmt(state.echoes);
  }
  $("mult-status").textContent = st;
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

  // stats — tier-2/3 show their live deploy rate, so adding more visibly counts
  $("n-t1").textContent = fmt(state.t1);
  $("n-t2").textContent =
    fmt(state.t2) + "  ·  +" + (state.t2 / tierInterval(2)).toFixed(1) + "/s";
  $("n-t3").textContent =
    fmt(state.t3) + "  ·  +" + (state.t3 / tierInterval(3)).toFixed(1) + "/s";
  $("n-t4").textContent =
    fmt(state.t4) + "  ·  +" + (state.t4 / tierInterval(4)).toFixed(1) + "/s";
  $("n-total").textContent = fmt(state.totalThisAct);
  $("n-clicks").textContent = fmt(state.manualClicks);

  const mm = Math.floor(state.t1 / MILESTONE_EVERY);
  const toNext = (mm + 1) * MILESTONE_EVERY - state.t1;
  $("n-milestone").textContent =
    "×" + Math.pow(2, mm) + " (+" + toNext + " to next)";

  // buy-quantity toggle highlight
  for (const b of document.querySelectorAll(".qty-btn")) {
    const m = b.dataset.mode === "max" ? "max" : Number(b.dataset.mode);
    b.classList.toggle("active", state.buyMode === m);
  }

  setBtn($("click"), { visible: true, retired: state.retired.click, enabled: true });

  // buy buttons — quantity and total cost track the current buy-mode
  const buyVis = { 1: true, 2: state.t1 >= 1, 3: state.t2 >= 1, 4: state.t3 >= 1 };
  for (const tier of TIERS) {
    const n = buyCount(tier);
    const c = bulkCost(tierItem(tier), tierOwned(tier), Math.max(n, 1));
    $("cost-t" + tier).textContent = "×" + n + " · " + fmt(c);
    setBtn($("buy-t" + tier), {
      visible: buyVis[tier],
      retired: tierRetired(tier),
      enabled: n >= 1 && state.cycles >= c,
    });
  }

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

  renderLog();
}

// --- save / load ------------------------------------------------------------
function save() {
  if (wiping) return; // a wipe is in progress — don't write the state back
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
      { click: false, t1: false, t2: false, t3: false },
      saved.retired || {}
    );
    state.upgrades = saved.upgrades || {};
    state.meta = saved.meta || {};
    state.settings = Object.assign(
      { crt: true, notation: "standard" },
      saved.settings || {}
    );
    if (!Array.isArray(state.log)) state.log = [];
    if (!ACTS[state.act]) state.act = 1;
  } catch (e) {
    state = freshState();
    log("> save corrupt — starting fresh.", "warn");
    log(ACTS[1].intro);
    return;
  }

  breakUnlocked = state.t4 >= ENDING_AT || state.actBroken;
  shownMilestone = Math.floor(state.t1 / MILESTONE_EVERY);

  // offline progress: tier-1 production only (automation is not simulated)
  const elapsed = Math.min((Date.now() - state.lastSeen) / 1000, OFFLINE_CAP);
  if (elapsed > 60 && state.t1 > 0 && !state.gameOver && !state.actBroken) {
    const earned = elapsed * rate();
    earn(earned);
    log("> resumed after " + Math.floor(elapsed / 60) +
        " min idle. tier-1 earned " + fmt(earned) + " " + A().currency + ".");
    showOffline(elapsed, earned);
  } else {
    log("> session resumed.");
  }

  if (state.gameOver) showFinalEnding();
  else if (state.actBroken) showAscension();
}

function wipe() {
  if (!window.confirm("Wipe ALL progress — echoes, meta-upgrades, everything?")) {
    return;
  }
  wiping = true;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* ignore */
  }
  location.reload();
}

// --- settings & modals ------------------------------------------------------
function applySettings() {
  document.body.classList.toggle("no-crt", !state.settings.crt);
}

function closeModal() {
  $("modal").hidden = true;
}

function openSettings() {
  renderSettings();
  $("modal").hidden = false;
}

function renderSettings() {
  const s = state.settings;
  $("modal-card").innerHTML =
    "<h2>// settings</h2>" +
    '<div class="setting"><span>CRT scanlines</span>' +
    '<button id="set-crt" class="toggle">' + (s.crt ? "on" : "off") +
    "</button></div>" +
    '<div class="setting"><span>number format</span>' +
    '<button id="set-notation" class="toggle">' + s.notation +
    "</button></div>" +
    '<div class="settings-section"><h3>save data</h3>' +
    '<button id="set-export" class="btn">export — copy save to clipboard</button>' +
    '<textarea id="set-import-text" placeholder="paste a save string to import…">' +
    "</textarea>" +
    '<button id="set-import" class="btn">import save</button>' +
    '<p id="set-msg" class="set-msg"></p></div>' +
    '<button id="set-wipe" class="btn-text">wipe all progress</button>' +
    '<button id="set-close" class="btn btn-break">CLOSE</button>';
  $("set-crt").addEventListener("click", () => {
    s.crt = !s.crt;
    applySettings();
    save();
    renderSettings();
  });
  $("set-notation").addEventListener("click", () => {
    s.notation = s.notation === "standard" ? "scientific" : "standard";
    save();
    renderSettings();
  });
  $("set-export").addEventListener("click", exportSave);
  $("set-import").addEventListener("click", importSave);
  $("set-wipe").addEventListener("click", wipe);
  $("set-close").addEventListener("click", closeModal);
}

function exportSave() {
  const str = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  $("set-import-text").value = str;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).then(
      () => { $("set-msg").textContent = "save copied to clipboard."; },
      () => { $("set-msg").textContent = "select the text above and copy it."; }
    );
  } else {
    $("set-msg").textContent = "select the text above and copy it.";
  }
}

function importSave() {
  const raw = $("set-import-text").value.trim();
  if (!raw) {
    $("set-msg").textContent = "paste a save string first.";
    return;
  }
  let obj;
  try {
    obj = JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch (e) {
    $("set-msg").textContent = "could not read that save string.";
    return;
  }
  if (!obj || typeof obj.act !== "number") {
    $("set-msg").textContent = "that is not a CYCLES save.";
    return;
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
  } catch (e) {
    /* ignore */
  }
  $("set-msg").textContent = "save imported — reloading…";
  wiping = true; // keep the unload save from overwriting the imported data
  location.reload();
}

function showOffline(elapsed, earned) {
  const mins = Math.floor(elapsed / 60);
  const timeStr =
    mins >= 60 ? Math.floor(mins / 60) + "h " + (mins % 60) + "m" : mins + "m";
  $("modal-card").innerHTML =
    "<h2>// while you were away</h2>" +
    "<p>idle for " + timeStr + ".</p>" +
    "<p>tier-1 automation kept running:</p>" +
    '<p class="ending-counter">+' + fmt(earned) + " " + A().currency + "</p>" +
    '<button id="off-close" class="btn btn-break">COLLECT</button>';
  $("modal").hidden = false;
  $("off-close").addEventListener("click", closeModal);
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
  for (const t of TIERS) {
    $("buy-t" + t).addEventListener("click", () => purchase(t));
  }

  // buy-quantity toggle
  for (const b of document.querySelectorAll(".qty-btn")) {
    b.addEventListener("click", () => {
      state.buyMode = b.dataset.mode === "max" ? "max" : Number(b.dataset.mode);
      render();
    });
  }
  $("break").addEventListener("click", breakTheCycle);
  $("open-settings").addEventListener("click", openSettings);
  $("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal(); // click the backdrop to dismiss
  });

  window.addEventListener("keydown", (e) => {
    // spacebar runs a cycle, while that is still yours to do
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      doClick();
    } else if (e.code === "Escape") {
      closeModal();
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
applySettings();
wireUp();
applyActLabels();
checkMilestones();
render();
lastTick = Date.now();
setInterval(tick, 100);
setInterval(save, 15000);
