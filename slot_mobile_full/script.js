// script.js — Slot mobile PIXI v5 (5x3)
// ✅ Perf: pas d'audio (tu peux supprimer les mp3)
// ✅ 7 sprites / rouleau (moins de swap visible)
// ✅ STOP pro: 2e clic => stop rouleau par rouleau, accélère la décélération
// ✅ Planning solide: reset userStopAt, ensurePlansAfterGrid unique, anti-Infinity
// ✅ Lag réduit: animation démarre direct, fetch en parallèle

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// --------------------------------------------------
// PERF toggles (simple)
// --------------------------------------------------
const ENABLE_GLOW = false; // garde false pour perf/stabilité (on fera plus tard)

// STOP pro
const MIN_SPIN_BEFORE_STOP_MS = 380; // mini avant accept stop (look casino)
const STOP_STAGGER_MS = 130;         // écart entre rouleaux au stop (casino feel)
const STOP_PREDECEL_BOOST = 0.55;    // <1 => pré-décél plus tôt (stop accélère)

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

// HUD refs
let messageText;
let statsLabelText;
let statsValueText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

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
  statsY: 0,
  buttonsY: 0,
};

// --------------------------------------------------
// SAFE TOP (notch)
// --------------------------------------------------
function getSafeTopPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(16, Math.round(h * 0.03));
}

// --------------------------------------------------
// VITESSES (spin un peu plus long, départ un peu plus rapide)
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 1.05,
    spinMs: 1850,          // ✅ plus long
    startStaggerMs: 115,
    stopStaggerMs: 130,
    accelMs: 110,          // ✅ départ plus rapide
    preDecelMs: 360,
    settleMs: 380,
    snapMs: 140,
    bounceMs: 190,
    bounceAmpFactor: 0.085 // ✅ bounce moins fort
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
    bounceAmpFactor: 0.08
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
    bounceAmpFactor: 0.075
  },
];
let speedIndex = 0;

// --------------------------------------------------
// Glow (désactivé pour l’instant)
// --------------------------------------------------
let glowFilters = null;
function buildGlowFilters() { return null; }

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
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => reject(e || new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// --------------------------------------------------
// Background (pas de cadre écran)
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

  if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }
  bgContainer = new PIXI.Container();

  const bg = new PIXI.Sprite(makeGradientTexture(w, h));
  bg.width = w;
  bg.height = h;
  bgContainer.addChild(bg);

  const stars = new PIXI.Graphics();
  const count = Math.floor((w * h) / 22000);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.80;
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

  // ✅ pour iPhone: on limite DPR
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

    glowFilters = ENABLE_GLOW ? buildGlowFilters() : null;

    buildBackground();
    buildSlotScene();
    buildHUD();

    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
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
    if (paytableOverlay) { paytableOverlay.destroy(true); paytableOverlay = null; }
    if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }

    app.stage.removeChildren();
    reels = [];
    highlightedCells = [];

    glowFilters = ENABLE_GLOW ? buildGlowFilters() : null;

    buildBackground();
    buildSlotScene();
    buildHUD();

    updateHUDTexts(spinning ? "Spin…" : "Appuyez sur SPIN pour lancer");
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
// Slot scene + frame + mask + reels (✅ 7 sprites)
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

  layout.statsY = layout.slotY + visibleH + layout.framePadY + Math.round(h * 0.03);
  layout.buttonsY = layout.statsY + Math.round(h * 0.12);

  slotContainer = new PIXI.Container();
  slotContainer.x = layout.slotX;
  slotContainer.y = layout.slotY;

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(6, 0xf2b632, 1);
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

  // ✅ 7 sprites: 2 au-dessus + 3 visibles + 2 en dessous
  const STRIP_COUNT = 7;
  const TOP_EXTRA = 2; // indices visibles = TOP_EXTRA .. TOP_EXTRA+2

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
      symbols: cells,     // ordre top->bottom
      offset: 0,
      vel: 0,

      state: "idle",      // spin | settle | snap | bounce | done
      settleQueue: null,
      settleIdx: 0,
      didTick: false,

      bounceStart: 0,
      snapStart: 0,

      startAt: 0,
      minStopAt: 0,
      settleStart: 0,
      preDecelStart: 0,

      userStopAt: Infinity, // ✅ important
    });
  }
}

// --------------------------------------------------
// HUD (boutons + stats fixes)
// --------------------------------------------------
function makeText(txt, size, x, y, anchorX = 0.5, anchorY = 0.5, weight = "600", mono = false) {
  const style = new PIXI.TextStyle({
    fontFamily: mono ? "ui-monospace, Menlo, monospace" : "system-ui",
    fontSize: size,
    fill: 0xffffff,
    fontWeight: weight,
  });
  const t = new PIXI.Text(txt, style);
  t.anchor.set(anchorX, anchorY);
  t.x = x;
  t.y = y;
  app.stage.addChild(t);
  return t;
}

function makeButton(label, width, height) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();

  g.beginFill(0x0f172a, 0.78);
  g.lineStyle(4, 0xf2b632, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, Math.min(18, height * 0.35));
  g.endFill();

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.06);
  shine.drawRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height * 0.35, Math.min(14, height * 0.28));
  shine.endFill();

  const t = new PIXI.Text(label, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.40, 30),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  t.anchor.set(0.5);

  container.addChild(g, shine, t);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.75));
  container.on("pointerup", () => (g.alpha = 1.0));
  container.on("pointerupoutside", () => (g.alpha = 1.0));

  app.stage.addChild(container);
  container._bg = g;
  container._shine = shine;
  container._text = t;
  return container;
}

function setSpinButtonMode(isStop) {
  if (!btnSpin) return;
  if (isStop) {
    btnSpin._text.text = "STOP";
    btnSpin._bg.tint = 0xff2d2d;
    btnSpin._shine.alpha = 0.10;
  } else {
    btnSpin._text.text = "SPIN";
    btnSpin._bg.tint = 0xffffff;
    btnSpin._shine.alpha = 0.06;
  }
}

function makeSpeedButton(width, height) {
  const b = makeButton("", width, height);
  b._text.destroy();

  const tTop = new PIXI.Text("VITESSE", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.26, 18),
    fill: 0xffffff,
    fontWeight: "700",
  }));
  const tBottom = new PIXI.Text(SPEEDS[speedIndex].name, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.34, 22),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  tTop.anchor.set(0.5);
  tBottom.anchor.set(0.5);
  tTop.y = -height * 0.18;
  tBottom.y = height * 0.18;

  b.addChild(tTop, tBottom);
  b._tBottom = tBottom;
  return b;
}

function updateSpeedButtonLabel() {
  if (btnSpeed) btnSpeed._tBottom.text = SPEEDS[speedIndex].name;
}

function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;

  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.032),
    w / 2,
    layout.slotY - layout.framePadY - Math.round(h * 0.05),
    0.5, 0.5, "700"
  );

  const labelSize = Math.round(h * 0.022);
  const valueSize = Math.round(h * 0.024);
  const statsX = w / 2;
  const y = layout.statsY;

  statsLabelText = makeText("Solde :      Mise :      Gain :", labelSize, statsX, y, 0.5, 0.5, "700", false);
  statsValueText = makeText("", valueSize, statsX, y, 0.5, 0.5, "900", true);

  const rectW = w * 0.28;
  const rectH = h * 0.072;

  const spinSize = Math.round(Math.min(w * 0.20, h * 0.13));
  const yBtn = layout.buttonsY;

  btnSpin = makeButton("SPIN", spinSize, spinSize);
  btnSpin.x = w / 2;
  btnSpin.y = yBtn;

  btnMinus = makeButton("-1", rectW, rectH);
  btnPlus  = makeButton("+1", rectW, rectH);

  const gap = Math.round(w * 0.06);
  btnMinus.x = btnSpin.x - (spinSize / 2 + gap + rectW / 2);
  btnPlus.x  = btnSpin.x + (spinSize / 2 + gap + rectW / 2);
  btnMinus.y = yBtn;
  btnPlus.y  = yBtn;

  const secondY = yBtn + spinSize / 2 + rectH * 0.75;

  btnSpeed = makeSpeedButton(rectW, rectH * 0.92);
  btnSpeed.x = btnSpin.x - (rectW / 2 + gap / 2);
  btnSpeed.y = secondY;

  btnInfo = makeButton("INFO", rectW, rectH * 0.92);
  btnInfo.x = btnSpin.x + (rectW / 2 + gap / 2);
  btnInfo.y = secondY;

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinOrStop);
  btnInfo.on("pointerup", () => {}); // overlay plus tard si tu veux

  btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    updateSpeedButtonLabel();
  });

  updateHUDNumbers();
  setSpinButtonMode(false);
}

function updateHUDTexts(msg) {
  if (messageText) messageText.text = msg;
}

function formatStatsValues() {
  const solde = String(balance).padStart(6, " ");
  const mise  = String(bet).padStart(3, " ");
  const gain  = String(lastWin).padStart(4, " ");
  return `${solde}      ${mise}      ${gain}`;
}

function updateHUDNumbers() {
  if (statsValueText) statsValueText.text = formatStatsValues();
}

// --------------------------------------------------
// Paylines / Paytable + eval (inchangé)
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
// Highlight (simple)
// --------------------------------------------------
function startHighlight(cells) {
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  // indices visibles pour 7 sprites: TOP_EXTRA=2 => visibles 2..4
  const TOP_EXTRA = 2;

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;
    const targetIndex = TOP_EXTRA + row; // 2..4
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
// STOP pro
// --------------------------------------------------
function requestStop(preset) {
  if (!spinning || stopRequested) return;

  stopRequested = true;
  stopArmedAt = performance.now();

  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    const earliest = r.startAt + MIN_SPIN_BEFORE_STOP_MS;
    r.userStopAt = Math.max(earliest, stopArmedAt + c * STOP_STAGGER_MS);
  }

  // ✅ si la grille est déjà arrivée, on recalc tout de suite
  if (gridArrivedAt) ensurePlansAfterGrid(preset);

  updateHUDTexts("STOP…");
}

// --------------------------------------------------
// Planning
// --------------------------------------------------
function prepareReelPlans(now, preset) {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    r.userStopAt = Infinity; // ✅ reset important

    r.offset = 0;
    r.vel = 0;
    r.container.y = 0;

    r.state = "spin";
    r.settleQueue = null;
    r.settleIdx = 0;
    r.didTick = false;

    r.snapStart = 0;

    r.startAt = now + c * preset.startStaggerMs;

    const baseStop = r.startAt + preset.spinMs + c * preset.stopStaggerMs;
    r.minStopAt = baseStop;

    r.settleStart = baseStop - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;
  }
}

// ✅ UNIQUE (pas de doublon)
function ensurePlansAfterGrid(preset) {
  const now = performance.now();

  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    const needsGridTime = gridArrivedAt ? (gridArrivedAt + c * 60) : 0;

    const normalStopAt = Math.max(r.minStopAt, needsGridTime);

    // user stop sécurisé (anti Infinity)
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
    const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 14);

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

        // BOUNCE (léger)
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

// --------------------------------------------------
// SPIN / STOP bouton
// --------------------------------------------------
async function onSpinOrStop() {
  if (spinning) {
    // STOP
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
      updateHUDTexts("Solde insuffisant");
      spinning = false;
      spinInFlight = false;
      setSpinButtonMode(false);
      return;
    }
    balance -= bet;
  }

  lastWin = 0;
  updateHUDNumbers();
  updateHUDTexts(paidSpin ? "Spin…" : `Free spin… restants : ${freeSpins}`);

  // démarre anim direct
  const now = performance.now();
  prepareReelPlans(now, preset);

  // fetch en parallèle
  fetch("/spin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bet: effectiveBet }),
  })
    .then((r) => r.json())
    .then((data) => {
      pendingGrid = data.result || data.grid || data;
      gridArrivedAt = performance.now();
      ensurePlansAfterGrid(preset); // ✅ recalc auto-stop (et stop user si déjà demandé)
    })
    .catch((err) => {
      console.error("Erreur API /spin", err);
      pendingGrid = null;
      gridArrivedAt = 0;
    });

  // attend la grille
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
  updateHUDNumbers();

  // message
  spinning = false;
  spinInFlight = false;
  setSpinButtonMode(false);

  if (totalWin > 0) {
    updateHUDTexts(
      freeSpins > 0 ? `Gain : ${totalWin} — free spins : ${freeSpins}` : `Gain : ${totalWin}`
    );
    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
    updateHUDTexts(
      freeSpins > 0
        ? `Pas de gain — free spins : ${freeSpins}`
        : "Pas de gain — appuyez sur SPIN"
    );
  }

  if (bonusTriggered) {
    updateHUDTexts("BONUS ! +10 free spins (gains ×2)");
  }
}

// --------------------------------------------------
// Bet
// --------------------------------------------------
function onBetMinus() {
  if (spinning) return;
  if (bet > 1) { bet -= 1; updateHUDNumbers(); }
}
function onBetPlus() {
  if (spinning) return;
  bet += 1;
  updateHUDNumbers();
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