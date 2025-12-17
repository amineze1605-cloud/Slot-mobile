// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ Layout slot OK (on ne touche pas au placement du slot)
// ✅ Plus de cadre "contour écran"
// ✅ SPIN carré + plus gros ; -1/+1 rectangulaires alignés
// ✅ Stats sous le slot, plus petit, labels fixes (seuls chiffres changent)
// ✅ SPIN -> STOP rouge pendant spin + Quick Stop au 2e tap
// ✅ Tick pendant le spin + stop par rouleau
// ✅ Anti "spin spam" : aucun nouveau spin ne modifie les symboles

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// --------------------------------------------------
// DOM & globals
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

// HUD refs
let messageText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

// Stats bar refs (labels fixes + valeurs séparées)
let statsBar = null;
let valSolde = null, valMise = null, valGain = null;

// highlight gagnant
let highlightedCells = [];
let highlightTimer = 0;

// slot refs + layout cache
let slotContainer = null;
let slotFrame = null;
let slotMask = null;
let slotLayout = null; // { frameX, frameY, frameW, frameH, paddingX, paddingY }

// background
let bgContainer = null;

// reel layout
let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;
let visibleH = 0;

// Quick stop control
let spinController = null; // { quickStop: boolean }

// --------------------------------------------------
// SAFE AREA (iPhone notch) – simple
// --------------------------------------------------
function getSafeTopPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(14, Math.round(h * 0.030));
}

// --------------------------------------------------
// VITESSES (3 modes) — stop plus smooth + quickstop plus rapide
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 0.95,
    spinMs: 1850,
    startStaggerMs: 130,
    stopStaggerMs: 150,
    accelMs: 300,
    preDecelMs: 360,
    settleMs: 360,
    settleFastFactor: 0.55, // quick stop
    bounceMs: 240,
    bounceAmpFactor: 0.20,
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.20,
    spinMs: 1500,
    startStaggerMs: 105,
    stopStaggerMs: 125,
    accelMs: 240,
    preDecelMs: 300,
    settleMs: 320,
    settleFastFactor: 0.55,
    bounceMs: 220,
    bounceAmpFactor: 0.18,
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
    settleFastFactor: 0.55,
    bounceMs: 200,
    bounceAmpFactor: 0.16,
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
  tick: new Audio("assets/audio/tick.mp3"), // ✅ ajoute un tick.mp3 dans assets/audio/
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
// Helpers UI loader
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
    img.src = "assets/spritesheet.png?v=7"; // ✅ comme ton script qui marchait

    const to = setTimeout(() => reject(new Error("Timeout chargement spritesheet")), 12000);

    img.onload = () => {
      clearTimeout(to);
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

    img.onerror = () => {
      clearTimeout(to);
      reject(new Error("Impossible de charger assets/spritesheet.png"));
    };
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
// Background (sans cadre écran)
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
    c.width * 0.5, c.height * 0.30, 10,
    c.width * 0.5, c.height * 0.5,
    Math.max(c.width, c.height) * 0.8
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.60)");
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

  showMessage("Chargement...");

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

    buildBackground();
    buildSlotScene();
    buildHUD();

    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
    updateHUDNumbers();
    app.ticker.add(updateHighlight);

    window.addEventListener("resize", rebuildAll);

  } catch (e) {
    console.error("Init error:", e);
    showMessage("Erreur : " + (e?.message || String(e)));
  }
}

// --------------------------------------------------
// Rebuild complet (resize)
// --------------------------------------------------
function destroyIf(obj) { try { obj?.destroy?.(true); } catch (e) {} }

function rebuildAll() {
  try {
    destroyIf(slotMask); slotMask = null;
    destroyIf(slotFrame); slotFrame = null;
    destroyIf(slotContainer); slotContainer = null;
    destroyIf(paytableOverlay); paytableOverlay = null;
    destroyIf(statsBar); statsBar = null;
    destroyIf(bgContainer); bgContainer = null;

    app.stage.removeChildren();

    reels = [];
    highlightedCells = [];
    slotLayout = null;

    glowFilters = buildGlowFilters();

    buildBackground();
    buildSlotScene();
    buildHUD();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
    updateHUDNumbers();
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// --------------------------------------------------
// Cellule symbole (glow derrière + net devant)
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
// Construction slot + mask + 5 sprites par reel (recyclage)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;

  const safeTop = getSafeTopPx();

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

  // ✅ On garde ton placement qui est "parfait"
  slotContainer.y = safeTop + Math.round(h * 0.14);

  // Frame
  const framePaddingX = 18;
  const framePaddingY = 18;

  const frameX = slotContainer.x - framePaddingX;
  const frameY = slotContainer.y - framePaddingY;
  const frameW = totalReelWidth + framePaddingX * 2;
  const frameH = visibleH + framePaddingY * 2;

  slotLayout = { frameX, frameY, frameW, frameH, paddingX: framePaddingX, paddingY: framePaddingY };

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(6, 0xf2b632, 1);
  slotFrame.beginFill(0x060b1a, 0.72);
  slotFrame.drawRoundedRect(frameX, frameY, frameW, frameH, 26);
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
      vel: 0,
      settled: false,
      settleQueue: null,
      settleStepsLeft: 0,
      bouncing: false,
      bounceStart: 0,

      lastTickAt: 0,
      stopPlayed: false,
    });
  }
}

// --------------------------------------------------
// UI helpers (buttons + text)
// --------------------------------------------------
function makeText(txt, size, x, y, anchorX = 0.5) {
  const t = new PIXI.Text(
    txt,
    new PIXI.TextStyle({
      fontFamily: "system-ui",
      fontSize: size,
      fill: 0xffffff,
    })
  );
  t.anchor.set(anchorX, 0.5);
  t.x = x;
  t.y = y;
  app.stage.addChild(t);
  return t;
}

function drawButton(bg, shine, w, h, fill, fillA, line, lineA, radius) {
  bg.clear();
  bg.beginFill(fill, fillA);
  bg.lineStyle(4, line, lineA);
  bg.drawRoundedRect(-w / 2, -h / 2, w, h, radius);
  bg.endFill();

  shine.clear();
  shine.beginFill(0xffffff, 0.06);
  shine.drawRoundedRect(-w / 2 + 6, -h / 2 + 6, w - 12, h * 0.35, Math.max(10, radius - 4));
  shine.endFill();
}

function makeButton(label, width, height, opts = {}) {
  const container = new PIXI.Container();

  const bg = new PIXI.Graphics();
  const shine = new PIXI.Graphics();

  const radius = opts.radius ?? 18;
  const fill = opts.fill ?? 0x0f172a;
  const fillA = opts.fillA ?? 0.72;
  const line = opts.line ?? 0xf2b632;
  const lineA = opts.lineA ?? 1;

  drawButton(bg, shine, width, height, fill, fillA, line, lineA, radius);

  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.42, opts.maxFont ?? 28),
    fill: opts.textFill ?? 0xffffff,
    fontWeight: "800",
  });
  const t = new PIXI.Text(label, style);
  t.anchor.set(0.5);

  container.addChild(bg, shine, t);

  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (bg.alpha = 0.78));
  container.on("pointerup", () => (bg.alpha = 1.0));
  container.on("pointerupoutside", () => (bg.alpha = 1.0));

  // API interne
  container._bg = bg;
  container._shine = shine;
  container._text = t;
  container._w = width;
  container._h = height;
  container._radius = radius;
  container._set = (p) => {
    const nf = p.fill ?? fill;
    const nfa = p.fillA ?? fillA;
    const nl = p.line ?? line;
    const nla = p.lineA ?? lineA;
    drawButton(bg, shine, width, height, nf, nfa, nl, nla, radius);
    if (typeof p.text === "string") t.text = p.text;
    if (typeof p.textFill === "number") t.style.fill = p.textFill;
  };

  app.stage.addChild(container);
  return container;
}

function makeSpeedButton(width, height) {
  const container = makeButton("", width, height, { maxFont: 22 });
  // On remplace le texte par 2 lignes
  container._text.destroy(true);

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
    fontWeight: "900",
  });

  const tTop = new PIXI.Text("VITESSE", topStyle);
  const tBottom = new PIXI.Text(SPEEDS[speedIndex].name, bottomStyle);

  tTop.anchor.set(0.5);
  tBottom.anchor.set(0.5);

  tTop.y = -height * 0.18;
  tBottom.y = height * 0.18;

  container.addChild(tTop, tBottom);
  container._tBottom = tBottom;

  return container;
}

function updateSpeedButtonLabel() {
  if (!btnSpeed) return;
  btnSpeed._tBottom.text = SPEEDS[speedIndex].name;
}

function setButtonsEnabled(enabled) {
  const arr = [btnMinus, btnPlus, btnSpeed, btnInfo];
  arr.forEach((b) => {
    if (!b) return;
    b.interactive = enabled;
    b.buttonMode = enabled;
    b.alpha = enabled ? 1.0 : 0.60;
  });
}

function setSpinButtonMode(mode) {
  // mode: "spin" | "stop"
  if (!btnSpin) return;

  if (mode === "stop") {
    btnSpin._set({
      fill: 0xb91c1c,   // rouge
      fillA: 0.85,
      line: 0xffd0d0,
      lineA: 0.35,
      text: "STOP",
      textFill: 0xffffff,
    });
  } else {
    btnSpin._set({
      fill: 0x0f172a,
      fillA: 0.72,
      line: 0xf2b632,
      lineA: 1,
      text: "SPIN",
      textFill: 0xffffff,
    });
  }
}

// --------------------------------------------------
// Stats bar (labels fixes, valeurs séparées)
// --------------------------------------------------
function padNum(n, width) {
  const s = String(Math.max(0, Math.floor(n)));
  return s.padStart(width, " ");
}

function buildStatsBar() {
  if (!slotLayout) return;

  const w = app.screen.width;
  const h = app.screen.height;

  if (statsBar) { statsBar.destroy(true); statsBar = null; }

  // ✅ juste sous le cadre du slot
  const y = slotLayout.frameY + slotLayout.frameH + Math.round(h * 0.035);

  statsBar = new PIXI.Container();
  app.stage.addChild(statsBar);

  // zone alignée sur le cadre du slot
  const left = slotLayout.frameX;
  const width = slotLayout.frameW;

  const fontSize = Math.max(14, Math.round(h * 0.020)); // plus petit & lisible
  const gap = Math.round(w * 0.01);

  const labelStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize,
    fill: 0xffffff,
    fontWeight: "600",
  });

  const valueStyle = new PIXI.TextStyle({
    fontFamily: "Menlo, Monaco, Consolas, monospace", // ✅ stable
    fontSize,
    fill: 0xffffff,
    fontWeight: "800",
  });

  const cols = 3;
  const colW = width / cols;

  function makePair(colIndex, label) {
    const x0 = left + colIndex * colW + Math.round(colW * 0.08);

    const tLabel = new PIXI.Text(label, labelStyle);
    tLabel.anchor.set(0, 0.5);
    tLabel.x = x0;
    tLabel.y = y;

    const tValue = new PIXI.Text("0", valueStyle);
    tValue.anchor.set(0, 0.5);
    tValue.x = x0 + Math.round(tLabel.width) + gap;
    tValue.y = y;

    statsBar.addChild(tLabel, tValue);
    return tValue;
  }

  valSolde = makePair(0, "Solde :");
  valMise  = makePair(1, "Mise :");
  valGain  = makePair(2, "Gain :");
}

function updateHUDNumbers() {
  if (!valSolde || !valMise || !valGain) return;
  valSolde.text = padNum(balance, 6);
  valMise.text  = padNum(bet, 3);
  valGain.text  = padNum(lastWin, 6);
}

function updateHUDTexts(msg) {
  if (messageText) messageText.text = msg;
}

// --------------------------------------------------
// HUD layout
// --------------------------------------------------
function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;
  const safeTop = getSafeTopPx();

  // message en haut
  if (messageText) { messageText.destroy(true); messageText = null; }
  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.035),
    w / 2,
    safeTop + Math.round(h * 0.06),
    0.5
  );

  // stats juste sous le slot
  buildStatsBar();

  // boutons
  const buttonsY = Math.round(h * 0.80);

  // ✅ SPIN carré plus gros
  const spinSize = Math.round(Math.min(w * 0.22, h * 0.12));
  const sideW = Math.round(spinSize * 1.70);  // -1/+1 rectangulaires
  const sideH = Math.round(spinSize * 0.75);
  const spacingX = Math.round(w * 0.06);

  btnSpin  = makeButton("SPIN", spinSize, spinSize, { radius: 20, maxFont: 30 });
  btnMinus = makeButton("-1", sideW, sideH, { radius: 20, maxFont: 28 });
  btnPlus  = makeButton("+1", sideW, sideH, { radius: 20, maxFont: 28 });

  btnSpin.x = w / 2;
  btnSpin.y = buttonsY;

  // ✅ centrés horizontalement par rapport au SPIN
  btnMinus.x = btnSpin.x - (spinSize / 2 + spacingX + sideW / 2);
  btnMinus.y = buttonsY;

  btnPlus.x = btnSpin.x + (spinSize / 2 + spacingX + sideW / 2);
  btnPlus.y = buttonsY;

  // 2e ligne : vitesse + info
  const secondY = buttonsY + Math.round(spinSize * 0.65) + Math.round(h * 0.02);
  const smallW = Math.round((sideW + spinSize + sideW) * 0.40);
  const smallH = Math.round(sideH * 0.92);

  btnSpeed = makeSpeedButton(smallW, smallH);
  btnSpeed.x = w / 2;
  btnSpeed.y = secondY;

  btnInfo = makeButton("INFO", smallW, smallH, { radius: 18, maxFont: 22 });
  btnInfo.x = w / 2 + smallW + Math.round(w * 0.02);
  btnInfo.y = secondY;

  // Events
  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinButton);
  btnInfo.on("pointerup", togglePaytable);

  btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    updateSpeedButtonLabel();
  });

  setSpinButtonMode("spin");
  updateHUDNumbers();
}

// --------------------------------------------------
// Paytable overlay (simple)
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
  title.y = panelY + Math.round(h * 0.02);
  container.addChild(title);

  const bodyText =
    "Fruits (pastèque, pomme, cerises, citron) :\n" +
    "  3 : 2× la mise\n  4 : 3× la mise\n  5 : 4× la mise\n\n" +
    "Cartes : 3× / 4× / 5×\n" +
    "Pièce : 4× / 5× / 6×\n" +
    "Couronne : 10× / 12× / 14×\n" +
    "BAR : 16× / 18× / 20×\n" +
    "7 rouge : 20× / 25× / 30×\n" +
    "77 mauve : 30× / 40× / 50×\n\n" +
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
  body.y = title.y + title.height + Math.round(h * 0.02);
  container.addChild(body);

  const close = makeButton("FERMER", panelWidth * 0.35, Math.round(h * 0.06), { maxFont: 20 });
  close.x = w / 2;
  close.y = panelY + panelHeight - Math.round(h * 0.04);
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
// Easing + smoothing
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
// NO-SWAP PRO: recyclage hors écran
// --------------------------------------------------
function recycleReelOneStepDown(reel, nextTopId) {
  const s = reel.symbols;

  for (let i = 0; i < s.length; i++) {
    s[i].container.y = Math.round(s[i].container.y + reelStep);
  }

  // symbole le plus bas
  let maxIdx = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].container.y > s[maxIdx].container.y) maxIdx = i;
  }
  const sym = s[maxIdx];

  // minY
  let minY = s[0].container.y;
  for (let i = 1; i < s.length; i++) {
    if (s[i].container.y < minY) minY = s[i].container.y;
  }

  // reposition en haut + change texture hors écran
  sym.container.y = Math.round(minY - reelStep);
  setCellSymbol(sym, nextTopId);
}

// --------------------------------------------------
// Spin anim (quick stop intégré)
// --------------------------------------------------
function animateSpinReels(finalGrid, controller) {
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
    reel.lastTickAt = 0;
    reel.stopPlayed = false;
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

      const isQuick = !!controller?.quickStop;
      const settleMs = isQuick
        ? Math.max(160, Math.round(preset.settleMs * preset.settleFastFactor))
        : preset.settleMs;

      for (let c = 0; c < reels.length; c++) {
        const reel = reels[c];
        const p = plan[c];

        // Quick stop: on force la phase settle ASAP
        if (isQuick && now < p.settleStart) {
          p.settleStart = now;
          p.preDecelStart = now - 1;
        }

        if (now < p.startAt) {
          allDone = false;
          continue;
        }

        if (reel.settled) continue;
        allDone = false;

        const k = smoothFactor(dt, isQuick ? 90 : 140);

        // -------------------
        // SETTLE
        // -------------------
        if (now >= p.settleStart) {
          const tSettle = clamp01((now - p.settleStart) / settleMs);

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

          // vitesse cible pour finir à temps
          const settleEnd = p.settleStart + settleMs;
          const remainingMs = Math.max(1, settleEnd - now);

          const distToNextStep = reelStep - reel.offset;
          const remainingSteps = Math.max(0, reel.settleStepsLeft);
          const remainingDist = distToNextStep + Math.max(0, remainingSteps - 1) * reelStep;

          const baseNeed = remainingDist / remainingMs;

          const ease = 0.92 - 0.22 * easeOutCubic(tSettle);
          let targetSpeed = Math.max(0.22, baseNeed * ease);

          if (isQuick) targetSpeed *= 1.35; // quick stop plus “nerveux” mais propre

          reel.vel = reel.vel + (targetSpeed - reel.vel) * k;
          reel.offset += reel.vel * dt;

          while (reel.offset >= reelStep && reel.settleStepsLeft > 0) {
            reel.offset -= reelStep;

            const nextId = reel.settleQueue.length ? reel.settleQueue.shift() : randomSymbolId();
            recycleReelOneStepDown(reel, nextId);

            // ✅ tick (throttle léger)
            if (now - reel.lastTickAt > (isQuick ? 25 : 35)) {
              playSound("tick");
              reel.lastTickAt = now;
            }

            reel.settleStepsLeft--;
          }

          if (reel.settleStepsLeft <= 0) {
            const EPS = 0.6;
            if (reel.offset >= reelStep - EPS) reel.offset = 0;

            reel.offset = 0;
            reel.container.y = 0;

            // ✅ stop par rouleau (une fois)
            if (!reel.stopPlayed) {
              playSound("stop");
              reel.stopPlayed = true;
            }

            reel.bouncing = true;
            reel.bounceStart = now;
            continue;
          }

          reel.container.y = reel.offset;
          continue;
        }

        // -------------------
        // SPIN
        // -------------------
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

          if (now - reel.lastTickAt > (isQuick ? 25 : 35)) {
            playSound("tick");
            reel.lastTickAt = now;
          }
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
// Spin button handler (SPIN / STOP)
// --------------------------------------------------
function onSpinButton() {
  if (!spinning) {
    onSpinStart();
  } else {
    // ✅ Quick stop comme vraie slot
    requestQuickStop();
  }
}

function requestQuickStop() {
  if (!spinning) return;
  if (spinController) spinController.quickStop = true;
}

// --------------------------------------------------
// SPIN start
// --------------------------------------------------
async function onSpinStart() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  if (freeSpins <= 0) winMultiplier = 1;

  spinning = true;
  spinController = { quickStop: false };

  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  setButtonsEnabled(false);
  setSpinButtonMode("stop");

  const effectiveBet = bet;
  const paidSpin = freeSpins <= 0;

  if (!paidSpin) {
    freeSpins--;
  } else {
    if (balance < bet) {
      updateHUDTexts("Solde insuffisant");
      spinning = false;
      setButtonsEnabled(true);
      setSpinButtonMode("spin");
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

    await animateSpinReels(grid, spinController);
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
    playSound("stop");
    spinning = false;
    spinController = null;
    setButtonsEnabled(true);
    setSpinButtonMode("spin");
  }
}

function finishSpin(win, winningLines, bonusTriggered) {
  spinning = false;
  spinController = null;

  setButtonsEnabled(true);
  setSpinButtonMode("spin");

  if (win > 0) {
    playSound("win");
    updateHUDTexts(
      freeSpins > 0 ? `Gain : ${win} — free spins : ${freeSpins}` : `Gain : ${win}`
    );

    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
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