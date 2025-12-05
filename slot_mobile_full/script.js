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

  // Vérif version de PIXI
  if (!PIXI || !PIXI.Assets) {
    console.error("PIXI.Assets indisponible. Version PIXI incorrecte ?");
    showMessage("Erreur JS : PIXI.Assets manquant");
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
    // 1) on enregistre la ressource
    PIXI.Assets.add("symbols", "assets/spritesheet.json");

    // 2) on charge
    const sheet = await PIXI.Assets.load("symbols");

    // 3) on récupère les textures
    symbolTextures = Object.values(sheet.textures || {});

    console.log("Textures chargées =", symbolTextures.length);

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();
    hideMessage();
    showMessage("Touchez pour lancer"); // on réutilise comme overlay
  } catch (e) {
    console.error("Erreur chargement assets", e);
    // message un peu plus précis pour debug
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

  // taille des symboles (un peu plus gros mais tous visibles)
  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.25;

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
    const msg = (e && e.message) ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});