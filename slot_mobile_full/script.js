// script.js
// Frontend PIXI pour Slot Mobile (spritesheet.png + sons)

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

// volume + préchargement
Object.values(sounds).forEach((a) => {
  a.preload = "auto";
  a.volume = 0.6;
});

let audioUnlocked = false;

// déblocage iOS : on joue une fois les sons en muet
function setupAudioUnlock() {
  function unlock() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    Object.values(sounds).forEach((s) => {
      try {
        s.muted = true;
        s.play().then(() => {
          s.pause();
          s.currentTime = 0;
          s.muted = false;
        }).catch(() => {});
      } catch (e) {}
    });
    
    // --------------------------------------------------
// Déblocage audio iOS (une seule fois au premier touch / clic)
// --------------------------------------------------
let audioUnlocked = false;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  Object.values(sounds).forEach(a => {
    const oldVolume = a.volume;
    a.volume = 0;          // on évite un "plop" au déblocage
    a.play().then(() => {
      a.pause();
      a.currentTime = 0;
      a.volume = oldVolume;
    }).catch(() => {
      // on ignore, certains navigateurs n'aiment pas
      a.volume = oldVolume;
    });
  });

  // on enlève les listeners après déblocage
  window.removeEventListener("touchstart", unlockAudioOnce);
  window.removeEventListener("mousedown", unlockAudioOnce);
}

// premier geste utilisateur n'importe où sur la page
window.addEventListener("touchstart", unlockAudioOnce, { passive: true });
window.addEventListener("mousedown", unlockAudioOnce);

    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("mousedown", unlock);
  }

  window.addEventListener("touchstart", unlock, { once: true });
  window.addEventListener("mousedown", unlock, { once: true });
}

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
let spinning = false;

// UI PIXI
let messageText;
let balanceText;
let betText;
let lastWinText;

let slotContainer;

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
    hideMessage();
    updateTopMessage("Touchez la grille pour relancer");
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = (e && e.message) ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3) + UI
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;

  // Conteneur principal des rouleaux
  slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.25;

  // On ne lance le spin QUE quand on tape la grille
  slotContainer.interactive = true;
  slotContainer.buttonMode = true;
  slotContainer.on("pointertap", onGridTap);

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

  // Texte en haut
  messageText = new PIXI.Text("Touchez la grille pour relancer", {
    fill: 0xffffff,
    fontSize: 28,
  });
  messageText.anchor.set(0.5, 0);
  messageText.x = w / 2;
  messageText.y = h * 0.08;
  app.stage.addChild(messageText);

  // Zone d’infos sous la grille
  const infoY = slotContainer.y + ROWS * (symbolSize + 8) + 20;

  balanceText = new PIXI.Text("", { fill: 0xffffff, fontSize: 18 });
  betText = new PIXI.Text("", { fill: 0xffffff, fontSize: 18 });
  lastWinText = new PIXI.Text("", { fill: 0xffffff, fontSize: 18 });

  balanceText.x = w * 0.1;
  betText.x = w * 0.45;
  lastWinText.x = w * 0.7;

  balanceText.y = betText.y = lastWinText.y = infoY;

  app.stage.addChild(balanceText);
  app.stage.addChild(betText);
  app.stage.addChild(lastWinText);

  // Boutons -1 / +1
  const btnY = infoY + 40;
  createBetButton(w * 0.3, btnY, "-1", () => changeBet(-1));
  createBetButton(w * 0.7, btnY, "+1", () => changeBet(1));

  updateInfoTexts();
}

function createBetButton(x, y, label, onClick) {
  const width = 120;
  const height = 60;

  const container = new PIXI.Container();
  container.x = x - width / 2;
  container.y = y;
  container.interactive = true;
  container.buttonMode = true;

  const bg = new PIXI.Graphics();
  bg.lineStyle(3, 0xf5c053);
  bg.beginFill(0x050814);
  bg.drawRoundedRect(0, 0, width, height, 10);
  bg.endFill();

  const text = new PIXI.Text(label, {
    fill: 0xffffff,
    fontSize: 26,
  });
  text.anchor.set(0.5);
  text.x = width / 2;
  text.y = height / 2;

  container.addChild(bg);
  container.addChild(text);

  container.on("pointertap", (e) => {
    e.stopPropagation(); // très important : ne pas lancer le spin !
    onClick();
  });

  app.stage.addChild(container);
}

function updateTopMessage(msg) {
  if (messageText) {
    messageText.text = msg;
  }
}

function updateInfoTexts() {
  if (!balanceText || !betText || !lastWinText) return;
  balanceText.text = `Solde : ${balance}`;
  betText.text = `Mise : ${bet}`;
  lastWinText.text = `Dernier gain : ${lastWin}`;
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
function onGridTap() {
  startSpin();
}

async function startSpin() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  spinning = true;
  lastWin = 0;
  balance -= bet;
  if (balance < 0) balance = 0;
  updateInfoTexts();

  updateTopMessage("En cours…");
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

function changeBet(delta) {
  bet += delta;
  if (bet < 1) bet = 1;
  if (bet > 100) bet = 100;
  updateInfoTexts();
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
// Fin de spin
// --------------------------------------------------
function finishSpin(win, bonus) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;

  if (lastWin > 0) {
    playSound("win");
    updateTopMessage(`Gagné : ${lastWin} — touchez la grille pour relancer`);
  } else {
    playSound("stop");
    updateTopMessage("Pas de gain — touchez la grille pour relancer");
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
  }

  updateInfoTexts();
}

// --------------------------------------------------
// Démarrage
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    setupAudioUnlock();
    initPixi();
  } catch (e) {
    console.error(e);
    const msg = (e && e.message) ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});