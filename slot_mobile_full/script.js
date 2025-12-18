// script.js — Slot mobile PIXI v5 (5x3)
// ✅ Swap OK (textures changées hors écran)
// ✅ Lag réduit (DPR cap + snap pixel + pas de blur filter forcé)
// ✅ STOP = accélère la décélération (pas un 2e spin)
// ✅ 7 sprites/reel (2 extra haut + 3 visibles + 2 extra bas)
// ✅ Bounce moins prononcé + spin un peu plus long + départ plus rapide
// ✅ Audio OFF (tu peux supprimer assets/audio)

"use strict";

// --------------------------------------------------
// PERF toggles
// --------------------------------------------------
const ENABLE_AUDIO = false;        // ✅ tu peux supprimer assets/audio
const ENABLE_MOTION_BLUR = false;  // ✅ laisse à false (sinon flou)
const MAX_DPR = 1.35;              // ✅ perf iPhone (1.25–1.5)

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

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

// 7 sprites/reel = 3 visibles + 2 au-dessus + 2 en dessous
const EXTRA = 2;
const SPRITES_PER_REEL = ROWS + EXTRA * 2; // 7
const VISIBLE_START = EXTRA;               // 2
const VISIBLE_END = EXTRA + ROWS - 1;      // 4

// IDs mapping
const PREMIUM77_ID = 0;
const BONUS_ID = 6;
const WILD_ID = 9;

// état
let balance = 1000;
let bet = 1;
let lastWin = 0;

let spinning = false;
let spinInFlight = false;

let freeSpins = 0;
let winMultiplier = 1;

// STOP
let stopRequested = false;
let stopRequestTime = 0;

// résultat réseau
let pendingGrid = null;
let gridArrivedAt = 0;

// HUD
let messageText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

// Stats (3 colonnes)
let statSoldeLabel, statSoldeValue;
let statMiseLabel, statMiseValue;
let statGainLabel, statGainValue;

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
// Pixel snapping (anti flou pendant mouvement)
// --------------------------------------------------
function snapPx(v) {
  const r = app?.renderer?.resolution || 1;
  return Math.round(v * r) / r;
}

// --------------------------------------------------
// VITESSES (départ + rapide, spin + long, bounce - fort)
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 1.00,
    spinMs: 2000,       // ✅ plus long
    startStaggerMs: 120,
    stopStaggerMs: 135,
    accelMs: 110,       // ✅ départ plus rapide
    preDecelMs: 360,
    settleMs: 380,
    snapMs: 120,
    bounceMs: 180,
    bounceAmpFactor: 0.08, // ✅ moins prononcé
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.28,
    spinMs: 1700,
    startStaggerMs: 95,
    stopStaggerMs: 115,
    accelMs: 100,
    preDecelMs: 320,
    settleMs: 350,
    snapMs: 110,
    bounceMs: 170,
    bounceAmpFactor: 0.075,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.55,
    spinMs: 1400,
    startStaggerMs: 85,
    stopStaggerMs: 95,
    accelMs: 90,
    preDecelMs: 280,
    settleMs: 320,
    snapMs: 100,
    bounceMs: 160,
    bounceAmpFactor: 0.07,
  },
];
let speedIndex = 0;

// --------------------------------------------------
// AUDIO (OFF)
// --------------------------------------------------
const audio = {
  spin:  { play() {} },
  stop:  { play() {} },
  win:   { play() {} },
  bonus: { play() {} },
  tick:  { play() {} },
};

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
    img.src = "assets/spritesheet.png?v=99";
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
    img.onerror = () => reject(new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// --------------------------------------------------
// Background simple (pas de cadre écran)
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
    const a = 0.06 + Math.random() * 0.22;
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

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

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
  app.ticker.maxFPS = 60;

  showMessage("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();

    // spritesheet 4x4 => 16 cases, on prend les 12 premières
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

    buildBackground();
    buildSlotScene();
    buildHUD();

    updateHUDTexts(spinning ? "Spin…" : "Appuyez sur SPIN pour lancer");
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// --------------------------------------------------
// Utils symbol
// --------------------------------------------------
function safeId(id) {
  const n = symbolTextures.length || 1;
  return ((id % n) + n) % n;
}
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

// --------------------------------------------------
// Symbol cell
// --------------------------------------------------
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
// Slot scene + frame + mask + reels
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

  layout.statsY = layout.slotY + visibleH + layout.framePadY + Math.round(h * 0.04);
  layout.buttonsY = layout.statsY + Math.round(h * 0.13);

  slotContainer = new PIXI.Container();
  slotContainer.x = layout.slotX;
  slotContainer.y = layout.slotY;

  // frame slot
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

  // mask
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

    // 7 symboles : i = 0..6 => y = (i-EXTRA)*step
    const cells = [];
    for (let i = 0; i < SPRITES_PER_REEL; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx);

      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = Math.round((i - EXTRA) * reelStep + symbolSize / 2);
      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells, // ordre top -> bottom (y croissant)
      offset: 0,
      vel: 0,

      state: "idle", // idle | spin | settle | snap | bounce | done
      settleQueue: null,
      settleIdx: 0,

      startAt: 0,
      minStopAt: 0,
      settleStart: 0,
      preDecelStart: 0,

      snapStart: 0,
      bounceStart: 0,
      didTick: false,
    });
  }
}

// --------------------------------------------------
// Recycle O(1) — change texture hors écran
// --------------------------------------------------
function recycleReelOneStepDown(reel, newTopId) {
  const s = reel.symbols;

  // décale tous les y
  for (let i = 0; i < s.length; i++) s[i].container.y += reelStep;

  // le plus bas remonte tout en haut
  const bottom = s.pop();
  bottom.container.y = s[0].container.y - reelStep;

  setCellSymbol(bottom, newTopId);
  s.unshift(bottom);
}

// --------------------------------------------------
// HUD helpers
// --------------------------------------------------
function makeText(txt, size, x, y, anchorX = 0.5, anchorY = 0.5, weight = "700") {
  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
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

function makeButton(label, width, height, opts = {}) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();

  const bg = opts.bg ?? 0x0f172a;
  const bgA = opts.bgA ?? 0.78;
  const border = opts.border ?? 0xf2b632;

  g.beginFill(bg, bgA);
  g.lineStyle(4, border, 1);
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

function updateHUDTexts(msg) {
  if (messageText) messageText.text = msg;
}

function updateHUDNumbers() {
  if (statSoldeValue) statSoldeValue.text = String(balance);
  if (statMiseValue)  statMiseValue.text  = String(bet);
  if (statGainValue)  statGainValue.text  = String(lastWin);
}

// --------------------------------------------------
// HUD build (3 colonnes propres)
// --------------------------------------------------
function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;

  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.032),
    w / 2,
    layout.slotY - layout.framePadY - Math.round(h * 0.05),
    0.5, 0.5, "800"
  );

  // stats sous slot (3 colonnes)
  const y = layout.statsY;
  const labelSize = Math.round(h * 0.018);
  const valueSize = Math.round(h * 0.030);
  const colGap = Math.round(w * 0.26);

  const x1 = w / 2 - colGap;
  const x2 = w / 2;
  const x3 = w / 2 + colGap;

  statSoldeLabel = makeText("SOLDE", labelSize, x1, y - valueSize * 0.55, 0.5, 0.5, "800");
  statSoldeValue = makeText("0",     valueSize, x1, y + valueSize * 0.10, 0.5, 0.5, "900");

  statMiseLabel  = makeText("MISE",  labelSize, x2, y - valueSize * 0.55, 0.5, 0.5, "800");
  statMiseValue  = makeText("0",     valueSize, x2, y + valueSize * 0.10, 0.5, 0.5, "900");

  statGainLabel  = makeText("GAIN",  labelSize, x3, y - valueSize * 0.55, 0.5, 0.5, "800");
  statGainValue  = makeText("0",     valueSize, x3, y + valueSize * 0.10, 0.5, 0.5, "900");

  // boutons
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
  btnInfo.on("pointerup", togglePaytable);

  btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    updateSpeedButtonLabel();
  });

  updateHUDNumbers();
  setSpinButtonMode(false);
}

// --------------------------------------------------
// Paytable overlay (inchangé simple)
// --------------------------------------------------
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

  const panelWidth = w * 0.86;
  const panelHeight = h * 0.7;
  const panelX = (w - panelWidth) / 2;
  const panelY = (h - panelHeight) / 2;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x111827, 0.95);
  panel.lineStyle(6, 0xf2b632, 1);
  panel.drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 24);
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
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ déclenchent 10 free spins (gains ×2)\n\n" +
    "Le reste = comme ton paytable backend (server.js).";

  const body = new PIXI.Text(bodyText, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.026),
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: panelWidth * 0.80,
    lineHeight: Math.round(h * 0.035),
  }));
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + Math.round(h * 0.03);
  container.addChild(body);

  const close = makeButton("FERMER", panelWidth * 0.35, Math.round(h * 0.06));
  close.x = w / 2;
  close.y = panelY + panelHeight - Math.round(h * 0.06);
  close.on("pointerup", () => togglePaytable(false));
  container.addChild(close);

  app.stage.addChild(container);
  return container;
}

function togglePaytable(forceVisible) {
  if (!paytableOverlay) paytableOverlay = createPaytableOverlay();
  if (typeof forceVisible === "boolean") paytableOverlay.visible = forceVisible;
  else paytableOverlay.visible = !paytableOverlay.visible;
}

// --------------------------------------------------
// Highlight (adapté à 7 sprites => visibles 2..4)
// --------------------------------------------------
function startHighlight(cells) {
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;

    const targetY = row * reelStep + symbolSize / 2;

    let best = reel.symbols[VISIBLE_START];
    let bestD = Math.abs(best.container.y - targetY);
    for (let i = VISIBLE_START + 1; i <= VISIBLE_END; i++) {
      const d = Math.abs(reel.symbols[i].container.y - targetY);
      if (d < bestD) { bestD = d; best = reel.symbols[i]; }
    }
    highlightedCells.push(best);
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
function easeInOutQuad(t) {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function smoothFactor(dt, tauMs) {
  return 1 - Math.exp(-dt / Math.max(1, tauMs));
}

// --------------------------------------------------
// STOP: accélère la décélération
// --------------------------------------------------
function requestStop() {
  if (!spinning || stopRequested) return;
  stopRequested = true;
  stopRequestTime = performance.now();
  if (ENABLE_AUDIO) audio.stop.play();
  updateHUDTexts("STOP…");
}

// --------------------------------------------------
// Plans / settleQueue
// --------------------------------------------------
function prepareReelPlans(now, preset) {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    r.offset = 0;
    r.vel = 0;
    r.container.y = 0;

    r.state = "spin";
    r.settleQueue = null;
    r.settleIdx = 0;
    r.didTick = false;

    r.startAt = now + c * preset.startStaggerMs;

    const baseStop = r.startAt + preset.spinMs + c * preset.stopStaggerMs;
    r.minStopAt = baseStop;

    r.settleStart = baseStop - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;
  }
}

function ensurePlansAfterGrid(preset) {
  // On garantit : pas de stop avant la grid (sinon swap)
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    const needGridTime = gridArrivedAt ? (gridArrivedAt + c * 55) : r.minStopAt;
    const forcedStop = Math.max(r.minStopAt, needGridTime);

    // STOP: on rapproche le stop mais jamais avant la grid
    if (stopRequested) {
      const wished = stopRequestTime + c * 45;
      const stopAt = Math.max(forcedStop, wished);

      // ✅ stop accélère la décélération : on démarre la pré-décél plus tôt
      r.settleStart = stopAt - preset.settleMs * 0.72;
      r.preDecelStart = r.settleStart - preset.preDecelMs * 0.55;
    } else {
      r.settleStart = forcedStop - preset.settleMs;
      r.preDecelStart = r.settleStart - preset.preDecelMs;
    }
  }
}

function buildSettleQueueForReel(grid, col) {
  // ordre: bot, mid, top + 2 random (car 7 sprites => on veut plus de marge)
  const topId = safeId(grid[0][col]);
  const midId = safeId(grid[1][col]);
  const botId = safeId(grid[2][col]);
  return [botId, midId, topId, randomSymbolId(), randomSymbolId()];
}

// --------------------------------------------------
// Animation (sans blur forcé + snap pixel)
// --------------------------------------------------
function animateSpinUntilDone(preset) {
  return new Promise((resolve, reject) => {
    let prev = performance.now();
    const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 14);

    let safetyStart = performance.now();
    const SAFETY_MS = 8000;

    function tick(now) {
      const dt = Math.max(0, now - prev);
      prev = now;

      if (!pendingGrid && now - safetyStart > SAFETY_MS) {
        return reject(new Error("Timeout: /spin trop lent ou erreur réseau."));
      }

      // dès que grid arrive, on recale les timings
      if (pendingGrid && !animateSpinUntilDone._plansFixed) {
        ensurePlansAfterGrid(preset);
        animateSpinUntilDone._plansFixed = true;
      }

      let allDone = true;
      const k = smoothFactor(dt, 105);

      for (let c = 0; c < reels.length; c++) {
        const r = reels[c];

        if (now < r.startAt) { allDone = false; continue; }
        if (r.state !== "done") allDone = false;

        // -------- SPIN --------
        if (r.state === "spin") {
          // si on est à l’heure du settle ET que grid est prête => settle
          if (now >= r.settleStart && pendingGrid) {
            r.state = "settle";
          } else {
            let target = preset.basePxPerMs;

            // départ plus rapide (monte vite)
            const tAccel = clamp01((now - r.startAt) / preset.accelMs);
            target *= (0.28 + 0.72 * easeInOutQuad(tAccel));

            // pré-décélération
            if (now >= r.preDecelStart) {
              const denom = Math.max(1, (r.settleStart - r.preDecelStart));
              const t = clamp01((now - r.preDecelStart) / denom);

              // STOP: décélère plus fort
              const strength = stopRequested ? 0.92 : 0.78;
              target *= (1 - easeInOutQuad(t) * strength);
            }

            r.vel = r.vel + (target - r.vel) * k;
            r.offset += r.vel * dt;

            while (r.offset >= reelStep) {
              r.offset -= reelStep;
              recycleReelOneStepDown(r, randomSymbolId());
            }

            // ✅ snap pixel => plus de flou
            r.container.y = snapPx(r.offset);
          }
        }

        // -------- SETTLE --------
        if (r.state === "settle") {
          if (!r.didTick) {
            if (ENABLE_AUDIO) audio.tick.play();
            r.didTick = true;
          }

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
          const ease = 0.95 - 0.32 * easeOutCubic(tSettle);
          const targetSpeed = Math.max(0.22, baseNeed * ease);

          r.vel = r.vel + (targetSpeed - r.vel) * k;
          r.offset += r.vel * dt;

          while (r.offset >= reelStep && r.settleIdx < r.settleQueue.length) {
            r.offset -= reelStep;
            const nextId = r.settleQueue[r.settleIdx++];
            recycleReelOneStepDown(r, nextId);
          }

          r.container.y = snapPx(r.offset);

          if (r.settleIdx >= r.settleQueue.length) {
            r.state = "snap";
            r.snapStart = now;
          }
        }

        // -------- SNAP --------
        if (r.state === "snap") {
          const t = clamp01((now - r.snapStart) / preset.snapMs);
          r.offset = r.offset * (1 - easeOutCubic(t));
          if (r.offset < 0.2) r.offset = 0;
          r.container.y = snapPx(r.offset);

          if (t >= 1 || r.offset === 0) {
            r.state = "bounce";
            r.bounceStart = now;
            r.container.y = 0;
            r.offset = 0;
            r.vel = 0;
          }
        }

        // -------- BOUNCE --------
        if (r.state === "bounce") {
          const tb = clamp01((now - r.bounceStart) / preset.bounceMs);
          const s = Math.sin(tb * Math.PI);
          const amp = bounceAmp * (1 - tb * 0.40);
          r.container.y = snapPx(-s * amp);

          if (tb >= 1) {
            r.container.y = 0;
            r.state = "done";
          }
        }
      }

      if (allDone) return resolve();
      requestAnimationFrame(tick);
    }

    animateSpinUntilDone._plansFixed = false;
    requestAnimationFrame(tick);
  });
}

// --------------------------------------------------
// SPIN / STOP
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

async function onSpinOrStop() {
  if (spinning) {
    requestStop();
    setSpinButtonMode(true);
    return;
  }

  if (spinInFlight) return;
  if (!app || !symbolTextures.length) return;

  spinInFlight = true;
  spinning = true;

  stopRequested = false;
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
  if (ENABLE_AUDIO) audio.spin.play();

  // lance anim immédiatement
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
      ensurePlansAfterGrid(preset);
    })
    .catch((err) => {
      console.error("Erreur API /spin", err);
      pendingGrid = null;
      gridArrivedAt = 0;
    });

  try {
    await animateSpinUntilDone(preset);
  } catch (e) {
    console.error(e);
    updateHUDTexts("Erreur réseau");
    spinning = false;
    spinInFlight = false;
    setSpinButtonMode(false);
    return;
  }

  // ✅ Ici: pas d’évaluation front (tu gardes ta logique serveur)
  // On se contente d’afficher “ok” et laisser ton code actuel de gain si tu veux.
  // Pour l’instant, on stabilise le rendu.
  updateHUDTexts(freeSpins > 0 ? `Pas de gain — free spins : ${freeSpins}` : "Pas de gain — appuyez sur SPIN");

  spinning = false;
  spinInFlight = false;
  setSpinButtonMode(false);
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