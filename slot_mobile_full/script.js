// script.js
// Frontend PIXI pour Slot Mobile – 5 lignes, paytable, highlight & bouton Info

// --------------------------------------------------
// Références DOM
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// --------------------------------------------------
// Audio (MP3)
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
// Variables de jeu
// --------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

let balance = 1000;
let bet = 1;
let lastWin = 0;
let freeSpinsLeft = 0;
let spinning = false;

// HUD
let topMessageText;
let hudText;
let spinButton;
let minusButton;
let plusButton;
let infoButton;
let paytableOverlay;

// pour nettoyer les highlights
let highlightedSprites = [];

// mêmes lignes que côté backend
const PAYLINES = [
  // 0 : haut
  [ [0,0], [0,1], [0,2], [0,3], [0,4] ],
  // 1 : milieu
  [ [1,0], [1,1], [1,2], [1,3], [1,4] ],
  // 2 : bas
  [ [2,0], [2,1], [2,2], [2,3], [2,4] ],
  // 3 : diagonale V
  [ [0,0], [1,1], [2,2], [1,3], [0,4] ],
  // 4 : diagonale ∧
  [ [2,0], [1,1], [0,2], [1,3], [2,4] ],
];

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

function setTopMessage(text) {
  if (topMessageText) {
    topMessageText.text = text;
  }
}

// --------------------------------------------------
// Chargement manuel de spritesheet.png
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
// Initialisation PIXI + découpe de la spritesheet
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

    // 12 symboles = 3 colonnes x 4 lignes sur la spritesheet
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

    buildSlotScene();
    buildHUD();
    buildInfoButton();
    createPaytableOverlay();

    hideMessage();
    setTopMessage("Appuyez sur SPIN pour lancer");

    updateHUD();
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = (e && e.message) ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  // Cadre autour de la grille
  const framePaddingX = w * 0.06;
  const framePaddingY = h * 0.18;
  const frameWidth = w - framePaddingX * 2;
  const frameHeight = h * 0.35;

  const frame = new PIXI.Graphics();
  frame.lineStyle(6, 0xfbbf24, 1);
  frame.beginFill(0x020617);
  frame.drawRoundedRect(
    framePaddingX,
    framePaddingY,
    frameWidth,
    frameHeight,
    24
  );
  frame.endFill();
  slotContainer.addChild(frame);

  const gridArea = new PIXI.Container();
  slotContainer.addChild(gridArea);

  const symbolSize = Math.min(frameWidth / (COLS + 0.5), frameHeight / (ROWS + 0.4));
  const reelWidth = symbolSize + 10;
  const totalReelWidth = reelWidth * COLS;
  const gridX = framePaddingX + (frameWidth - totalReelWidth) / 2;
  const gridY = framePaddingY + (frameHeight - (ROWS * (symbolSize + 8))) / 2;

  gridArea.x = gridX;
  gridArea.y = gridY;

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    gridArea.addChild(reelContainer);
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
// HUD & boutons (-1, SPIN, +1)
// --------------------------------------------------
function makeButton(label, onClick) {
  const container = new PIXI.Container();

  const g = new PIXI.Graphics();
  g.lineStyle(4, 0xfbbf24, 1);
  g.beginFill(0x020617);
  g.drawRoundedRect(0, 0, 140, 72, 18);
  g.endFill();

  const t = new PIXI.Text(label, {
    fill: 0xffffff,
    fontSize: 26,
    fontWeight: "600",
  });
  t.anchor.set(0.5);
  t.x = 70;
  t.y = 36;

  container.addChild(g);
  container.addChild(t);

  container.interactive = true;
  container.buttonMode = true;
  container.on("pointertap", onClick);

  return container;
}

function buildHUD() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // Message du haut
  topMessageText = new PIXI.Text("Chargement…", {
    fill: 0xffffff,
    fontSize: 22,
  });
  topMessageText.anchor.set(0.5);
  topMessageText.x = w / 2;
  topMessageText.y = h * 0.10;
  app.stage.addChild(topMessageText);

  // HUD (solde/mise/gain)
  hudText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: 20,
  });
  hudText.anchor.set(0.5);
  hudText.x = w / 2;
  hudText.y = h * 0.63;
  app.stage.addChild(hudText);

  // Boutons -1 / SPIN / +1
  const buttonsContainer = new PIXI.Container();
  app.stage.addChild(buttonsContainer);

  const spacing = 40;
  const totalWidth = 3 * 140 + 2 * spacing;

  buttonsContainer.x = (w - totalWidth) / 2;
  buttonsContainer.y = h * 0.70;

  minusButton = makeButton("-1", () => {
    if (spinning) return;
    if (bet > 1) {
      bet -= 1;
      updateHUD();
    }
  });

  spinButton = makeButton("SPIN", () => {
    startSpin();
  });

  plusButton = makeButton("+1", () => {
    if (spinning) return;
    if (bet < 1000) {
      bet += 1;
      updateHUD();
    }
  });

  buttonsContainer.addChild(minusButton);
  buttonsContainer.addChild(spinButton);
  buttonsContainer.addChild(plusButton);

  minusButton.x = 0;
  spinButton.x = 140 + spacing;
  plusButton.x = 2 * (140 + spacing);
}

// Bouton Info (petit bouton en haut à droite)
function buildInfoButton() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const container = new PIXI.Container();

  const g = new PIXI.Graphics();
  g.lineStyle(2, 0xfbbf24, 1);
  g.beginFill(0x020617);
  g.drawRoundedRect(0, 0, 64, 32, 10);
  g.endFill();

  const t = new PIXI.Text("INFO", {
    fill: 0xffffff,
    fontSize: 14,
    fontWeight: "600",
  });
  t.anchor.set(0.5);
  t.x = 32;
  t.y = 16;

  container.addChild(g);
  container.addChild(t);

  container.interactive = true;
  container.buttonMode = true;
  container.on("pointertap", () => {
    if (paytableOverlay) {
      paytableOverlay.visible = true;
    }
  });

  container.x = w - 80;
  container.y = h * 0.08;
  app.stage.addChild(container);

  infoButton = container;
}

// Overlay "Table des gains"
function createPaytableOverlay() {
  paytableOverlay = new PIXI.Container();
  paytableOverlay.visible = false;
  app.stage.addChild(paytableOverlay);

  const w = app.renderer.width;
  const h = app.renderer.height;

  const bg = new PIXI.Graphics();
  bg.beginFill(0x000000, 0.8);
  bg.drawRect(0, 0, w, h);
  bg.endFill();
  bg.interactive = true;
  bg.buttonMode = true;
  bg.on("pointertap", () => {
    paytableOverlay.visible = false;
  });
  paytableOverlay.addChild(bg);

  const panelW = w * 0.9;
  const panelH = h * 0.75;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x020617);
  panel.lineStyle(3, 0xfbbf24, 1);
  panel.drawRoundedRect(
    (w - panelW) / 2,
    (h - panelH) / 2,
    panelW,
    panelH,
    20
  );
  panel.endFill();
  paytableOverlay.addChild(panel);

  const title = new PIXI.Text("Table des gains", {
    fill: 0xffffff,
    fontSize: 22,
    fontWeight: "bold",
  });
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = (h - panelH) / 2 + 16;
  paytableOverlay.addChild(title);

  const lines = [
    "Cerise / Pastèque / Pomme / Citron (ID 0–3)",
    "  3 symboles = 2× mise, 4 = 3×, 5 = 4×",
    "",
    "Symboles carte (ID 4)",
    "  3 = 3×, 4 = 4×, 5 = 5×",
    "",
    "Pièce (ID 5)",
    "  3 = 4×, 4 = 5×, 5 = 6×",
    "",
    "Couronne (ID 6)",
    "  3 = 10×, 4 = 12×, 5 = 14×",
    "",
    "BAR (ID 7)",
    "  3 = 16×, 4 = 18×, 5 = 20×",
    "",
    "7 (ID 8)",
    "  3 = 20×, 4 = 25×, 5 = 30×",
    "",
    "777 (ID 9)",
    "  3 = 30×, 4 = 40×, 5 = 50×",
    "",
    "WILD (ID 10) : remplace n'importe quel symbole",
    "  (sauf BONUS) sur une ligne gagnante.",
    "",
    "BONUS (ID 11) : 3+ sur la grille =",
    "  10 free spins + gains du tour x2.",
  ];

  const textStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 16,
    wordWrap: true,
    wordWrapWidth: panelW - 40,
    lineHeight: 22,
  });

  const details = new PIXI.Text(lines.join("\n"), textStyle);
  details.x = (w - panelW) / 2 + 20;
  details.y = title.y + 40;
  paytableOverlay.addChild(details);

  const hint = new PIXI.Text("(Touchez pour fermer)", {
    fill: 0x9ca3af,
    fontSize: 14,
  });
  hint.anchor.set(0.5);
  hint.x = w / 2;
  hint.y = (h + panelH) / 2 - 24;
  paytableOverlay.addChild(hint);
}

// --------------------------------------------------
// Helpers reels / HUD
// --------------------------------------------------
function clearHighlights() {
  highlightedSprites.forEach((sprite) => {
    sprite.tint = 0xffffff;
    sprite.scale.set(1);
  });
  highlightedSprites = [];
}

function highlightWinningLines(winningLines) {
  if (!Array.isArray(winningLines) || !winningLines.length) return;
  if (!reels || !reels.length) return;

  winningLines.forEach((info) => {
    const line = PAYLINES[info.lineIndex];
    if (!line) return;

    const count = info.count || 0;
    for (let i = 0; i < count; i++) {
      const [row, col] = line[i];
      const reel = reels[col];
      if (!reel) continue;
      const sprite = reel.symbols[row];
      if (!sprite) continue;

      sprite.tint = 0xffff99;
      sprite.scale.set(1.08);
      highlightedSprites.push(sprite);
    }
  });
}

function applyResultToReels(grid) {
  if (!Array.isArray(grid) || !grid.length) return;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;

      const index = value % symbolTextures.length;
      reel.symbols[r].texture = symbolTextures[index];
    }
  }
}

function updateHUD() {
  if (!hudText) return;

  const freeTxt = freeSpinsLeft > 0 ? ` | Free : ${freeSpinsLeft}` : "";
  hudText.text =
    `Solde : ${balance}  |  Mise : ${bet}  |  Dernier gain : ${lastWin}` +
    freeTxt;
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
async function startSpin() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  clearHighlights();

  const isFreeSpin = freeSpinsLeft > 0;

  if (!isFreeSpin) {
    if (balance < bet) {
      setTopMessage("Solde insuffisant");
      return;
    }
    balance -= bet;
  } else {
    freeSpinsLeft--;
  }

  spinning = true;
  lastWin = 0;
  updateHUD();
  setTopMessage("SPIN en cours…");
  playSound("spin");

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet }),
    });

    const data = await response.json();
    const grid = data.result || [];
    const win = data.win || 0;
    const bonus = data.bonus || { freeSpins: 0, multiplier: 1 };
    const winningLines = data.winningLines || [];

    applyResultToReels(grid);

    setTimeout(() => {
      finishSpin(win, bonus, winningLines);
    }, 350);
  } catch (err) {
    console.error("Erreur API /spin", err);
    setTopMessage("Erreur réseau /spin");
    spinning = false;
    playSound("stop");
  }
}

// --------------------------------------------------
// Fin de spin
// --------------------------------------------------
function finishSpin(win, bonus, winningLines) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;

  if (Array.isArray(winningLines) && winningLines.length > 0) {
    highlightWinningLines(winningLines);
  }

  let msg = "";

  if (bonus && bonus.freeSpins > 0) {
    freeSpinsLeft += bonus.freeSpins;
    msg = `BONUS ! +${bonus.freeSpins} free spins (x${bonus.multiplier})`;
    playSound("bonus");
  } else if (lastWin > 0) {
    msg = `Gain : ${lastWin}`;
    playSound("win");
  } else {
    msg = "Pas de gain — appuyez sur SPIN";
    playSound("stop");
  }

  setTopMessage(msg);
  updateHUD();
}

// --------------------------------------------------
// Démarrage
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    const msg = (e && e.message) ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});