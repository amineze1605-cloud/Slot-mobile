// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ FIX iPhone: autoDensity + resolution (DPR) + layout basé sur app.screen.*
// ✅ Anti-bleeding: clamp + mipmaps off + PAD
// ✅ VISUEL: Glow propre (copie derrière) => symboles nets, glow seulement 77/WILD/BONUS
// ✅ CAP: ne jamais upscaler au-dessus de 256px (taille source)
// ✅ MASK FIX: mask sur app.stage (pas enfant du slotContainer) => plus d’écran vide
// ✅ NO-SWAP (PRO): recyclage des sprites (texture change hors écran) => swap quasi invisible
// ✅ UI: fond + glass panel (rendu plus pro)
// ✅ FIX layout: retour aux positions “comme avant” (plus de safeTop qui décale tout)
// ✅ STOP plus fluide: smoothing de vitesse (vel) + decel plus doux
// ✅ SPIN un poil plus long

// --------------------------------------------------
// PIXI global settings (IMPORTANT)
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

// IDs
const WILD_ID = 9;
const BONUS_ID = 6;
const PREMIUM77_ID = 0;

// état jeu
let balance = 1000;
let bet = 1;
let lastlastWin = 0;
let lastWin = 0;
let spinning = false;
let freeSpins = 0;
let winMultiplier = 1;

// HUD
let messageText;
let statsText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

// clignotement gagnant
let highlightedCells = [];
let highlightTimer = 0;

// slot refs
let slotContainer = null;
let slotFrame = null;
let slotMask = null;

// background / glass
let bgContainer = null;
let glassPanel = null;

// layout reel
let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;          // symbolSize + gap
let visibleH = 0;

// --------------------------------------------------
// SAFE AREA (désactivé pour retrouver le layout “comme avant”)
// --------------------------------------------------
function getSafeTopPx() {
  return 0;
}

// --------------------------------------------------
// VITESSES (3 modes) — + long + arrêt plus doux
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 0.95,
    spinMs: 1900,
    startStaggerMs: 130,
    stopStaggerMs: 150,
    accelMs: 300,
    preDecelMs: 360,
    settleMs: 360,
    bounceMs: 260,
    bounceAmpFactor: 0.22,
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.20,
    spinMs: 1550,
    startStaggerMs: 105,
    stopStaggerMs: 125,
    accelMs: 240,
    preDecelMs: 300,
    settleMs: 320,
    bounceMs: 240,
    bounceAmpFactor: 0.20,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.55,
    spinMs: 1200,
    startStaggerMs: 85,
    stopStaggerMs: 100,
    accelMs: 200,
    preDecelMs: 240,
    settleMs: 280,
    bounceMs: 220,
    bounceAmpFactor: 0.18,
  },
];

let speedIndex = 0;

// --------------------------------------------------
// VISUEL (Glow)
// --------------------------------------------------
const GLOW_COLORS = {
  wild: 0x2bff5a,
  bonus: 0x3aa6ff,
  premium77: 0xd45bff,
};

const GLOW_PARAMS = {
  wild:    { distance: 6, outer: 0.70, inner: 0.20, quality: 0.25 },
  bonus:   { distance: 6, outer: 0.65, inner: 0.20, quality: 0.25 },
  premium: { distance: 7, outer: 0.85, inner: 0.20, quality: 0.28 },
};

let glowFilters = null;

// --------------------------------------------------
// AUDIO
// --------------------------------------------------
const sounds = {
  spin: new Audio("assets/audio/spin.mp3"),
  stop: new Audio("assets/audio/stop.mp3"),
  win: new Audio("assets/audio/win.mp3"),
  bonus: new Audio("assets/audio/bonus.mp3"),
};

Object.values(sounds).forEach((a) => {
  a.preload = "auto";
  a.volume = 0.7;
});

function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  try {
    s.currentTime = 0;
    s.play().catch(() => {});
  } catch (e) {}
}

// --------------------------------------------------
// Paylines & paytable
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

// --------------------------------------------------
// Helpers UI
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
// Chargement spritesheet.png
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = "assets/spritesheet.png?v=7";

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
// GlowFilters (partagés)
// --------------------------------------------------
function buildGlowFilters() {
  const hasGlow = !!(PIXI.filters && PIXI.filters.GlowFilter);
  if (!hasGlow) return null;

  const r = app.renderer.resolution || 1;

  const fWild = new PIXI.filters.GlowFilter(
    GLOW_PARAMS.wild.distance,
    GLOW_PARAMS.wild.outer,
    GLOW_PARAMS.wild.inner,
    GLOW_COLORS.wild,
    GLOW_PARAMS.wild.quality
  );
  const fBonus = new PIXI.filters.GlowFilter(
    GLOW_PARAMS.bonus.distance,
    GLOW_PARAMS.bonus.outer,
    GLOW_PARAMS.bonus.inner,
    GLOW_COLORS.bonus,
    GLOW_PARAMS.bonus.quality
  );
  const fPremium = new PIXI.filters.GlowFilter(
    GLOW_PARAMS.premium.distance,
    GLOW_PARAMS.premium.outer,
    GLOW_PARAMS.premium.inner,
    GLOW_COLORS.premium77,
    GLOW_PARAMS.premium.quality
  );

  fWild.resolution = r;
  fBonus.resolution = r;
  fPremium.resolution = r;

  fWild.padding = GLOW_PARAMS.wild.distance * 2;
  fBonus.padding = GLOW_PARAMS.bonus.distance * 2;
  fPremium.padding = GLOW_PARAMS.premium.distance * 2;

  return { wild: fWild, bonus: fBonus, premium: fPremium };
}

// --------------------------------------------------
// Background + Glass panel
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
    Math.max(c.width, c.height) * 0.7
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

  const tex = makeGradientTexture(w, h);
  const bg = new PIXI.Sprite(tex);
  bg.width = w;
  bg.height = h;
  bgContainer.addChild(bg);

  const stars = new PIXI.Graphics();
  const count = Math.floor((w * h) / 18000);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.75;
    const a = 0.10 + Math.random() * 0.35;
    const r = 0.6 + Math.random() * 1.2;
    stars.beginFill(0xffffff, a);
    stars.drawCircle(x, y, r);
    stars.endFill();
  }
  bgContainer.addChild(stars);

  app.stage.addChild(bgContainer);
}

function buildGlassPanel() {
  const w = app.screen.width;
  const h = app.screen.height;

  if (glassPanel) { glassPanel.destroy(true); glassPanel = null; }

  // ✅ décor uniquement, ne doit pas dicter le layout
  const padX = Math.round(w * 0.05);
  const topY = Math.round(h * 0.06);
  const bottomPad = Math.round(h * 0.04);
  const panelW = Math.round(w - padX * 2);
  const panelH = Math.round(h - topY - bottomPad);
  const radius = Math.round(Math.min(w, h) * 0.045);

  glassPanel = new PIXI.Container();

  const base = new PIXI.Graphics();
  base.beginFill(0x0a1026, 0.35);
  base.lineStyle(2, 0xffffff, 0.10);
  base.drawRoundedRect(padX, topY, panelW, panelH, radius);
  base.endFill();

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.05);
  shine.drawRoundedRect(padX + 10, topY + 10, panelW - 20, Math.round(panelH * 0.18), radius - 10);
  shine.endFill();

  const gold = new PIXI.Graphics();
  gold.lineStyle(2, 0xf2b632, 0.20);
  gold.drawRoundedRect(padX + 3, topY + 3, panelW - 6, panelH - 6, radius - 3);

  glassPanel.addChild(base, shine, gold);
  app.stage.addChild(glassPanel);
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

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

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

    const fullW = baseTexture.width;
    const fullH = baseTexture.height;

    // 4x4 => 256x256
    const COLS_SHEET = 4;
    const ROWS_SHEET = 4;
    const cellW = Math.round(fullW / COLS_SHEET);
    const cellH = Math.round(fullH / ROWS_SHEET);

    const positions = [
      [0, 0], [1, 0], [2, 0], [3, 0],
      [0, 1], [1, 1], [2, 1], [3, 1],
      [0, 2], [1, 2], [2, 2], [3, 2],
    ];

    const PAD = 0;

    symbolTextures = positions.map(([c, r]) => {
      const rect = new PIXI.Rectangle(
        c * cellW + PAD,
        r * cellH + PAD,
        cellW - PAD * 2,
        cellH - PAD * 2
      );
      return new PIXI.Texture(baseTexture, rect);
    });

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    glowFilters = buildGlowFilters();

    // ordre important
    buildBackground();
    buildGlassPanel();
    buildSlotScene();
    buildHUD();

    // ✅ force l'ordre des layers: bg (0), glass (1)
    if (bgContainer) app.stage.setChildIndex(bgContainer, 0);
    if (glassPanel) app.stage.setChildIndex(glassPanel, 1);

    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
    app.ticker.add(updateHighlight);

    window.addEventListener("resize", rebuildAll);

  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    showMessage("Erreur JS : chargement assets (" + (e?.message || String(e)) + ")");
  }
}

// --------------------------------------------------
// Rebuild complet (resize)
// --------------------------------------------------
function rebuildAll() {
  try {
    if (slotMask) { slotMask.destroy(true); slotMask = null; }
    if (slotFrame) { slotFrame.destroy(true); slotFrame = null; }
    if (slotContainer) { slotContainer.destroy(true); slotContainer = null; }
    if (paytableOverlay) { paytableOverlay.destroy(true); paytableOverlay = null; }
    if (glassPanel) { glassPanel.destroy(true); glassPanel = null; }
    if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }

    app.stage.removeChildren();

    reels = [];
    highlightedCells = [];

    glowFilters = buildGlowFilters();

    buildBackground();
    buildGlassPanel();
    buildSlotScene();
    buildHUD();
    updateHUDTexts("Appuyez sur SPIN pour lancer");

    if (bgContainer) app.stage.setChildIndex(bgContainer, 0);
    if (glassPanel) app.stage.setChildIndex(glassPanel, 1);
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// --------------------------------------------------
// Cellule symbole
// --------------------------------------------------
function createSymbolCell(texture, sizePx) {
  const cell = new PIXI.Container();
  cell.roundPixels = true;

  const glowSprite = new PIXI.Sprite(texture);
  glowSprite.anchor.set(0.5);
  glowSprite.width = sizePx;
  glowSprite.height = sizePx;
  glowSprite.visible = false;
  glowSprite.roundPixels = true;
  glowSprite.alpha = 0.55;

  const mainSprite = new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width = sizePx;
  mainSprite.height = sizePx;
  mainSprite.roundPixels = true;

  cell.addChild(glowSprite, mainSprite);
  return { container: cell, glow: glowSprite, main: mainSprite, symbolId: -1 };
}

function applySymbolVisual(cellObj, symbolId) {
  cellObj.symbolId = symbolId;

  cellObj.glow.visible = false;
  cellObj.glow.filters = null;
  cellObj.glow.tint = 0xffffff;

  if (!glowFilters) return;

  if (symbolId === WILD_ID) {
    cellObj.glow.alpha = 0.45;
    cellObj.glow.visible = true;
    cellObj.glow.filters = [glowFilters.wild];
  } else if (symbolId === BONUS_ID) {
    cellObj.glow.alpha = 0.45;
    cellObj.glow.visible = true;
    cellObj.glow.filters = [glowFilters.bonus];
  } else if (symbolId === PREMIUM77_ID) {
    cellObj.glow.alpha = 0.35;
    cellObj.glow.tint = GLOW_COLORS.premium77;
    cellObj.glow.visible = true;
    cellObj.glow.filters = [glowFilters.premium];
  }
}

// --------------------------------------------------
// Helpers symbol
// --------------------------------------------------
function safeId(id) {
  const n = symbolTextures.length || 1;
  return ((id % n) + n) % n;
}

function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

function setCellSymbol(cellObj, symbolId) {
  const sid = safeId(symbolId);
  const tex = symbolTextures[sid];
  cellObj.main.texture = tex;
  cellObj.glow.texture = tex;
  applySymbolVisual(cellObj, sid);
}

// --------------------------------------------------
// Construction slot + mask + 5 sprites par reel
// --------------------------------------------------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  reelGap = 8;

  const symbolFromHeight = h * 0.16;
  const symbolFromWidth = (maxTotalWidth - reelGap * (COLS - 1)) / COLS;

  const MAX_SYMBOL_PX = 256;
  symbolSize = Math.min(MAX_SYMBOL_PX, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

  reelStep = symbolSize + reelGap;
  visibleH = ROWS * reelStep - reelGap;

  const totalReelWidth = COLS * symbolSize + reelGap * (COLS - 1);

  slotContainer = new PIXI.Container();
  slotContainer.x = Math.round((w - totalReelWidth) / 2);

  // ✅ retour au layout “comme avant”
  slotContainer.y = Math.round(h * 0.22);

  // Frame
  const framePaddingX = 18;
  const framePaddingY = 18;

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(6, 0xf2b632, 1);
  slotFrame.beginFill(0x060b1a, 0.72);
  slotFrame.drawRoundedRect(
    slotContainer.x - framePaddingX,
    slotContainer.y - framePaddingY,
    totalReelWidth + framePaddingX * 2,
    visibleH + framePaddingY * 2,
    26
  );
  slotFrame.endFill();

  app.stage.addChild(slotFrame);
  app.stage.addChild(slotContainer);

  // MASK
  if (slotMask) { slotMask.destroy(true); slotMask = null; }
  slotMask = new PIXI.Graphics();
  slotMask.beginFill(0xffffff, 1);
  slotMask.drawRect(0, 0, totalReelWidth, visibleH);
  slotMask.endFill();
  slotMask.x = slotContainer.x;
  slotMask.y = slotContainer.y;
  slotMask.renderable = false;

  app.stage.addChild(slotMask);
  slotContainer.mask = slotMask;

  // Reels
  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = Math.round(c * (symbolSize + reelGap));
    reelContainer.y = 0;

    // 5 symboles: 1 extra haut + 3 visibles + 1 extra bas
    const cells = [];
    for (let i = 0; i < ROWS + 2; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx);

      const y = Math.round((i - 1) * reelStep + symbolSize / 2);
      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = y;

      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells,
      offset: 0,

      // smoothing
      vel: 0,

      settled: false,
      settleQueue: null,
      settleStepsLeft: 0,
      bouncing: false,
      bounceStart: 0,
    });
  }
}

// --------------------------------------------------
// HUD + boutons
// --------------------------------------------------
function makeText(txt, size, y, alignCenter = true) {
  const w = app.screen.width;
  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: size,
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: w * 0.9,
    align: alignCenter ? "center" : "left",
  });
  const t = new PIXI.Text(txt, style);
  if (alignCenter) {
    t.anchor.set(0.5, 0.5);
    t.x = w / 2;
  } else {
    t.anchor.set(0, 0.5);
    t.x = w * 0.05;
  }
  t.y = y;
  app.stage.addChild(t);
  return t;
}

function makeButton(label, width, height) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();

  g.beginFill(0x0f172a, 0.72);
  g.lineStyle(4, 0xf2b632, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, 18);
  g.endFill();

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.06);
  shine.drawRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height * 0.35, 14);
  shine.endFill();

  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.45, 28),
    fill: 0xffffff,
    fontWeight: "700",
  });
  const t = new PIXI.Text(label, style);
  t.anchor.set(0.5);

  container.addChild(g, shine, t);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.75));
  container.on("pointerup", () => (g.alpha = 1.0));
  container.on("pointerupoutside", () => (g.alpha = 1.0));

  app.stage.addChild(container);
  container._bg = g;
  container._text = t;
  return container;
}

function makeSpeedButton(width, height) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();

  g.beginFill(0x0f172a, 0.72);
  g.lineStyle(4, 0xf2b632, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, 18);
  g.endFill();

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.06);
  shine.drawRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height * 0.35, 14);
  shine.endFill();

  const topStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.28, 18),
    fill: 0xffffff,
    fontWeight: "600",
  });
  const bottomStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.34, 22),
    fill: 0xffffff,
    fontWeight: "800",
  });

  const tTop = new PIXI.Text("VITESSE", topStyle);
  const tBottom = new PIXI.Text(SPEEDS[speedIndex].name, bottomStyle);

  tTop.anchor.set(0.5);
  tBottom.anchor.set(0.5);

  tTop.y = -height * 0.18;
  tBottom.y = height * 0.18;

  container.addChild(g, shine, tTop, tBottom);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.75));
  container.on("pointerup", () => (g.alpha = 1.0));
  container.on("pointerupoutside", () => (g.alpha = 1.0));

  container._bg = g;
  container._tBottom = tBottom;

  app.stage.addChild(container);
  return container;
}

function updateSpeedButtonLabel() {
  if (!btnSpeed) return;
  btnSpeed._tBottom.text = SPEEDS[speedIndex].name;
}

function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;

  // ✅ retour au layout “comme avant”
  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.035),
    Math.round(h * 0.10)
  );

  statsText = makeText("", Math.round(h * 0.028), Math.round(h * 0.72));
  statsText.anchor.set(0.5, 0.5);

  const buttonWidth = w * 0.26;
  const buttonHeight = h * 0.07;
  const spacingX = w * 0.06;
  const buttonsY = Math.round(h * 0.82);

  btnMinus = makeButton("-1", buttonWidth, buttonHeight);
  btnSpin  = makeButton("SPIN", buttonWidth, buttonHeight);
  btnPlus  = makeButton("+1", buttonWidth, buttonHeight);

  btnSpin.x = w / 2;
  btnSpin.y = buttonsY;

  btnMinus.x = btnSpin.x - (buttonWidth + spacingX);
  btnMinus.y = buttonsY;

  btnPlus.x = btnSpin.x + (buttonWidth + spacingX);
  btnPlus.y = buttonsY;

  const secondY = buttonsY + buttonHeight + Math.round(h * 0.02);

  btnSpeed = makeSpeedButton(buttonWidth, buttonHeight * 0.90);
  btnSpeed.x = btnSpin.x;
  btnSpeed.y = secondY;

  btnInfo = makeButton("INFO", buttonWidth * 0.90, buttonHeight * 0.90);
  btnInfo.x = btnPlus.x;
  btnInfo.y = secondY;

  const safeRight = w - w * 0.03;
  if (btnInfo.x + (buttonWidth * 0.90) / 2 > safeRight) {
    btnInfo.x = safeRight - (buttonWidth * 0.90) / 2;
  }

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinClick);
  btnInfo.on("pointerup", togglePaytable);

  btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    updateSpeedButtonLabel();
  });

  updateHUDNumbers();
}

function updateHUDTexts(msg) {
  if (messageText) messageText.text = msg;
}
function updateHUDNumbers() {
  if (!statsText) return;
  statsText.text = `Solde : ${balance}   Mise : ${bet}   Dernier gain : ${lastWin}`;
}

// --------------------------------------------------
// Paytable overlay (identique à avant, raccourci ici)
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
  const marginY = h * 0.02;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x111827, 0.95);
  panel.lineStyle(6, 0xf2b632, 1);
  panel.drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 24);
  panel.endFill();
  panel.interactive = true;
  container.addChild(panel);

  const title = new PIXI.Text(
    "Table des gains",
    new PIXI.TextStyle({
      fontFamily: "system-ui",
      fontSize: Math.round(h * 0.035),
      fill: 0xffffff,
      fontWeight: "800",
    })
  );
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = panelY + marginY;
  container.addChild(title);

  const closeHeight = Math.round(h * 0.06);
  const closeWidth = panelWidth * 0.35;

  const close = makeButton("FERMER", closeWidth, closeHeight);
  close.x = w / 2;
  close.y = panelY + panelHeight - marginY - closeHeight / 2;
  close.on("pointerup", () => togglePaytable(false));

  const bodyText =
    "Fruits (pastèque, pomme, cerises, citron) :\n" +
    "  3 symboles : 2× la mise\n" +
    "  4 symboles : 3× la mise\n" +
    "  5 symboles : 4× la mise\n\n" +
    "Cartes : 3× / 4× / 5× la mise\n" +
    "Pièce : 4× / 5× / 6× la mise\n" +
    "Couronne : 10× / 12× / 14× la mise\n" +
    "BAR : 16× / 18× / 20× la mise\n" +
    "7 rouge : 20× / 25× / 30× la mise\n" +
    "77 mauve : 30× / 40× / 50× la mise\n\n" +
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ déclenchent 10 free spins (gains ×2)";

  const body = new PIXI.Text(
    bodyText,
    new PIXI.TextStyle({
      fontFamily: "system-ui",
      fontSize: Math.round(h * 0.024),
      fill: 0xffffff,
      wordWrap: true,
      wordWrapWidth: panelWidth * 0.80,
      lineHeight: Math.round(h * 0.03),
    })
  );
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + marginY;

  container.addChild(body);
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
// Helpers: cellule visible (0..2) via position Y
// --------------------------------------------------
function getCellAtVisibleRow(reel, rowIndex) {
  const targetY = rowIndex * reelStep + symbolSize / 2;
  let best = reel.symbols[0];
  let bestD = Math.abs(best.container.y - targetY);

  for (let i = 1; i < reel.symbols.length; i++) {
    const d = Math.abs(reel.symbols[i].container.y - targetY);
    if (d < bestD) { bestD = d; best = reel.symbols[i]; }
  }
  return best;
}

// --------------------------------------------------
// Application grille backend (sécurité finale)
// --------------------------------------------------
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length !== ROWS) return;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const reel = reels[c];
      if (!reel) continue;

      const cellObj = getCellAtVisibleRow(reel, r);
      if (!cellObj) continue;

      setCellSymbol(cellObj, safeId(grid[r][c]));
      cellObj.container.alpha = 1;
    }
  }
}

// --------------------------------------------------
// Evaluation gains
// --------------------------------------------------
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
    const cellObj = getCellAtVisibleRow(reel, row);
    if (!cellObj) return;
    highlightedCells.push(cellObj);
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
// Easing helpers
// --------------------------------------------------
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t) {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// --------------------------------------------------
// NO-SWAP PRO: recyclage de sprites (texture change hors écran)
// --------------------------------------------------
function recycleReelOneStepDown(reel, nextTopId) {
  const s = reel.symbols;

  for (let i = 0; i < s.length; i++) {
    s[i].container.y = Math.round(s[i].container.y + reelStep);
  }

  let maxIdx = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].container.y > s[maxIdx].container.y) maxIdx = i;
  }
  const sym = s[maxIdx];

  let minY = s[0].container.y;
  for (let i = 1; i < s.length; i++) {
    if (s[i].container.y < minY) minY = s[i].container.y;
  }

  sym.container.y = Math.round(minY - reelStep);
  setCellSymbol(sym, nextTopId);
}

// --------------------------------------------------
// Smoothing helper
// --------------------------------------------------
function smoothFactor(dt, tauMs) {
  return 1 - Math.exp(-dt / Math.max(1, tauMs));
}

// --------------------------------------------------
// Spin anim (vel smoothing + decel plus douce)
// --------------------------------------------------
function animateSpinReels(finalGrid) {
  const preset = SPEEDS[speedIndex];

  reels.forEach((reel) => {
    reel.offset = 0;
    reel.container.y = 0;
    reel.vel = 0;
    reel.settled = false;
    reel.settleQueue = null;
    reel.settleStepsLeft = 0;
    reel.bouncing = false;
    reel.bounceStart = 0;
  });

  const startTime = performance.now();

  const plan = reels.map((_, c) => {
    const startAt = startTime + c * preset.startStaggerMs;
    const stopAt  = startAt + preset.spinMs + c * preset.stopStaggerMs;

    const settleStart = stopAt - preset.settleMs;
    const preDecelStart = settleStart - preset.preDecelMs;

    return { startAt, stopAt, settleStart, preDecelStart };
  });

  const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 24);

  return new Promise((resolve) => {
    let prev = performance.now();

    function tick(now) {
      const dt = Math.max(0, now - prev);
      prev = now;

      let allDone = true;

      for (let c = 0; c < reels.length; c++) {
        const reel = reels[c];
        const p = plan[c];

        if (now < p.startAt) {
          allDone = false;
          continue;
        }

        if (reel.settled) continue;
        allDone = false;

        const k = smoothFactor(dt, 140);

        // SETTLE
        if (now >= p.settleStart) {
          const tSettle = clamp01((now - p.settleStart) / preset.settleMs);

          if (!reel.settleQueue) {
            const topId = safeId(finalGrid[0][c]);
            const midId = safeId(finalGrid[1][c]);
            const botId = safeId(finalGrid[2][c]);

            reel.settleQueue = [botId, midId, topId, randomSymbolId()];
            reel.settleStepsLeft = reel.settleQueue.length;
          }

          if (reel.bouncing) {
            const tb = clamp01((now - reel.bounceStart) / preset.bounceMs);
            const s = Math.sin(tb * Math.PI);
            const amp = bounceAmp * (1 - tb * 0.15);
            reel.container.y = -s * amp;

            if (tb >= 1) {
              reel.container.y = 0;
              reel.offset = 0;
              reel.vel = 0;
              reel.settled = true;
            }
            continue;
          }

          const settleEnd = p.settleStart + preset.settleMs;
          const remainingMs = Math.max(1, settleEnd - now);

          const distToNextStep = reelStep - reel.offset;
          const remainingSteps = Math.max(0, reel.settleStepsLeft);
          const remainingDist = distToNextStep + Math.max(0, remainingSteps - 1) * reelStep;

          const baseNeed = remainingDist / remainingMs;

          const ease = 0.92 - 0.22 * easeOutCubic(tSettle);
          const targetSpeed = Math.max(0.22, baseNeed * ease);

          reel.vel = reel.vel + (targetSpeed - reel.vel) * k;

          reel.offset += reel.vel * dt;

          while (reel.offset >= reelStep && reel.settleStepsLeft > 0) {
            reel.offset -= reelStep;
            const nextId = reel.settleQueue.length ? reel.settleQueue.shift() : randomSymbolId();
            recycleReelOneStepDown(reel, nextId);
            reel.settleStepsLeft--;
          }

          if (reel.settleStepsLeft <= 0) {
            const EPS = 0.6;
            if (reel.offset >= reelStep - EPS) reel.offset = 0;

            reel.offset = 0;
            reel.container.y = 0;

            reel.bouncing = true;
            reel.bounceStart = now;
            continue;
          }

          reel.container.y = reel.offset;
          continue;
        }

        // SPIN
        let target = preset.basePxPerMs;

        const tAccel = clamp01((now - p.startAt) / preset.accelMs);
        target *= easeInOutQuad(tAccel);

        if (now >= p.preDecelStart) {
          const t = clamp01((now - p.preDecelStart) / (p.settleStart - p.preDecelStart));
          const dec = 1 - easeInOutQuad(t) * 0.72;
          target *= dec;
        }

        reel.vel = reel.vel + (target - reel.vel) * k;

        reel.offset += reel.vel * dt;

        while (reel.offset >= reelStep) {
          reel.offset -= reelStep;
          recycleReelOneStepDown(reel, randomSymbolId());
        }

        reel.container.y = reel.offset;
      }

      if (allDone) return resolve();
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

// --------------------------------------------------
// SPIN
// --------------------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  if (freeSpins <= 0) winMultiplier = 1;

  spinning = true;
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  const effectiveBet = bet;
  const paidSpin = freeSpins <= 0;

  if (!paidSpin) {
    freeSpins--;
  } else {
    if (balance < bet) {
      updateHUDTexts("Solde insuffisant");
      spinning = false;
      return;
    }
    balance -= bet;
  }

  lastWin = 0;
  updateHUDNumbers();
  updateHUDTexts(paidSpin ? "Spin en cours…" : `Free spin… restants : ${freeSpins}`);
  playSound("spin");

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet: effectiveBet }),
    });

    const data = await response.json();
    const grid = data.result || data.grid || data;

    await animateSpinReels(grid);
    applyResultToReels(grid);

    const { baseWin, winningLines, bonusTriggered } = evaluateGrid(grid, effectiveBet);

    let totalWin = baseWin;

    if (bonusTriggered) {
      freeSpins += 10;
      winMultiplier = 2;
    }

    if (winMultiplier > 1) totalWin *= winMultiplier;

    lastWin = totalWin;
    balance += totalWin;
    updateHUDNumbers();

    finishSpin(totalWin, winningLines, bonusTriggered);
  } catch (err) {
    console.error("Erreur API /spin", err);
    updateHUDTexts("Erreur API");
    spinning = false;
    playSound("stop");
  }
}

function finishSpin(win, winningLines, bonusTriggered) {
  spinning = false;

  if (win > 0) {
    playSound("win");
    updateHUDTexts(
      freeSpins > 0 ? `Gain : ${win} — free spins : ${freeSpins}` : `Gain : ${win}`
    );

    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
    playSound("stop");
    updateHUDTexts(
      freeSpins > 0
        ? `Pas de gain — free spins : ${freeSpins}`
        : "Pas de gain — appuyez sur SPIN pour relancer"
    );
  }

  if (bonusTriggered) {
    playSound("bonus");
    updateHUDTexts("BONUS ! +10 free spins (gains ×2)");
  }
}

// --------------------------------------------------
// Mise
// --------------------------------------------------
function onBetMinus() {
  if (spinning) return;
  if (bet > 1) {
    bet -= 1;
    updateHUDNumbers();
  }
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