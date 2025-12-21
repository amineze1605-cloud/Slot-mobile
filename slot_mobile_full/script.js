// script.js — Slot mobile PIXI v5 (5x3)
// ✅ Pas d'audio
// ✅ 7 sprites / rouleau
// ✅ STOP pro (accélère la décélération, stop synchro)
// ✅ HUD pro + bandeau de mises scrollable tactile

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// --------------------------------------------------
// PERF toggles
// --------------------------------------------------
const ENABLE_GLOW = false;

// STOP
const MIN_SPIN_BEFORE_STOP_MS = 260;
const STOP_STAGGER_MS = 0;        // tous en même temps
const STOP_PREDECEL_BOOST = 0.40; // décélération plus agressive si STOP

// --------------------------------------------------
// DOM & globales
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

// IDs mapping
const PREMIUM77_ID = 0;
const BONUS_ID = 6;
const WILD_ID = 9;

// état
let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;
let freeSpins = 0;
let winMultiplier = 1;

// STOP / réseau
let stopRequested = false;
let stopArmedAt = 0;
let spinInFlight = false;
let pendingGrid = null;
let gridArrivedAt = 0;

// highlight
let highlightedCells = [];
let highlightTimer = 0;

// slot refs
let slotContainer = null;
let slotFrame = null;
let slotMask = null;

// background
let bgContainer = null;

// layout
let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;
let visibleH = 0;

let layout = {
  slotX: 0,
  slotY: 0,
  slotW: 0,
  slotH: 0,
  framePadX: 18,
  framePadY: 18,
  frameRadius: 26,
};

// --------------------------------------------------
// SAFE TOP (notch)
// --------------------------------------------------
function getSafeTopPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(16, Math.round(h * 0.03));
}

// --------------------------------------------------
// VITESSES (ajuste si tu veux)
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 1.05,
    spinMs: 1850,
    startStaggerMs: 115,
    stopStaggerMs: 130,
    accelMs: 110,
    preDecelMs: 360,
    settleMs: 380,
    snapMs: 140,
    bounceMs: 190,
    bounceAmpFactor: 0.085,
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.35,
    spinMs: 1500,
    startStaggerMs: 95,
    stopStaggerMs: 110,
    accelMs: 105,
    preDecelMs: 310,
    settleMs: 340,
    snapMs: 135,
    bounceMs: 180,
    bounceAmpFactor: 0.08,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.70,
    spinMs: 1200,
    startStaggerMs: 80,
    stopStaggerMs: 95,
    accelMs: 95,
    preDecelMs: 260,
    settleMs: 300,
    snapMs: 125,
    bounceMs: 170,
    bounceAmpFactor: 0.075,
  },
];
let speedIndex = 0;

// --------------------------------------------------
// Loader helpers
// --------------------------------------------------
function showMessage(text) {
  if (!loaderEl) return;
  loaderEl.style.display = "flex";
  loaderEl.textContent = text;
}
function hideMessage() {
  if (!loaderEl) return;
  loaderEl.style.display = "none";
}

// --------------------------------------------------
// Spritesheet load
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = "assets/spritesheet.png?v=11";
    img.onload = () => {
      try {
        const baseTexture = PIXI.BaseTexture.from(img);
        baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
        baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
        baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
        baseTexture.update();
        resolve(baseTexture);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = (e) =>
      reject(e || new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// --------------------------------------------------
// Background
// --------------------------------------------------
function makeGradientTexture(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.floor(w));
  c.height = Math.max(2, Math.floor(h));
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.0, "#040712");
  g.addColorStop(0.45, "#070C1F");
  g.addColorStop(1.0, "#030510");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const v = ctx.createRadialGradient(
    c.width * 0.5, c.height * 0.35, 10,
    c.width * 0.5, c.height * 0.5,
    Math.max(c.width, c.height) * 0.75
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, c.width, c.height);

  return PIXI.Texture.from(c);
}

function buildBackground() {
  const w = app.screen.width;
  const h = app.screen.height;

  if (bgContainer) {
    bgContainer.destroy(true);
    bgContainer = null;
  }
  bgContainer = new PIXI.Container();

  const bg = new PIXI.Sprite(makeGradientTexture(w, h));
  bg.width = w;
  bg.height = h;
  bgContainer.addChild(bg);

  const stars = new PIXI.Graphics();
  const count = Math.floor((w * h) / 22000);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.8;
    const a = 0.08 + Math.random() * 0.28;
    const r = 0.6 + Math.random() * 1.2;
    stars.beginFill(0xffffff, a);
    stars.drawCircle(x, y, r);
    stars.endFill();
  }
  bgContainer.addChild(stars);

  app.stage.addChild(bgContainer);
}

// --------------------------------------------------
// Init PIXI
// --------------------------------------------------
async function initPixi() {
  if (!canvas) return console.error("Canvas #game introuvable");
  if (!window.PIXI) {
    console.error("PIXI introuvable");
    showMessage("Erreur JS : PIXI introuvable");
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 1.35);

  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: true,
    autoDensity: true,
    resolution: dpr,
    powerPreference: "high-performance",
  });
  app.renderer.roundPixels = true;

  showMessage("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();

    // 4x4 => 16 cases, on utilise 12 cases
    const fullW = baseTexture.width;
    const fullH = baseTexture.height;
    const COLS_SHEET = 4;
    const ROWS_SHEET = 4;
    const cellW = Math.round(fullW / COLS_SHEET);
    const cellH = Math.round(fullH / ROWS_SHEET);

    const positions = [
      [0, 0],[1, 0],[2, 0],[3, 0],
      [0, 1],[1, 1],[2, 1],[3, 1],
      [0, 2],[1, 2],[2, 2],[3, 2],
    ];

    symbolTextures = positions.map(([c, r]) => {
      const rect = new PIXI.Rectangle(c * cellW, r * cellH, cellW, cellH);
      return new PIXI.Texture(baseTexture, rect);
    });

    buildBackground();
    buildSlotScene();
    buildHUD(); // HUD pro + scroll bets

    hideMessage();
    hudSetTopMessage("Appuyez sur SPIN pour lancer");
    app.ticker.add(updateHighlight);

    window.addEventListener("resize", rebuildAll);
  } catch (e) {
    console.error("Erreur chargement", e);
    showMessage("Erreur JS : chargement assets (" + (e?.message || String(e)) + ")");
  }
}

// --------------------------------------------------
// Rebuild (resize)
// --------------------------------------------------
function rebuildAll() {
  try {
    if (!app) return;

    if (slotMask) { slotMask.destroy(true); slotMask = null; }
    if (slotFrame) { slotFrame.destroy(true); slotFrame = null; }
    if (slotContainer) { slotContainer.destroy(true); slotContainer = null; }
    if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }
    if (hud?.root) { hud.root.destroy({ children: true }); hud.root = null; }

    app.stage.removeChildren();
    reels = [];
    highlightedCells = [];

    buildBackground();
    buildSlotScene();
    buildHUD();

    hudSetTopMessage(spinning ? "Spin…" : "Appuyez sur SPIN pour lancer");
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// --------------------------------------------------
// Symbols helpers
// --------------------------------------------------
function safeId(id) {
  const n = symbolTextures.length || 1;
  return ((id % n) + n) % n;
}
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

function createSymbolCell(texture, sizePx) {
  const cell = new PIXI.Container();
  cell.roundPixels = true;

  const mainSprite = new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width = sizePx;
  mainSprite.height = sizePx;
  mainSprite.roundPixels = true;

  cell.addChild(mainSprite);
  return { container: cell, main: mainSprite, symbolId: -1 };
}

function setCellSymbol(cellObj, symbolId) {
  const sid = safeId(symbolId);
  cellObj.symbolId = sid;
  cellObj.main.texture = symbolTextures[sid];
}

// --------------------------------------------------
// Slot scene + frame + mask + reels (7 sprites)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;
  const safeTop = getSafeTopPx();

  reelGap = 8;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  const symbolFromWidth = (maxTotalWidth - reelGap * (COLS - 1)) / COLS;

  const topZone = safeTop + Math.round(h * 0.10);
  const bottomZone = Math.round(h * 0.64);
  const availableH = Math.max(260, bottomZone - topZone);
  const symbolFromHeight = availableH * 0.36;

  const MAX_SYMBOL_PX = 256;
  symbolSize = Math.min(MAX_SYMBOL_PX, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

  reelStep = symbolSize + reelGap;
  visibleH = ROWS * reelStep - reelGap;

  const totalReelWidth = COLS * symbolSize + reelGap * (COLS - 1);

  layout.slotW = totalReelWidth;
  layout.slotH = visibleH;
  layout.slotX = Math.round((w - totalReelWidth) / 2);
  layout.slotY = Math.round(topZone + (availableH - visibleH) * 0.30);

  slotContainer = new PIXI.Container();
  slotContainer.x = layout.slotX;
  slotContainer.y = layout.slotY;

  // Contours un peu plus fins (plus pro)
  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(4, 0xf2b632, 1);        // <= avant: 6
  slotFrame.beginFill(0x060b1a, 0.78);
  slotFrame.drawRoundedRect(
    layout.slotX - layout.framePadX,
    layout.slotY - layout.framePadY,
    totalReelWidth + layout.framePadX * 2,
    visibleH + layout.framePadY * 2,
    layout.frameRadius
  );
  slotFrame.endFill();

  app.stage.addChild(slotFrame);
  app.stage.addChild(slotContainer);

  slotMask = new PIXI.Graphics();
  slotMask.beginFill(0xffffff, 1);
  slotMask.drawRect(0, 0, totalReelWidth, visibleH);
  slotMask.endFill();
  slotMask.x = layout.slotX;
  slotMask.y = layout.slotY;
  slotMask.renderable = false;
  app.stage.addChild(slotMask);
  slotContainer.mask = slotMask;

  reels = [];

  const STRIP_COUNT = 7;
  const TOP_EXTRA = 2;

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    reelContainer.x = Math.round(c * (symbolSize + reelGap));
    reelContainer.y = 0;
    slotContainer.addChild(reelContainer);

    const cells = [];
    for (let i = 0; i < STRIP_COUNT; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx);

      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = Math.round((i - TOP_EXTRA) * reelStep + symbolSize / 2);

      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells,

      offset: 0,
      vel: 0,

      state: "idle",
      settleQueue: null,
      settleIdx: 0,

      bounceStart: 0,
      snapStart: 0,

      startAt: 0,
      minStopAt: 0,
      settleStart: 0,
      preDecelStart: 0,

      userStopAt: Infinity,
    });
  }
}

// --------------------------------------------------
// Paylines / Paytable + eval
// --------------------------------------------------
const PAYLINES = [
  [[0, 0],[1, 0],[2, 0],[3, 0],[4, 0]],
  [[0, 1],[1, 1],[2, 1],[3, 1],[4, 1]],
  [[0, 2],[1, 2],[2, 2],[3, 2],[4, 2]],
  [[0, 0],[1, 1],[2, 2],[3, 1],[4, 0]],
  [[0, 2],[1, 1],[2, 0],[3, 1],[4, 2]],
];

const PAYTABLE = {
  1:  { 3: 2, 4: 3, 5: 4 },
  3:  { 3: 2, 4: 3, 5: 4 },
  7:  { 3: 2, 4: 3, 5: 4 },
  10: { 3: 2, 4: 3, 5: 4 },
  4:  { 3: 3, 4: 4, 5: 5 },
  8:  { 3: 4, 4: 5, 5: 6 },
  5:  { 3: 10, 4: 12, 5: 14 },
  2:  { 3: 16, 4: 18, 5: 20 },
  11: { 3: 20, 4: 25, 5: 30 },
  0:  { 3: 30, 4: 40, 5: 50 },
};

function evaluateGrid(grid, betValue) {
  let baseWin = 0;
  const winningLines = [];
  let bonusCount = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  PAYLINES.forEach((coords, lineIndex) => {
    let base = null;
    let invalid = false;

    for (let i = 0; i < coords.length; i++) {
      const [col, row] = coords[i];
      const sym = grid[row][col];
      if (sym === BONUS_ID) { invalid = true; break; }
      if (sym !== WILD_ID) { base = sym; break; }
    }
    if (invalid || base === null) return;
    if (!PAYTABLE[base]) return;

    let count = 0;
    const cells = [];

    for (let i = 0; i < coords.length; i++) {
      const [col, row] = coords[i];
      const sym = grid[row][col];
      if (sym === BONUS_ID) break;

      if (sym === base || sym === WILD_ID) { count++; cells.push([col, row]); }
      else break;
    }

    if (count >= 3) {
      const mult = PAYTABLE[base]?.[count] || 0;
      if (mult > 0) {
        const lineWin = betValue * mult;
        baseWin += lineWin;
        winningLines.push({ lineIndex, cells, symbolId: base, count, amount: lineWin });
      }
    }
  });

  return { baseWin, winningLines, bonusTriggered: bonusCount >= 3 };
}

// --------------------------------------------------
// Highlight
// --------------------------------------------------
function startHighlight(cells) {
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  const TOP_EXTRA = 2;

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;
    const targetIndex = TOP_EXTRA + row;
    const cellObj = reel.symbols[targetIndex];
    if (cellObj) highlightedCells.push(cellObj);
  });

  highlightTimer = 0;
}

function updateHighlight(delta) {
  if (!highlightedCells.length) return;
  highlightTimer += delta;
  const alpha = Math.sin(highlightTimer * 0.25) > 0 ? 0.35 : 1.0;
  highlightedCells.forEach((cell) => (cell.container.alpha = alpha));

  if (highlightTimer > 80) {
    highlightedCells.forEach((cell) => (cell.container.alpha = 1));
    highlightedCells = [];
    highlightTimer = 0;
  }
}

// --------------------------------------------------
// Easing
// --------------------------------------------------
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t) {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function smoothFactor(dt, tauMs) {
  return 1 - Math.exp(-dt / Math.max(1, tauMs));
}

// --------------------------------------------------
// Recycle O(1) top->bottom (7 sprites)
// --------------------------------------------------
function recycleReelOneStepDown(reel, newTopId) {
  const s = reel.symbols;

  for (let i = 0; i < s.length; i++) s[i].container.y += reelStep;

  const bottom = s.pop();
  bottom.container.y = s[0].container.y - reelStep;
  setCellSymbol(bottom, newTopId);
  s.unshift(bottom);
}

// --------------------------------------------------
// STOP (synchro, rapide)
// --------------------------------------------------
function requestStop(preset) {
  if (!spinning || stopRequested) return;

  stopRequested = true;
  stopArmedAt = performance.now();

  const globalStopAt = stopArmedAt;

  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    const earliest = r.startAt + MIN_SPIN_BEFORE_STOP_MS;
    r.userStopAt = Math.max(earliest, globalStopAt);
  }

  if (gridArrivedAt) ensurePlansAfterGrid(preset);

  hudSetTopMessage("STOP…");
}

// --------------------------------------------------
// Planning
// --------------------------------------------------
function prepareReelPlans(now, preset) {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    r.userStopAt = Infinity;

    r.offset = 0;
    r.vel = 0;
    r.container.y = 0;

    r.state = "spin";
    r.settleQueue = null;
    r.settleIdx = 0;

    r.snapStart = 0;

    r.startAt = now + c * preset.startStaggerMs;

    const baseStop = r.startAt + preset.spinMs + c * preset.stopStaggerMs;
    r.minStopAt = baseStop;

    r.settleStart = baseStop - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;
  }
}

function ensurePlansAfterGrid(preset) {
  const now = performance.now();

  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    const needsGridTime = gridArrivedAt ? gridArrivedAt : 0;

    const normalStopAt = Math.max(r.minStopAt, needsGridTime);

    const u = Number.isFinite(r.userStopAt) ? r.userStopAt : now;
    const requestedStopAt = stopRequested ? Math.max(u, needsGridTime) : normalStopAt;

    const stopAt = stopRequested ? requestedStopAt : normalStopAt;

    r.settleStart = stopAt - preset.settleMs;
    r.settleStart = Math.max(r.startAt + 80, r.settleStart);

    const preBoost = stopRequested ? STOP_PREDECEL_BOOST : 1.0;
    r.preDecelStart = r.settleStart - preset.preDecelMs * preBoost;
    r.preDecelStart = Math.max(r.startAt, r.preDecelStart);
  }
}

function buildSettleQueueForReel(grid, col) {
  const topId = safeId(grid[0][col]);
  const midId = safeId(grid[1][col]);
  const botId = safeId(grid[2][col]);
  return [botId, midId, topId, randomSymbolId()];
}

// --------------------------------------------------
// Animation (spin -> settle -> snap -> bounce)
// --------------------------------------------------
function animateSpinUntilDone(preset) {
  return new Promise((resolve) => {
    let prev = performance.now();
    const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 12);

    function tick(now) {
      const dt = Math.max(0, now - prev);
      prev = now;

      let allDone = true;
      const k = smoothFactor(dt, 110);

      for (let c = 0; c < reels.length; c++) {
        const r = reels[c];

        if (now < r.startAt) { allDone = false; continue; }
        if (r.state !== "done") allDone = false;

        // SPIN
        if (r.state === "spin") {
          if (now >= r.settleStart && pendingGrid) {
            r.state = "settle";
          } else {
            let target = preset.basePxPerMs;

            const tAccel = clamp01((now - r.startAt) / preset.accelMs);
            target *= (0.35 + 0.65 * easeInOutQuad(tAccel));

            if (now >= r.preDecelStart) {
              const t = clamp01((now - r.preDecelStart) / Math.max(1, (r.settleStart - r.preDecelStart)));
              target *= (1 - easeInOutQuad(t) * 0.78);
            }

            r.vel = r.vel + (target - r.vel) * k;
            r.offset += r.vel * dt;

            while (r.offset >= reelStep) {
              r.offset -= reelStep;
              recycleReelOneStepDown(r, randomSymbolId());
            }

            r.container.y = r.offset;
          }
        }

        // SETTLE
        if (r.state === "settle") {
          if (!r.settleQueue) {
            r.settleQueue = buildSettleQueueForReel(pendingGrid, c);
            r.settleIdx = 0;
          }

          const tSettle = clamp01((now - r.settleStart) / preset.settleMs);

          const settleEnd = r.settleStart + preset.settleMs;
          const remainingMs = Math.max(1, settleEnd - now);

          const distToNextStep = reelStep - r.offset;
          const remainingSteps = Math.max(0, (r.settleQueue.length - r.settleIdx));
          const remainingDist = distToNextStep + Math.max(0, remainingSteps - 1) * reelStep;

          const baseNeed = remainingDist / remainingMs;
          const ease = 0.95 - 0.30 * easeOutCubic(tSettle);
          const targetSpeed = Math.max(0.25, baseNeed * ease);

          r.vel = r.vel + (targetSpeed - r.vel) * k;
          r.offset += r.vel * dt;

          while (r.offset >= reelStep && r.settleIdx < r.settleQueue.length) {
            r.offset -= reelStep;
            const nextId = r.settleQueue[r.settleIdx++];
            recycleReelOneStepDown(r, nextId);
          }

          r.container.y = r.offset;

          if (r.settleIdx >= r.settleQueue.length) {
            r.state = "snap";
            r.snapStart = now;
          }
        }

        // SNAP
        if (r.state === "snap") {
          const t = clamp01((now - r.snapStart) / preset.snapMs);
          r.offset = r.offset * (1 - easeOutCubic(t));
          if (r.offset < 0.25) r.offset = 0;
          r.container.y = r.offset;

          if (t >= 1 || r.offset === 0) {
            r.state = "bounce";
            r.bounceStart = now;
            r.container.y = 0;
            r.offset = 0;
            r.vel = 0;
          }
        }

        // BOUNCE
        if (r.state === "bounce") {
          const tb = clamp01((now - r.bounceStart) / preset.bounceMs);
          const s = Math.sin(tb * Math.PI);
          const amp = bounceAmp * (1 - tb * 0.35);
          r.container.y = -s * amp;

          if (tb >= 1) {
            r.container.y = 0;
            r.state = "done";
          }
        }
      }

      if (allDone) return resolve();
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

// ==================================================
// HUD pro — tailles corrigées + bandeau mises scrollable
// IMPORTANT :
// - Le bandeau du haut = messages uniquement
// - Le panneau SOLDE/MISE/GAIN = chiffres + petite ligne info indépendante
// ==================================================

let hud = {
  root: null,

  topPanel: null,
  topText: null,

  meterPanel: null,
  soldeValue: null,
  miseValue: null,
  gainValue: null,
  meterInfo: null, // petite ligne sous les chiffres (PAS liée au top)

  // bandeau de mises scrollable
  betBar: null,
  betViewport: null,
  betMask: null,
  betStrip: null,
  betButtons: [],
  betValues: [1, 2, 5, 10, 20, 30, 50, 100, 200],

  btnSpin: null,
  btnSpeed: null,
  btnInfo: null,

  // drag state
  drag: {
    active: false,
    startX: 0,
    stripStartX: 0,
    moved: false,
  },
};

// ---------------------------
// Helpers visuels
// ---------------------------
function makePanelTexture(w, h, top = "#111827", mid = "#0b1220", bot = "#050814") {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.floor(w));
  c.height = Math.max(2, Math.floor(h));
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const v = ctx.createRadialGradient(
    c.width * 0.5, c.height * 0.15, 10,
    c.width * 0.5, c.height * 0.5,
    Math.max(w, h)
  );
  v.addColorStop(0, "rgba(255,255,255,0.04)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, c.width, c.height);

  return PIXI.Texture.from(c);
}

function makeRoundedPanel(w, h, radius, borderColor = 0xf2b632, borderW = 2) {
  const cont = new PIXI.Container();

  const bg = new PIXI.Sprite(makePanelTexture(w, h));
  bg.width = w;
  bg.height = h;
  cont.addChild(bg);

  const border = new PIXI.Graphics();
  border.lineStyle(borderW, borderColor, 1);
  border.drawRoundedRect(0, 0, w, h, radius);
  cont.addChild(border);

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.04);
  shine.drawRoundedRect(6, 6, w - 12, h * 0.33, Math.min(radius, 16));
  shine.endFill();
  cont.addChild(shine);

  cont._bg = bg;
  cont._border = border;

  return cont;
}

function makeLabel(txt, size) {
  return new PIXI.Text(txt, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: size,
    fill: 0xffffff,
    fontWeight: "800",
    stroke: 0x000000,
    strokeThickness: 3,
    dropShadow: true,
    dropShadowAlpha: 0.4,
    dropShadowBlur: 3,
    dropShadowDistance: 2,
  }));
}

function makeValue(txt, size) {
  return new PIXI.Text(txt, new PIXI.TextStyle({
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: size,
    fill: 0xffffff,
    fontWeight: "900",
    stroke: 0x000000,
    strokeThickness: 4,
    dropShadow: true,
    dropShadowAlpha: 0.5,
    dropShadowBlur: 4,
    dropShadowDistance: 2,
  }));
}

// ---------------------------
// Bouton rond (SPIN / STOP / VIT / INFO)
// ---------------------------
function makeRoundButton(diam) {
  const c = new PIXI.Container();
  c.interactive = true;
  c.buttonMode = true;

  const r = diam / 2;

  const ring = new PIXI.Graphics();
  ring.beginFill(0x0b1220, 0.92);
  ring.lineStyle(5, 0xf2b632, 1); // <= un peu plus fin
  ring.drawCircle(0, 0, r);
  ring.endFill();

  const inner = new PIXI.Graphics();
  inner.beginFill(0x111827, 0.95);
  inner.lineStyle(3, 0x0ea5e9, 0.22);
  inner.drawCircle(0, 0, r * 0.72);
  inner.endFill();

  const t = new PIXI.Text("BTN", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(40, diam * 0.24),
    fill: 0xffffff,
    fontWeight: "1000",
    stroke: 0x000000,
    strokeThickness: 5,
    dropShadow: true,
    dropShadowAlpha: 0.55,
    dropShadowBlur: 5,
    dropShadowDistance: 2,
    align: "center",
  }));
  t.anchor.set(0.5);

  c.addChild(ring, inner, t);

  c._ring = ring;
  c._inner = inner;
  c._text = t;

  c.on("pointerdown", () => { c.scale.set(0.985); });
  c.on("pointerup", () => { c.scale.set(1.0); });
  c.on("pointerupoutside", () => { c.scale.set(1.0); });

  return c;
}

function setSpinButtonMode(isStop) {
  if (!hud.btnSpin) return;

  if (isStop) {
    hud.btnSpin._text.text = "STOP";
    hud.btnSpin._ring.tint = 0xff2d2d;
    hud.btnSpin._inner.tint = 0x7f1d1d;
  } else {
    hud.btnSpin._text.text = "SPIN";
    hud.btnSpin._ring.tint = 0xffffff;
    hud.btnSpin._inner.tint = 0xffffff;
  }
}

function refreshSpeedButtonLabel() {
  if (!hud.btnSpeed || !hud.btnSpeed._text) return;
  const name = SPEEDS?.[speedIndex]?.name || "VIT";
  hud.btnSpeed._text.text = `VIT\n${name}`;
  hud.btnSpeed._text.style.fontSize = Math.max(12, Math.round(hud.btnSpeed._ring.width * 0.16));
  hud.btnSpeed._text.style.align = "center";
}

// ---------------------------
// Bet button (dans bandeau scrollable)
// ---------------------------
function makeBetButton(label, w, h) {
  const c = new PIXI.Container();
  c.interactive = true;
  c.buttonMode = true;

  const g = new PIXI.Graphics();
  g.beginFill(0x0b1220, 0.85);
  g.lineStyle(2, 0xf2b632, 1);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, Math.min(14, h * 0.42));
  g.endFill();

  const t = new PIXI.Text(label, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(20, h * 0.46),
    fill: 0xffffff,
    fontWeight: "900",
    stroke: 0x000000,
    strokeThickness: 3,
  }));
  t.anchor.set(0.5);

  c.addChild(g, t);

  c._bg = g;
  c._text = t;

  return c;
}

function setBetSelected(btn, selected) {
  if (!btn || !btn._bg) return;
  btn._bg.tint = selected ? 0x2dd4bf : 0xffffff;
  btn._bg.alpha = selected ? 1.0 : 0.95;
}

// ---------------------------
// Messages HUD (IMPORTANT)
// ---------------------------
function hudSetTopMessage(msg) {
  const m = (msg || "").toString();
  if (hud.topText) hud.topText.text = m || "";
}

// petite ligne dans le panneau “meter”
function hudSetMeterInfo(msg) {
  if (!hud.meterInfo) return;
  hud.meterInfo.text = (msg || "").toString();
}

// chiffres
function hudUpdateNumbers() {
  if (hud.soldeValue) hud.soldeValue.text = String(balance);
  if (hud.miseValue) hud.miseValue.text = String(bet);
  if (hud.gainValue) hud.gainValue.text = String(lastWin);

  // sélection bet
  if (hud.betButtons?.length) {
    hud.betButtons.forEach((b) => setBetSelected(b, b._value === bet));
  }

  // petite info
  if (spinning) {
    hudSetMeterInfo("SPIN…");
  } else if (freeSpins > 0) {
    hudSetMeterInfo(`FREE SPINS : ${freeSpins}`);
  } else {
    hudSetMeterInfo("METTEZ VOTRE MISE");
  }
}

// ---------------------------
// Drag scroller bets
// ---------------------------
function clampStripX() {
  if (!hud.betViewport || !hud.betStrip) return;

  const vw = hud.betViewport._w || 0;
  const sw = hud.betStrip._w || 0;

  const minX = Math.min(0, vw - sw);
  const maxX = 0;

  hud.betStrip.x = Math.max(minX, Math.min(maxX, hud.betStrip.x));
}

function attachBetDrag() {
  if (!hud.betViewport) return;

  const vp = hud.betViewport;
  vp.interactive = true;
  vp.buttonMode = true;

  vp.on("pointerdown", (e) => {
    hud.drag.active = true;
    hud.drag.moved = false;
    hud.drag.startX = e.data.global.x;
    hud.drag.stripStartX = hud.betStrip.x;
  });

  vp.on("pointermove", (e) => {
    if (!hud.drag.active) return;
    const x = e.data.global.x;
    const dx = x - hud.drag.startX;
    if (Math.abs(dx) > 6) hud.drag.moved = true;

    hud.betStrip.x = hud.drag.stripStartX + dx;
    clampStripX();
  });

  const end = () => {
    hud.drag.active = false;
    setTimeout(() => (hud.drag.moved = false), 0);
  };

  vp.on("pointerup", end);
  vp.on("pointerupoutside", end);
}

// ---------------------------
// HUD principal
// ---------------------------
function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;
  const safeTop = getSafeTopPx();

  if (hud.root) {
    hud.root.destroy({ children: true });
    hud.root = null;
  }
  hud.root = new PIXI.Container();
  app.stage.addChild(hud.root);

  // ---- TOP MESSAGE PANEL
  const topW = Math.min(w * 0.92, 680);
  const topH = Math.max(44, Math.round(h * 0.058));
  hud.topPanel = makeRoundedPanel(topW, topH, 18, 0xf2b632, 2);
  hud.topPanel.x = Math.round((w - topW) / 2);
  hud.topPanel.y = safeTop + 8;

  hud.topText = makeLabel("Appuyez sur SPIN pour lancer", Math.round(topH * 0.40));
  hud.topText.anchor.set(0.5);
  hud.topText.x = topW / 2;
  hud.topText.y = topH / 2;

  hud.topPanel.addChild(hud.topText);
  hud.root.addChild(hud.topPanel);

  // ---- BOTTOM LAYOUT (plus pro / plus compact)
  const bottomPad = Math.round(h * 0.04);

  // boutons plus petits
  const spinDiam = Math.round(Math.min(w * 0.24, h * 0.14));
  const sideDiam = Math.round(spinDiam * 0.60);

  const btnRowY = Math.round(h - bottomPad - spinDiam / 2);

  // ---- BET SCROLL BAR (juste au-dessus des boutons)
  const betBarW = Math.min(w * 0.92, 760);
  const betBarH = Math.max(54, Math.round(h * 0.072));
  const betBarX = Math.round((w - betBarW) / 2);

  const gap1 = Math.round(h * 0.018);
  const betBarY = Math.round(btnRowY - spinDiam / 2 - gap1 - betBarH);

  hud.betBar = makeRoundedPanel(betBarW, betBarH, 18, 0xf2b632, 2);
  hud.betBar.x = betBarX;
  hud.betBar.y = betBarY;
  hud.root.addChild(hud.betBar);

  // viewport + mask
  hud.betViewport = new PIXI.Container();
  hud.betViewport.x = 0;
  hud.betViewport.y = 0;
  hud.betViewport._w = betBarW;
  hud.betViewport._h = betBarH;

  hud.betMask = new PIXI.Graphics();
  hud.betMask.beginFill(0xffffff, 1);
  hud.betMask.drawRoundedRect(6, 6, betBarW - 12, betBarH - 12, 14);
  hud.betMask.endFill();
  hud.betMask.renderable = false;

  hud.betStrip = new PIXI.Container();
  hud.betStrip.x = 0;
  hud.betStrip.y = 0;

  hud.betViewport.addChild(hud.betStrip);
  hud.betBar.addChild(hud.betViewport);
  hud.betBar.addChild(hud.betMask);
  hud.betViewport.mask = hud.betMask;

  // boutons de mise
  hud.betButtons = [];
  const btnH = Math.round(betBarH * 0.72);
  const btnW = Math.round(Math.min(74, betBarW * 0.14));
  const gap = Math.round(btnW * 0.22);
  let x = Math.round(12 + btnW / 2);
  const y = Math.round(betBarH / 2);

  for (let i = 0; i < hud.betValues.length; i++) {
    const v = hud.betValues[i];
    const b = makeBetButton(String(v), btnW, btnH);
    b.x = x;
    b.y = y;
    b._value = v;
    setBetSelected(b, v === bet);

    b.on("pointerup", () => {
      // si on a drag, on ne clique pas
      if (hud.drag.moved) return;
      if (spinning) return;
      bet = v;
      hudUpdateNumbers();
    });

    hud.betStrip.addChild(b);
    hud.betButtons.push(b);

    x += btnW + gap;
  }

  hud.betStrip._w = x + 12;
  hud.betViewport._w = betBarW;

  attachBetDrag();
  clampStripX();

  // ---- METERS (juste au-dessus du betBar)
  const meterW = Math.min(w * 0.92, 720);
  const meterH = Math.max(70, Math.round(h * 0.088)); // <= plus petit verticalement
  const meterX = Math.round((w - meterW) / 2);

  const gap2 = Math.round(h * 0.016);
  const meterY = Math.round(betBarY - gap2 - meterH);

  hud.meterPanel = makeRoundedPanel(meterW, meterH, 20, 0xf2b632, 2);
  hud.meterPanel.x = meterX;
  hud.meterPanel.y = meterY;
  hud.root.addChild(hud.meterPanel);

  // 3 colonnes (labels + valeurs)
  const colPad = 12;
  const colW = (meterW - colPad * 2) / 3;

  const labelSize = Math.round(meterH * 0.26);
  const valueSize = Math.round(meterH * 0.42);

  const soldeLabel = makeLabel("SOLDE", labelSize);
  soldeLabel.anchor.set(0, 0);
  soldeLabel.x = colPad + 10;
  soldeLabel.y = 8;

  hud.soldeValue = makeValue("0", valueSize);
  hud.soldeValue.anchor.set(0, 0);
  hud.soldeValue.x = colPad + 10;
  hud.soldeValue.y = soldeLabel.y + soldeLabel.height + 2;

  const miseLabel = makeLabel("MISE", labelSize);
  miseLabel.anchor.set(0.5, 0);
  miseLabel.x = colPad + colW + colW / 2;
  miseLabel.y = 8;

  hud.miseValue = makeValue("1", valueSize);
  hud.miseValue.anchor.set(0.5, 0);
  hud.miseValue.x = miseLabel.x;
  hud.miseValue.y = miseLabel.y + miseLabel.height + 2;

  const gainLabel = makeLabel("GAIN", labelSize);
  gainLabel.anchor.set(1, 0);
  gainLabel.x = colPad + colW * 2 + colW - 10;
  gainLabel.y = 8;

  hud.gainValue = makeValue("0", valueSize);
  hud.gainValue.anchor.set(1, 0);
  hud.gainValue.x = gainLabel.x;
  hud.gainValue.y = gainLabel.y + gainLabel.height + 2;

  // petite ligne d'info (indépendante du bandeau du haut)
  hud.meterInfo = makeLabel("METTEZ VOTRE MISE", Math.round(meterH * 0.22));
  hud.meterInfo.anchor.set(0.5, 1);
  hud.meterInfo.x = meterW / 2;
  hud.meterInfo.y = meterH - 6;

  hud.meterPanel.addChild(
    soldeLabel, hud.soldeValue,
    miseLabel, hud.miseValue,
    gainLabel, hud.gainValue,
    hud.meterInfo
  );

  // ---- BUTTONS ROW
  hud.btnSpin = makeRoundButton(spinDiam);
  hud.btnSpin._text.text = "SPIN";
  hud.btnSpin.x = Math.round(w / 2);
  hud.btnSpin.y = btnRowY;
  hud.root.addChild(hud.btnSpin);

  hud.btnSpeed = makeRoundButton(sideDiam);
  hud.btnSpeed.x = hud.btnSpin.x - spinDiam * 0.90;
  hud.btnSpeed.y = btnRowY;
  hud.root.addChild(hud.btnSpeed);

  hud.btnInfo = makeRoundButton(sideDiam);
  hud.btnInfo._text.text = "INFO";
  hud.btnInfo.x = hud.btnSpin.x + spinDiam * 0.90;
  hud.btnInfo.y = btnRowY;
  hud.root.addChild(hud.btnInfo);

  hud.btnSpin.on("pointerup", () => {
    if (typeof onSpinOrStop === "function") onSpinOrStop();
  });

  hud.btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    refreshSpeedButtonLabel();
    hudSetTopMessage(`Vitesse : ${SPEEDS[speedIndex].name}`);
    hudUpdateNumbers(); // met à jour la petite ligne si besoin, mais ne copie PAS le top
  });

  hud.btnInfo.on("pointerup", () => {
    togglePaytable();
  });

  refreshSpeedButtonLabel();
  hudUpdateNumbers();
  setSpinButtonMode(false);
}

// ---------------------------
// Paytable overlay (simple)
// ---------------------------
let paytableOverlay = null;

function togglePaytable() {
  if (paytableOverlay) {
    paytableOverlay.destroy({ children: true });
    paytableOverlay = null;
    return;
  }

  const w = app.screen.width;
  const h = app.screen.height;

  paytableOverlay = new PIXI.Container();
  paytableOverlay.interactive = true;
  paytableOverlay.buttonMode = true;

  const dim = new PIXI.Graphics();
  dim.beginFill(0x000000, 0.55);
  dim.drawRect(0, 0, w, h);
  dim.endFill();
  paytableOverlay.addChild(dim);

  const boxW = Math.min(w * 0.88, 640);
  const boxH = Math.min(h * 0.62, 720);
  const box = makeRoundedPanel(boxW, boxH, 22, 0xf2b632, 2);
  box.x = Math.round((w - boxW) / 2);
  box.y = Math.round((h - boxH) / 2);

  const title = makeLabel("Table des gains", Math.round(boxH * 0.07));
  title.anchor.set(0.5, 0);
  title.x = boxW / 2;
  title.y = 16;

  const body = new PIXI.Text(
    "Fruits : 3=2x | 4=3x | 5=4x\n\n" +
    "Cartes : 3x / 4x / 5x\n" +
    "Pièce : 4x / 5x / 6x\n" +
    "Couronne : 10x / 12x / 14x\n" +
    "BAR : 16x / 18x / 20x\n" +
    "7 rouge : 20x / 25x / 30x\n" +
    "77 mauve : 30x / 40x / 50x\n\n" +
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ => 10 free spins (gains x2)",
    new PIXI.TextStyle({
      fontFamily: "system-ui",
      fontSize: Math.round(boxH * 0.045),
      fill: 0xffffff,
      fontWeight: "800",
      stroke: 0x000000,
      strokeThickness: 3,
      lineHeight: Math.round(boxH * 0.06),
    })
  );
  body.anchor.set(0.5, 0);
  body.x = boxW / 2;
  body.y = Math.round(boxH * 0.16);

  const closeBtn = makeRoundedPanel(Math.round(boxW * 0.55), Math.round(boxH * 0.16), 18, 0xf2b632, 2);
  closeBtn.x = Math.round((boxW - closeBtn.width) / 2);
  closeBtn.y = Math.round(boxH - closeBtn.height - 18);
  closeBtn.interactive = true;
  closeBtn.buttonMode = true;

  const closeTxt = makeLabel("FERMER", Math.round(closeBtn.height * 0.38));
  closeTxt.anchor.set(0.5);
  closeTxt.x = closeBtn.width / 2;
  closeTxt.y = closeBtn.height / 2;

  closeBtn.addChild(closeTxt);

  closeBtn.on("pointerup", () => togglePaytable());

  box.addChild(title, body, closeBtn);
  paytableOverlay.addChild(box);

  paytableOverlay.on("pointerup", (e) => {
    // clic sur le dim => ferme
    if (e.target === dim) togglePaytable();
  });

  hud.root.addChild(paytableOverlay);
}

// --------------------------------------------------
// SPIN / STOP
// --------------------------------------------------
async function onSpinOrStop() {
  if (spinning) {
    const preset = SPEEDS[speedIndex];
    requestStop(preset);
    setSpinButtonMode(true);
    return;
  }

  if (spinInFlight) return;
  if (!app || !symbolTextures.length) return;

  spinInFlight = true;
  spinning = true;
  stopRequested = false;
  stopArmedAt = 0;
  pendingGrid = null;
  gridArrivedAt = 0;

  setSpinButtonMode(true);

  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  if (freeSpins <= 0) winMultiplier = 1;

  const preset = SPEEDS[speedIndex];
  const effectiveBet = bet;
  const paidSpin = freeSpins <= 0;

  if (!paidSpin) {
    freeSpins--;
  } else {
    if (balance < bet) {
      hudSetTopMessage("Solde insuffisant");
      spinning = false;
      spinInFlight = false;
      setSpinButtonMode(false);
      hudUpdateNumbers();
      return;
    }
    balance -= bet;
  }

  lastWin = 0;
  hudUpdateNumbers();
  hudSetTopMessage(paidSpin ? "Spin…" : `Free spin… restants : ${freeSpins}`);

  const now = performance.now();
  prepareReelPlans(now, preset);

  fetch("/spin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bet: effectiveBet }),
  })
    .then((r) => r.json())
    .then((data) => {
      pendingGrid = data.result || data.grid || data;
      gridArrivedAt = performance.now();
      ensurePlansAfterGrid(preset);
    })
    .catch((err) => {
      console.error("Erreur API /spin", err);
      pendingGrid = null;
      gridArrivedAt = 0;
    });

  while (!pendingGrid) {
    await new Promise((res) => setTimeout(res, 25));
  }

  await animateSpinUntilDone(preset);

  const { baseWin, winningLines, bonusTriggered } = evaluateGrid(pendingGrid, effectiveBet);

  let totalWin = baseWin;
  if (bonusTriggered) {
    freeSpins += 10;
    winMultiplier = 2;
  }
  if (winMultiplier > 1) totalWin *= winMultiplier;

  lastWin = totalWin;
  balance += totalWin;

  spinning = false;
  spinInFlight = false;
  setSpinButtonMode(false);

  hudUpdateNumbers();

  if (totalWin > 0) {
    hudSetTopMessage(
      freeSpins > 0 ? `Gain : ${totalWin} — free spins : ${freeSpins}` : `Gain : ${totalWin}`
    );
    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
    hudSetTopMessage(
      freeSpins > 0
        ? `Pas de gain — free spins : ${freeSpins}`
        : "Pas de gain — appuyez sur SPIN"
    );
  }

  if (bonusTriggered) {
    hudSetTopMessage("BONUS ! +10 free spins (gains ×2)");
  }
}

// --------------------------------------------------
// Start
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    showMessage("Erreur JS : init (" + (e?.message || String(e)) + ")");
  }
});