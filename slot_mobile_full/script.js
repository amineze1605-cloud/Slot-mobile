// script.js
// Slot mobile : spritesheet.png (12 symboles), solde/mise/gain, zone de spin + timeout API

// --------------------------------------------------
// Références DOM
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// --------------------------------------------------
// Audio
// --------------------------------------------------
const sounds = {
  spin: new Audio("assets/audio/spin.wav"),
  stop: new Audio("assets/audio/stop.wav"),
  win: new Audio("assets/audio/win.wav"),
  bonus: new Audio("assets/audio/bonus.wav"),
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
  } catch (_) {}
}

// --------------------------------------------------
// Variables de jeu
// --------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;
const SYMBOL_GAP = 8;

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// Layout / UI
let slotContainer = null;
let symbolSize = 0;
let spinZone = null;       // rectangle cliquable pour lancer le spin
let uiMessage = null;      // texte haut
let infoText = null;       // "Solde / Mise / Dernier gain"

// --------------------------------------------------
// Helpers UI (loader DOM)
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

// --------------------------------------------------
// Chargement de spritesheet.png (Image + BaseTexture)
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = "assets/spritesheet.png";

    img.onload = () => {
      try {
        const baseTexture = PIXI.BaseTexture.from(img);
        resolve({ baseTexture, width: img.width, height: img.height });
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
    const { baseTexture, width: fullW, height: fullH } = await loadSpritesheet();
    console.log("spritesheet.png =", fullW, "x", fullH);

    // 12 symboles = 3 colonnes x 4 lignes
    const SHEET_COLS = 3;
    const SHEET_ROWS = 4;
    const frameW = fullW / SHEET_COLS;
    const frameH = fullH / SHEET_ROWS;

    symbolTextures = [];
    for (let r = 0; r < SHEET_ROWS; r++) {
      for (let c = 0; c < SHEET_COLS; c++) {
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
    setMessage("Touchez la grille pour lancer");
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
  slotContainer.y = h * 0.28;

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

  // Zone cliquable (rectangle autour de la grille)
  const gridWidth = COLS * (symbolSize + SYMBOL_GAP);
  const gridHeight = ROWS * (symbolSize + SYMBOL_GAP);
  spinZone = {
    x: slotContainer.x,
    y: slotContainer.y,
    width: gridWidth,
    height: gridHeight,
  };

  // Écouteurs DOM sur le canvas, filtrés par spinZone
  canvas.addEventListener("click", onSpinClick);
  canvas.addEventListener("touchstart", onSpinClick);
}

// --------------------------------------------------
// UI : message haut + ligne info + boutons +/- mise
// --------------------------------------------------
function buildUI() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // Message haut
  const msgStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 24,
  });
  uiMessage = new PIXI.Text("", msgStyle);
  uiMessage.anchor.set(0.5, 0);
  uiMessage.x = w / 2;
  uiMessage.y = h * 0.10;
  app.stage.addChild(uiMessage);

  // Ligne info
  const infoStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 16,
  });
  infoText = new PIXI.Text("", infoStyle);
  infoText.anchor.set(0.5, 0);

  const gridBottomY =
    slotContainer.y + ROWS * (symbolSize + SYMBOL_GAP) - SYMBOL_GAP;
  infoText.x = w / 2;
  infoText.y = gridBottomY + 16;
  app.stage.addChild(infoText);

  // Boutons -1 / +1
  const btnY = infoText.y + 50;
  const btnWidth = 90;
  const btnHeight = 45;
  const btnSpacing = 140;

  const styleLabel = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 20,
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

  updateInfoText();
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
  const xNorm =
    ((touch.clientX - rect.left) * app.renderer.width) / rect.width;
  const yNorm =
    ((touch.clientY - rect.top) * app.renderer.height) / rect.height;

  return { x: xNorm, y: yNorm };
}

// --------------------------------------------------
// Appel API /spin avec timeout (2 secondes)
// --------------------------------------------------
async function callSpinAPI(betValue) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet: betValue }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
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
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Gestion du SPIN (clic sur la grille)
// --------------------------------------------------
async function onSpinClick(e) {
  e.preventDefault();

  if (!spinZone || !app) return;

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
    const data = await callSpinAPI(bet);
    const grid = data.result || [];
    const win = data.win || 0;
    const bonus = data.bonus || { freeSpins: 0, multiplier: 1 };

    applyResultToReels(grid);

    setTimeout(() => {
      finishSpin(win, bonus);
    }, 200);
  } catch (err) {
    console.error("Erreur API /spin", err);
    setMessage("Erreur réseau, réessayez");
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
  setMessage("Touchez la grille pour relancer");
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