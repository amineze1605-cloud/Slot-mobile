// --------------------------------------------------
// script.js – Slot mobile avec 5 lignes et paytable
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

// paytable : multiplicateurs par ID et par longueur de chaîne
const PAYTABLE = {
  0: { 3: 2, 4: 3, 5: 4 },   // cerise
  1: { 3: 2, 4: 3, 5: 4 },   // pastèque
  2: { 3: 2, 4: 3, 5: 4 },   // pomme
  3: { 3: 2, 4: 3, 5: 4 },   // citron
  4: { 3: 3, 4: 4, 5: 5 },   // cartes
  5: { 3: 4, 4: 5, 5: 6 },   // pièce
  6: { 3: 10, 4: 12, 5: 14 }, // couronne
  7: { 3: 16, 4: 18, 5: 20 }, // BAR
  8: { 3: 20, 4: 25, 5: 30 }, // 7
  9: { 3: 30, 4: 40, 5: 50 }, // 777
};

// 5 lignes : 3 horizontales + 2 diagonales (classique 5-lignes)
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
  const w = app.renderer.width;
  const h = app.renderer.height;

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
  if (!infoOverlay) return;

  infoOverlay.removeChildren(1); // garde le bg, on reconstruit panel + textes + bouton
  const bg = infoOverlay.children[0];

  bg.clear();
  bg.beginFill(0x000000, 0.6);
  bg.drawRect(0, 0, app.renderer.width, app.renderer.height);
  bg.endFill();

  infoPanel = new PIXI.Graphics();
  infoOverlay.addChild(infoPanel);

  const panelW = app.renderer.width * 0.9;
  const panelH = app.renderer.height * 0.7;
  const panelX = (app.renderer.width - panelW) / 2;
  const panelY = (app.renderer.height - panelH) / 2;

  infoPanel.lineStyle(4, 0xffc247, 1);
  infoPanel.beginFill(0x12182a);
  infoPanel.drawRoundedRect(panelX, panelY, panelW, panelH, 26);
  infoPanel.endFill();

  infoText.anchor.set(0.5, 0);
  infoText.x = app.renderer.width / 2;
  infoText.y = panelY + 24;
  infoText.style.wordWrapWidth = panelW - 40;
  infoOverlay.addChild(infoText);

  const btnClose = createButton("FERMER", () => {
    infoOverlay.visible = false;
  });
  btnClose.x = app.renderer.width / 2 - 70;
  btnClose.y = panelY + panelH - 90;
  infoOverlay.addChild(btnClose);
  infoOverlay.btnClose = btnClose;
}

function fillPaytableText() {
  const txt =
    "Table des gains\n\n" +
    "0–3 : 2× | 4 : 3× | 5 : 4×\n" +
    "4 (cartes) : 3× / 4× / 5×\n" +
    "5 (pièce) : 4× / 5× / 6×\n" +
    "6 (couronne) : 10× / 12× / 14×\n" +
    "7 (BAR) : 16× / 18× / 20×\n" +
    "8 (7) : 20× / 25× / 30×\n" +
    "9 (777) : 30× / 40× / 50×\n\n" +
    "10 (WILD) : remplace tout sauf BONUS\n" +
    "11 (BONUS) : 3+ = 10 free spins, gains ×2";

  infoText.text = txt;
}

// --------------------------------------------------
// LAYOUT
// --------------------------------------------------
function layoutUI() {
  if (!app || !slotContainer || !reels.length) return;

  const w = app.renderer.width;
  const h = app.renderer.height;

  // taille symboles (un peu plus petit pour tout faire rentrer)
  const symbolSize = Math.min(w * 0.14, h * 0.14);
  const reelGap = symbolSize * 0.08;
  const rowGap = symbolSize * 0.12;
  const reelWidth = symbolSize + reelGap;

  // position des symboles
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

  const totalReelW = reelWidth * COLS;
  const totalReelH = ROWS * (symbolSize + rowGap) - rowGap;

  slotContainer.x = (w - totalReelW) / 2;
  slotContainer.y = h * 0.25;

  // cadre autour
  frameGfx.clear();
  const padX = symbolSize * 0.35;
  const padY = symbolSize * 0.35;
  const frameX = slotContainer.x - padX;
  const frameY = slotContainer.y - padY;
  const frameW = totalReelW + padX * 2;
  const frameH = totalReelH + padY * 2;

  frameGfx.lineStyle(8, 0xffc247, 1);
  frameGfx.drawRoundedRect(frameX, frameY, frameW, frameH, 28);

  // message haut
  topText.x = w / 2;
  topText.y = Math.max(10, frameY - 70);

  // redimension du texte en fonction de la hauteur
  const hudFontSize = Math.round(h * 0.028);
  const topFontSize = Math.round(h * 0.032);
  hudBalanceText.style.fontSize = hudFontSize;
  hudBetText.style.fontSize = hudFontSize;
  hudLastWinText.style.fontSize = hudFontSize;
  topText.style.fontSize = topFontSize;

  [btnMinus, btnSpin, btnPlus, btnInfo].forEach((btn) => {
    const txt = btn.children[1];
    if (txt && txt.style) {
      txt.style.fontSize = Math.round(h * 0.03);
    }
  });

  if (infoText && infoText.style) {
    infoText.style.fontSize = Math.round(h * 0.028);
    infoText.style.lineHeight = Math.round(h * 0.034);
  }

  // HUD bas
  const hudY = frameY + frameH + 40;
  hudBalanceText.x = 20;
  hudBetText.x = w / 2;
  hudLastWinText.x = w - 20;
  hudBalanceText.y = hudBetText.y = hudLastWinText.y = hudY;

  // boutons
  const btnY = hudY + 70;
  const centerX = w / 2;

  btnSpin.x = centerX - btnSpin.width / 2;
  btnSpin.y = btnY;

  const spacing = 40;
  btnMinus.x = btnSpin.x - btnMinus.width - spacing;
  btnMinus.y = btnY;

  btnPlus.x = btnSpin.x + btnSpin.width + spacing;
  btnPlus.y = btnY;

  btnInfo.x = centerX - btnInfo.width / 2;
  btnInfo.y = btnY + btnInfo.height + 20;

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

// Évalue une seule ligne 5 symboles
// - baseSymbol = premier symbole 0..9 (non wild, non bonus)
// - wild (10) peut remplacer baseSymbol
// - bonus (11) coupe la ligne
function evaluateLine(symbolsOnLine) {
  let count = 0;
  let baseSymbol = null;
  let usedPositions = [];

  for (let i = 0; i < symbolsOnLine.length; i++) {
    const s = symbolsOnLine[i];

    // BONUS coupe la ligne
    if (s === 11) break;

    if (baseSymbol === null) {
      if (s === 10) {
        // wild avant un symbole réel : on compte mais
        // on fixera la base dès qu'on voit 0..9
        count++;
        usedPositions.push(i);
        continue;
      }
      if (s >= 0 && s <= 9) {
        baseSymbol = s;
        count++;
        usedPositions.push(i);
      } else {
        break;
      }
    } else {
      if (s === baseSymbol || s === 10) {
        count++;
        usedPositions.push(i);
      } else {
        break;
      }
    }
  }

  if (baseSymbol === null || count < 3) return null;
  const table = PAYTABLE[baseSymbol];
  if (!table) return null;
  const mult = table[count] || 0;
  if (mult <= 0) return null;

  return {
    symbol: baseSymbol,
    count,
    multiplier: mult,
    usedPositions,
  };
}

/**
 * Évalue toute la grille :
 * - 5 lignes (PAYLINES)
 * - wild (10) remplace tout sauf bonus
 * - bonus (11) : 3+ = 10 free spins ; ne paie pas en ligne
 * - spinMultiplier = 1 en jeu normal, 2 pendant free spins
 */
function evaluateGrid(grid, currentBet, spinMultiplier = 1) {
  let totalWin = 0;
  const winningLines = [];
  let bonusCount = 0;

  // compter les bonus
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === 11) bonusCount++;
    }
  }

  const bonusFreeSpins = bonusCount >= 3 ? 10 : 0;

  // chaque ligne
  PAYLINES.forEach((coords, lineIndex) => {
    const symbols = coords.map(([r, c]) => grid[r][c]);
    const res = evaluateLine(symbols);
    if (!res) return;

    const lineWin = currentBet * res.multiplier * spinMultiplier;
    totalWin += lineWin;

    const winningCells = res.usedPositions.map(
      (posIndex) => coords[posIndex]
    );

    winningLines.push({
      lineIndex,
      lineWin,
      symbol: res.symbol,
      count: res.count,
      cells: winningCells,
    });
  });

  return { totalWin, winningLines, bonusFreeSpins };
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
    if (!info.cells) return;
    info.cells.forEach(([r, c]) => {
      const reel = reels[c];
      if (reel && reel.symbols[r]) {
        highlightedSprites.push(reel.symbols[r]);
      }
    });
  });

  let t = 0;
  highlightTicker = (delta) => {
    t += delta;
    const phase = Math.floor(t / 6) % 2; // clignote doucement
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

  spinning = true;
  clearHighlights();

  const wasFreeSpin = freeSpins > 0;
  let effectiveBet = bet;
  let paidSpin = !wasFreeSpin;

  if (wasFreeSpin) {
    freeSpins--; // on consomme un free spin
  } else {
    if (balance < bet) {
      setTopMessage("Solde insuffisant");
      spinning = false;
      return;
    }
    balance -= bet;
  }

  const spinMultiplier = wasFreeSpin ? 2 : 1;

  lastWin = 0;
  updateHudTexts();
  playSound("spin");
  if (wasFreeSpin) {
    setTopMessage(`Free spins : ${freeSpins}`);
  } else {
    setTopMessage("Bonne chance !");
  }

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet: effectiveBet }),
    });
    const data = await response.json();
    const grid = data.result || data.grid || data;

    applyResultToReels(grid);

    // évaluation de la grille (avec multiplicateur)
    const evalRes = evaluateGrid(grid, effectiveBet, spinMultiplier);
    const totalWin = evalRes.totalWin;

    lastWin = totalWin;
    balance += totalWin;

    if (evalRes.bonusFreeSpins > 0) {
      freeSpins += evalRes.bonusFreeSpins;
    }

    highlightWinningLines(evalRes.winningLines);
    finishSpin(totalWin, evalRes.bonusFreeSpins);
  } catch (err) {
    console.error("Erreur API /spin", err);
    showMessage("Erreur JS : API");
    spinning = false;
    playSound("stop");
  }
}

function finishSpin(winAmount, bonusFreeSpins) {
  spinning = false;
  updateHudTexts();

  let message = "";

  if (winAmount > 0) {
    playSound("win");
    if (freeSpins > 0) {
      message = `Gain : ${winAmount} — free spins : ${freeSpins}`;
    } else {
      message = `Gain : ${winAmount}`;
    }
  } else {
    playSound("stop");
    if (freeSpins > 0) {
      message = `Pas de gain — free spins : ${freeSpins}`;
    } else {
      message = "Pas de gain — touchez SPIN";
    }
  }

  if (bonusFreeSpins > 0) {
    playSound("bonus");
    message = `BONUS ! +${bonusFreeSpins} free spins (gains ×2)`;
  }

  setTopMessage(message);
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