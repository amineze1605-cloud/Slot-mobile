// script.js — Slot mobile PIXI v5 (5x3)
// ✅ Perf: pas d'audio (tu peux supprimer les mp3)
// ✅ 7 sprites / rouleau (moins de swap visible)
// ✅ STOP pro: 2e clic => stop rapide synchro (tous ensemble) + décélération accélérée
// ✅ Animation démarre immédiatement (anti-lag réseau)
// ✅ HUD v3: textes non doublés + contours plus fins + mise en page propre

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// --------------------------------------------------
// PERF toggles
// --------------------------------------------------
const ENABLE_GLOW = false; // pas utilisé pour l’instant

// STOP pro (synchro + rapide)
const MIN_SPIN_BEFORE_STOP_MS = 220; // plus petit = stop accepté plus vite
const STOP_PREDECEL_BOOST = 0.40;    // plus petit = décélération plus agressive

// Reels strip (7 sprites)
const STRIP_COUNT = 7; // 2 au-dessus + 3 visibles + 2 dessous
const TOP_EXTRA = 2;   // indices visibles = 2..4

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
// VITESSES (spin un peu plus long, départ rapide, bounce léger)
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
    bounceAmpFactor: 0.070, // ✅ moins prononcé
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
    bounceAmpFactor: 0.065,
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
    bounceAmpFactor: 0.060,
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
    img.onerror = (e) => reject(e || new Error("Impossible de charger assets/spritesheet.png"));
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

  // ✅ iPhone: limite DPR pour perf
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

    // 4x4 => 16 cases, on utilise 12 cases (0..11)
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
    buildHUD();
    hideMessage();

    updateHUDTexts("Appuyez sur SPIN pour lancer");
    setCenterStatus("Mettez votre mise");

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

    if (paytableOverlay) { paytableOverlay.destroy({ children: true }); paytableOverlay = null; }
    if (hud?.root) { hud.root.destroy({ children: true }); hud.root = null; }

    app.stage.removeChildren();
    reels = [];
    highlightedCells = [];

    buildBackground();
    buildSlotScene();
    buildHUD();

    updateHUDTexts(spinning ? "Spin…" : "Appuyez sur SPIN pour lancer");
    setCenterStatus(spinning ? "Bonne chance !" : "Mettez votre mise");
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

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(3, 0xf2b632, 1);   // ✅ plus fin
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
      symbols: cells,     // top->bottom
      offset: 0,
      vel: 0,

      state: "idle",      // spin | settle | snap | bounce | done
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

// ==================================================
// HUD v3 (raffiné)
// ==================================================
let paytableOverlay = null;

let hud = {
  root: null,

  topPanel: null,
  topText: null,

  meterPanel: null,
  soldeValue: null,
  miseValue: null,
  gainValue: null,
  centerStatus: null,

  chips: [],
  chipValues: [1, 2, 5, 10, 20],

  btnSpin: null,
  btnSpeed: null,
  btnInfo: null,
};

function makePanelTexture(w, h, top = "#121a2b", mid = "#0b1220", bot = "#050814") {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.floor(w));
  c.height = Math.max(2, Math.floor(h));
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, top);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const v = ctx.createRadialGradient(
    c.width * 0.5, c.height * 0.2, 10,
    c.width * 0.5, c.height * 0.55,
    Math.max(w, h)
  );
  v.addColorStop(0, "rgba(255,255,255,0.04)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, c.width, c.height);

  return PIXI.Texture.from(c);
}

function makeRoundedPanel(w, h, radius, borderColor = 0xf2b632) {
  const cont = new PIXI.Container();

  const bg = new PIXI.Sprite(makePanelTexture(w, h));
  bg.width = w;
  bg.height = h;
  cont.addChild(bg);

  const border = new PIXI.Graphics();
  border.lineStyle(2, borderColor, 1); // ✅ fin
  border.drawRoundedRect(0, 0, w, h, radius);
  cont.addChild(border);

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.035);
  shine.drawRoundedRect(6, 6, w - 12, h * 0.32, Math.min(radius, 16));
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
    dropShadowAlpha: 0.35,
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
    dropShadowAlpha: 0.45,
    dropShadowBlur: 4,
    dropShadowDistance: 2,
  }));
}

function makeChip(label, w, h) {
  const c = new PIXI.Container();

  const g = new PIXI.Graphics();
  g.beginFill(0x0b1220, 0.88);
  g.lineStyle(2, 0xf2b632, 1);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, Math.min(14, h * 0.4));
  g.endFill();

  const t = new PIXI.Text(label, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(20, h * 0.48),
    fill: 0xffffff,
    fontWeight: "900",
    stroke: 0x000000,
    strokeThickness: 3,
  }));
  t.anchor.set(0.5);

  c.addChild(g, t);
  c.interactive = true;
  c.buttonMode = true;
  c._bg = g;
  c._text = t;
  return c;
}

function setChipSelected(chip, selected) {
  if (!chip || !chip._bg) return;
  chip._bg.tint = selected ? 0x22c55e : 0xffffff;
  chip._bg.alpha = selected ? 1.0 : 0.95;
}

function makeRoundButton(diam) {
  const c = new PIXI.Container();
  c.interactive = true;
  c.buttonMode = true;

  const r = diam / 2;

  const ring = new PIXI.Graphics();
  ring.beginFill(0x0b1220, 0.92);
  ring.lineStyle(4, 0xf2b632, 1); // ✅ fin
  ring.drawCircle(0, 0, r);
  ring.endFill();

  const inner = new PIXI.Graphics();
  inner.beginFill(0x111827, 0.95);
  inner.lineStyle(2, 0x0ea5e9, 0.22);
  inner.drawCircle(0, 0, r * 0.72);
  inner.endFill();

  const t = new PIXI.Text("BTN", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(44, diam * 0.26),
    fill: 0xffffff,
    fontWeight: "1000",
    stroke: 0x000000,
    strokeThickness: 5,
    dropShadow: true,
    dropShadowAlpha: 0.45,
    dropShadowBlur: 5,
    dropShadowDistance: 2,
    align: "center",
  }));
  t.anchor.set(0.5);

  c.addChild(ring, inner, t);
  c._ring = ring;
  c._inner = inner;
  c._text = t;

  c.on("pointerdown", () => c.scale.set(0.985));
  c.on("pointerup", () => c.scale.set(1.0));
  c.on("pointerupoutside", () => c.scale.set(1.0));

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
  if (!hud.btnSpeed) return;
  const name = SPEEDS?.[speedIndex]?.name || "VIT";
  hud.btnSpeed._text.text = `VIT\n${name}`;
}

function updateHUDTexts(msg) {
  const m = (msg || "").toString();
  if (hud.topText) hud.topText.text = m || "";
}
function setCenterStatus(msg) {
  if (!hud.centerStatus) return;
  const m = (msg || "").toString();
  hud.centerStatus.text = m ? m.toUpperCase() : "";
}

function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;

  if (hud.root) {
    hud.root.destroy({ children: true });
    hud.root = null;
  }
  hud.root = new PIXI.Container();
  app.stage.addChild(hud.root);

  const safeTop = getSafeTopPx();

  // TOP MESSAGE
  const topW = Math.min(w * 0.92, 680);
  const topH = Math.max(44, Math.round(h * 0.055));
  hud.topPanel = makeRoundedPanel(topW, topH, 18);
  hud.topPanel.x = Math.round((w - topW) / 2);
  hud.topPanel.y = safeTop + 8;

  hud.topText = makeLabel("Appuyez sur SPIN pour lancer", Math.round(topH * 0.42));
  hud.topText.anchor.set(0.5);
  hud.topText.x = topW / 2;
  hud.topText.y = topH / 2;

  hud.topPanel.addChild(hud.topText);
  hud.root.addChild(hud.topPanel);

  // METERS
  const meterW = Math.min(w * 0.92, 720);
  const meterH = Math.max(92, Math.round(h * 0.115));
  const meterX = Math.round((w - meterW) / 2);
  const meterY = Math.round(layout.slotY + layout.slotH + layout.framePadY + h * 0.02);

  hud.meterPanel = makeRoundedPanel(meterW, meterH, 22);
  hud.meterPanel.x = meterX;
  hud.meterPanel.y = meterY;
  hud.root.addChild(hud.meterPanel);

  const colW = meterW / 3;
  const yLabel = Math.round(meterH * 0.18);
  const yValue = Math.round(meterH * 0.60);

  const soldeLabel = makeLabel("SOLDE", Math.round(meterH * 0.20));
  soldeLabel.anchor.set(0.5, 0.5);
  soldeLabel.x = Math.round(colW * 0.5);
  soldeLabel.y = yLabel;

  hud.soldeValue = makeValue("0", Math.round(meterH * 0.32));
  hud.soldeValue.anchor.set(0.5, 0.5);
  hud.soldeValue.x = Math.round(colW * 0.5);
  hud.soldeValue.y = yValue;

  const miseLabel = makeLabel("MISE", Math.round(meterH * 0.18));
  miseLabel.anchor.set(0.5, 0.5);
  miseLabel.x = Math.round(colW * 1.5);
  miseLabel.y = yLabel;

  hud.miseValue = makeValue("1", Math.round(meterH * 0.28));
  hud.miseValue.anchor.set(0.5, 0.5);
  hud.miseValue.x = Math.round(colW * 1.5);
  hud.miseValue.y = yValue;

  const gainLabel = makeLabel("DERNIER GAIN", Math.round(meterH * 0.18));
  gainLabel.anchor.set(0.5, 0.5);
  gainLabel.x = Math.round(colW * 2.5);
  gainLabel.y = yLabel;

  hud.gainValue = makeValue("0", Math.round(meterH * 0.32));
  hud.gainValue.anchor.set(0.5, 0.5);
  hud.gainValue.x = Math.round(colW * 2.5);
  hud.gainValue.y = yValue;

  hud.centerStatus = makeLabel("METTEZ VOTRE MISE", Math.round(meterH * 0.16));
  hud.centerStatus.anchor.set(0.5, 0.5);
  hud.centerStatus.x = Math.round(meterW / 2);
  hud.centerStatus.y = Math.round(meterH * 0.88);
  hud.centerStatus.alpha = 0.85;

  hud.meterPanel.addChild(
    soldeLabel, hud.soldeValue,
    miseLabel, hud.miseValue,
    gainLabel, hud.gainValue,
    hud.centerStatus
  );

  // CHIPS
  hud.chips.forEach(c => c.destroy({ children: true }));
  hud.chips = [];

  const chipsY = Math.round(meterY + meterH + h * 0.02);
  const chipW = Math.min(84, Math.round(w * 0.17));
  const chipH = Math.max(46, Math.round(h * 0.06));
  const gap = Math.round(chipW * 0.18);

  const totalChipsW = hud.chipValues.length * chipW + (hud.chipValues.length - 1) * gap;
  let cx = Math.round(w / 2 - totalChipsW / 2);

  for (let i = 0; i < hud.chipValues.length; i++) {
    const v = hud.chipValues[i];
    const chip = makeChip(String(v), chipW, chipH);
    chip.x = cx + chipW / 2;
    chip.y = chipsY + chipH / 2;

    chip._value = v;
    setChipSelected(chip, v === bet);

    chip.on("pointerup", () => {
      if (spinning) return;
      bet = v;
      updateHUDNumbers();
      setCenterStatus("Mettez votre mise");
    });

    hud.root.addChild(chip);
    hud.chips.push(chip);
    cx += chipW + gap;
  }

  // BUTTONS
  const spinDiam = Math.round(Math.min(w * 0.30, h * 0.18));
  const spinY = Math.round(chipsY + chipH + h * 0.075);

  hud.btnSpin = makeRoundButton(spinDiam);
  hud.btnSpin._text.text = "SPIN";
  hud.btnSpin.x = Math.round(w / 2);
  hud.btnSpin.y = spinY;
  hud.root.addChild(hud.btnSpin);

  hud.btnSpin.on("pointerup", () => {
    if (typeof onSpinOrStop === "function") onSpinOrStop();
  });

  const sideDiam = Math.round(spinDiam * 0.62);

  hud.btnSpeed = makeRoundButton(sideDiam);
  hud.btnSpeed.x = hud.btnSpin.x - spinDiam * 0.95;
  hud.btnSpeed.y = spinY;
  hud.root.addChild(hud.btnSpeed);

  hud.btnInfo = makeRoundButton(sideDiam);
  hud.btnInfo._text.text = "INFO";
  hud.btnInfo.x = hud.btnSpin.x + spinDiam * 0.95;
  hud.btnInfo.y = spinY;
  hud.root.addChild(hud.btnInfo);

  hud.btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    refreshSpeedButtonLabel();
    updateHUDTexts(`Vitesse : ${SPEEDS[speedIndex].name}`);
  });

  hud.btnInfo.on("pointerup", () => togglePaytable());

  refreshSpeedButtonLabel();
  updateHUDNumbers();
  setSpinButtonMode(false);
}

function updateHUDNumbers() {
  if (hud.soldeValue) hud.soldeValue.text = String(balance);
  if (hud.miseValue) hud.miseValue.text = String(bet);
  if (hud.gainValue) hud.gainValue.text = String(lastWin);

  if (hud.chips && hud.chips.length) {
    hud.chips.forEach((c) => setChipSelected(c, c._value === bet));
  }
}

// --------------------------------------------------
// Paytable overlay (simple)
// --------------------------------------------------
function togglePaytable(forceVisible) {
  if (!paytableOverlay) paytableOverlay = createPaytableOverlay();
  if (typeof forceVisible === "boolean") paytableOverlay.visible = forceVisible;
  else paytableOverlay.visible = !paytableOverlay.visible;
}

function createPaytableOverlay() {
  const w = app.screen.width;
  const h = app.screen.height;

  const container = new PIXI.Container();
  container.visible = false;
  container.interactive = true;

  const backdrop = new PIXI.Graphics();
  backdrop.beginFill(0x000000, 0.75);
  backdrop.drawRect(0, 0, w, h);
  backdrop.endFill();
  backdrop.interactive = true;
  container.addChild(backdrop);

  const panelW = w * 0.86;
  const panelH = h * 0.7;
  const panelX = (w - panelW) / 2;
  const panelY = (h - panelH) / 2;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x111827, 0.95);
  panel.lineStyle(3, 0xf2b632, 1);
  panel.drawRoundedRect(panelX, panelY, panelW, panelH, 22);
  panel.endFill();
  container.addChild(panel);

  const title = new PIXI.Text("Table des gains", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.035),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = panelY + Math.round(h * 0.02);
  container.addChild(title);

  const bodyText =
    "Fruits : 3=2x | 4=3x | 5=4x\n\n" +
    "Cartes : 3x / 4x / 5x\n" +
    "Pièce : 4x / 5x / 6x\n" +
    "Couronne : 10x / 12x / 14x\n" +
    "BAR : 16x / 18x / 20x\n" +
    "7 rouge : 20x / 25x / 30x\n" +
    "77 mauve : 30x / 40x / 50x\n\n" +
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ => 10 free spins (gains x2)";

  const body = new PIXI.Text(bodyText, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.024),
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: panelW * 0.80,
    lineHeight: Math.round(h * 0.03),
  }));
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + Math.round(h * 0.02);
  container.addChild(body);

  const close = new PIXI.Text("FERMER", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.03),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  close.anchor.set(0.5);
  close.x = w / 2;
  close.y = panelY + panelH - Math.round(h * 0.06);
  close.interactive = true;
  close.buttonMode = true;
  close.on("pointerup", () => togglePaytable(false));
  container.addChild(close);

  app.stage.addChild(container);
  return container;
}

// --------------------------------------------------
// Paylines / Paytable
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

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;
    const idx = TOP_EXTRA + row; // visibles 2..4
    const cellObj = reel.symbols[idx];
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
// Easing / smoothing
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
// STOP pro (synchro + rapide)
// --------------------------------------------------
function requestStop(preset) {
  if (!spinning || stopRequested) return;

  stopRequested = true;
  stopArmedAt = performance.now();

  // ✅ stop synchro (même moment)
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    const earliest = r.startAt + MIN_SPIN_BEFORE_STOP_MS;
    r.userStopAt = Math.max(earliest, stopArmedAt);
  }

  if (gridArrivedAt) ensurePlansAfterGrid(preset);

  updateHUDTexts("STOP…");
  setCenterStatus("Arrêt…");
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

    const needsGridTime = gridArrivedAt ? gridArrivedAt : 0; // ✅ synchro
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

function makeRandomGrid() {
  const g = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push(randomSymbolId());
    g.push(row);
  }
  return g;
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
    const preset = SPEEDS[speedIndex];
    requestStop(preset);
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
      setCenterStatus("Mise trop élevée");
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
  setCenterStatus("Bonne chance !");

  const now = performance.now();
  prepareReelPlans(now, preset);

  // ✅ animation démarre IMMÉDIATEMENT
  const animPromise = animateSpinUntilDone(preset);

  // fetch en parallèle
  let resolved = false;
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
      resolved = true;
    })
    .catch((err) => {
      console.error("Erreur API /spin", err);
      pendingGrid = makeRandomGrid();      // ✅ fallback (pas de blocage)
      gridArrivedAt = performance.now();
      ensurePlansAfterGrid(preset);
      resolved = true;
    });

  // sécurité: si API trop lente => fallback après 3.5s
  const timeoutAt = performance.now() + 3500;
  while (!resolved && performance.now() < timeoutAt) {
    await new Promise((res) => setTimeout(res, 25));
  }
  if (!pendingGrid) {
    pendingGrid = makeRandomGrid();
    gridArrivedAt = performance.now();
    ensurePlansAfterGrid(preset);
  }

  await animPromise;

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

  spinning = false;
  spinInFlight = false;
  setSpinButtonMode(false);

  if (totalWin > 0) {
    updateHUDTexts(
      freeSpins > 0 ? `Gain : ${totalWin} — free spins : ${freeSpins}` : `Gain : ${totalWin}`
    );
    setCenterStatus(freeSpins > 0 ? `Free spins : ${freeSpins}` : "Mettez votre mise");

    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
    updateHUDTexts(
      freeSpins > 0
        ? `Pas de gain — free spins : ${freeSpins}`
        : "Pas de gain — appuyez sur SPIN"
    );
    setCenterStatus(freeSpins > 0 ? `Free spins : ${freeSpins}` : "Mettez votre mise");
  }

  if (bonusTriggered) {
    updateHUDTexts("BONUS ! +10 free spins (gains x2)");
    setCenterStatus("BONUS !");
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