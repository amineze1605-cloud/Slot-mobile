// script.js – Slot mobile avec 5 lignes, paytable, bouton INFO
// et layout qui tient sur l’écran

// -------------------------------------
// Références DOM
// -------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// -------------------------------------
// Audio (MP3)
// -------------------------------------
const sounds = {
  spin: new Audio("assets/audio/spin.mp3"),
  stop: new Audio("assets/audio/stop.mp3"),
  win: new Audio("assets/audio/win.mp3"),
  bonus: new Audio("assets/audio/bonus.mp3"),
};

Object.values(sounds).forEach((a) => {
  if (!a) return;
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

// -------------------------------------
// PIXI + état du jeu
// -------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

let freeSpins = 0;
let winMultiplier = 1;

// éléments UI
let messageLabel;
let infoButton;
let balanceText;
let betText;
let lastWinText;
let spinButton;
let minusButton;
let plusButton;

// conteneurs
let slotContainer;
let uiContainer;

// tailles calculées
let symbolSize = 100;
let reelGap = 8;
let framePadding = 16;

// -------------------------------------
// Lignes & Paytable
// -------------------------------------
const WILD = 10;
const BONUS = 11;

const LINES = [
  // 0 : top
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  // 1 : middle
  [
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4],
  ],
  // 2 : bottom
  [
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [2, 4],
  ],
  // 3 : diagonale bas -> haut
  [
    [2, 0],
    [1, 1],
    [0, 2],
    [1, 3],
    [2, 4],
  ],
  // 4 : diagonale haut -> bas
  [
    [0, 0],
    [1, 1],
    [2, 2],
    [1, 3],
    [0, 4],
  ],
];

// paytable[indexSymbole][nbSymbolesAlignés]
const paytable = {
  0: { 3: 2, 4: 3, 5: 4 },
  1: { 3: 2, 4: 3, 5: 4 },
  2: { 3: 2, 4: 3, 5: 4 },
  3: { 3: 2, 4: 3, 5: 4 },
  4: { 3: 3, 4: 4, 5: 5 },
  5: { 3: 4, 4: 5, 5: 6 },
  6: { 3: 10, 4: 12, 5: 14 },
  7: { 3: 16, 4: 18, 5: 20 },
  8: { 3: 20, 4: 25, 5: 30 },
  9: { 3: 30, 4: 40, 5: 50 },
};

// -------------------------------------
// Helpers UI
// -------------------------------------
function showMessage(text) {
  if (!loaderEl) return;
  loaderEl.style.display = "flex";
  loaderEl.textContent = text;
}

function hideMessage() {
  if (!loaderEl) return;
  loaderEl.style.display = "none";
}

function updateHud() {
  if (balanceText) balanceText.text = `Solde : ${balance}`;
  if (betText) betText.text = `Mise : ${bet}`;
  if (lastWinText) lastWinText.text = `Dernier gain : ${lastWin}`;
}

// -------------------------------------
// Chargement spritesheet.png
// -------------------------------------
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
    img.onerror = (e) =>
      reject(e || new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// -------------------------------------
// Création PIXI
// -------------------------------------
async function initPixi() {
  if (!canvas) {
    console.error("Canvas #game introuvable");
    return;
  }
  if (!window.PIXI) {
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
        const rect = new PIXI.Rectangle(
          c * frameW,
          r * frameH,
          frameW,
          frameH
        );
        const tex = new PIXI.Texture(baseTexture, rect);
        symbolTextures.push(tex);
      }
    }

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildScene();
    hideMessage();
    messageLabel.text = "Appuyez sur SPIN pour lancer";
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// -------------------------------------
// Construction de la scène complète
// -------------------------------------
function buildScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  app.stage.removeChildren();

  // conteneurs
  slotContainer = new PIXI.Container();
  uiContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);
  app.stage.addChild(uiContainer);

  // calcul tailles : la grille occupe ~40% de la hauteur
  const maxGridHeight = h * 0.4;
  const maxGridWidth = w * 0.9;

  reelGap = h * 0.008;
  framePadding = h * 0.02;

  const symbolSizeByHeight =
    (maxGridHeight - framePadding * 2 - reelGap * (ROWS - 1)) / ROWS;
  const symbolSizeByWidth =
    (maxGridWidth - framePadding * 2 - reelGap * (COLS - 1)) / COLS;

  symbolSize = Math.floor(
    Math.min(symbolSizeByHeight, symbolSizeByWidth, h * 0.14)
  );

  const gridWidth =
    COLS * symbolSize + (COLS - 1) * reelGap + framePadding * 2;
  const gridHeight =
    ROWS * symbolSize + (ROWS - 1) * reelGap + framePadding * 2;

  // ------------------ Texte du haut + bouton INFO
  const topFontSize = Math.round(h * 0.033);

  messageLabel = new PIXI.Text("…", {
    fontFamily: "system-ui",
    fontSize: topFontSize,
    fill: 0xffffff,
    align: "center",
    wordWrap: true,
    wordWrapWidth: w * 0.7,
  });
  messageLabel.anchor.set(0.5, 0);
  messageLabel.x = w * 0.5;
  messageLabel.y = h * 0.04;
  uiContainer.addChild(messageLabel);

  infoButton = createButton("INFO", () => {
    togglePaytable();
  });
  infoButton.x = w - infoButton.width - h * 0.04;
  infoButton.y = h * 0.04;
  uiContainer.addChild(infoButton);

  // ------------------ Cadre de la grille
  const frameGraphics = new PIXI.Graphics();
  frameGraphics.lineStyle(Math.max(4, h * 0.006), 0xf2b233, 1);
  frameGraphics.beginFill(0x11141f, 0.95);
  frameGraphics.drawRoundedRect(0, 0, gridWidth, gridHeight, h * 0.03);
  frameGraphics.endFill();

  slotContainer.addChild(frameGraphics);

  // position de la grille (centre vertical)
  slotContainer.x = (w - gridWidth) / 2;
  slotContainer.y = h * 0.16;

  // ------------------ Reels & symboles
  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = framePadding + c * (symbolSize + reelGap);

    const reel = {
      container: reelContainer,
      symbols: [],
    };

    for (let r = 0; r < ROWS; r++) {
      const idx = Math.floor(Math.random() * symbolTextures.length);
      const sprite = new PIXI.Sprite(symbolTextures[idx]);

      sprite.width = symbolSize;
      sprite.height = symbolSize;
      sprite.x = 0;
      sprite.y = framePadding + r * (symbolSize + reelGap);
      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }

  // ------------------ HUD texte (solde / mise / dernier gain)
  const hudY = slotContainer.y + gridHeight + h * 0.03;
  const hudFontSize = Math.round(h * 0.028);

  balanceText = new PIXI.Text(`Solde : ${balance}`, {
    fontFamily: "system-ui",
    fontSize: hudFontSize,
    fill: 0xffffff,
  });

  betText = new PIXI.Text(`Mise : ${bet}`, {
    fontFamily: "system-ui",
    fontSize: hudFontSize,
    fill: 0xffffff,
  });

  lastWinText = new PIXI.Text(`Dernier gain : ${lastWin}`, {
    fontFamily: "system-ui",
    fontSize: hudFontSize,
    fill: 0xffffff,
  });

  balanceText.y = betText.y = lastWinText.y = hudY;
  uiContainer.addChild(balanceText, betText, lastWinText);

  const hudTotalWidth =
    balanceText.width + betText.width + lastWinText.width + w * 0.06;

  let startX = (w - hudTotalWidth) / 2;
  balanceText.x = startX;
  betText.x = balanceText.x + balanceText.width + w * 0.02;
  lastWinText.x = betText.x + betText.width + w * 0.02;

  // ------------------ Boutons -1, SPIN, +1
  const buttonsY = hudY + h * 0.06;
  const buttonWidth = Math.min(w * 0.26, 220);
  const buttonHeight = Math.min(h * 0.08, 70);

  minusButton = createButton("-1", () => {
    if (spinning) return;
    if (bet > 1) {
      bet -= 1;
      updateHud();
    }
  }, buttonWidth, buttonHeight);

  spinButton = createButton("SPIN", () => {
    onSpinClick();
  }, buttonWidth, buttonHeight);

  plusButton = createButton("+1", () => {
    if (spinning) return;
    bet += 1;
    updateHud();
  }, buttonWidth, buttonHeight);

  const totalButtonsWidth =
    minusButton.width + spinButton.width + plusButton.width + w * 0.05;
  startX = (w - totalButtonsWidth) / 2;

  minusButton.x = startX;
  spinButton.x = minusButton.x + minusButton.width + w * 0.025;
  plusButton.x = spinButton.x + spinButton.width + w * 0.025;

  minusButton.y = spinButton.y = plusButton.y = buttonsY;

  uiContainer.addChild(minusButton, spinButton, plusButton);

  updateHud();
}

// -------------------------------------
// Création d’un bouton PIXI
// -------------------------------------
function createButton(label, onClick, width = 160, height = 64) {
  const container = new PIXI.Container();

  const g = new PIXI.Graphics();
  g.beginFill(0x171d2b, 1);
  g.lineStyle(4, 0xf2b233, 1);
  g.drawRoundedRect(0, 0, width, height, height * 0.25);
  g.endFill();

  const txt = new PIXI.Text(label, {
    fontFamily: "system-ui",
    fontSize: height * 0.4,
    fill: 0xffffff,
  });
  txt.anchor.set(0.5);
  txt.x = width / 2;
  txt.y = height / 2;

  container.addChild(g, txt);

  container.interactive = true;
  container.buttonMode = true;
  container.on("pointertap", (e) => {
    e.stopPropagation();
    onClick();
  });

  return container;
}

// -------------------------------------
// Paytable (popup simple)
// -------------------------------------
let paytableVisible = false;
let paytableContainer = null;

function togglePaytable() {
  if (paytableVisible) {
    if (paytableContainer && uiContainer) {
      uiContainer.removeChild(paytableContainer);
      paytableContainer.destroy({ children: true });
      paytableContainer = null;
    }
    paytableVisible = false;
    return;
  }

  const w = app.renderer.width;
  const h = app.renderer.height;

  paytableContainer = new PIXI.Container();

  const bg = new PIXI.Graphics();
  bg.beginFill(0x000000, 0.85);
  bg.drawRect(0, 0, w, h);
  bg.endFill();
  paytableContainer.addChild(bg);

  const panelWidth = w * 0.9;
  const panelHeight = h * 0.7;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x161a2a, 1);
  panel.lineStyle(4, 0xf2b233, 1);
  panel.drawRoundedRect(
    (w - panelWidth) / 2,
    (h - panelHeight) / 2,
    panelWidth,
    panelHeight,
    18
  );
  panel.endFill();
  paytableContainer.addChild(panel);

  const title = new PIXI.Text("Table des gains", {
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.035),
    fill: 0xffffff,
  });
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = (h - panelHeight) / 2 + h * 0.02;
  paytableContainer.addChild(title);

  const lines = [
    "0-3 : 2× | 4 : 3× | 5 : 4×",
    "4 (cartes) : 3× / 4× / 5×",
    "5 (pièce) : 4× / 5× / 6×",
    "6 (couronne) : 10× / 12× / 14×",
    "7 (BAR) : 16× / 18× / 20×",
    "8 (7) : 20× / 25× / 30×",
    "9 (777) : 30× / 40× / 50×",
    "10 (WILD) : remplace tout sauf BONUS",
    "11 (BONUS) : 3+ = 10 free spins, gains ×2",
  ];

  const textBlock = new PIXI.Text(lines.join("\n"), {
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.025),
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: panelWidth * 0.9,
    lineHeight: Math.round(h * 0.03),
  });
  textBlock.x = (w - panelWidth) / 2 + panelWidth * 0.05;
  textBlock.y = title.y + h * 0.05;
  paytableContainer.addChild(textBlock);

  // fermer en touchant n'importe où
  paytableContainer.interactive = true;
  paytableContainer.on("pointertap", () => {
    togglePaytable();
  });

  uiContainer.addChild(paytableContainer);
  paytableVisible = true;
}

// -------------------------------------
// Application de la grille + highlight simple
// -------------------------------------
function applyResultToReels(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;
      const sprite = reel.symbols[r];
      const texture = symbolTextures[value % symbolTextures.length];
      sprite.texture = texture;
      sprite.tint = 0xffffff;
      sprite.alpha = 1;
    }
  }
}

// highlight uniquement les symboles gagnants (pas de gros overlay)
function highlightWinningSymbols(grid, winningLines) {
  // reset au cas où
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const sprite = reels[c].symbols[r];
      sprite.tint = 0xffffff;
      sprite.alpha = 1;
    }
  }

  if (!winningLines || !winningLines.length) return;

  const toHighlight = [];

  winningLines.forEach((lineInfo) => {
    const line = LINES[lineInfo.lineIndex];
    for (let i = 0; i < lineInfo.count; i++) {
      const [row, col] = line[i];
      const sprite = reels[col].symbols[row];
      if (sprite && !toHighlight.includes(sprite)) {
        toHighlight.push(sprite);
      }
    }
  });

  let visible = true;
  let blinkCount = 0;

  const interval = setInterval(() => {
    visible = !visible;
    toHighlight.forEach((s) => {
      s.alpha = visible ? 1 : 0.15;
    });

    blinkCount++;
    if (blinkCount > 6) {
      clearInterval(interval);
      toHighlight.forEach((s) => {
        s.alpha = 1;
      });
    }
  }, 150);
}

// -------------------------------------
// Évaluation de la grille côté client
// -------------------------------------
function evaluateGrid(grid, baseBet) {
  let totalWin = 0;
  const winningLines = [];

  // lignes normales avec wild
  LINES.forEach((line, lineIndex) => {
    const symbols = line.map(([row, col]) => grid[row][col]);

    // si un BONUS est dans la ligne on ne paie pas cette ligne (et le bonus est géré à part)
    if (symbols.includes(BONUS)) {
      return;
    }

    // symbole de base = premier symbole non wild/non bonus
    let baseSymbol = null;
    for (const v of symbols) {
      if (v !== WILD && v !== BONUS) {
        baseSymbol = v;
        break;
      }
    }
    if (baseSymbol === null || !paytable[baseSymbol]) return;

    // nombre de symboles alignés en partant de la gauche (wild inclus)
    let count = 0;
    for (let i = 0; i < symbols.length; i++) {
      const v = symbols[i];
      if (v === baseSymbol || v === WILD) {
        count++;
      } else {
        break;
      }
    }

    if (count >= 3) {
      const mult = paytable[baseSymbol][count] || 0;
      if (mult > 0) {
        const win = mult * baseBet;
        totalWin += win;
        winningLines.push({ lineIndex, count, win });
      }
    }
  });

  // BONUS = 3+ n'importe où
  let bonusCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS) bonusCount++;
    }
  }

  const bonusTriggered = bonusCount >= 3;

  return { baseWin: totalWin, winningLines, bonusTriggered };
}

// -------------------------------------
// Gestion du SPIN
// -------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  const cost = freeSpins > 0 ? 0 : bet;
  if (balance < cost) {
    messageLabel.text = "Solde insuffisant";
    playSound("stop");
    return;
  }

  spinning = true;
  lastWin = 0;
  balance -= cost;
  updateHud();

  if (freeSpins > 0) {
    freeSpins--;
  }

  playSound("spin");
  messageLabel.text = "Spin en cours…";

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet }),
    });

    const data = await response.json();
    const grid = data.result || data.grid || [];

    if (!Array.isArray(grid) || !grid.length) {
      throw new Error("Réponse /spin invalide");
    }

    applyResultToReels(grid);

    setTimeout(() => {
      finishSpin(grid);
    }, 300);
  } catch (err) {
    console.error("Erreur API /spin", err);
    messageLabel.text = "Erreur réseau /spin";
    playSound("stop");
    spinning = false;
  }
}

// -------------------------------------
// Fin de spin
// -------------------------------------
function finishSpin(grid) {
  spinning = false;

  const evalResult = evaluateGrid(grid, bet);
  let win = evalResult.baseWin;

  // bonus
  if (evalResult.bonusTriggered) {
    freeSpins += 10;
    winMultiplier *= 2;
    playSound("bonus");
  }

  win *= winMultiplier;
  lastWin = win;
  balance += win;
  updateHud();

  if (win > 0) {
    messageLabel.text = `Gain : ${win}`;
    playSound("win");
    highlightWinningSymbols(grid, evalResult.winningLines);
  } else {
    if (freeSpins > 0) {
      messageLabel.text = `Pas de gain — free spins restants : ${freeSpins}`;
    } else {
      messageLabel.text = "Pas de gain — appuyez sur SPIN";
    }
    playSound("stop");
  }
}

// -------------------------------------
// Démarrage
// -------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});