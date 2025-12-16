// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ FIX iPhone: autoDensity + resolution (DPR) + layout basé sur app.screen.*
// ✅ Anti-bleeding: clamp + mipmaps off + PAD
// ✅ VISUEL: Glow propre (copie derrière) => symboles nets, glow seulement 77/WILD/BONUS
// ✅ INFO: texte auto-fit => plus de texte caché par le bouton
// ✅ CAP: ne jamais upscaler au-dessus de 256px (taille source)
// ✅ SPIN ANIM: smooth (ease) + arrêt en cascade + 3 vitesses sélectionnables

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

// --------------------------------------------------
// (A) Vitesses de spin (3 modes)
// --------------------------------------------------
const SPEED_PRESETS = [
  // plus lent = plus long + ralentissement plus visible
  { key: "SLOW",   label: "LENT",   totalSpinMs: 1250, shuffleMinMs: 70, slowDownMs: 450, stopStaggerMs: 140 },
  { key: "NORM",   label: "NORMAL", totalSpinMs: 850,  shuffleMinMs: 55, slowDownMs: 320, stopStaggerMs: 100 },
  { key: "FAST",   label: "RAPIDE", totalSpinMs: 600,  shuffleMinMs: 40, slowDownMs: 240, stopStaggerMs: 80  },
];

let speedIndex = 1; // default NORMAL
try {
  const saved = localStorage.getItem("slot_speed_index");
  if (saved !== null) speedIndex = Math.max(0, Math.min(SPEED_PRESETS.length - 1, parseInt(saved, 10)));
} catch (e) {}

function getSpeedPreset() {
  return SPEED_PRESETS[speedIndex] || SPEED_PRESETS[1];
}

function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEED_PRESETS.length;
  try { localStorage.setItem("slot_speed_index", String(speedIndex)); } catch (e) {}
  refreshSpeedButtonLabel();

  if (!spinning) {
    updateHUDTexts(`Vitesse : ${getSpeedPreset().label}`);
    // petit retour message "normal"
    setTimeout(() => {
      if (!spinning) updateHUDTexts("Appuyez sur SPIN pour lancer");
    }, 900);
  }
}

function refreshSpeedButtonLabel() {
  if (!btnSpeed || !btnSpeed.setLabel) return;
  const p = getSpeedPreset();
  // style "x1/x2/x3" comme les slots
  const x = (speedIndex + 1);
  btnSpeed.setLabel(`x${x}`);
}

// --------------------------------------------------
// VISUEL (Glow)
// --------------------------------------------------
const GLOW_COLORS = {
  wild: 0x2bff5a,     // vert
  bonus: 0x3aa6ff,    // bleu
  premium77: 0xd45bff // violet
};

// Intensités (tes valeurs actuelles)
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

    img.onerror = (e) =>
      reject(e || new Error("Impossible de charger assets/spritesheet.png"));
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
    cellObj.glow.tint  = GLOW_COLORS.premium77;
    cellObj.glow.visible = true;
    cellObj.glow.filters = [glowFilters.premium];
  }
}

// --------------------------------------------------
// Helpers spin anim
// --------------------------------------------------
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
// easing doux pour décélération
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

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

function applyFinalReel(col, finalGrid) {
  for (let r = 0; r < ROWS; r++) {
    const cellObj = reels[col]?.symbols[r];
    if (!cellObj) continue;
    setCellSymbol(cellObj, finalGrid[r][col]);
    cellObj.container.alpha = 1;
  }
}

// --------------------------------------------------
// (C) animation visuelle du spin (smooth + arrêt en cascade)
// --------------------------------------------------
function animateSpinVisual(finalGrid) {
  const sp = getSpeedPreset();

  return new Promise((resolve) => {
    const start = performance.now();

    // moment où chaque reel s'arrête (cascade)
    const reelStopAt = Array.from({ length: COLS }, (_, c) =>
      start + sp.totalSpinMs + c * sp.stopStaggerMs
    );

    // suivi shuffle par reel
    const lastShuffleAt = Array(COLS).fill(0);
    const stopped = Array(COLS).fill(false);

    function tick(now) {
      let allStopped = true;

      for (let c = 0; c < COLS; c++) {
        if (stopped[c]) continue;

        allStopped = false;

        const stopT = reelStopAt[c];
        const remaining = stopT - now;

        // on est dans la zone de décélération (les dernières slowDownMs)
        const slowWindow = sp.slowDownMs;
        const slowT = 1 - clamp01(remaining / slowWindow); // 0 -> 1
        const ease = easeOutCubic(clamp01(slowT));

        // intervalle dynamique : au début rapide, puis ralentit progressivement
        const minI = sp.shuffleMinMs;
        const maxI = sp.shuffleMinMs * 4.0; // ralentissement visible
        const interval = lerp(minI, maxI, ease);

        if (now - lastShuffleAt[c] >= interval) {
          lastShuffleAt[c] = now;
          for (let r = 0; r < ROWS; r++) {
            const cellObj = reels[c]?.symbols[r];
            if (!cellObj) continue;
            setCellSymbol(cellObj, randomSymbolId());
          }
        }

        // stop reel
        if (remaining <= 0) {
          stopped[c] = true;
          applyFinalReel(c, finalGrid);
        }
      }

      if (allStopped) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

// --------------------------------------------------
// Construction scène slot
// --------------------------------------------------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  const gap = 8;

  const symbolFromHeight = h * 0.16;
  const symbolFromWidth = (maxTotalWidth - gap * (COLS - 1)) / COLS;

  // ✅ CAP: ne jamais dépasser la taille source (256px)
  const MAX_SYMBOL_PX = 256;
  const symbolSize = Math.min(
    MAX_SYMBOL_PX,
    Math.round(Math.min(symbolFromWidth, symbolFromHeight))
  );

  const totalReelWidth = COLS * symbolSize + gap * (COLS - 1);

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
    ROWS * (symbolSize + gap) - gap + framePaddingY * 2,
    26
  );
  frame.endFill();
  app.stage.addChildAt(frame, 0);

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = Math.round(c * (symbolSize + gap));

    const reel = { container: reelContainer, symbols: [] };

    for (let r = 0; r < ROWS; r++) {
      const idx = Math.floor(Math.random() * symbolTextures.length);
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);

      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = Math.round(r * (symbolSize + gap) + symbolSize / 2);

      applySymbolVisual(cellObj, idx);

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

  // ✅ helper pour changer le label après création
  container.setLabel = (newLabel) => {
    t.text = newLabel;
  };

  app.stage.addChild(container);
  return container;
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

  // --- INFO + VITESSE côte à côte
  const smallH = buttonHeight * 0.75;
  const smallW = w * 0.30;
  const smallGap = w * 0.04;
  const smallY = buttonsY + buttonHeight + h * 0.02;

  btnInfo = makeButton("INFO", smallW, smallH);
  btnSpeed = makeButton("x2", smallW, smallH);

  btnInfo.x = w / 2 - (smallW / 2) - (smallGap / 2);
  btnSpeed.x = w / 2 + (smallW / 2) + (smallGap / 2);

  btnInfo.y = smallY;
  btnSpeed.y = smallY;

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinClick);
  btnInfo.on("pointerup", togglePaytable);
  btnSpeed.on("pointerup", cycleSpeed);

  refreshSpeedButtonLabel();
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
// Application grille backend
// --------------------------------------------------
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length !== ROWS) return;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;

      const safeId =
        ((value % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;

      const tex = symbolTextures[safeId];
      const cellObj = reel.symbols[r];

      cellObj.main.texture = tex;
      cellObj.glow.texture = tex;

      applySymbolVisual(cellObj, safeId);
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
    if (!reel || !reel.symbols[row]) return;
    highlightedCells.push(reel.symbols[row]);
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

    // ✅ animation smooth + cascade + vitesse choisie
    await animateSpinVisual(grid);

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