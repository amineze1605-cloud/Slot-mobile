// script.js
// Jeu Slot Mobile Pro - Frontend PIXI + Audio HTML5
// Place ce fichier dans: slot_mobile_full/script.js

// -----------------------------------------------------
// Références DOM
// -----------------------------------------------------
const canvas = document.getElementById("game");
const loaderOverlay = document.getElementById("loader"); // <div id="loader">Chargement…</div>

const overlay = document.getElementById("overlay");       // peut être null (pas grave)
const spinButton = document.getElementById("spinButton"); // peut être null aussi
const statusText = document.getElementById("status");
const balanceEl = document.getElementById("balance");
const betEl = document.getElementById("bet");
const winEl = document.getElementById("win");

// -----------------------------------------------------------------------------
// Audio (HTML5) - chemins des fichiers
// -----------------------------------------------------------------------------
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

// Déblocage du son sur iOS (première interaction utilisateur)
function unlockAudio() {
  Object.values(sounds).forEach((s) => {
    s.muted = true;
    s.play().catch(() => {});
    s.pause();
    s.currentTime = 0;
    s.muted = false;
  });
}

// -----------------------------------------------------------------------------
// Variables jeu
// -----------------------------------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;
const SYMBOLS_COUNT = 6; // Doit correspondre à randInt(6) côté serveur

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// -----------------------------------------------------------------------------
// Initialisation PIXI
// -----------------------------------------------------------------------------
function initPixi() {
  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: true,
  });

  // Chargement du spritesheet
  PIXI.Loader.shared
    .add("symbols", "assets/spritesheet.json")
    .load(onAssetsLoaded);
}

// -----------------------------------------------------------------------------
// Chargement terminé
// -----------------------------------------------------------------------------
function onAssetsLoaded(loader, resources) {
  const sheet = resources.symbols.spritesheet;

  // Textures des symboles (si jamais le spritesheet est vide,
  // symbolTextures sera [], et on affichera des carrés blancs)
  symbolTextures = sheet ? Object.values(sheet.textures) : [];

  // Construire la scène puis brancher les interactions
  buildSlotScene();
  setupUI();

  // ➜ Cacher l’écran "Chargement..."
  if (loaderOverlay) {
    loaderOverlay.style.display = "none";
  }
}

// -----------------------------------------------------------------------------
// Construction de la scène slot (5x3)
// -----------------------------------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const reelWidth = w * 0.13;
  const totalReelWidth = reelWidth * COLS + reelWidth * 0.2;
  const symbolSize = (h * 0.5) / ROWS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);
  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.2;

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    slotContainer.addChild(reelContainer);
    reelContainer.x = c * (totalReelWidth / COLS);

    const reel = {
      container: reelContainer,
      symbols: [],
    };

    for (let r = 0; r < ROWS; r++) {
      const idx = Math.floor(Math.random() * SYMBOLS_COUNT);
      const texture = getTextureByIndex(idx);
      const sprite = new PIXI.Sprite(texture);

      sprite.width = symbolSize;
      sprite.height = symbolSize;
      sprite.x = 0;
      sprite.y = r * (symbolSize + 4);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }
}

// Récupérer une texture à partir d’un index (0..SYMBOLS_COUNT-1)
function getTextureByIndex(index) {
  if (!symbolTextures.length) {
    return PIXI.Texture.WHITE;
  }
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// -----------------------------------------------------
// UI & interactions
// -----------------------------------------------------
// -----------------------------------------------------
// UI & interactions
// -----------------------------------------------------
function setupUI() {
  updateUI();

  // 1er tap : débloque le son, puis on utilise le canvas pour lancer les spins
  if (canvas) {
    const start = (e) => {
      e.preventDefault();

      // essayer de débloquer le son iOS
      unlockAudio();

      // on cache éventuellement le loader si jamais il est encore là
      if (loaderOverlay) {
        loaderOverlay.style.display = "none";
      }

      // on enlève ces handlers "start"
      canvas.removeEventListener("click", start);
      canvas.removeEventListener("touchstart", start);

      // ➜ À partir de maintenant, chaque tap lance un spin
      canvas.addEventListener("click", onSpinClick);
      canvas.addEventListener("touchstart", (ev) => {
        ev.preventDefault();
        onSpinClick();
      });
    };

    canvas.addEventListener("click", start);
    canvas.addEventListener("touchstart", start);
  }

  // Si un bouton HTML existe un jour, on le branche aussi (optionnel)
  if (spinButton) {
    spinButton.addEventListener("click", onSpinClick);
    spinButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      onSpinClick();
    });
  }
}

// Mise à jour des textes
function updateUI() {
  if (balanceEl) balanceEl.textContent = balance.toString();
  if (betEl) betEl.textContent = bet.toString();
  if (winEl) winEl.textContent = lastWin.toString();
}

// -----------------------------------------------------------------------------
// Gestion du SPIN
// -----------------------------------------------------------------------------
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
  if (statusText) statusText.textContent = "Spin en cours...";

  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet }),
    });

    const data = await response.json();
    const grid = data.result; // [ [row0...], [row1...], [row2...] ]
    const win = data.win || 0;
    const bonus = data.bonus || { freeSpins: 0, multiplier: 1 };

    applyResultToReels(grid);

    // petite attente pour simuler l’arrêt
    setTimeout(() => {
      finishSpin(win, bonus);
    }, 500);
  } catch (err) {
    console.error("Erreur API /spin :", err);
    if (statusText) statusText.textContent = "Erreur serveur";
    spinning = false;
    playSound("stop");
  }
}

// Applique la grille de symboles aux sprites
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length < ROWS) return;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;
      const sprite = reel.symbols[r];
      sprite.texture = getTextureByIndex(Number(value) || 0);
    }
  }
}

// Fin de spin : mise à jour solde + son
function finishSpin(win, bonus) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;
  updateUI();

  if (lastWin > 0) {
    playSound("win");
  } else {
    playSound("stop");
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
    if (statusText) {
      statusText.textContent =
        "Bonus ! " +
        (bonus.freeSpins ? `${bonus.freeSpins} free spins ` : "") +
        (bonus.multiplier && bonus.multiplier > 1
          ? `x${bonus.multiplier}`
          : "");
    }
  } else if (statusText) {
    statusText.textContent = lastWin > 0 ? "Gain !" : "Aucun gain";
  }
}

// -----------------------------------------------------------------------------
// Utilitaires
// -----------------------------------------------------------------------------
function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  try {
    s.currentTime = 0;
    s.play().catch(() => {});
  } catch (e) {
    // iOS peut refuser, ce n’est pas grave
  }
}

// -----------------------------------------------------------------------------
// Démarrage
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
  initPixi();
});
