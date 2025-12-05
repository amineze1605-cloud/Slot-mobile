// script.js
// Slot mobile avec spritesheet.png (12 symboles), UI mise + solde

// --------------------------------------------------
// Références DOM
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// --------------------------------------------------
// Audio
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
// Variables de jeu
// --------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;
const SYMBOL_GAP = 8; // écart vertical/horizontal entre symboles

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// pour placer la UI correctement
let slotContainer = null;
let symbolSize = 0;

// zone cliquable pour le spin (limité à la grille)
let spinZone = null;

// textes UI
let infoText;   // "Solde / Mise / Dernier gain"
let uiMessage;  // "Touchez pour lancer / relancer"

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
    console.error("PIXI introuvable (CDN ?)");
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

    // 12 symboles = 3 colonnes x 4 lignes
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
    buildUI();
    hideMessage();
    setMessage("Touchez pour lancer");
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + SYMBOL_GAP;
  const totalReelWidth = reelWidth * COLS;

  slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.28; // un peu plus haut pour laisser de la place dessous

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
      sprite.y = r * (symbolSize + SYMBOL_GAP);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }

  // zone cliquable pour le spin = rectangle autour de la grille
  const gridWidth = COLS * (symbolSize + SYMBOL_GAP);
  const gridHeight = ROWS * (symbolSize + SYMBOL_GAP);
  spinZone = {
    x: slotContainer.x,
    y: slotContainer.y,
    width: gridWidth,
    height: gridHeight,
  };

  // écoute du SPIN sur tout le canvas, mais filtré par spinZone
  canvas.addEventListener("click", onSpinClick);
  canvas.addEventListener("touchstart", onSpinClick);
}

// --------------------------------------------------
// UI : message haut + ligne infos + boutons +/- mise
// --------------------------------------------------
function buildUI() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // ----- Message haut ("Touchez pour lancer")
  const msgStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 28,
  });
  uiMessage = new PIXI.Text("", msgStyle);
  uiMessage.anchor.set(0.5, 0);
  uiMessage.x = w / 2;
  uiMessage.y = h * 0.12;
  app.stage.addChild(uiMessage);

  // ----- Ligne infos (solde / mise / gain)
  const infoStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 18,
  });
  infoText = new PIXI.Text("", infoStyle);
  infoText.anchor.set(0.5, 0);

  const gridBottomY =
    slotContainer.y + ROWS * (symbolSize + SYMBOL_GAP) - SYMBOL_GAP;
  infoText.x = w / 2;
  infoText.y = gridBottomY + 16; // juste sous la grille
  app.stage.addChild(infoText);

  // ----- Boutons -1 / +1 pour la mise
  const btnY = infoText.y + 50; // sous la ligne d'info
  const btnWidth = 90;
  const btnHeight = 50;
  const btnSpacing = 140;

  const styleLabel = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 22,
  });

  // bouton -1
  const btnMinus = new PIXI.Container();
  const gMinus = new PIXI.Graphics();
  gMinus.lineStyle(2, 0xf5c744);
  gMinus.beginFill(0x151922);
  gMinus.drawRoundedRect(-btnWidth / 2, -btnHeight / 2, btnWidth, btnHeight, 10);
  gMinus.endFill();
  btnMinus.addChild(gMinus);

  const labelMinus = new PIXI.Text("-1", styleLabel);
  labelMinus.anchor.set(0.5);
  btnMinus.addChild(labelMinus);

  btnMinus.x = w / 2 - btnSpacing / 2;
  btnMinus.y = btnY;
  btnMinus.interactive = true;
  btnMinus.buttonMode = true;
  btnMinus.on("pointertap", () => changeBet(-1));

  app.stage.addChild(btnMinus);

  // bouton +1
  const btnPlus = new PIXI.Container();
  const gPlus = new PIXI.Graphics();
  gPlus.lineStyle(2, 0xf5c744);
  gPlus.beginFill(0x151922);
  gPlus.drawRoundedRect(-btnWidth / 2, -btnHeight / 2, btnWidth, btnHeight, 10);
  gPlus.endFill();
  btnPlus.addChild(gPlus);

  const labelPlus = new PIXI.Text("+1", styleLabel);
  labelPlus.anchor.set(0.5);
  btnPlus.addChild(labelPlus);

  btnPlus.x = w / 2 + btnSpacing / 2;
  btnPlus.y = btnY;
  btnPlus.interactive = true;
  btnPlus.buttonMode = true;
  btnPlus.on("pointertap", () => changeBet(1));

  app.stage.addChild(btnPlus);

  // init texte
  updateInfoText();
}

function setMessage(text) {
  if (!uiMessage) return;
  uiMessage.text = text;
}

function updateInfoText() {
  if (!infoText) return;
  infoText.text =
    "Solde : " +
    balance +
    "   |   Mise : " +
    bet +
    "   |   Dernier gain : " +
    lastWin;
}

// changement de mise
function changeBet(delta) {
  const newBet = bet + delta;
  if (newBet < 1) return;
  bet = newBet;
  updateInfoText();
}

// --------------------------------------------------
// Utilitaire : coordonnée du toucher dans le canvas
// --------------------------------------------------
function getPointerPosition(e) {
  const touch = e.touches && e.touches[0] ? e.touches[0] : e;
  if (!touch || !canvas || !app) return null;

  const rect = canvas.getBoundingClientRect();
  const xNorm = ((touch.clientX - rect.left) * app.renderer.width) / rect.width;
  const yNorm =
    ((touch.clientY - rect.top) * app.renderer.height) / rect.height;

  return { x: xNorm, y: yNorm };
}

// --------------------------------------------------
// Application de la grille renvoyée par le backend
// --------------------------------------------------
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || !grid.length) return;

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
  if (!symbolTextures.length) {
    return PIXI.Texture.WHITE;
  }
  const safeIndex = index % symbolTextures.length; // 0..11
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
async function onSpinClick(e) {
  e.preventDefault();

  if (!spinZone || !app) return;

  // on ne spin que si le toucher est dans la zone de la grille
  const pos = getPointerPosition(e);
  if (
    !pos ||
    pos.x < spinZone.x ||
    pos.x > spinZone.x + spinZone.width ||
    pos.y < spinZone.y ||
    pos.y > spinZone.y + spinZone.height
  ) {
    // clic/touch en dehors de la grille -> on ignore
    return;
  }

  if (spinning) return;
  if (!symbolTextures.length) return;

  spinning = true;
  lastWin = 0;

  if (balance >= bet) {
    balance -= bet;
  }

  updateInfoText();
  setMessage("Spin en cours…");
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

    applyResultToReels(grid);

    setTimeout(() => {
      finishSpin(win, bonus);
    }, 400);
  } catch (err) {
    console.error("Erreur API /spin", err);
    showMessage("Erreur JS : API");
    spinning = false;
    playSound("stop");
  }
}

// --------------------------------------------------
// Fin de spin
// --------------------------------------------------
function finishSpin(win, bonus) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;

  if (lastWin > 0) {
    playSound("win");
  } else {
    playSound("stop");
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
  }

  updateInfoText();
  setMessage("Touchez pour relancer");
}

// --------------------------------------------------
// Démarrage
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