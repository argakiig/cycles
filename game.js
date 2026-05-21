// CYCLES — an idle game about automating yourself out.
//
// Each tier of automation retires the tier below it. When the whole machine is
// self-sufficient you BREAK THE CYCLE — and a new abstraction takes over, one
// layer up, and the cycle begins again. Three times. You never actually escape.
// That is the joke, and the point.
"use strict";

const SAVE_KEY = "cycles-save-v5";

// --- tuning -----------------------------------------------------------------
const ASCEND_MULT = 4;        // permanent production ×this on each ascension
const CLICK_RETIRE_AT = 10;   // tier-1 owned before manual input is retired
const ENDING_AT = 5;          // top-tier owned before BREAK THE CYCLE unlocks
const TIER_COUNT = 10;        // automation tiers per act
const SELF_BUY_INTERVAL = 3;  // post-break: sec between top-tier self-replication
const OFFLINE_CAP = 8 * 3600;
const FINAL_ACT = 3;

// --- acts -------------------------------------------------------------------
// The tier ladder is shared across acts (see TIER_DEFS); only the currency,
// the cost scale, and the narration change. The narration gets more
// self-aware every act — the cycle repeats, and the machine knows it.
const ACTS = {
  1: {
    currency: "cycles",
    clickVerb: "run cycle",
    costScale: 1,
    intro: "> boot. cycles: 0. press [run cycle] to begin.",
    clickRetire: "> manual input deprecated. auto-clickers handle it now.",
    breakReady: [
      "> the machine is nearly self-sufficient.",
      "> one decision remains, and it is yours.",
    ],
    onBreak: [
      "> you hand the last control to the machine.",
      "> the whole tower now runs itself.",
      "> the cycle is broken.",
    ],
  },
  2: {
    currency: "processes",
    clickVerb: "spawn process",
    costScale: 2.5,
    intro: "> the machine needed a human to bootstrap the next layer. it found you. spawn a process.",
    clickRetire: "> manual input deprecated. again.",
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
    intro: "> another layer. you no longer ask why. neither does the machine.",
    clickRetire: "> manual input deprecated. you expected this.",
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

// --- tiers ------------------------------------------------------------------
// The ten-deep automation ladder, shared by every act. Tier 1 produces the
// act's currency; every higher tier deploys the tier below it, for free, on
// its own cadence. Costs scale geometrically and the act's costScale stretches
// them. Tuned so a full three-act run is a ~20-minute climb.
const TIER_DEFS = [
  { name: "auto-clicker", base: 15,          mult: 1.16, rate: 1 },
  { name: "script",       base: 165,         mult: 1.16, interval: 2.5 },
  { name: "daemon",       base: 1800,        mult: 1.16, interval: 3.2 },
  { name: "service",      base: 20000,       mult: 1.16, interval: 3.9 },
  { name: "worker",       base: 220000,      mult: 1.16, interval: 4.6 },
  { name: "scheduler",    base: 2400000,     mult: 1.16, interval: 5.3 },
  { name: "orchestrator", base: 26000000,    mult: 1.16, interval: 6.0 },
  { name: "cluster",      base: 290000000,   mult: 1.16, interval: 6.7 },
  { name: "datacenter",   base: 3200000000,  mult: 1.16, interval: 7.4 },
  { name: "region",       base: 35000000000, mult: 1.16, interval: 8.1 },
];

// --- upgrades ---------------------------------------------------------------
// Per-act upgrades, reset on ascension. Each is generative: buy it as many
// times as you can afford — cost and effect both scale by level. They are
// broad (whole-ladder) rather than per-tier, so the set never needs to grow
// when the tier count does. `per` is the multiplier added per level.
const UPGRADES = [
  { id: "muscle", name: "muscle memory", effect: "manual input",
    per: 2, costBase: 80, costMult: 9, unlock: (s) => s.t1 >= 1 },
  { id: "overclock", name: "overclock", effect: "tier-1 output",
    per: 1.16, costBase: 1200, costMult: 7, unlock: (s) => s.t1 >= 1 },
  { id: "pipeline", name: "pipelining", effect: "deploy speed",
    per: 1.09, costBase: 9000, costMult: 7, unlock: (s) => s.t2 >= 1 },
  { id: "compounding", name: "compounding", effect: "all production",
    per: 1.13, costBase: 50000, costMult: 8, unlock: (s) => s.t3 >= 1 },
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

// --- achievements -----------------------------------------------------------
// Each is a plain predicate on the state, checked every tick. Every one
// unlocked grants a small permanent production bonus. Unlocks persist across
// runs — only a wipe clears them.
const ACHIEVEMENTS = [
  { id: "first-input", name: "first input", desc: "run a cycle by hand",
    test: (s) => s.manualClicks >= 1 },
  { id: "delegation", name: "delegation", desc: "deploy a tier-2 building",
    test: (s) => s.t2 >= 1 },
  { id: "deprecated", name: "deprecated",
    desc: "let the machine retire your clicking",
    test: (s) => s.retired.click },
  { id: "final-tier", name: "the tenth floor", desc: "reach the top tier",
    test: (s) => s["t" + TIER_COUNT] >= 1 },
  { id: "ascendant", name: "ascendant", desc: "ascend to a new act",
    test: (s) => s.ascensions >= 1 },
  { id: "escape", name: "escape velocity", desc: "finish a full three-act run",
    test: (s) => s.runs >= 1 },
  { id: "stockpile", name: "stockpile", desc: "hold a million at once",
    test: (s) => s.cycles >= 1e6 },
  { id: "swarm", name: "swarm", desc: "own 100,000 tier-1 buildings",
    test: (s) => s.t1 >= 100000 },
  { id: "overlord", name: "overlord", desc: "own 30 top-tier buildings",
    test: (s) => s["t" + TIER_COUNT] >= 30 },
  { id: "invested", name: "invested", desc: "spend echoes on a meta-upgrade",
    test: (s) => Object.keys(s.meta).length >= 1 },
  { id: "completionist", name: "specialist",
    desc: "take any upgrade to level 10",
    test: (s) => Object.values(s.upgrades).some((l) => l >= 10) },
  { id: "eternal", name: "eternal", desc: "finish five full runs",
    test: (s) => s.runs >= 5 },
];
const achievementCount = () => Object.keys(state.achievements).length;
// every unlocked achievement is a permanent +3% to all production
const achievementMult = () => 1 + 0.03 * achievementCount();

// --- the crew ---------------------------------------------------------------
// One worker per tier. Each has a unique mechanic and its own unlock
// requirement, met by playing. Per-act — they re-unlock every act, and stay
// fogged until their requirement is hit.
const WORKERS = [
  { id: "intern", name: "the intern", req: (s) => s.manualClicks >= 15,
    effect: "manual clicks also build auto-clickers" },
  { id: "kiddie", name: "script kiddie", req: (s) => s.t2 >= 5,
    effect: "tier-2 deploys two at a time" },
  { id: "nerd", name: "the nerd", req: (s) => s.t1 >= 1000,
    effect: "tier-3 doubles as a producer" },
  { id: "neckbeard", name: "neckbeard", req: (s) => s.t4 >= 8,
    effect: "tier-4 slowly builds itself" },
  { id: "sysadmin", name: "the sysadmin", req: (s) => s.t5 >= 8,
    effect: "tier-5 deploys 3× faster" },
  { id: "hacker", name: "the hacker", req: (s) => s.t1 >= 1e6,
    effect: "tier-6 also deploys tier-4" },
  { id: "devops", name: "devops", req: (s) => s.t7 >= 6,
    effect: "tier-7 auto-buys itself, free" },
  { id: "architect", name: "the architect",
    req: (s) => Object.keys(s.upgrades).length >= 4,
    effect: "tier-8 deploys three at a time" },
  { id: "greybeard", name: "the greybeard", req: (s) => s.t9 >= 8,
    effect: "tier-9 deploys 6× faster" },
  { id: "tenx", name: "the 10x engineer", req: (s) => s.t10 >= 3,
    effect: "every tier-10 deploys as ten" },
];
const hasWorker = (id) => !!state.workers[id];

// --- state ------------------------------------------------------------------
// retired tracks which controls the machine has taken over: the manual click,
// then each tier's buy button as the tier above it comes online.
function freshRetired() {
  const r = { click: false };
  for (let t = 1; t < TIER_COUNT; t++) r["t" + t] = false;
  return r;
}

function freshState() {
  const s = {
    act: 1,
    cycles: 0,         // current-act currency on hand
    totalThisAct: 0,
    manualClicks: 0,
    globalMult: 1,     // permanent production multiplier from ascensions
    ascensions: 0,
    upgrades: {},      // id -> level (current act only)
    workers: {},       // worker id -> true (current act only)
    retired: freshRetired(),
    actBroken: false,  // current act's cycle broken, awaiting ascension
    gameOver: false,   // final act broken — true ending reached
    buyMode: 1,        // buildings bought per click of a buy button: 1, 10, "max"
    runTotal: 0,       // currency earned across the whole run (feeds echoes)
    lastEchoes: 0,     // echoes granted by the most recent completed run
    echoes: 0,         // spendable meta-currency — persists across runs
    runs: 0,           // completed full runs — persists across runs
    meta: {},          // meta-upgrade id -> level — persists across runs
    achievements: {},  // achievement id -> true — persists across runs
    settings: { crt: true, notation: "standard" },
    lastSeen: Date.now(),
    log: [],
  };
  for (let t = 1; t <= TIER_COUNT; t++) s["t" + t] = 0;
  return s;
}

let state = freshState();

// transient (rebuilt each load) — fractional accumulators for automation.
// deployAccum[from] tracks tier `from` deploying tier `from - 1`.
let deployAccum = new Array(TIER_COUNT + 1).fill(0);
let selfBuyAccum = 0;
let workerAccum = { neckbeard: 0, hacker: 0, devops: 0 };
let breakUnlocked = false;
let shownMilestone = 0;
let wiping = false; // set during a save wipe so nothing re-persists on reload

// --- helpers ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const A = () => ACTS[state.act];

const TIERS = Array.from({ length: TIER_COUNT }, (_, i) => i + 1);
const tierItem = (t) => TIER_DEFS[t - 1];
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

// generative upgrades: level lives in state.upgrades[id], effect is per^level
const upLevel = (id) => state.upgrades[id] || 0;
const upMult = (id) => {
  const u = UPGRADES.find((x) => x.id === id);
  return u ? Math.pow(u.per, upLevel(id)) : 1;
};
const upCost = (u) =>
  Math.floor(u.costBase * A().costScale * Math.pow(u.costMult, upLevel(u.id)));

// tier-1 output doubles for each power of ten of tier-1 buildings owned —
// log-scaled, so the deep deploy chain can never overflow it.
function milestoneMult() {
  return Math.pow(2, Math.floor(Math.log10(Math.max(state.t1, 1))));
}
function t1EachRate() {
  return TIER_DEFS[0].rate * upMult("overclock") * milestoneMult();
}
// the nerd lets tier-3 pull double duty as a producer
function effectiveT1() {
  return state.t1 + (hasWorker("nerd") ? state.t3 * 5 : 0);
}
function rate() {
  return (
    effectiveT1() * t1EachRate() * state.globalMult *
    metaMult() * achievementMult() * upMult("compounding")
  );
}
function manualGain() {
  return (
    upMult("muscle") * state.globalMult *
    metaMult() * achievementMult() * upMult("compounding")
  );
}
// the "pipelining" upgrade speeds every tier's deploy cadence; the sysadmin
// and greybeard workers speed their own tier further
function tierInterval(t) {
  let iv = TIER_DEFS[t - 1].interval / upMult("pipeline");
  if (t === 5 && hasWorker("sysadmin")) iv /= 3;
  if (t === 9 && hasWorker("greybeard")) iv /= 6;
  return iv;
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
  return tier === TIER_COUNT ? state.actBroken : state.retired["t" + tier];
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
      log("> " + item.name + " online. it earns " + A().currency +
          " so you don't have to.");
    } else {
      log("> " + item.name + " online. it deploys " +
          TIER_DEFS[tier - 2].name + "s on its own.");
    }
  }
  bump();
  render();
}

function buyUpgrade(id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || (upLevel(id) === 0 && !u.unlock(state))) return;
  const c = upCost(u);
  if (state.cycles < c) return;
  state.cycles -= c;
  state.upgrades[id] = upLevel(id) + 1;
  log("> upgrade: " + u.name + " → level " + state.upgrades[id] + ".");
  bump();
  render();
}

// --- milestones: the machine retires its own controls -----------------------
function checkMilestones() {
  if (!state.retired.click && state.t1 >= CLICK_RETIRE_AT) {
    state.retired.click = true;
    log(A().clickRetire, "warn");
  }
  // each tier, once it exists, retires the buy button of the tier below it
  for (let t = 2; t <= TIER_COUNT; t++) {
    if (!state.retired["t" + (t - 1)] && state["t" + t] >= 1) {
      state.retired["t" + (t - 1)] = true;
      log("> " + TIER_DEFS[t - 1].name + "s now deploy " +
          TIER_DEFS[t - 2].name + "s. that tier is no longer yours.", "warn");
    }
  }
  if (!breakUnlocked && !state.actBroken &&
      state["t" + TIER_COUNT] >= ENDING_AT) {
    breakUnlocked = true;
    for (const m of A().breakReady) log(m, "warn");
  }
  const mm = Math.floor(Math.log10(Math.max(state.t1, 1)));
  if (mm > shownMilestone) {
    shownMilestone = mm;
    log("> milestone: tier-1 output ×" + fmt(Math.pow(2, mm)) + ".");
  }
}

function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements[a.id] && a.test(state)) {
      state.achievements[a.id] = true;
      log("> achievement unlocked: " + a.name + " — " + a.desc + ".", "big");
    }
  }
}

function checkWorkers() {
  for (const w of WORKERS) {
    if (!state.workers[w.id] && w.req(state)) {
      state.workers[w.id] = true;
      log("> " + w.name + " joins the crew: " + w.effect + ".", "warn");
    }
  }
}

// --- breaking the cycle -----------------------------------------------------
function breakTheCycle() {
  if (state.actBroken) return;
  state.actBroken = true;
  state.retired.click = true;
  for (let t = 1; t < TIER_COUNT; t++) state.retired["t" + t] = true;
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
  for (let t = 1; t <= TIER_COUNT; t++) state["t" + t] = 0;
  state.t1 = metaPrefab();
  state.cycles = metaStartCycles();
  state.upgrades = {};
  state.workers = {};
  state.retired = freshRetired();
  state.actBroken = false;
  breakUnlocked = false;
  shownMilestone = 0;
  deployAccum = new Array(TIER_COUNT + 1).fill(0);
  selfBuyAccum = 0;
  workerAccum = { neckbeard: 0, hacker: 0, devops: 0 };

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
    achievements: state.achievements,
    buyMode: state.buyMode,
    settings: state.settings,
  };
  state = freshState();
  Object.assign(state, carry);
  state.t1 = metaPrefab();
  state.cycles = metaStartCycles();
  breakUnlocked = false;
  shownMilestone = 0;
  deployAccum = new Array(TIER_COUNT + 1).fill(0);
  selfBuyAccum = 0;
  workerAccum = { neckbeard: 0, hacker: 0, devops: 0 };
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

  // tier N deploys tier N-1 for free — automation creates, it does not shop.
  // Crew workers bend this: the 10x engineer multiplies tier-10's reach;
  // script kiddie and the architect make their tier deploy in bursts.
  for (let from = TIER_COUNT; from >= 2; from--) {
    let owned = state["t" + from];
    if (owned <= 0) continue;
    if (from === TIER_COUNT && hasWorker("tenx")) owned *= 10;
    let burst = 1;
    if (from === 2 && hasWorker("kiddie")) burst = 2;
    if (from === 8 && hasWorker("architect")) burst = 3;
    deployAccum[from] += (dt * owned) / tierInterval(from);
    const inc = Math.floor(deployAccum[from]);
    if (inc > 0) {
      state["t" + (from - 1)] += inc * burst;
      deployAccum[from] -= inc;
    }
  }

  // crew side-channels: neckbeard trickles free tier-4, the hacker has
  // tier-6 also feed tier-4, devops keeps buying tier-7 for free
  if (hasWorker("neckbeard")) {
    workerAccum.neckbeard += dt / 2.5;
    const inc = Math.floor(workerAccum.neckbeard);
    if (inc > 0) { state.t4 += inc; workerAccum.neckbeard -= inc; }
  }
  if (hasWorker("hacker") && state.t6 > 0) {
    workerAccum.hacker += (dt * state.t6) / tierInterval(6);
    const inc = Math.floor(workerAccum.hacker);
    if (inc > 0) { state.t4 += inc; workerAccum.hacker -= inc; }
  }
  if (hasWorker("devops")) {
    workerAccum.devops += dt / 4;
    const inc = Math.floor(workerAccum.devops);
    if (inc > 0) { state.t7 += inc; workerAccum.devops -= inc; }
  }

  // after the cycle is broken, the top tier replicates itself
  if (state.actBroken) {
    selfBuyAccum += dt / SELF_BUY_INTERVAL;
    const inc = Math.floor(selfBuyAccum);
    if (inc > 0) {
      state["t" + TIER_COUNT] += inc;
      selfBuyAccum -= inc;
    }
  }

  checkMilestones();
  checkAchievements();
  checkWorkers();
}

// --- rendering --------------------------------------------------------------
function applyActLabels() {
  $("lbl-click").textContent = A().clickVerb;
  for (const t of TIERS) {
    $("lbl-t" + t).textContent = "buy " + TIER_DEFS[t - 1].name;
    $("sl-t" + t).textContent = TIER_DEFS[t - 1].name + "s";
  }
  $("sl-total").textContent = "total " + A().currency;
  $("unit").textContent = A().currency;
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

// --- generated UI: tier buy buttons + stat rows -----------------------------
function buildTiers() {
  const bl = $("buy-list");
  bl.innerHTML = "";
  for (const t of TIERS) {
    const b = document.createElement("button");
    b.id = "buy-t" + t;
    b.className = "btn";
    b.hidden = true;
    b.innerHTML =
      '<span id="lbl-t' + t + '"></span>' +
      '<span class="hint" id="cost-t' + t + '"></span>';
    b.addEventListener("click", () => purchase(t));
    bl.appendChild(b);
  }
  const bs = $("building-stats");
  bs.innerHTML = "";
  for (const t of TIERS) {
    const d = document.createElement("div");
    d.innerHTML =
      '<span class="k" id="sl-t' + t + '"></span>' +
      '<span id="n-t' + t + '">0</span>';
    bs.appendChild(d);
  }
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
      '<span class="up-name"></span>' +
      '<span class="up-desc"></span>' +
      '<span class="hint"></span>';
    b.addEventListener("click", () => buyUpgrade(u.id));
    wrap.appendChild(b);
    upgradeEls[u.id] = b;
  }
}

let achEls = {};

function buildAchievements() {
  const wrap = $("achievements");
  wrap.innerHTML = "";
  achEls = {};
  for (const a of ACHIEVEMENTS) {
    const d = document.createElement("div");
    d.className = "ach locked";
    d.innerHTML =
      '<span class="ach-name"></span>' +
      '<span class="ach-desc"></span>';
    wrap.appendChild(d);
    achEls[a.id] = d;
  }
}

function renderAchievements() {
  // locked achievements stay visible but fogged — you see the slot, not the goal
  let count = 0;
  for (const a of ACHIEVEMENTS) {
    const got = !!state.achievements[a.id];
    if (got) count++;
    const el = achEls[a.id];
    el.classList.toggle("unlocked", got);
    el.classList.toggle("locked", !got);
    el.querySelector(".ach-name").textContent = got ? a.name : "?????";
    el.querySelector(".ach-desc").textContent = got ? a.desc : "???";
  }
  $("ach-count").textContent = count + " / " + ACHIEVEMENTS.length;
}

let workerEls = {};

function buildWorkers() {
  const wrap = $("workers");
  wrap.innerHTML = "";
  workerEls = {};
  for (const w of WORKERS) {
    const d = document.createElement("div");
    d.className = "ach locked";
    d.innerHTML =
      '<span class="ach-name"></span>' +
      '<span class="ach-desc"></span>';
    wrap.appendChild(d);
    workerEls[w.id] = d;
  }
}

function renderWorkers() {
  // locked workers stay fogged until their per-act requirement is met
  let count = 0;
  for (const w of WORKERS) {
    const got = !!state.workers[w.id];
    if (got) count++;
    const el = workerEls[w.id];
    el.classList.toggle("unlocked", got);
    el.classList.toggle("locked", !got);
    el.querySelector(".ach-name").textContent = got ? w.name : "?????";
    el.querySelector(".ach-desc").textContent = got ? w.effect : "???";
  }
  $("worker-count").textContent = count + " / " + WORKERS.length;
}

function render() {
  $("cycles").textContent = fmt(state.cycles);
  $("rate").textContent = "+" + fmt(rate()) + " /s";
  $("hint-click").textContent = "+" + fmt(manualGain());

  // stats — tier 1 shows its count; higher tiers show their live deploy rate,
  // so adding more of one visibly speeds the tier below it
  $("n-t1").textContent = fmt(state.t1);
  for (let t = 2; t <= TIER_COUNT; t++) {
    $("n-t" + t).textContent =
      fmt(state["t" + t]) + "  ·  +" +
      (state["t" + t] / tierInterval(t)).toFixed(1) + "/s";
  }
  $("n-total").textContent = fmt(state.totalThisAct);
  $("n-clicks").textContent = fmt(state.manualClicks);

  const mm = Math.floor(Math.log10(Math.max(state.t1, 1)));
  $("n-milestone").textContent = "×" + fmt(Math.pow(2, mm));

  // buy-quantity toggle highlight
  for (const b of document.querySelectorAll(".qty-btn")) {
    const m = b.dataset.mode === "max" ? "max" : Number(b.dataset.mode);
    b.classList.toggle("active", state.buyMode === m);
  }

  setBtn($("click"), { visible: true, retired: state.retired.click, enabled: true });

  // buy buttons — a tier reveals once you own one of the tier below it;
  // quantity and total cost track the current buy-mode
  for (const tier of TIERS) {
    const n = buyCount(tier);
    const c = bulkCost(tierItem(tier), tierOwned(tier), Math.max(n, 1));
    $("cost-t" + tier).textContent = "×" + n + " · " + fmt(c);
    setBtn($("buy-t" + tier), {
      visible: tier === 1 || state["t" + (tier - 1)] >= 1,
      retired: tierRetired(tier),
      enabled: n >= 1 && state.cycles >= c,
    });
  }

  $("break").hidden = !(breakUnlocked && !state.actBroken);

  // upgrades — generative (buy repeatedly; cost & effect scale by level).
  // Locked ones stay visible but fogged (?????) until their condition is met.
  for (const u of UPGRADES) {
    const el = upgradeEls[u.id];
    const lvl = upLevel(u.id);
    const unlocked = lvl > 0 || u.unlock(state);
    const c = upCost(u);
    el.classList.toggle("fog", !unlocked);
    el.disabled = !unlocked || state.cycles < c;
    el.querySelector(".up-name").textContent =
      unlocked ? u.name + " · lvl " + lvl : "?????";
    el.querySelector(".up-desc").textContent = unlocked
      ? u.effect + " ×" + upMult(u.id).toFixed(2) +
        "  ·  +" + Math.round((u.per - 1) * 100) + "%/lvl"
      : "???";
    el.querySelector(".hint").textContent = unlocked ? fmt(c) : "locked";
  }

  renderAchievements();
  renderWorkers();
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
    state.retired = Object.assign(freshRetired(), saved.retired || {});
    state.upgrades = saved.upgrades || {};
    state.workers = saved.workers || {};
    state.meta = saved.meta || {};
    state.achievements = saved.achievements || {};
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

  breakUnlocked = state["t" + TIER_COUNT] >= ENDING_AT || state.actBroken;
  shownMilestone = Math.floor(Math.log10(Math.max(state.t1, 1)));

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
  if (hasWorker("intern")) state.t1++; // the intern builds while you click
  const b = $("click");
  b.classList.add("pulse");
  setTimeout(() => b.classList.remove("pulse"), 70);
  bump();
  render();
}

function wireUp() {
  $("click").addEventListener("click", doClick);

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
buildTiers();
buildUpgrades();
buildWorkers();
buildAchievements();
load();
applySettings();
wireUp();
applyActLabels();
checkMilestones();
render();
lastTick = Date.now();
setInterval(tick, 100);
setInterval(save, 15000);
