// --------------------------------------------------
// script.js – Slot mobile avec 5 lignes, paytable & layout responsive
// --------------------------------------------------

// DOM
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

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
  a.volume = 0.6;
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
// CONSTANTES JEU
// --------------------------------------------------
const COLS = 5;
const ROWS = 3;

// IDs des symboles dans le spritesheet
// 0 - 777 violet
// 1 - pastèque
// 2 - BAR
// 3 - pomme
// 4 - cartes
// 5 - couronne
// 6 - BONUS
// 7 - cerises
// 8 - pièce
// 9 - WILD
// 10 - citron
// 11 - 7 rouge

const WILD_ID = 9;
const BONUS_ID = 6;

// paytable : multiplicateurs par ID et par longueur de chaîne
const PAYTABLE = {
  // Fruits : pastèque, pomme, cerises, citron
  1: { 3: 2, 4: 3, 5: 4 },  // pastèque
  3: { 3: 2, 4: 3, 5: 4 },  // pomme
  7: { 3: 2, 4: 3, 5: 4 },  // cerises
  10: { 3: 2, 4: 3, 5: 4 }, // citron

  4: { 3: 3, 4: 4, 5: 5 },   // cartes
  8: { 3: 4, 4: 5, 5: 6 },   // pièce
  5: { 3: 10, 4: 12, 5: 14 }, // couronne
  2: { 3: 16, 4: 18, 5: 20 }, // BAR
  11: { 3: 20, 4: 25, 5: 30 }, // 7 rouge
  0: { 3: 30, 4: 40, 5: 50 },  // 777 violet
};

// 5 lignes : 3 horizontales + 2 diagonales (classique 5-lignes)
// ATTENTION : colonnes toujours dans l'ordre gauche → droite !
const PAYLINES = [
  // 0 : rangée du haut
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  // 1 : rangée du milieu
  [
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4],
  ],
  // 2 : rangée du bas
  [
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
  ],
  // 3 : diagonale en V (haut → bas → haut)
  [
    [0, 0],
    [1, 1],
    [2, 2],
    [1, 3],
    [0, 4],
  ],
  // 4 : diagonale en V inversé (bas → haut → bas)
  [
    [2, 0],
    [1, 1],
    [0, 2],
    [1, 3],
    [2, 4],
  ],
];

// --------------------------------------------------
// VARIABLES GLOBALes
// --------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

let freeSpins = 0;
let winMultiplier = 1;

// UI PIXI
let topText;
let slotContainer;
let frameGfx;
let hudBalanceText;
let hudBetText;
let hudLastWinText;
let btnMinus, btnPlus, btnSpin, btnInfo;

// paytable overlay
let infoOverlay;
let infoPanel;
let infoText;

// highlight
let highlightedSprites = [];
let highlightTicker = null;

// --------------------------------------------------
// HELPERS UI
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
// CHARGEMENT SPRITESHEET
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = "assets/spritesheet.png";

    img.onload = () => {
      try {
        const baseTexture = PIXI.BaseTexture.from(img);
        resolve(baseTexture);
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = (e) => {
      reject(e || new Error("Impossible de charger assets/spritesheet.png"));
    };
  });
}

// --------------------------------------------------
// INIT PIXI & SCÈNE
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

  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  showMessage("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();
    const fullW = baseTexture.width;
    const fullH = baseTexture.height;

    const COLS_SHEET = 3;
    const ROWS_SHEET = 4;
    const frameW = fullW / COLS_SHEET;
    const frameH = fullH / ROWS_SHEET;

    symbolTextures = [];
    for (let r = 0; r < ROWS_SHEET; r++) {
      for (let c = 0; c < COLS_SHEET; c++) {
        const rect = new PIXI.Rectangle(c * frameW, r * frameH, frameW, frameH);
        const tex = new PIXI.Texture(baseTexture, rect);
        symbolTextures.push(tex);
      }
    }

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildScene();
    layoutUI();
    hideMessage();
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

function buildScene() {
  // message du haut
  topText = new PIXI.Text("Appuyez sur SPIN pour lancer", {
    fontFamily: "system-ui",
    fontSize: 26,
    fill: 0xffffff,
  });
  topText.anchor.set(0.5, 0);
  app.stage.addChild(topText);

  // conteneur slot + cadre
  slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  frameGfx = new PIXI.Graphics();
  app.stage.addChild(frameGfx);

  // créer les symboles (5x3)
  reels = [];
  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);

    const reel = { container: reelContainer, symbols: [] };
    reels.push(reel);

    for (let r = 0; r < ROWS; r++) {
      const idx = Math.floor(Math.random() * symbolTextures.length);
      const sprite = new PIXI.Sprite(symbolTextures[idx]);
      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }
  }

  // HUD bas
  hudBalanceText = new PIXI.Text("", {
    fontFamily: "system-ui",
    fontSize: 20,
    fill: 0xffffff,
  });
  hudBetText = new PIXI.Text("", {
    fontFamily: "system-ui",
    fontSize: 20,
    fill: 0xffffff,
  });
  hudLastWinText = new PIXI.Text("", {
    fontFamily: "system-ui",
    fontSize: 20,
    fill: 0xffffff,
  });

  hudBalanceText.anchor.set(0, 0.5);
  hudBetText.anchor.set(0.5, 0.5);
  hudLastWinText.anchor.set(1, 0.5);

  app.stage.addChild(hudBalanceText, hudBetText, hudLastWinText);

  // boutons HUD
  btnMinus = createButton("-1", onMinusBet);
  btnSpin = createButton("SPIN", onSpinClick);
  btnPlus = createButton("+1", onPlusBet);
  btnInfo = createButton("INFO", onInfoClick);

  app.stage.addChild(btnMinus, btnSpin, btnPlus, btnInfo);

  // overlay paytable
  buildInfoOverlay();

  updateHudTexts();

  window.addEventListener("resize", () => {
    layoutUI();
  });
}

// bouton générique
function createButton(label, onClick) {
  const container = new PIXI.Container();
  const bg = new PIXI.Graphics();
  bg.lineStyle(3, 0xffc247, 1);
  bg.beginFill(0x12182a);
  bg.drawRoundedRect(0, 0, 140, 70, 18);
  bg.endFill();
  container.addChild(bg);

  const txt = new PIXI.Text(label, {
    fontFamily: "system-ui",
    fontSize: 26,
    fill: 0xffffff,
  });
  txt.anchor.set(0.5);
  txt.x = 70;
  txt.y = 35;
  container.addChild(txt);

  container.interactive = true;
  container.buttonMode = true;
  container.on("pointerdown", () => {
    onClick();
  });

  return container;
}

// overlay paytable
function buildInfoOverlay() {
  infoOverlay = new PIXI.Container();
  infoOverlay.visible = false;

  const bg = new PIXI.Graphics();
  bg.beginFill(0x000000, 0.6);
  bg.drawRect(0, 0, app.renderer.width, app.renderer.height);
  bg.endFill();
  infoOverlay.addChild(bg);

  infoPanel = new PIXI.Graphics();
  infoOverlay.addChild(infoPanel);

  infoText = new PIXI.Text("", {
    fontFamily: "system-ui",
    fontSize: 22,
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: app.renderer.width * 0.8,
    lineHeight: 28,
  });
  infoText.anchor.set(0.5, 0);
  infoOverlay.addChild(infoText);

  const btnClose = createButton("FERMER", () => {
    infoOverlay.visible = false;
  });
  infoOverlay.addChild(btnClose);
  infoOverlay.btnClose = btnClose;

  app.stage.addChild(infoOverlay);

  updateInfoOverlayLayout();
  fillPaytableText();
}

function updateInfoOverlayLayout() {
  if (!infoOverlay || !app) return;

  const w = app.renderer.screen.width;
  const h = app.renderer.screen.height;

  // BG semi-transparent
  const bg = infoOverlay.children[0];
  if (bg && bg.clear) {
    bg.clear();
    bg.beginFill(0x000000, 0.6);
    bg.drawRect(0, 0, w, h);
    bg.endFill();
  }

  // panel
  if (!infoPanel) {
    infoPanel = new PIXI.Graphics();
    infoOverlay.addChild(infoPanel);
  } else {
    infoPanel.clear();
  }

  const panelW = w * 0.9;
  const panelH = h * 0.7;
  const panelX = (w - panelW) / 2;
  const panelY = (h - panelH) / 2;

  infoPanel.lineStyle(4, 0xffc247, 1);
  infoPanel.beginFill(0x12182a);
  infoPanel.drawRoundedRect(panelX, panelY, panelW, panelH, 26);
  infoPanel.endFill();

  if (infoText) {
    infoText.x = w / 2;
    infoText.y = panelY + 24;
    infoText.style.wordWrapWidth = panelW - 40;
  }

  if (!infoOverlay.btnClose) return;
  const btnClose = infoOverlay.btnClose;
  btnClose.x = w / 2 - btnClose.width / 2;
  btnClose.y = panelY + panelH - btnClose.height - 20;
}

function fillPaytableText() {
  const txt =
    "Table des gains\n\n" +
    "Fruits (pastèque, pomme, cerises, citron) :\n" +
    "  3 symboles : 2× la mise\n" +
    "  4 symboles : 3× la mise\n" +
    "  5 symboles : 4× la mise\n\n" +
    "Cartes : 3× / 4× / 5× la mise\n" +
    "Pièce : 4× / 5× / 6× la mise\n" +
    "Couronne : 10× / 12× / 14× la mise\n" +
    "BAR : 16× / 18× / 20× la mise\n" +
    "7 rouge : 20× / 25× / 30× la mise\n" +
    "777 violet : 30× / 40× / 50× la mise\n\n" +
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ déclenchent 10 free spins (gains ×2)";

  infoText.text = txt;
}

// --------------------------------------------------
// LAYOUT RESPONSIVE (nouvelle version)
// --------------------------------------------------
function layoutUI() {
  if (!app || !slotContainer || !reels.length) return;

  const w = app.renderer.width;
  const h = app.renderer.height;

  // 1) Taille de symbole basée sur la plus petite dimension
  const shortestSide = Math.min(w, h);
  let symbolSize = shortestSide / 6;      // base
  symbolSize = Math.max(48, Math.min(symbolSize, 140)); // bornes min/max

  const reelGap = symbolSize * 0.08;
  const rowGap = symbolSize * 0.12;
  const reelWidth = symbolSize + reelGap;

  // 2) Taille totale des rouleaux
  const totalReelW = reelWidth * COLS - reelGap;
  const totalReelH = ROWS * (symbolSize + rowGap) - rowGap;

  // 3) Positionner les sprites dans chaque rouleau
  for (let c = 0; c < COLS; c++) {
    const reel = reels[c];
    reel.container.x = c * reelWidth;
    for (let r = 0; r < ROWS; r++) {
      const sprite = reel.symbols[r];
      sprite.width = symbolSize;
      sprite.height = symbolSize;
      sprite.x = 0;
      sprite.y = r * (symbolSize + rowGap);
    }
  }

  // 4) Centrage horizontal et placement vertical du cadre
  slotContainer.x = (w - totalReelW) / 2;

  const framePaddingX = symbolSize * 0.35;
  const framePaddingY = symbolSize * 0.35;
  const frameH = totalReelH + framePaddingY * 2;

  // On vise ~18% du haut pour le cadre
  let frameTop = h * 0.18;

  // Si le bas du cadre dépasse 70% de l'écran, on remonte un peu
  if (frameTop + frameH > h * 0.7) {
    frameTop = h * 0.7 - frameH;
  }
  if (frameTop < 60) frameTop = 60;

  slotContainer.y = frameTop + framePaddingY;

  frameGfx.clear();
  const frameX = slotContainer.x - framePaddingX;
  const frameY = frameTop;
  const frameW = totalReelW + framePaddingX * 2;
  frameGfx.lineStyle(8, 0xffc247, 1);
  frameGfx.drawRoundedRect(frameX, frameY, frameW, frameH, 28);

  // 5) Texte du haut
  topText.x = w / 2;
  topText.y = Math.max(20, frameY - symbolSize * 0.9);

  // 6) HUD juste sous le cadre
  const hudY = frameY + frameH + symbolSize * 0.4;
  hudBalanceText.x = 20;
  hudBetText.x = w / 2;
  hudLastWinText.x = w - 20;
  hudBalanceText.y = hudBetText.y = hudLastWinText.y = hudY;

  // 7) Boutons SPIN / -1 / +1
  const btnY = hudY + symbolSize * 0.8;
  const centerX = w / 2;

  btnSpin.x = centerX - btnSpin.width / 2;
  btnSpin.y = btnY;

  const spacing = 40;
  btnMinus.x = btnSpin.x - btnMinus.width - spacing;
  btnMinus.y = btnY;

  btnPlus.x = btnSpin.x + btnSpin.width + spacing;
  btnPlus.y = btnY;

  // 8) Bouton INFO en dessous, mais on s'assure qu'il reste dans l'écran
  let infoY = btnY + btnSpin.height + symbolSize * 0.3;
  if (infoY + btnInfo.height > h - 10) {
    infoY = h - btnInfo.height - 10;
  }
  btnInfo.x = centerX - btnInfo.width / 2;
  btnInfo.y = infoY;

  // 9) Recalage de l'overlay paytable
  updateInfoOverlayLayout();
}

// --------------------------------------------------
// APPLY GRID & HIGHLIGHT
// --------------------------------------------------
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length !== ROWS) return;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;
      const texture = getTextureByIndex(value);
      reel.symbols[r].texture = texture;
    }
  }
}

function getTextureByIndex(index) {
  if (!symbolTextures.length) return PIXI.Texture.WHITE;
  const safe =
    ((index % symbolTextures.length) + symbolTextures.length) %
    symbolTextures.length;
  return symbolTextures[safe] || symbolTextures[0];
}

// --------------------------------------------------
// ÉVALUATION DES LIGNES
// --------------------------------------------------
/**
 * Évalue toutes les lignes :
 * - gain uniquement si 3+ symboles identiques consécutifs depuis la colonne 0
 * - symboles payants : ceux définis dans PAYTABLE
 * - WILD (9) remplace n'importe lequel (sauf BONUS)
 * - BONUS (6) uniquement pour free spins
 */
function evaluateGrid(grid, currentBet) {
  let totalWin = 0;
  const winningLines = []; // { lineIndex, count }
  let bonusCount = 0;

  // compter les bonus pour le mode bonus
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  // pour chaque ligne
  for (let li = 0; li < PAYLINES.length; li++) {
    const coords = PAYLINES[li];

    // 1) Trouver la "base" (premier symbole non-WILD, non-BONUS de gauche à droite)
    let base = null;
    let invalid = false;

    for (let i = 0; i < coords.length; i++) {
      const [r, c] = coords[i];
      const sym = grid[r][c];

      if (sym === BONUS_ID) {
        // BONUS avant la base => ligne non payante
        invalid = true;
        break;
      }
      if (sym !== WILD_ID) {
        base = sym;
        break;
      }
    }

    if (invalid || base === null) continue;
    if (!PAYTABLE[base]) continue; // ni WILD, ni BONUS, ni symbole non-payant

    // 2) Compter les symboles consécutifs depuis la gauche
    let count = 0;
    for (let i = 0; i < coords.length; i++) {
      const [r, c] = coords[i];
      const sym = grid[r][c];

      if (sym === BONUS_ID) {
        break; // BONUS casse la ligne payante
      }
      if (sym === base || sym === WILD_ID) {
        count++;
      } else {
        break;
      }
    }

    if (count >= 3) {
      const table = PAYTABLE[base];
      const mult = table && table[count] ? table[count] : 0;
      if (mult > 0) {
        const lineWin = currentBet * mult;
        totalWin += lineWin;
        winningLines.push({ lineIndex: li, count });
      }
    }
  }

  const bonusTriggered = bonusCount >= 3;
  return { baseWin: totalWin, winningLines, bonusTriggered };
}

// --------------------------------------------------
// HIGHLIGHT DES LIGNES GAGNANTES
// --------------------------------------------------
function clearHighlights() {
  if (highlightTicker) {
    app.ticker.remove(highlightTicker);
    highlightTicker = null;
  }
  highlightedSprites.forEach((s) => {
    if (s) s.alpha = 1;
  });
  highlightedSprites = [];
}

function highlightWinningLines(winningLines) {
  clearHighlights();
  if (!winningLines || !winningLines.length) return;

  winningLines.forEach((info) => {
    const coords = PAYLINES[info.lineIndex];
    for (let i = 0; i < info.count; i++) {
      const [r, c] = coords[i];
      const reel = reels[c];
      if (reel && reel.symbols[r]) {
        highlightedSprites.push(reel.symbols[r]);
      }
    }
  });

  let t = 0;
  highlightTicker = (delta) => {
    t += delta;
    const phase = Math.floor(t / 6) % 2;
    const alpha = phase === 0 ? 1 : 0.25;
    highlightedSprites.forEach((s) => {
      if (s) s.alpha = alpha;
    });
  };
  app.ticker.add(highlightTicker);
}

// --------------------------------------------------
// HUD & MESSAGES
// --------------------------------------------------
function updateHudTexts() {
  hudBalanceText.text = `Solde : ${balance}`;
  hudBetText.text = `Mise : ${bet}`;
  hudLastWinText.text = `Dernier gain : ${lastWin}`;
}

function setTopMessage(text) {
  if (topText) topText.text = text;
}

// --------------------------------------------------
// BOUTONS
// --------------------------------------------------
function onMinusBet() {
  if (spinning) return;
  if (bet > 1) {
    bet--;
    updateHudTexts();
  }
}

function onPlusBet() {
  if (spinning) return;
  if (bet < 100) {
    bet++;
    updateHudTexts();
  }
}

function onInfoClick() {
  infoOverlay.visible = true;
}

// --------------------------------------------------
// SPIN
// --------------------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  // si on n'est plus en free spins, on remet le multiplicateur à 1
  if (freeSpins <= 0) {
    winMultiplier = 1;
  }

  spinning = true;
  clearHighlights();

  let effectiveBet = bet;
  let paidSpin = true;

  if (freeSpins > 0) {
    paidSpin = false;
    effectiveBet = bet;
    freeSpins--;
  } else {
    if (balance < bet) {
      setTopMessage("Solde insuffisant");
      spinning = false;
      return;
    }
    balance -= bet;
  }

  lastWin = 0;
  updateHudTexts();
  playSound("spin");
  setTopMessage(
    paidSpin ? "Bonne chance !" : `Free spin… restants : ${freeSpins}`
  );

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet: effectiveBet }),
    });
    const data = await response.json();
    const grid = data.result || data.grid || data;

    applyResultToReels(grid);

    // on évalue nous-mêmes la grille
    const evalRes = evaluateGrid(grid, effectiveBet);
    let totalWin = evalRes.baseWin;

    // gestion bonus
    let bonusTriggered = false;
    if (evalRes.bonusTriggered) {
      freeSpins += 10;
      winMultiplier = 2;
      bonusTriggered = true;
    }

    if (winMultiplier > 1) {
      totalWin *= winMultiplier;
    }

    lastWin = totalWin;
    balance += totalWin;

    highlightWinningLines(evalRes.winningLines);
    finishSpin(totalWin, bonusTriggered);
  } catch (err) {
    console.error("Erreur API /spin", err);
    showMessage("Erreur JS : API");
    spinning = false;
    playSound("stop");
  }
}

function finishSpin(winAmount, bonusTriggered) {
  spinning = false;
  updateHudTexts();

  if (bonusTriggered) {
    playSound("bonus");
    setTopMessage("BONUS ! +10 free spins (gains ×2)");
    return;
  }

  if (winAmount > 0) {
    playSound("win");
    if (freeSpins > 0) {
      setTopMessage(`Gain : ${winAmount} — free spins : ${freeSpins}`);
    } else {
      setTopMessage(`Gain : ${winAmount}`);
    }
  } else {
    playSound("stop");
    if (freeSpins > 0) {
      setTopMessage(`Pas de gain — free spins : ${freeSpins}`);
    } else {
      setTopMessage("Pas de gain — appuyez sur SPIN pour relancer");
    }
  }
}

// --------------------------------------------------
// DÉMARRAGE
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});