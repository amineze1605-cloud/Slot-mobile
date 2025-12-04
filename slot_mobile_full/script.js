// script.js - version PIXI.Assets (compatible Pixi v7/v8)

// ----------------------------------------------------
// Références DOM
// ----------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// Ces éléments n'existent pas encore dans ton HTML mais le
// code les gère de façon optionnelle si tu veux les ajouter plus tard.
const spinButton = document.getElementById("spinButton");
const statusText = document.getElementById("status");
const balanceEl = document.getElementById("balance");
const betEl = document.getElementById("bet");
const winEl = document.getElementById("win");

// ----------------------------------------------------
// Audio
// ----------------------------------------------------
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
  } catch (e) {
    // iOS peut refuser, ce n'est pas grave
  }
}

function unlockAudio() {
  Object.values(sounds).forEach((s) => {
    s.muted = true;
    s.play().catch(() => {});
    s.pause();
    s.currentTime = 0;
    s.muted = false;
  });
}

// ----------------------------------------------------
// Variables jeu
// ----------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// ----------------------------------------------------
// Utilitaires
// ----------------------------------------------------
function randInt(max) {
  return Math.floor(Math.random() * max);
}

function getTextureByIndex(index) {
  if (!symbolTextures.length) {
    return PIXI.Texture.WHITE;
  }
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex];
}

function updateUI() {
  if (balanceEl) balanceEl.textContent = balance.toString();
  if (betEl) betEl.textContent = bet.toString();
  if (winEl) winEl.textContent = lastWin.toString();
}

// Affichage d'erreur lisible sur l'écran
function showError(message) {
  console.error(message);
  if (loaderEl) {
    loaderEl.textContent = "Erreur JS : " + message;
  }
}

// Catch global des erreurs JS pour les voir sur mobile
window.addEventListener("error", (event) => {
  const msg =
    event.message || (event.error && event.error.message) || "Erreur inconnue";
  showError(msg);
});

// ----------------------------------------------------
// Initialisation PIXI + chargement du spritesheet
// ----------------------------------------------------
async function initPixi() {
  try {
    if (!canvas) {
      throw new Error("Canvas #game introuvable");
    }
    if (typeof PIXI === "undefined" || !PIXI.Application) {
      throw new Error("PIXI n'est pas chargé");
    }

    if (loaderEl) loaderEl.textContent = "Initialisation du jeu…";

    app = new PIXI.Application({
      view: canvas,
      resizeTo: window,
      backgroundColor: 0x050814,
      antialias: true,
    });

    if (loaderEl) loaderEl.textContent = "Chargement des images…";

    // IMPORTANT : avec Pixi v7/v8 on utilise PIXI.Assets
    const sheet = await PIXI.Assets.load("assets/spritesheet.json");
    if (!sheet || !sheet.textures) {
      throw new Error("Spritesheet.json chargé mais sans textures");
    }

    symbolTextures = Object.values(sheet.textures);
    if (!symbolTextures.length) {
      throw new Error("Aucune texture trouvée dans spritesheet.json");
    }

    buildSlotScene();
    setupUI();

    if (loaderEl) loaderEl.textContent = "Touchez pour commencer";
  } catch (err) {
    showError(err.message || String(err));
  }
}

// ----------------------------------------------------
// Construction de la scène slot (5x3)
// ----------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const reelWidth = w * 0.13;
  const totalReelWidth = reelWidth * COLS;
  const symbolSize = (h * 0.5) / ROWS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);
  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.2;

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = c * (reelWidth + 4);

    const reel = {
      container: reelContainer,
      symbols: [],
    };

    for (let r = 0; r < ROWS; r++) {
      const idx = randInt(symbolTextures.length);
      const texture = getTextureByIndex(idx);
      const sprite = new PIXI.Sprite(texture);

      sprite.width = reelWidth;
      sprite.height = symbolSize;
      sprite.x = 0;
      sprite.y = r * (symbolSize + 4);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }
}

// ----------------------------------------------------
// UI & interactions
// ----------------------------------------------------
function setupUI() {
  updateUI();

  if (loaderEl) {
    const start = (e) => {
      e.preventDefault();
      unlockAudio();
      loaderEl.style.display = "none";
      if (statusText) statusText.textContent = "Bonne chance !";
      // Premier spin automatique au premier tap
      onSpinClick();
    };

    loaderEl.addEventListener("click", start);
    loaderEl.addEventListener("touchstart", start, { passive: false });
  }

  if (spinButton) {
    spinButton.addEventListener("click", onSpinClick);
    spinButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      onSpinClick();
    });
  }
}

// ----------------------------------------------------
// Gestion du SPIN (appel backend /spin)
// ----------------------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (balance < bet) {
    if (statusText) statusText.textContent = "Solde insuffisant";
    playSound("stop");
    return;
  }

  spinning = true;
  balance -= bet;
  lastWin = 0;
  updateUI();
  playSound("spin");
  if (statusText) statusText.textContent = "Spin en cours…";

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet }),
    });

    if (!response.ok) {
      throw new Error("Réponse /spin invalide : " + response.status);
    }

    const data = await response.json();
    const grid = data.result;
    const win = data.win || 0;
    const bonus = data.bonus || { freeSpins: 0, multiplier: 1 };

    applyResultToReels(grid);

    // Petite attente pour simuler l'animation
    setTimeout(() => {
      finishSpin(win, bonus);
    }, 500);
  } catch (err)