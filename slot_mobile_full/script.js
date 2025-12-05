// script.js
// Frontend PIXI pour Slot Mobile

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

// petit helper audio (évite les erreurs iOS)
function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  try {
    s.currentTime = 0;
    s.play().catch(() => {});
  } catch (e) {
    // ignore
  }
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
// Initialisation PIXI + chargement des assets
// --------------------------------------------------
async function initPixi() {
  if (!canvas) {
    console.error("Canvas #game introuvable");
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
    // PIXI v8 : on utilise Assets
    PIXI.Assets.add("symbols", "assets/spritesheet.json");
    const sheet = await PIXI.Assets.load("symbols");
    symbolTextures = Object.values(sheet.textures || {});

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();
    hideMessage();
    showMessage("Touchez pour lancer"); // on réutilise comme overlay
  } catch (e) {
    console.error("Erreur chargement assets", e);
    showMessage("Erreur JS : chargement assets");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const reelWidth = w * 0.13;
  const totalReelWidth = reelWidth * COLS;

  // ↓↓↓ Modif : symboles un peu plus petits pour ne plus être coupés
  const symbolSize = (h * 0.45) / ROWS;
  const spacing = 6; // petit espace vertical entre symboles

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  // ↓↓↓ Modif : on remonte un peu la grille
  slotContainer.y = h * 0.15;

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
      sprite.y = r * (symbolSize + spacing);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }

  // clique sur tout l'écran = SPIN
  canvas.addEventListener("click", onSpinClick);
  canvas.addEventListener("touchstart", onSpinClick);
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

// récupère une texture à partir de l’index du backend
function getTextureByIndex(index) {
  if (!symbolTextures.length) {
    return PIXI.Texture.WHITE;
  }
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
async function onSpinClick(e) {
  e.preventDefault();

  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  spinning = true;
  lastWin = 0;
  balance -= bet;
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

    // petite pause pour laisser "le temps" d'afficher
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

// fin de spin : mise à jour des valeurs + sons
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

  // on affiche juste un petit texte dans le loader pour debug
  if (loaderEl) {
    if (lastWin > 0) {
      loaderEl.textContent = `Gagné : ${lastWin}`;
    } else {
      loaderEl.textContent = "Touchez pour relancer";
    }
  }
}

// --------------------------------------------------
// Démarrage
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    showMessage("Erreur JS : init");
  }
});
