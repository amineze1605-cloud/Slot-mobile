// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, free spins + mapping 4x4 (1024)
// ✅ Point 1: iPhone net -> autoDensity + resolution (DPR) + FILTER_RESOLUTION
// ✅ Point 2: layout basé sur app.screen (CSS pixels) + arrondis pour éviter flou
// ✅ Point 3: visuel -> GlowFilter (si dispo) + shadow (si dispo) SANS perdre en qualité

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
// Pour symboles "smooth". Si tu préfères plus "sharp", teste NEAREST (mais ça pixelise).
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

// IDs symboles
const WILD_ID = 9;
const BONUS_ID = 6;

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
let btnMinus, btnPlus, btnSpin, btnInfo;
let paytableOverlay = null;

// highlight
let highlightedSprites = [];
let highlightTimer = 0;

// --------------------------------------------------
// VISUELS (Glow / Shadow)
// --------------------------------------------------
const VISUALS = {
  // glow “normal”
  glow: { distance: 10, outerStrength: 1.3, innerStrength: 0.15, quality: 0.7 },
  // glow “premium”
  premium: { distance: 14, outerStrength: 2.2, innerStrength: 0.25, quality: 0.8 },
  shadowAlpha: 0.35,
};

const GLOW_COLORS = {
  default: 0xffffff,
  wild: 0x2bff5a,
  bonus: 0x3aa6ff,
  premium77: 0xd45bff,
};

let FILTERS = {
  ready: false,
  hasGlow: false,
  hasShadow: false,
  // caches
  glowDefault: null,
  glowWild: null,
  glowBonus: null,
  glowPremium: null,
  shadow: null,
};

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
  1:  { 3: 2, 4: 3, 5: 4 },   // pastèque
  3:  { 3: 2, 4: 3, 5: 4 },   // pomme
  7:  { 3: 2, 4: 3, 5: 4 },   // cerises
  10: { 3: 2, 4: 3, 5: 4 },   // citron
  4:  { 3: 3, 4: 4, 5: 5 },   // cartes
  8:  { 3: 4, 4: 5, 5: 6 },   // pièce
  5:  { 3: 10, 4: 12, 5: 14 },// couronne
  2:  { 3: 16, 4: 18, 5: 20 },// BAR
  11: { 3: 20, 4: 25, 5: 30 },// 7 rouge
  0:  { 3: 30, 4: 40, 5: 50 },// 77 mauve
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

        // anti-bleeding + netteté
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
// Setup Filters (Glow/Shadow) -> IMPORTANT: resolution = DPR
// --------------------------------------------------
function setupFilters(dpr) {
  const pf = PIXI.filters || {};
  FILTERS.hasGlow = !!pf.GlowFilter;
  FILTERS.hasShadow = !!pf.DropShadowFilter;

  // glow a tendance à flouter si le filtre render en res 1
  // -> on force une résolution de filtre au niveau global
  PIXI.settings.FILTER_RESOLUTION = dpr;

  // reset caches
  FILTERS.glowDefault = null;
  FILTERS.glowWild = null;
  FILTERS.glowBonus = null;
  FILTERS.glowPremium = null;
  FILTERS.shadow = null;

  if (FILTERS.hasGlow) {
    const Glow = pf.GlowFilter;

    const makeGlow = (color, preset) => {
      const f = new Glow({
        distance: preset.distance,
        outerStrength: preset.outerStrength,
        innerStrength: preset.innerStrength,
        color,
        quality: preset.quality,
      });
      // encore mieux: forcer résolution/padding
      f.resolution = dpr;
      f.padding = Math.ceil(preset.distance * 2 + 8);
      return f;
    };

    FILTERS.glowDefault = makeGlow(GLOW_COLORS.default, VISUALS.glow);
    FILTERS.glowWild = makeGlow(GLOW_COLORS.wild, VISUALS.glow);
    FILTERS.glowBonus = makeGlow(GLOW_COLORS.bonus, VISUALS.glow);
    FILTERS.glowPremium = makeGlow(GLOW_COLORS.premium77, VISUALS.premium);
  }

  if (FILTERS.hasShadow) {
    const Shadow = pf.DropShadowFilter;
    const s = new Shadow({
      rotation: 45,
      distance: 6,
      alpha: VISUALS.shadowAlpha,
      blur: 2,
      color: 0x000000,
    });
    s.resolution = dpr;
    s.padding = 12;
    FILTERS.shadow = s;
  }

  FILTERS.ready = true;
}

function applySymbolFilters(sprite, symbolId) {
  if (!FILTERS.ready) return;

  // pas de filtre = meilleure perf
  let glow = null;

  if (symbolId === WILD_ID) glow = FILTERS.glowWild;
  else if (symbolId === BONUS_ID) glow = FILTERS.glowBonus;
  else if (symbolId === 0) glow = FILTERS.glowPremium; // 77 mauve premium
  else glow = FILTERS.glowDefault; // tu peux mettre null si tu veux glow seulement sur bonus/wild

  const f = [];
  if (FILTERS.shadow) f.push(FILTERS.shadow);
  if (glow) f.push(glow);

  sprite.filters = f.length ? f : null;
}

// --------------------------------------------------
// Initialisation PIXI
// --------------------------------------------------
async function initPixi() {
  if (!canvas) {
    console.error("Canvas #game introuvable");
    return;
  }
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

  // ✅ Point 3 (et surtout anti-flou glow sur iPhone)
  setupFilters(dpr);

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

    // mapping 12 symboles (3 lignes remplies)
    const positions = [
      [0, 0], [1, 0], [2, 0], [3, 0],
      [0, 1], [1, 1], [2, 1], [3, 1],
      [0, 2], [1, 2], [2, 2], [3, 2],
    ];

    // PAD: 0 si tes symboles ont déjà du “vide” autour.
    // Mets 1 si tu vois du bleeding.
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

    rebuildScene();
    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");

    app.ticker.add(updateHighlight);

    window.addEventListener("resize", () => {
      // rebuild propre (layout en app.screen)
      rebuildScene();
    });

  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    showMessage("Erreur JS : chargement assets (" + (e?.message || String(e)) + ")");
  }
}

function rebuildScene() {
  if (!app) return;

  // garde le fond + tout recalcul
  app.stage.removeChildren();
  reels = [];
  highlightedSprites = [];
  highlightTimer = 0;
  paytableOverlay = null;

  buildSlotScene();
  buildHUD();
  updateHUDNumbers();
  updateHUDTexts("Appuyez sur SPIN pour lancer");
}

// --------------------------------------------------
// Construction scène slot
// --------------------------------------------------
function buildSlotScene() {
  // ✅ Point 2: utiliser app.screen (CSS pixels)
  const w = app.screen.width;
  const h = app.screen.height;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  const gap = 8;

  const symbolFromHeight = h * 0.16;
  const symbolFromWidth = (maxTotalWidth - gap * (COLS - 1)) / COLS;

  // arrondi pour éviter flou
  const symbolSize = Math.max(32, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

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

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = Math.round(c * (symbolSize + gap));

    const reel = { container: reelContainer, symbols: [] };

    for (let r = 0; r < ROWS; r++) {
      const idx = Math.floor(Math.random() * symbolTextures.length);
      const sprite = new PIXI.Sprite(symbolTextures[idx]);

      sprite.roundPixels = true;
      sprite.anchor.set(0.5);

      // IMPORTANT: width/height = symbolSize (ok si tes cases 256 sont bien “remplies”)
      sprite.width = symbolSize;
      sprite.height = symbolSize;

      sprite.x = Math.round(symbolSize / 2);
      sprite.y = Math.round(r * (symbolSize + gap) + symbolSize / 2);

      // visuel
      applySymbolFilters(sprite, idx);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
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
  btnSpin = makeButton("SPIN", buttonWidth, buttonHeight);
  btnPlus = makeButton("+1", buttonWidth, buttonHeight);

  btnSpin.x = w / 2;
  btnSpin.y = buttonsY;

  btnMinus.x = btnSpin.x - (buttonWidth + spacingX);
  btnMinus.y = buttonsY;

  btnPlus.x = btnSpin.x + (buttonWidth + spacingX);
  btnPlus.y = buttonsY;

  const infoWidth = buttonWidth * 0.9;
  const infoHeight = buttonHeight * 0.75;
  btnInfo = makeButton("INFO", infoWidth, infoHeight);
  btnInfo.x = w / 2;
  btnInfo.y = buttonsY + buttonHeight + h * 0.02;

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinClick);
  btnInfo.on("pointerup", togglePaytable);

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
// Paytable overlay
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
      fontSize: Math.round(h * 0.026),
      fill: 0xffffff,
      wordWrap: true,
      wordWrapWidth: panelWidth * 0.8,
      lineHeight: Math.round(h * 0.031),
    })
  );
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + marginY;
  container.addChild(body);

  const closeHeight = h * 0.06;
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
      fontSize: Math.round(h * 0.025),
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

      const sprite = reel.symbols[r];
      sprite.texture = getTextureByIndex(value);

      // ✅ Point 3: re-applique le glow selon l’ID
      applySymbolFilters(sprite, value);
    }
  }
}

function getTextureByIndex(index) {
  if (!symbolTextures.length) return PIXI.Texture.WHITE;
  const safeIndex = ((index % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
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
  highlightedSprites.forEach((s) => (s.alpha = 1));
  highlightedSprites = [];

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel || !reel.symbols[row]) return;
    highlightedSprites.push(reel.symbols[row]);
  });

  highlightTimer = 0;
}

function updateHighlight(delta) {
  if (!highlightedSprites.length) return;

  highlightTimer += delta;
  const alpha = Math.sin(highlightTimer * 0.25) > 0 ? 0.3 : 1.0;
  highlightedSprites.forEach((s) => (s.alpha = alpha));

  if (highlightTimer > 80) {
    highlightedSprites.forEach((s) => (s.alpha = 1));
    highlightedSprites = [];
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
  highlightedSprites.forEach((s) => (s.alpha = 1));
  highlightedSprites = [];

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

    applyResultToReels(grid);

    setTimeout(() => {
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
    }, 400);
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
    updateHUDTexts(freeSpins > 0 ? `Gain : ${win} — free spins : ${freeSpins}` : `Gain : ${win}`);

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