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
// mapping :
// 0 = cerise
// 1 = pastèque
// 2 = pomme
// 3 = citron
// 4 = symboles carte
// 5 = pièce
// 6 = couronne
// 7 = bar
// 8 = sept
// 9 = triple sept
// 10 = wild
// 11 = bonus
const PAYTABLE = {
  0: { 3: 2, 4: 3, 5: 4 },    // cerise
  1: { 3: 2, 4: 3, 5: 4 },    // pastèque
  2: { 3: 2, 4: 3, 5: 4 },    // pomme
  3: { 3: 2, 4: 3, 5: 4 },    // citron
  4: { 3: 3, 4: 4, 5: 5 },    // cartes
  5: { 3: 4, 4: 5, 5: 6 },    // pièce
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
// VARIABLES GLOBALES
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

  // taille symboles
  const symbolSize = Math.min(w * 0.16, h * 0.16);
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

/**
 * Évalue toutes les lignes :
 * - On cherche la meilleure chaîne de 3, 4 ou 5 symboles consécutifs
 *   sur chaque ligne (peut commencer n'importe où).
 * - symboles payants : IDs 0..9
 * - WILD (10) remplace n'importe lequel (sauf BONUS)
 * - BONUS (11) ne paye pas mais sert pour déclencher le mode bonus.
 */
function evaluateGrid(grid, currentBet) {
  let totalWin = 0;
  const winningLines = []; // { lineIndex, count, startIndex }
  let bonusCount = 0;

  // compter les bonus pour le mode bonus
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === 11) bonusCount++;
    }
  }

  // pour chaque ligne de PAYLINES
  for (let li = 0; li < PAYLINES.length; li++) {
    const coords = PAYLINES[li];

    let bestWinForLine = 0;
    let bestCount = 0;
    let bestStartIndex = 0;

    // on teste tous les points de départ possibles (0,1,2)
    for (let start = 0; start <= coords.length - 3; start++) {
      let base = null; // symbole de base (0..9)
      let count = 0;
      let valid = true;

      for (let i = start; i < coords.length; i++) {
        const [r, c] = coords[i];
        const sym = grid[r][c];

        if (sym === 11) {
          // BONUS coupe la chaîne
          break;
        }

        if (base === null) {
          // pas encore de symbole de base
          if (sym === 10) {
            // WILD avant d'avoir le symbole, on le compte
            count++;
            continue;
          } else {
            // premier symbole non-wild, non-bonus
            if (sym < 0 || sym > 9) {
              valid = false;
              break;
            }
            base = sym;
            count++;
            continue;
          }
        } else {
          // base déjà défini
          if (sym === base || sym === 10) {
            count++;
          } else {
            break;
          }
        }
      } // fin boucle i

      if (!valid) continue;
      if (base === null) continue; // que des wilds / bonus, pas de symbole réel

      if (count >= 3) {
        const table = PAYTABLE[base];
        const mult = table && table[count] ? table[count] : 0;
        const win = mult * currentBet;
        if (win > bestWinForLine) {
          bestWinForLine = win;
          bestCount = count;
          bestStartIndex = start;
        }
      }
    } // fin boucle start

    if (bestWinForLine > 0) {
      totalWin += bestWinForLine;
      winningLines.push({
        lineIndex: li,
        count: bestCount,
        startIndex: bestStartIndex,
      });
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
    const start = info.startIndex || 0;
    const end = Math.min(start + info.count, coords.length);
    for (let i = start; i < end; i++) {
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

  let effectiveBet = bet;
  let paidSpin = true;
  let wasFreeSpin = false;

  if (freeSpins > 0) {
    // spin gratuit
    paidSpin = false;
    wasFreeSpin = true;
    effectiveBet = bet;
    freeSpins--; // on consomme un free spin
  } else {
    // spin normal
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
    wasFreeSpin
      ? `Free spin… restants : ${freeSpins}`
      : "Bonne chance !"
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

    // multiplicateur : x2 uniquement quand le spin est gratuit
    const spinMultiplier = wasFreeSpin ? 2 : 1;
    let totalWin = evalRes.baseWin * spinMultiplier;

    // gestion bonus (3+ bonus n'importe où)
    if (evalRes.bonusTriggered) {
      freeSpins += 10;
    }

    lastWin = totalWin;
    balance += totalWin;

    highlightWinningLines(evalRes.winningLines);
    finishSpin(totalWin, evalRes.bonusTriggered, wasFreeSpin);
  } catch (err) {
    console.error("Erreur API /spin", err);
    showMessage("Erreur JS : API");
    spinning = false;
    playSound("stop");
  }
}

function finishSpin(winAmount, bonusTriggered, wasFreeSpin) {
  spinning = false;
  updateHudTexts();

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

  if (bonusTriggered) {
    playSound("bonus");
    setTopMessage("BONUS ! +10 free spins (gains ×2)");
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