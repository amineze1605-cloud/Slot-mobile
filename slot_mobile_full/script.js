// script.js
// Frontend PIXI pour Slot Mobile Pro

// ------------------------------------------------------
// Références DOM
// ------------------------------------------------------
const canvas = document.getElementById("game");
const loaderOverlay = document.getElementById("loader");
const overlay = document.getElementById("overlay");
const spinButton = document.getElementById("spin");
const statusText = document.getElementById("status");
const balanceEl = document.getElementById("balance");
const betEl = document.getElementById("bet");
const winEl = document.getElementById("win");

// Petit helper pour afficher des messages dans le loader
function setLoaderText(msg) {
  if (loaderOverlay) {
    loaderOverlay.textContent = msg;
  }
}

// ------------------------------------------------------
// Audio (HTML5)
// ------------------------------------------------------
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

// Déblocage du son sur iOS (premier touch)
function unlockAudio() {
  Object.values(sounds).forEach((s) => {
    try {
      s.muted = true;
      s.play().catch(() => {});
      s.pause();
      s.currentTime = 0;
      s.muted = false;
    } catch (_) {}
  });
}

// ------------------------------------------------------
// Variables de jeu
// ------------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;
const SYMBOLS_COUNT = 6; // doit correspondre au spritesheet

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// ------------------------------------------------------
// Initialisation PIXI
// ------------------------------------------------------
function initPixi() {
  try {
    if (!canvas) {
      console.error("Canvas #game introuvable");
      setLoaderText("Erreur : canvas introuvable");
      return;
    }

    app = new PIXI.Application({
      view: canvas,
      resizeTo: window,
      backgroundColor: 0x050814,
      antialias: true,
    });

    // Gestion d'erreur du loader PIXI
    PIXI.Loader.shared.onError.add((err) => {
      console.error("Erreur loader PIXI :", err);
      setLoaderText("Erreur chargement spritesheet");
    });

    // Chargement direct de l'image spritesheet.png
PIXI.Loader.shared
  .add("symbols", "assets/spritesheet.png")
  .load(onAssetsLoaded);

    setLoaderText("Chargement des ressources…");
  } catch (e) {
    console.error("Erreur dans initPixi :", e);
    setLoaderText("Erreur JS : " + e.message);
  }
}

// ------------------------------------------------------
// Chargement terminé
function onAssetsLoaded(loader, resources) {
  // On récupère la texture de base de spritesheet.png
  const baseTexture = resources.symbols.texture.baseTexture;

  symbolTextures = [];

  // On coupe l'image en SYMBOLS_COUNT morceaux horizontaux
  const total = SYMBOLS_COUNT;            // 6 chez toi
  const frameWidth = baseTexture.width / total;
  const frameHeight = baseTexture.height;

  for (let i = 0; i < total; i++) {
    const frame = new PIXI.Rectangle(
      i * frameWidth,
      0,
      frameWidth,
      frameHeight
    );
    const texture = new PIXI.Texture(baseTexture, frame);
    symbolTextures.push(texture);
  }

  // On construit la scène une fois les textures prêtes
  buildSlotScene();
  setupUI();
}

    if (!sheet) {
      console.warn("Spritesheet vide ou invalide, textures par défaut.");
      symbolTextures = [];
    } else {
      symbolTextures = Object.values(sheet.textures || {});
    }

    buildSlotScene();
    setupUI();

    if (loaderOverlay) {
      loaderOverlay.style.display = "none";
    }
  } catch (e) {
    console.error("Erreur dans onAssetsLoaded :", e);
    setLoaderText("Erreur : " + e.message);
  }
}

// ------------------------------------------------------
// Construction de la scène (5x3)
// ------------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const reelWidth = w * 0.13;
  const totalReelWidth = reelWidth * COLS;
  const symbolSize = (h * 0.5) / ROWS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);
  slotContainer.x = (w - totalReelWidth) * 0.5;
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

// Récupérer une texture à partir d’un index
function getTextureByIndex(index) {
  if (!symbolTextures.length) {
    return PIXI.Texture.WHITE;
  }
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex];
}

// ------------------------------------------------------
// UI & interactions
// ------------------------------------------------------
function setupUI() {
  updateUI();

  // Overlay d’activation audio (si présent dans le HTML)
  if (overlay) {
    overlay.style.display = "flex";

    const start = (e) => {
      e.preventDefault();
      unlockAudio();
      overlay.style.display = "none";
      if (statusText) {
        statusText.textContent = "Prêt à jouer";
      }
    };

    overlay.addEventListener("click", start);
    overlay.addEventListener("touchstart", start);
  }

  // Bouton SPIN (si présent dans le HTML)
  if (spinButton) {
    spinButton.addEventListener("click", onSpinClick);
  }
}

// Mise à jour des textes UI
function updateUI() {
  if (balanceEl) balanceEl.textContent = balance.toString();
  if (betEl) betEl.textContent = bet.toString();
  if (winEl) winEl.textContent = lastWin.toString();
}

// ------------------------------------------------------
// Gestion du SPIN
// ------------------------------------------------------
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

    const data = await response.json();
    const grid = data.result;        // [ [0..5], [..], [..] ]
    const win = data.win || 0;
    const bonus = data.bonus || {};

    applyResultToReels(grid);

    // petite attente pour simuler le temps de rotation
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

// Applique la grille de symboles au rendu
function applyResultToReels(grid) {
  if (!Array.isArray(grid) || grid.length !== ROWS) {
    console.warn("Grille invalide :", grid);
    return;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = grid[r][c];
      const reel = reels[c];
      if (!reel || !reel.symbols[r]) continue;
      const sprite = reel.symbols[r];
      sprite.texture = getTextureByIndex(value);
    }
  }
}

// Fin de spin : mise à jour solde + sons + message
function finishSpin(win, bonus) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;
  updateUI();

  if (lastWin > 0) {
    playSound("win");
    if (statusText) statusText.textContent = "Gain : " + lastWin;
  } else {
    playSound("stop");
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
    if (statusText) {
      statusText.textContent =
        "Bonus ! " +
        (bonus.freeSpins ? `${bonus.freeSpins} tours gratuits ` : "") +
        (bonus.multiplier && bonus.multiplier > 1
          ? `x${bonus.multiplier}`
          : "");
    }
  } else if (statusText) {
    statusText.textContent = lastWin > 0 ? "Bravo !" : "Réessaie";
  }
}

// ------------------------------------------------------
// Utilitaires
// ------------------------------------------------------
function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  try {
    s.currentTime = 0;
    s.play().catch(() => {});
  } catch (_) {
    // iOS peut refuser, ce n’est pas grave
  }
}

// ------------------------------------------------------
// Démarrage
// ------------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();

    // Sécurité : si au bout de 10s on est toujours sur “Chargement…”
    // on affiche un message d’erreur générique.
    setTimeout(() => {
      if (loaderOverlay && loaderOverlay.style.display !== "none") {
        setLoaderText("Erreur : chargement trop long (JS)");
      }
    }, 10000);
  } catch (e) {
    console.error("Erreur globale :", e);
    setLoaderText("Erreur : " + e.message);
  }
});
