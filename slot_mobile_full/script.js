// script.js
// Frontend PIXI pour Slot Mobile (spritesheet.png 3x4 = 12 symboles)

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
// Chargement manuel de spritesheet.png avec BaseTexture.from
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
    console.log("spritesheet.png =", fullW, "x", fullH);

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

    console.log("Textures découpées :", symbolTextures.length);

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();
    hideMessage(); // on enlève le texte, on laisse juste la grille
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
  if (!app || !app.renderer) {
    showMessage("Erreur JS : app PIXI manquante");
    return;
  }

  const w = app.renderer.width;
  const h = app.renderer.height;

  // Taille + espacement des symboles
  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.25; // grille un peu remontée

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

  // On n'affiche plus le loader par-dessus,
  // donc pas de texte ici pour ne pas gêner l'écran.
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