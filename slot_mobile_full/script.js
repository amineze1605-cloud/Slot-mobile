// script.js
// Slot mobile PIXI v5 – 5x3, 5 lignes, paytable + bouton INFO sous SPIN

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

// état jeu
let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// HUD
let messageText;
let statsText;
let btnMinus, btnPlus, btnSpin, btnInfo;
let paytableOverlay = null;

// pour le clignotement des lignes gagnantes
let highlightedSprites = [];
let highlightTimer = 0;

// audio
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

// indices [col, row]
const PAYLINES = [
  // 0 : ligne du haut
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ],
  // 1 : milieu
  [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
  ],
  // 2 : bas
  [
    [0, 2],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
  ],
  // 3 : diagonale ↘
  [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 1],
    [4, 0],
  ],
  // 4 : diagonale ↗
  [
    [0, 2],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 2],
  ],
];

// multiplicateurs : { 3: x, 4: x, 5: x }
const PAYTABLE = {
  0: { 3: 2, 4: 3, 5: 4 }, // cerise
  1: { 3: 2, 4: 3, 5: 4 }, // pastèque
  2: { 3: 2, 4: 3, 5: 4 }, // pomme
  3: { 3: 2, 4: 3, 5: 4 }, // citron
  4: { 3: 3, 4: 4, 5: 5 }, // cartes
  5: { 3: 4, 4: 5, 5: 6 }, // pièce
  6: { 3: 10, 4: 12, 5: 14 }, // couronne
  7: { 3: 16, 4: 18, 5: 20 }, // BAR
  8: { 3: 20, 4: 25, 5: 30 }, // 7
  9: { 3: 30, 4: 40, 5: 50 }, // 777
  // 10 = wild, pas de paytable directe
  // 11 = bonus, géré à part
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
// Chargement spritesheet.png (manuel)
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

    // 3 colonnes x 4 lignes => 12 symboles
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

    buildSlotScene();
    buildHUD();
    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");

    // ticker pour faire clignoter
    app.ticker.add(updateHighlight);

  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  // margin top pour laisser la place au texte
  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.22;

  // cadre
  const framePaddingX = 18;
  const framePaddingY = 18;
  const frame = new PIXI.Graphics();
  frame.lineStyle(6, 0xf2b632, 1);
  frame.beginFill(0x060b1a, 0.9);
  frame.drawRoundedRect(
    slotContainer.x - framePaddingX,
    slotContainer.y - framePaddingY,
    totalReelWidth + framePaddingX * 2,
    ROWS * (symbolSize + 8) - 8 + framePaddingY * 2,
    26
  );
  frame.endFill();
  app.stage.addChildAt(frame, 0);

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = c * reelWidth;

    const reel = {
      container: reelContainer,
      symbols: [],
    };

    for (let r = 0; r < ROWS; r++) {
      const idx = Math.floor(Math.random() * symbolTextures.length);
      const texture = symbolTextures[idx];
      const sprite = new PIXI.Sprite(texture);

      sprite.width = symbolSize;
      sprite.height = symbolSize;
      sprite.x = 0;
      sprite.y = r * (symbolSize + 8);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }
}

// --------------------------------------------------
// HUD + boutons (INFO sous SPIN)
// --------------------------------------------------
function makeText(txt, size, y, alignCenter = true) {
  const style = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: size,
    fill: 0xffffff,
  });
  const t = new PIXI.Text(txt, style);
  if (alignCenter) {
    t.anchor.set(0.5, 0.5);
    t.x = app.renderer.width / 2;
  } else {
    t.anchor.set(0, 0.5);
    t.x = app.renderer.width * 0.05;
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

  // simple feedback tactile
  container.on("pointerdown", () => {
    g.alpha = 0.7;
  });
  container.on("pointerup", () => {
    g.alpha = 1.0;
  });
  container.on("pointerupoutside", () => {
    g.alpha = 1.0;
  });

  app.stage.addChild(container);
  return container;
}

function buildHUD() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // texte du haut
  messageText = makeText("Appuyez sur SPIN pour lancer", Math.round(h * 0.035), h * 0.10);

  // texte du bas (stats solde/mise/gain)
  statsText = makeText("", Math.round(h * 0.028), h * 0.72);
  statsText.anchor.set(0.5, 0.5);

  const buttonWidth = w * 0.26;
  const buttonHeight = h * 0.07;
  const spacingX = w * 0.06;

  const buttonsY = h * 0.82;

  // -1 / SPIN / +1
  btnMinus = makeButton("-1", buttonWidth, buttonHeight);
  btnSpin = makeButton("SPIN", buttonWidth, buttonHeight);
  btnPlus = makeButton("+1", buttonWidth, buttonHeight);

  btnSpin.x = w / 2;
  btnSpin.y = buttonsY;

  btnMinus.x = btnSpin.x - (buttonWidth + spacingX);
  btnMinus.y = buttonsY;

  btnPlus.x = btnSpin.x + (buttonWidth + spacingX);
  btnPlus.y = buttonsY;

  // bouton INFO — NOUVELLE POSITION : sous SPIN
  const infoWidth = buttonWidth * 0.9;
  const infoHeight = buttonHeight * 0.75;
  btnInfo = makeButton("INFO", infoWidth, infoHeight);
  btnInfo.x = w / 2;
  btnInfo.y = buttonsY + buttonHeight + h * 0.02; // sous SPIN

  // callbacks
  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinClick);
  btnInfo.on("pointerup", togglePaytable);

  updateHUDNumbers();
}

function updateHUDTexts(msg) {
  if (messageText) {
    messageText.text = msg;
  }
}

function updateHUDNumbers() {
  if (!statsText) return;
  statsText.text = `Solde : ${balance}   Mise : ${bet}   Dernier gain : ${lastWin}`;
}

// --------------------------------------------------
// Paytable overlay (centré, bonne taille)
// --------------------------------------------------
function createPaytableOverlay() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const container = new PIXI.Container();
  container.visible = false;
  container.interactive = true; // capte les clics
  container.buttonMode = false;

  // fond semi-transparent plein écran
  const backdrop = new PIXI.Graphics();
  backdrop.beginFill(0x000000, 0.75);
  backdrop.drawRect(0, 0, w, h);
  backdrop.endFill();
  backdrop.interactive = true;
  backdrop.on("pointerup", () => togglePaytable(false));
  container.addChild(backdrop);

  // panneau centré
  const panelWidth = w * 0.86;
  const panelHeight = h * 0.62;
  const panelX = (w - panelWidth) / 2;
  const panelY = (h - panelHeight) / 2;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x111827);
  panel.lineStyle(6, 0xf2b632, 1);
  panel.drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 24);
  panel.endFill();
  container.addChild(panel);

  const styleTitle = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.035),
    fill: 0xffffff,
  });
  const title = new PIXI.Text("Table des gains", styleTitle);
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = panelY + h * 0.02;
  container.addChild(title);

  const styleBody = new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.026),
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: panelWidth * 0.8,
    lineHeight: Math.round(h * 0.031),
  });

  const bodyText =
    "0–3 : 2× | 4 : 3× | 5 : 4×\n" +
    "4 (cartes) : 3× / 4× / 5×\n" +
    "5 (pièce) : 4× / 5× / 6×\n" +
    "6 (couronne) : 10× / 12× / 14×\n" +
    "7 (BAR) : 16× / 18× / 20×\n" +
    "8 (7) : 20× / 25× / 30×\n" +
    "9 (777) : 30× / 40× / 50×\n" +
    "10 (WILD) : remplace tout sauf BONUS\n" +
    "11 (BONUS) : 3+ = gains ×2";

  const body = new PIXI.Text(bodyText, styleBody);
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + h * 0.02;
  container.addChild(body);

  app.stage.addChild(container);
  return container;
}

function togglePaytable(forceVisible) {
  if (!paytableOverlay) {
    paytableOverlay = createPaytableOverlay();
  }
  if (typeof forceVisible === "boolean") {
    paytableOverlay.visible = forceVisible;
  } else {
    paytableOverlay.visible = !paytableOverlay.visible;
  }
}

// --------------------------------------------------
// Application de la grille reçue du backend
// --------------------------------------------------
function applyResultToReels(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c]; // grid[row][col]
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;
      const texture = getTextureByIndex(value);
      reel.symbols[r].texture = texture;
    }
  }
}

function getTextureByIndex(index) {
  if (!symbolTextures.length) {
    return PIXI.Texture.WHITE;
  }
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Evaluation des gains (5 lignes + wild + bonus)
// --------------------------------------------------
function evaluateGrid(grid, betValue) {
  let totalWin = 0;
  const winningLines = []; // { lineIndex, cells, symbolId, count }
  let bonusCount = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === 11) bonusCount++;
    }
  }

  PAYLINES.forEach((line, lineIndex) => {
    const symbols = line.map(([col, row]) => grid[row][col]);

    // symbole de base = premier non-wild
    let baseSymbol = symbols.find((id) => id !== 10);
    if (baseSymbol === undefined) {
      // que des wilds -> on prend le symbole le plus cher (777)
      baseSymbol = 9;
    }

    // compte de gauche à droite
    let matchCount = 0;
    const matchedCells = [];
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      if (s === baseSymbol || s === 10) {
        matchCount++;
        matchedCells.push(line[i]); // [col, row]
      } else {
        break;
      }
    }

    if (matchCount >= 3 && PAYTABLE[baseSymbol]) {
      const mult = PAYTABLE[baseSymbol][matchCount] || 0;
      if (mult > 0) {
        const lineWin = betValue * mult;
        totalWin += lineWin;
        winningLines.push({
          lineIndex,
          cells: matchedCells,
          symbolId: baseSymbol,
          count: matchCount,
          amount: lineWin,
        });
      }
    }
  });

  // BONUS : 3+ symboles 11 -> gains x2
  const bonus = { freeSpins: 0, multiplier: 1 };
  if (bonusCount >= 3) {
    bonus.multiplier = 2;
    bonus.freeSpins = 10; // (info, on ne gère pas encore les free spins)
    totalWin *= 2;
  }

  return { win: totalWin, winningLines, bonus };
}

// --------------------------------------------------
// Highlight des lignes gagnantes
// --------------------------------------------------
function startHighlight(cells) {
  // reset précédent
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

  const t = highlightTimer;
  const phase = Math.sin(t * 0.25);
  const alpha = phase > 0 ? 0.3 : 1.0;
  highlightedSprites.forEach((s) => {
    s.alpha = alpha;
  });

  if (highlightTimer > 80) {
    highlightedSprites.forEach((s) => (s.alpha = 1));
    highlightedSprites = [];
    highlightTimer = 0;
  }
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  if (balance < bet) {
    updateHUDTexts("Solde insuffisant");
    return;
  }

  spinning = true;
  lastWin = 0;
  balance -= bet;
  updateHUDNumbers();
  updateHUDTexts("Spin en cours…");
  playSound("spin");

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet }),
    });

    const data = await response.json();
    const grid = data.result || [];

    // appli visuelle
    applyResultToReels(grid);

    // on laisse « rouler » un peu avant le résultat
    setTimeout(() => {
      const { win, winningLines, bonus } = evaluateGrid(grid, bet);
      finishSpin(win, winningLines, bonus);
    }, 400);
  } catch (err) {
    console.error("Erreur API /spin", err);
    updateHUDTexts("Erreur API");
    spinning = false;
    playSound("stop");
  }
}

function finishSpin(win, winningLines, bonus) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;

  if (lastWin > 0) {
    playSound("win");
    updateHUDTexts(`Gain : ${lastWin}`);
    // on fait clignoter toutes les cases des lignes gagnantes
    const cells = [];
    winningLines.forEach((line) => {
      line.cells.forEach((c) => cells.push(c));
    });
    if (cells.length) startHighlight(cells);
  } else {
    playSound("stop");
    updateHUDTexts("Pas de gain — appuyez sur SPIN pour relancer");
  }

  if (bonus && bonus.multiplier > 1) {
    playSound("bonus");
    updateHUDTexts(`Bonus x${bonus.multiplier} – appuyez sur SPIN pour relancer`);
  }

  updateHUDNumbers();
}

// --------------------------------------------------
// Boutons mise
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
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});