// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ FIX iPhone: autoDensity + resolution (DPR) + layout basé sur app.screen.*
// ✅ Anti-bleeding: clamp + mipmaps off + PAD
// ✅ VISUEL: Glow propre (copie derrière) => symboles nets, glow seulement 77/WILD/BONUS
// ✅ INFO: texte auto-fit => plus de texte caché par le bouton
// ✅ CAP: ne jamais upscaler au-dessus de 256px (taille source)
// ✅ SPIN ANIM: rouleaux par rouleaux, départ gauche->droite, arrêt gauche->droite + bounce doux
// ✅ FIX SWAP: verrouillage des 3 visibles AVANT stop (plus de random en fin de spin)

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

// Dimensions reel (calculées)
const COLS = 5;
const ROWS = 3;
const REEL_SYMBOLS = ROWS + 2; // 5 (1 au-dessus + 3 visibles + 1 en dessous)

let SYMBOL_SIZE = 128;
let GAP = 8;
let STEP = 136;
let REEL_WRAP_SHIFT = STEP * REEL_SYMBOLS;
let WRAP_THRESHOLD_Y = STEP * (ROWS + 1); // quand ça dépasse, on wrap
let TOP_Y0 = -STEP + STEP / 2;           // position du symbole du haut

// IDs
const WILD_ID = 9;
const BONUS_ID = 6;
const PREMIUM77_ID = 0;

// Etat jeu
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

// Highlight
let highlightedCells = [];
let highlightTimer = 0;

// --------------------------------------------------
// VITESSES (3 modes) + bounce plus prononcé mais doux
// --------------------------------------------------
const SPEEDS = [
  {
    key: "LENT",
    durationBase: 1550,      // plus long entre départ et arrêt
    startStagger: 90,        // départ gauche->droite
    stopStagger: 120,        // arrêt gauche->droite
    accelFrac: 0.18,
    decelFrac: 0.22,
    pxPerMs: 1.05,           // vitesse moyenne (départ plus fluide)
    finalLockMs: 260,        // quand on lock le résultat avant stop
    bouncePx: 14,
    bounceMs: 360,
  },
  {
    key: "NORMAL",
    durationBase: 1200,
    startStagger: 75,
    stopStagger: 100,
    accelFrac: 0.16,
    decelFrac: 0.20,
    pxPerMs: 1.25,
    finalLockMs: 230,
    bouncePx: 13,
    bounceMs: 330,
  },
  {
    key: "RAPIDE",
    durationBase: 900,
    startStagger: 55,
    stopStagger: 80,
    accelFrac: 0.14,
    decelFrac: 0.18,
    pxPerMs: 1.45,
    finalLockMs: 190,
    bouncePx: 12,
    bounceMs: 300,
  },
];

let speedIndex = 0;
function getSpeed() {
  return SPEEDS[speedIndex] || SPEEDS[0];
}

// --------------------------------------------------
// VISUEL (Glow) - tes paramètres actuels
// --------------------------------------------------
const GLOW_COLORS = {
  wild: 0x2bff5a,
  bonus: 0x3aa6ff,
  premium77: 0xd45bff,
};

const GLOW_PARAMS = {
  wild:     { distance: 6, outer: 0.70, inner: 0.20, quality: 0.25 },
  bonus:    { distance: 6, outer: 0.65, inner: 0.20, quality: 0.25 },
  premium:  { distance: 7, outer: 0.85, inner: 0.20, quality: 0.28 },
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
  1:  { 3: 2, 4: 3, 5: 4 },    // pastèque
  3:  { 3: 2, 4: 3, 5: 4 },    // pomme
  7:  { 3: 2, 4: 3, 5: 4 },    // cerises
  10: { 3: 2, 4: 3, 5: 4 },    // citron
  4:  { 3: 3, 4: 4, 5: 5 },    // cartes
  8:  { 3: 4, 4: 5, 5: 6 },    // pièce
  5:  { 3: 10, 4: 12, 5: 14 }, // couronne
  2:  { 3: 16, 4: 18, 5: 20 }, // BAR
  11: { 3: 20, 4: 25, 5: 30 }, // 7 rouge
  0:  { 3: 30, 4: 40, 5: 50 }, // 77 mauve
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
    img.onerror = (e) => reject(e || new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// --------------------------------------------------
// GlowFilters (partagés) – resolution = renderer.resolution
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

    buildSlotScene();
    buildHUD();
    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");

    app.ticker.add(updateHighlight);

    window.addEventListener("resize", () => {
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
// Symbol helpers
// --------------------------------------------------
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

function setCellSymbol(cellObj, symbolId) {
  const safeId = ((symbolId % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;
  const tex = symbolTextures[safeId];
  cellObj.main.texture = tex;
  cellObj.glow.texture = tex;
  applySymbolVisual(cellObj, safeId);
}

// --------------------------------------------------
// Crée une “cellule” symbole : glow derrière + symbole net devant
// --------------------------------------------------
function createSymbolCell(texture, symbolSize) {
  const cell = new PIXI.Container();
  cell.roundPixels = true;

  const glowSprite = new PIXI.Sprite(texture);
  glowSprite.anchor.set(0.5);
  glowSprite.width = symbolSize;
  glowSprite.height = symbolSize;
  glowSprite.visible = false;
  glowSprite.roundPixels = true;
  glowSprite.alpha = 0.55;

  const mainSprite = new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width = symbolSize;
  mainSprite.height = symbolSize;
  mainSprite.roundPixels = true;

  cell.addChild(glowSprite, mainSprite);

  return {
    container: cell,
    glow: glowSprite,
    main: mainSprite,
    symbolId: -1,
    locked: false, // ✅ utilisé pour anti-swap
  };
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
// Construction scène slot
// --------------------------------------------------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  GAP = 8;

  const symbolFromHeight = h * 0.16;
  const symbolFromWidth = (maxTotalWidth - GAP * (COLS - 1)) / COLS;

  const MAX_SYMBOL_PX = 256; // CAP
  SYMBOL_SIZE = Math.min(MAX_SYMBOL_PX, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

  STEP = SYMBOL_SIZE + GAP;
  REEL_WRAP_SHIFT = STEP * REEL_SYMBOLS;
  WRAP_THRESHOLD_Y = STEP * (ROWS + 1);
  TOP_Y0 = -STEP + STEP / 2;

  const totalReelWidth = COLS * SYMBOL_SIZE + GAP * (COLS - 1);

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = Math.round((w - totalReelWidth) / 2);
  slotContainer.y = Math.round(h * 0.22);

  const framePaddingX = 18;
  const framePaddingY = 18;

  const frame = new PIXI.Graphics();
  frame.lineStyle(6, 0xf2b632, 1);
  frame.beginFill(0x060b1a, 0.9);
  frame.drawRoundedRect(
    slotContainer.x - framePaddingX,
    slotContainer.y - framePaddingY,
    totalReelWidth + framePaddingX * 2,
    ROWS * STEP - GAP + framePaddingY * 2,
    26
  );
  frame.endFill();
  app.stage.addChildAt(frame, 0);

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = Math.round(c * (SYMBOL_SIZE + GAP));
    reelContainer.y = 0;

    const reel = { container: reelContainer, symbols: [] };

    // 5 symboles (2 offscreen)
    for (let i = 0; i < REEL_SYMBOLS; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], SYMBOL_SIZE);

      cellObj.container.x = Math.round(SYMBOL_SIZE / 2);
      cellObj.container.y = Math.round(TOP_Y0 + i * STEP);

      setCellSymbol(cellObj, idx);

      reelContainer.addChild(cellObj.container);
      reel.symbols.push(cellObj);
    }

    reels.push(reel);
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

function makeButton(label, width, height, fontSizeOverride = null, lineHeightOverride = null) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.beginFill(0x111827);
  g.lineStyle(4, 0xf2b632, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, 18);
  g.endFill();

  const baseFont = fontSizeOverride ?? Math.min(height * 0.42, 26);

  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: baseFont,
    fill: 0xffffff,
    align: "center",
    lineHeight: lineHeightOverride ?? Math.round(baseFont * 1.05),
  });

  const t = new PIXI.Text(label, style);
  t.anchor.set(0.5);

  container.addChild(g, t);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.7));
  container.on("pointerup", () => (g.alpha = 1.0));
  container.on("pointerupoutside", () => (g.alpha = 1.0));

  // expose texte pour update
  container._bg = g;
  container._text = t;

  app.stage.addChild(container);
  return container;
}

function setSpeedButtonLabel() {
  if (!btnSpeed || !btnSpeed._text) return;
  const s = getSpeed();
  btnSpeed._text.text = `VITESSE\n${s.key}`;
}

function clampX(x, width) {
  const w = app.screen.width;
  const margin = w * 0.04;
  return Math.max(width / 2 + margin, Math.min(w - width / 2 - margin, x));
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

  // ✅ dessous de SPIN : VITESSE (large comme SPIN, texte en 2 lignes)
  const smallH = buttonHeight * 0.75;
  const secondRowY = buttonsY + buttonHeight + h * 0.02;

  const speedFont = Math.min(smallH * 0.32, 18);
  btnSpeed = makeButton("VITESSE\nLENT", buttonWidth, smallH, speedFont, Math.round(speedFont * 1.15));
  btnSpeed.x = clampX(w / 2, buttonWidth);
  btnSpeed.y = secondRowY;

  // ✅ à droite de VITESSE : INFO aligné sous +1 (et pas coupé)
  const infoWidth = buttonWidth; // tu voulais plus large / propre
  btnInfo = makeButton("INFO", infoWidth, smallH, Math.min(smallH * 0.42, 22));
  btnInfo.x = clampX(btnPlus.x, infoWidth);
  btnInfo.y = secondRowY;

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinClick);
  btnInfo.on("pointerup", togglePaytable);

  btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedButtonLabel();
  });

  setSpeedButtonLabel();
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
// Paytable overlay (auto-fit texte)
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
// Application grille backend (snap direct)
// --------------------------------------------------
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length !== ROWS) return;

  for (let c = 0; c < COLS; c++) {
    const reel = reels[c];
    if (!reel) continue;

    const sorted = reel.symbols.slice().sort((a, b) => a.container.y - b.container.y);

    // place les 5 en positions propres
    for (let i = 0; i < REEL_SYMBOLS; i++) {
      const cellObj = sorted[i];
      if (!cellObj) continue;
      cellObj.container.y = Math.round(TOP_Y0 + i * STEP);
      cellObj.locked = false;
    }

    // set les 3 visibles au résultat
    for (let row = 0; row < ROWS; row++) {
      const cellObj = sorted[row + 1];
      if (!cellObj) continue;
      setCellSymbol(cellObj, grid[row][c]);
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

    // on highlight le visible "row" => sorted[row+1]
    const sorted = reel.symbols.slice().sort((a, b) => a.container.y - b.container.y);
    const cellObj = sorted[row + 1];
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
// EASING
// --------------------------------------------------
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function easeInOutSine(x) { return 0.5 - 0.5 * Math.cos(Math.PI * x); }
function easeInCubic(x) { return x * x * x; }
function easeOutCubic(x) { const t = 1 - x; return 1 - t * t * t; }

// --------------------------------------------------
// FIX SWAP: lock visible cells
// --------------------------------------------------
function lockFinalVisibleCells(col, finalGrid) {
  const reel = reels[col];
  if (!reel) return;

  const sorted = reel.symbols.slice().sort((a, b) => a.container.y - b.container.y);

  for (let row = 0; row < ROWS; row++) {
    const cellObj = sorted[row + 1];
    if (!cellObj) continue;

    cellObj.locked = true;
    setCellSymbol(cellObj, finalGrid[row][col]);
  }
}

function snapReelToGrid(col) {
  const reel = reels[col];
  if (!reel) return;
  const sorted = reel.symbols.slice().sort((a, b) => a.container.y - b.container.y);
  for (let i = 0; i < REEL_SYMBOLS; i++) {
    const cellObj = sorted[i];
    if (!cellObj) continue;
    cellObj.container.y = Math.round(TOP_Y0 + i * STEP);
  }
}

function wrapCellDown(cellObj, st) {
  if (cellObj.container.y > WRAP_THRESHOLD_Y) {
    cellObj.container.y -= REEL_WRAP_SHIFT;

    // ✅ si locked => jamais random
    // ✅ si finalizing => plus aucun random non plus (anti-swap)
    if (!cellObj.locked && !st.finalizing) {
      setCellSymbol(cellObj, randomSymbolId());
    }
  }
}

// --------------------------------------------------
// ANIMATION SPIN: rouleau par rouleau + bounce
// --------------------------------------------------
function animateSpinReels(finalGrid) {
  return new Promise((resolve) => {
    const speed = getSpeed();
    const startTime = performance.now();
    let prev = startTime;

    const state = new Array(COLS).fill(0).map((_, c) => ({
      col: c,
      stopped: false,
      bouncing: false,
      bounceStart: 0,
      baseReelY: reels[c]?.container?.y || 0,
      finalizing: false,
      done: false,
      // timings
      startDelay: c * speed.startStagger,
      stopExtra: c * speed.stopStagger,
      duration: speed.durationBase + c * speed.stopStagger,
    }));

    function tick(now) {
      const dt = Math.min(40, now - prev);
      prev = now;

      let allDone = true;

      for (let c = 0; c < COLS; c++) {
        const st = state[c];
        const reel = reels[c];
        if (!reel) continue;

        if (st.done) continue;
        allDone = false;

        const t0 = now - startTime;

        // bounce phase (après stop)
        if (st.bouncing) {
          const tb = now - st.bounceStart;
          const x = clamp01(tb / speed.bounceMs);

          // sinus smooth 0->1->0 (doux) mais amplitude plus haute
          const offset = -speed.bouncePx * Math.sin(Math.PI * x);

          reel.container.y = st.baseReelY + offset;

          if (x >= 1) {
            reel.container.y = st.baseReelY;
            st.bouncing = false;
            st.done = true;
          }
          continue;
        }

        // pas encore démarré (départ gauche->droite)
        if (t0 < st.startDelay) continue;

        const t = t0 - st.startDelay;
        const end = st.duration;

        // progress
        const p = clamp01(t / end);

        // ✅ on déclenche "finalizing" assez tôt pour verrouiller
        const remainingMs = end - t;
        if (!st.finalizing && remainingMs <= speed.finalLockMs) st.finalizing = true;

        // vitesse instantanée (départ fluide + decel)
        let velMult = 1;

        const a = speed.accelFrac;
        const d = speed.decelFrac;

        if (p < a) {
          velMult = easeInCubic(p / a); // 0 -> 1
        } else if (p > 1 - d) {
          velMult = easeOutCubic((1 - p) / d); // 1 -> 0
        } else {
          velMult = 1;
        }

        // un léger smoothing global pour éviter le “brusque”
        velMult = easeInOutSine(velMult);

        const dy = speed.pxPerMs * velMult * dt;

        // move symbols down
        for (let i = 0; i < reel.symbols.length; i++) {
          const cellObj = reel.symbols[i];
          cellObj.container.y += dy;
          wrapCellDown(cellObj, st);
        }

        // ✅ pendant finalizing: on force les 3 visibles à être le résultat (anti swap)
        if (st.finalizing && !st.stopped) {
          lockFinalVisibleCells(c, finalGrid);
        }

        // stop
        if (!st.stopped && t >= end) {
          // snap positions propres + lock final visible
          snapReelToGrid(c);
          lockFinalVisibleCells(c, finalGrid);

          st.stopped = true;

          // démarre bounce (plus doux mais prononcé)
          st.bouncing = true;
          st.bounceStart = now;
          st.baseReelY = reel.container.y;

          // son stop à chaque reel (optionnel)
          playSound("stop");
        }
      }

      if (allDone) {
        // cleanup locks
        for (let c = 0; c < COLS; c++) {
          const reel = reels[c];
          if (!reel) continue;
          reel.symbols.forEach((s) => (s.locked = false));
        }
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

    // ✅ animation reel par reel + stop reel par reel + anti-swap lock
    await animateSpinReels(grid);

    // evaluation
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