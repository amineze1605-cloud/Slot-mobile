// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ FIX iPhone: autoDensity + resolution (DPR) + layout basé sur app.screen.*
// ✅ Anti-bleeding: clamp + mipmaps off + PAD
// ✅ VISUEL: Glow propre (copie derrière) => symboles nets, glow seulement 77/WILD/BONUS
// ✅ INFO: texte auto-fit => plus de texte caché par le bouton
// ✅ CAP: ne jamais upscaler au-dessus de 256px (taille source)
// ✅ SPIN ANIM: reel par reel + départ doux + arrêt + bounce
// ✅ MASK FIX: mask sur app.stage (pas enfant du slotContainer) => plus d’écran vide
// ✅ PATCH SWAP PRO: plus de "setFinalColumnOnReel" visible => on injecte le résultat via les 4 derniers steps

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

// layout reel
let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;          // symbolSize + gap
let visibleH = 0;

// --------------------------------------------------
// VITESSES (3 modes)
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 0.95,
    spinMs: 1820,
    startStaggerMs: 130,
    stopStaggerMs: 150,
    accelMs: 280,
    preDecelMs: 260,
    settleMs: 320,
    bounceMs: 260,
    bounceAmpFactor: 0.22,
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.20,
    spinMs: 1470,
    startStaggerMs: 105,
    stopStaggerMs: 125,
    accelMs: 220,
    preDecelMs: 220,
    settleMs: 280,
    bounceMs: 240,
    bounceAmpFactor: 0.20,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.55,
    spinMs: 1170,
    startStaggerMs: 85,
    stopStaggerMs: 100,
    accelMs: 180,
    preDecelMs: 180,
    settleMs: 240,
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
    img.src = "assets/spritesheet.png?v=5";

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
// Initialisation PIXI
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

    buildSlotScene();
    buildHUD();

    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
    app.ticker.add(updateHighlight);

    window.addEventListener("resize", () => {
      if (slotMask) { slotMask.destroy(true); slotMask = null; }

      app.stage.removeChildren();
      reels = [];
      highlightedCells = [];
      paytableOverlay = null;

      glowFilters = buildGlowFilters();
      buildSlotScene();
      buildHUD();
      updateHUDTexts("Appuyez sur SPIN pour lancer");
    });

  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    showMessage("Erreur JS : chargement assets (" + (e?.message || String(e)) + ")");
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

// --------------------------------------------------
// Helpers symbol
// --------------------------------------------------
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

function setCellSymbol(cellObj, symbolId) {
  const safeId =
    ((symbolId % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;

  const tex = symbolTextures[safeId];
  cellObj.main.texture = tex;
  cellObj.glow.texture = tex;
  applySymbolVisual(cellObj, safeId);
}

// --------------------------------------------------
// Slot scene + mask
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
  app.stage.addChild(slotContainer);

  slotContainer.x = Math.round((w - totalReelWidth) / 2);
  slotContainer.y = Math.round(h * 0.22);

  const framePaddingX = 18;
  const framePaddingY = 18;

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(6, 0xf2b632, 1);
  slotFrame.beginFill(0x060b1a, 0.9);
  slotFrame.drawRoundedRect(
    slotContainer.x - framePaddingX,
    slotContainer.y - framePaddingY,
    totalReelWidth + framePaddingX * 2,
    visibleH + framePaddingY * 2,
    26
  );
  slotFrame.endFill();
  app.stage.addChildAt(slotFrame, 0);

  if (slotMask) {
    slotMask.destroy(true);
    slotMask = null;
  }
  slotMask = new PIXI.Graphics();
  slotMask.beginFill(0xffffff, 1);
  slotMask.drawRect(0, 0, totalReelWidth, visibleH);
  slotMask.endFill();
  slotMask.x = slotContainer.x;
  slotMask.y = slotContainer.y;
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
    for (let i = 0; i < ROWS + 1; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx);

      const y = Math.round(i * reelStep - reelStep + symbolSize / 2);
      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = y;

      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells, // [extraTop, row0, row1, row2]
      offset: 0,
      settled: false,

      // PATCH SWAP PRO: queue finale injectée via les steps
      finalQueue: null,
      finalQueueReady: false,

      // settle memory
      settling: false,
      settleT0: 0,
      settleOffset0: 0,
    });
  }
}

// --------------------------------------------------
// HUD + boutons (inchangé)
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
  g.beginFill(0x111827);
  g.lineStyle(4, 0xf2b632, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, 18);
  g.endFill();

  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.45, 28),
    fill: 0xffffff,
  });
  const t = new PIXI.Text(label, style);
  t.anchor.set(0.5);

  container.addChild(g, t);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.7));
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
  g.beginFill(0x111827);
  g.lineStyle(4, 0xf2b632, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, 18);
  g.endFill();

  const topStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.28, 18),
    fill: 0xffffff,
  });
  const bottomStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.34, 22),
    fill: 0xffffff,
    fontWeight: "700",
  });

  const tTop = new PIXI.Text("VITESSE", topStyle);
  const tBottom = new PIXI.Text(SPEEDS[speedIndex].name, bottomStyle);

  tTop.anchor.set(0.5);
  tBottom.anchor.set(0.5);

  tTop.y = -height * 0.18;
  tBottom.y = height * 0.18;

  container.addChild(g, tTop, tBottom);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.7));
  container.on("pointerup", () => (g.alpha = 1.0));
  container.on("pointerupoutside", () => (g.alpha = 1.0));

  container._bg = g;
  container._tTop = tTop;
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

  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.035),
    h * 0.1
  );

  statsText = makeText("", Math.round(h * 0.028), h * 0.72);
  statsText.anchor.set(0.5, 0.5);

  const buttonWidth = w * 0.26;
  const buttonHeight = h * 0.07;
  const spacingX = w * 0.06;
  const buttonsY = h * 0.82;

  btnMinus = makeButton("-1", buttonWidth, buttonHeight);
  btnSpin  = makeButton("SPIN", buttonWidth, buttonHeight);
  btnPlus  = makeButton("+1", buttonWidth, buttonHeight);

  btnSpin.x = w / 2;
  btnSpin.y = buttonsY;

  btnMinus.x = btnSpin.x - (buttonWidth + spacingX);
  btnMinus.y = buttonsY;

  btnPlus.x = btnSpin.x + (buttonWidth + spacingX);
  btnPlus.y = buttonsY;

  const secondY = buttonsY + buttonHeight + h * 0.02;

  const speedW = buttonWidth;
  const speedH = buttonHeight * 0.90;

  btnSpeed = makeSpeedButton(speedW, speedH);
  btnSpeed.x = btnSpin.x;
  btnSpeed.y = secondY;

  const infoW = buttonWidth * 0.90;
  const infoH = speedH;
  btnInfo = makeButton("INFO", infoW, infoH);
  btnInfo.x = btnPlus.x;
  btnInfo.y = secondY;

  const safeRight = w - w * 0.03;
  if (btnInfo.x + infoW / 2 > safeRight) {
    btnInfo.x = safeRight - infoW / 2;
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
// Paytable overlay (inchangé)
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
  panel.beginFill(0x111827);
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
    })
  );
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = panelY + marginY;
  container.addChild(title);

  const closeHeight = Math.round(h * 0.06);
  const closeWidth = panelWidth * 0.35;

  const close = new PIXI.Container();
  const cg = new PIXI.Graphics();
  cg.beginFill(0x111827);
  cg.lineStyle(4, 0xf2b632, 1);
  cg.drawRoundedRect(-closeWidth / 2, -closeHeight / 2, closeWidth, closeHeight, 16);
  cg.endFill();

  const closeText = new PIXI.Text(
    "FERMER",
    new PIXI.TextStyle({
      fontFamily: "system-ui",
      fontSize: Math.round(h * 0.024),
      fill: 0xffffff,
    })
  );
  closeText.anchor.set(0.5);

  close.addChild(cg, closeText);
  close.x = w / 2;
  close.y = panelY + panelHeight - marginY - closeHeight / 2;
  close.interactive = true;
  close.buttonMode = true;

  close.on("pointerdown", () => (cg.alpha = 0.7));
  close.on("pointerup", () => { cg.alpha = 1.0; togglePaytable(false); });
  close.on("pointerupoutside", () => (cg.alpha = 1.0));

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

  const smallScreen = h < 750;
  let fontSize = smallScreen ? Math.round(h * 0.020) : Math.round(h * 0.024);
  let lineHeight = smallScreen ? Math.round(h * 0.025) : Math.round(h * 0.030);

  const bodyStyle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize,
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: panelWidth * 0.80,
    lineHeight,
  });

  const body = new PIXI.Text(bodyText, bodyStyle);
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + marginY;

  const maxBottom = close.y - closeHeight / 2 - marginY;
  let safety = 0;
  while (body.y + body.height > maxBottom && fontSize > 12 && safety < 25) {
    fontSize = Math.max(12, fontSize - 1);
    lineHeight = Math.max(14, lineHeight - 1);
    body.style.fontSize = fontSize;
    body.style.lineHeight = lineHeight;
    safety++;
  }

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
// Application grille backend
// --------------------------------------------------
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length !== ROWS) return;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel) continue;

      const cellObj = reel.symbols[r + 1];
      if (!cellObj) continue;

      const safeId =
        ((value % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;
      setCellSymbol(cellObj, safeId);
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
    if (!reel || !reel.symbols[row + 1]) return;
    highlightedCells.push(reel.symbols[row + 1]);
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

// --------------------------------------------------
// Spin core helpers
// --------------------------------------------------
function shiftReelOneStepDown(reel, nextTopId) {
  const s = reel.symbols; // [extraTop, row0, row1, row2]
  setCellSymbol(s[3], s[2].symbolId);
  setCellSymbol(s[2], s[1].symbolId);
  setCellSymbol(s[1], s[0].symbolId);
  setCellSymbol(s[0], nextTopId);
}

function makeFinalQueueForReel(colIndex, finalGrid) {
  // grid: [row][col] => row 0 top, 1 mid, 2 bot
  const topId = finalGrid[0][colIndex];
  const midId = finalGrid[1][colIndex];
  const botId = finalGrid[2][colIndex];

  // IMPORTANT:
  // Derniers inserts (du plus ancien au plus récent) : bot, mid, top, top
  // => à l'arrêt : extraTop=top et visible=top/mid/bot (pas de swap)
  return [botId, midId, topId, topId].map((v) => {
    return ((v % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;
  });
}

function nextTopFromQueueOrRandom(reel) {
  if (reel.finalQueue && reel.finalQueue.length > 0) {
    return reel.finalQueue.shift();
  }
  return randomSymbolId();
}

// --------------------------------------------------
// Spin anim reel-by-reel + settle + bounce intégré (sans swap)
// --------------------------------------------------
function animateSpinReels(finalGrid) {
  const preset = SPEEDS[speedIndex];
  const startTime = performance.now();

  const plan = reels.map((_, c) => {
    const startAt = startTime + c * preset.startStaggerMs;
    const stopAt  = startAt + preset.spinMs + c * preset.stopStaggerMs;

    const settleStartMin = stopAt - preset.settleMs;
    const preDecelStart = settleStartMin - preset.preDecelMs;

    return { startAt, stopAt, settleStartMin, preDecelStart };
  });

  const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 22);
  const bounceWindow = Math.max(120, Math.min(preset.bounceMs, preset.settleMs));
  const bounceStartFrac = clamp01(1 - bounceWindow / preset.settleMs);
  const bounceFracRange = Math.max(0.12, 1 - bounceStartFrac);

  // reset state
  reels.forEach((reel) => {
    reel.offset = 0;
    reel.container.y = 0;
    reel.settled = false;

    reel.finalQueue = null;
    reel.finalQueueReady = false;

    reel.settling = false;
    reel.settleT0 = 0;
    reel.settleOffset0 = 0;
  });

  return new Promise((resolve) => {
    let prev = performance.now();

    function tick(now) {
      const dt = Math.max(0, now - prev);
      prev = now;

      let allDone = true;

      for (let c = 0; c < reels.length; c++) {
        const reel = reels[c];
        const p = plan[c];

        if (reel.settled) continue;

        if (now < p.startAt) {
          allDone = false;
          continue;
        }

        allDone = false;

        // prépare la queue finale dès preDecelStart (assez tôt)
        if (!reel.finalQueueReady && now >= p.preDecelStart) {
          reel.finalQueue = makeFinalQueueForReel(c, finalGrid);
          reel.finalQueueReady = true;
        }

        // ---- SETTLE: seulement quand la queue finale est complètement passée
        // (si la queue n'est pas vide, on continue de tourner doucement jusqu'à l'avoir injectée)
        const canSettle = reel.finalQueueReady && reel.finalQueue && reel.finalQueue.length === 0;
        const settleStart = p.settleStartMin; // min
        const shouldEnterSettle = (now >= settleStart) && canSettle;

        if (shouldEnterSettle) {
          if (!reel.settling) {
            reel.settling = true;
            reel.settleT0 = now;
            reel.offset = ((reel.offset % reelStep) + reelStep) % reelStep;
            reel.settleOffset0 = reel.offset;
          }

          const t = clamp01((now - reel.settleT0) / preset.settleMs);
          const e = easeOutCubic(t);

          const baseY = (1 - e) * reel.settleOffset0;

          let bounceY = 0;
          if (t >= bounceStartFrac) {
            const u = clamp01((t - bounceStartFrac) / bounceFracRange);
            const s = Math.sin(u * Math.PI);
            const amp = bounceAmp * (1 - u * 0.18);
            bounceY = -s * amp;
          }

          reel.container.y = baseY + bounceY;

          if (t >= 1) {
            reel.container.y = 0;
            reel.offset = 0;
            reel.settled = true;
          }
          continue;
        }

        // ---- SPIN: scroll vers le bas
        let speed = preset.basePxPerMs;

        // accel
        const tAccel = clamp01((now - p.startAt) / preset.accelMs);
        speed *= easeInOutQuad(tAccel);

        // pre-decel
        if (now >= p.preDecelStart) {
          const t = clamp01((now - p.preDecelStart) / (Math.max(1, (p.settleStartMin - p.preDecelStart))));
          const dec = 1 - easeOutCubic(t) * 0.65;
          speed *= dec;
        }

        // si on est "après settleStartMin" mais queue pas vide, on force une vitesse douce
        // pour finir d'injecter les 4 steps finals sans jump
        if (now >= p.settleStartMin && !(reel.finalQueueReady && reel.finalQueue && reel.finalQueue.length === 0)) {
          speed = Math.min(speed, preset.basePxPerMs * 0.55);
          speed = Math.max(speed, 0.45); // sécurité: avance toujours
        }

        reel.offset += speed * dt;

        while (reel.offset >= reelStep) {
          reel.offset -= reelStep;
          const nextId = nextTopFromQueueOrRandom(reel);
          shiftReelOneStepDown(reel, nextId);
        }

        reel.container.y = reel.offset;
      }

      if (allDone) {
        resolve();
        return;
      }
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

    // sécurité
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