// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ Glass panel FULL SCREEN (pile écran)
// ✅ Slot centré (layout dynamique, plus de gros vide)
// ✅ Stats sous le slot + texte plus petit + labels fixes (seuls chiffres changent)
// ✅ iPhone: autoDensity + resolution + SAFE-AREA réel (env safe-area-inset-*)
// ✅ Anti-bleeding: clamp + mipmaps off
// ✅ Glow propre (copie derrière) => symboles nets, glow seulement 77/WILD/BONUS
// ✅ CAP: ne jamais upscaler au-dessus de 256px
// ✅ MASK FIX: mask sur app.stage
// ✅ NO-SWAP (PRO): recyclage des sprites (texture change hors écran)
// ✅ STOP plus fluide: vel smoothing + decel plus douce
// ✅ SPIN un poil plus long

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

// IDs
const WILD_ID = 9;
const BONUS_ID = 6;
const PREMIUM77_ID = 0;

// état jeu
let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;
let freeSpins = 0;
let winMultiplier = 1;

// HUD
let messageText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

// stats séparées (labels fixes / chiffres changent)
let statsBar = null;
let statBalanceValue = null;
let statBetValue = null;
let statWinValue = null;

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
let reelStep = 0;
let visibleH = 0;

// metrics slot pour redraw
let slotMetrics = {
  totalReelWidth: 0,
  framePaddingX: 18,
  framePaddingY: 18,
  frameRadius: 26,
};

// --------------------------------------------------
// SAFE AREA (iOS env safe-area-inset-*)
// --------------------------------------------------
function readSafeInsetPx(which /* "top"|"bottom" */) {
  try {
    if (!document.body) return 0;
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "0";
    el.style.height = "0";
    el.style.paddingTop = "env(safe-area-inset-top)";
    el.style.paddingBottom = "env(safe-area-inset-bottom)";
    // vieux iOS
    el.style.paddingTop = "constant(safe-area-inset-top)";
    el.style.paddingBottom = "constant(safe-area-inset-bottom)";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const v = which === "bottom" ? parseFloat(cs.paddingBottom) : parseFloat(cs.paddingTop);
    document.body.removeChild(el);
    return Math.round(v || 0);
  } catch {
    return 0;
  }
}
function getSafeTopPx() {
  const v = readSafeInsetPx("top");
  return Math.max(v, 10);
}
function getSafeBottomPx() {
  const v = readSafeInsetPx("bottom");
  return Math.max(v, 10);
}

// --------------------------------------------------
// VITESSES (3 modes)
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
  } catch {}
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

    img.onerror = (e) => reject(e || new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// --------------------------------------------------
// GlowFilters
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

  glassPanel = new PIXI.Container();
  glassPanel._base = new PIXI.Graphics();
  glassPanel._shine = new PIXI.Graphics();
  glassPanel._gold = new PIXI.Graphics();
  glassPanel.addChild(glassPanel._base, glassPanel._shine, glassPanel._gold);
  app.stage.addChild(glassPanel);

  redrawGlassPanelFullScreen(w, h);
}

// ✅ FULL SCREEN : pile à la taille de l’écran
function redrawGlassPanelFullScreen(w, h) {
  if (!glassPanel) return;

  const radius = Math.round(Math.min(w, h) * 0.045);
  const base = glassPanel._base;
  const shine = glassPanel._shine;
  const gold = glassPanel._gold;

  base.clear();
  base.beginFill(0x0a1026, 0.30);
  base.drawRoundedRect(0, 0, w, h, radius);
  base.endFill();

  shine.clear();
  shine.beginFill(0xffffff, 0.05);
  shine.drawRoundedRect(10, 10, w - 20, Math.round(h * 0.12), Math.max(8, radius - 10));
  shine.endFill();

  gold.clear();
  gold.lineStyle(3, 0xf2b632, 0.22);
  gold.drawRoundedRect(2, 2, w - 4, h - 4, Math.max(8, radius - 2));
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

    symbolTextures = positions.map(([c, r]) => {
      const rect = new PIXI.Rectangle(c * cellW, r * cellH, cellW, cellH);
      return new PIXI.Texture(baseTexture, rect);
    });

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    glowFilters = buildGlowFilters();

    buildBackground();
    buildGlassPanel();
    buildSlotScene();
    buildHUD();

    // ordre stable
    if (bgContainer) app.stage.setChildIndex(bgContainer, 0);
    if (glassPanel) app.stage.setChildIndex(glassPanel, 1);

    layoutAll();

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
    if (statsBar) { statsBar.destroy(true); statsBar = null; statBalanceValue = statBetValue = statWinValue = null; }

    app.stage.removeChildren();

    reels = [];
    highlightedCells = [];

    glowFilters = buildGlowFilters();

    buildBackground();
    buildGlassPanel();
    buildSlotScene();
    buildHUD();

    if (bgContainer) app.stage.setChildIndex(bgContainer, 0);
    if (glassPanel) app.stage.setChildIndex(glassPanel, 1);

    layoutAll();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
    updateHUDNumbers();
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// --------------------------------------------------
// Symbol cell
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
// Slot build + frame redraw
// --------------------------------------------------
function drawSlotFrame() {
  if (!slotFrame || !slotContainer) return;

  const { totalReelWidth, framePaddingX, framePaddingY, frameRadius } = slotMetrics;

  slotFrame.clear();
  slotFrame.lineStyle(6, 0xf2b632, 1);
  slotFrame.beginFill(0x060b1a, 0.72);
  slotFrame.drawRoundedRect(
    slotContainer.x - framePaddingX,
    slotContainer.y - framePaddingY,
    totalReelWidth + framePaddingX * 2,
    visibleH + framePaddingY * 2,
    frameRadius
  );
  slotFrame.endFill();
}

function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  reelGap = 8;

  const symbolFromHeight = h * 0.17;
  const symbolFromWidth = (maxTotalWidth - reelGap * (COLS - 1)) / COLS;

  const MAX_SYMBOL_PX = 256;
  symbolSize = Math.min(MAX_SYMBOL_PX, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

  reelStep = symbolSize + reelGap;
  visibleH = ROWS * reelStep - reelGap;

  const totalReelWidth = COLS * symbolSize + reelGap * (COLS - 1);
  slotMetrics.totalReelWidth = totalReelWidth;

  slotContainer = new PIXI.Container();
  slotContainer.x = Math.round((w - totalReelWidth) / 2);
  slotContainer.y = 0; // posé par layoutAll()

  slotFrame = new PIXI.Graphics();
  app.stage.addChild(slotFrame);
  app.stage.addChild(slotContainer);

  slotMask = new PIXI.Graphics();
  slotMask.beginFill(0xffffff, 1);
  slotMask.drawRect(0, 0, totalReelWidth, visibleH);
  slotMask.endFill();
  slotMask.renderable = false;
  app.stage.addChild(slotMask);
  slotContainer.mask = slotMask;

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = Math.round(c * (symbolSize + reelGap));
    reelContainer.y = 0;

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
// HUD
// --------------------------------------------------
function makeText(txt, size, y) {
  const w = app.screen.width;
  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: size,
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: w * 0.92,
    align: "center",
    fontWeight: "700",
  });
  const t = new PIXI.Text(txt, style);
  t.anchor.set(0.5, 0.5);
  t.x = w / 2;
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
    fontWeight: "800",
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
    fontWeight: "700",
  });
  const bottomStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.34, 22),
    fill: 0xffffff,
    fontWeight: "900",
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

  container._tBottom = tBottom;

  app.stage.addChild(container);
  return container;
}

function updateSpeedButtonLabel() {
  if (!btnSpeed) return;
  btnSpeed._tBottom.text = SPEEDS[speedIndex].name;
}

// ✅ Stats bar : labels fixes + valeurs séparées
function buildStatsBar() {
  const w = app.screen.width;
  const h = app.screen.height;

  const fontSize = Math.max(14, Math.round(h * 0.020)); // plus petit
  const labelStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize,
    fill: 0xffffff,
    fontWeight: "700",
  });
  const valueStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize,
    fill: 0xffffff,
    fontWeight: "900",
  });

  const bar = new PIXI.Container();

  // 3 groupes (gauche / centre / droite)
  const gx = [w * 0.18, w * 0.50, w * 0.82];

  function makeGroup(label, initialValue, x) {
    const g = new PIXI.Container();
    g.x = Math.round(x);
    g.y = 0;

    const tLabel = new PIXI.Text(label, labelStyle);
    tLabel.anchor.set(1, 0.5); // label aligné à droite
    tLabel.x = 0;
    tLabel.y = 0;

    const tValue = new PIXI.Text(String(initialValue), valueStyle);
    tValue.anchor.set(0, 0.5); // valeur part à droite, ne bouge pas le label
    tValue.x = 8;
    tValue.y = 0;

    g.addChild(tLabel, tValue);
    bar.addChild(g);

    return tValue;
  }

  statBalanceValue = makeGroup("Solde :", balance, gx[0]);
  statBetValue     = makeGroup("Mise :", bet, gx[1]);
  statWinValue     = makeGroup("Gain :", lastWin, gx[2]);

  bar.y = 0;
  app.stage.addChild(bar);
  return bar;
}

function buildHUD() {
  const h = app.screen.height;

  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.034),
    60
  );

  statsBar = buildStatsBar();

  const w = app.screen.width;

  btnMinus = makeButton("-1", w * 0.26, h * 0.07);
  btnSpin  = makeButton("SPIN", w * 0.26, h * 0.07);
  btnPlus  = makeButton("+1", w * 0.26, h * 0.07);
  btnSpeed = makeSpeedButton(w * 0.26, (h * 0.07) * 0.90);
  btnInfo  = makeButton("INFO", (w * 0.26) * 0.90, (h * 0.07) * 0.90);

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
  // ✅ seuls les chiffres changent
  if (statBalanceValue) statBalanceValue.text = String(balance);
  if (statBetValue) statBetValue.text = String(bet);
  if (statWinValue) statWinValue.text = String(lastWin);
}

// --------------------------------------------------
// ✅ Layout (slot centré + stats sous slot)
// --------------------------------------------------
function layoutAll() {
  if (!app) return;

  const w = app.screen.width;
  const h = app.screen.height;

  // glass panel full screen
  if (glassPanel) redrawGlassPanelFullScreen(w, h);

  const safeTop = getSafeTopPx();
  const safeBottom = getSafeBottomPx();

  // message
  const msgY = Math.round(safeTop + Math.max(26, h * 0.045));
  messageText.x = w / 2;
  messageText.y = msgY;

  // boutons
  const buttonWidth = w * 0.26;
  const buttonHeight = h * 0.07;
  const spacingX = w * 0.06;
  const rowGap = Math.round(h * 0.02);
  const row2H = buttonHeight * 0.90;

  const bottomMargin = Math.max(12, safeBottom + Math.round(h * 0.02));

  const row2Y = Math.round(h - bottomMargin - row2H / 2);
  const row1Y = Math.round(row2Y - row2H / 2 - rowGap - buttonHeight / 2);

  btnSpin.x = w / 2; btnSpin.y = row1Y;
  btnMinus.x = btnSpin.x - (buttonWidth + spacingX); btnMinus.y = row1Y;
  btnPlus.x  = btnSpin.x + (buttonWidth + spacingX); btnPlus.y  = row1Y;

  btnSpeed.x = btnSpin.x; btnSpeed.y = row2Y;
  btnInfo.x  = btnPlus.x; btnInfo.y  = row2Y;

  // évite INFO coupé
  const infoW = buttonWidth * 0.90;
  const safeRight = w - w * 0.03;
  if (btnInfo.x + infoW / 2 > safeRight) btnInfo.x = safeRight - infoW / 2;

  // zone utile entre message et boutons
  const topPad = Math.max(10, Math.round(h * 0.018));
  const bottomPad = Math.max(10, Math.round(h * 0.018));

  const availTop = Math.round(msgY + messageText.height / 2 + topPad);
  const availBottom = Math.round(row1Y - buttonHeight / 2 - bottomPad);

  // stats sous slot
  const gapSlotToStats = Math.max(10, Math.round(h * 0.020));
  const statsH = statsBar ? statsBar.height : 20;

  // hauteur totale du bloc (slot frame + stats)
  const slotFrameH = visibleH + slotMetrics.framePaddingY * 2;
  const blockH = slotFrameH + gapSlotToStats + statsH;

  // centre le bloc
  const availH = Math.max(10, availBottom - availTop);
  const blockTop = Math.round(availTop + Math.max(0, (availH - blockH) / 2));

  // slotContainer.y = top du contenu visible
  slotContainer.y = blockTop + slotMetrics.framePaddingY;

  // X slot
  slotContainer.x = Math.round((w - slotMetrics.totalReelWidth) / 2);

  // mask
  slotMask.x = slotContainer.x;
  slotMask.y = slotContainer.y;

  // frame
  drawSlotFrame();

  // stats juste sous le slot
  if (statsBar) {
    statsBar.x = 0; // groupes déjà en x écran
    statsBar.y = Math.round(slotContainer.y + visibleH + gapSlotToStats + statsH / 2);
  }
}

// --------------------------------------------------
// Paytable overlay (identique à avant, raccourci)
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
// Helpers: cellule visible
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
// Apply result
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
// Evaluate win
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
// NO-SWAP PRO
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
// Spin anim
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

        if (now < p.startAt) { allDone = false; continue; }
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