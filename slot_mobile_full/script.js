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

function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  try {
    s.currentTime = 0;
    s.play().catch(() => {});
  } catch (e) {
    // iOS peut refuser, on ignore
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

// Quand le message "Touchez pour lancer" est affiché,
// on laisse l'overlay cliquable pour démarrer le jeu.
function enableStartOverlay() {
  if (!loaderEl) return;

  const handler = (e) => {
    e.preventDefault();
    loaderEl.removeEventListener("click", handler);
    loaderEl.removeEventListener("touchstart", handler);

    hideMessage();

    // On déclenche un premier spin "manuellement"
    onSpinClick({
      preventDefault() {}
    });
  };

  loaderEl.addEventListener("click", handler);
  loaderEl.addEventListener("touchstart", handler);
}

// --------------------------------------------------
// Découper le PNG en 12 textures (3 x 4)
// --------------------------------------------------
function sliceSheetToTextures(baseTexture) {
  const cols = 3; // 3 colonnes
  const rows = 4; // 4 lignes

  const tileW = baseTexture.width / cols;
  const tileH = baseTexture.height / rows;

  const textures = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = new PIXI.Rectangle(
        c * tileW,
        r * tileH,
        tileW,
        tileH
      );
      const tex = new PIXI.Texture(baseTexture, rect);
      textures.push(tex);
    }
  }

  return textures;
}

// Charger le PNG selon la version de PIXI
async function loadSymbolTextures() {
  const imgPath = "assets/spritesheet.png";

  // PIXI v7/v8 : Assets
  if (PIXI.Assets && PIXI.Assets.load) {
    const tex = await PIXI.Assets.load(imgPath);
    const baseTexture = tex.baseTexture || tex;
    return sliceSheetToTextures(baseTexture);
  }

  // PIXI v5/v6 : Loader
  return new Promise((resolve, reject) => {
    try {
      const loader = new PIXI.Loader();
      loader.add("symbolSheet", imgPath);
      loader.load((_, resources) => {
        const res = resources.symbolSheet;
        if (!res || !res.texture) {
          reject(new Error("Impossible de charger " + imgPath));
          return;
        }
        const baseTexture = res.texture.baseTexture;
        resolve(sliceSheetToTextures(baseTexture));
      });
      loader.onError.add((err) => {
        reject(err || new Error("Erreur Loader PIXI"));
      });
    } catch (e) {
      reject(e);
    }
  });
}

// --------------------------------------------------
// Initialisation PIXI + assets
// --------------------------------------------------
async function initPixi() {
  if (!canvas) {
    console.error("Canvas #game introuvable");
    showMessage("Erreur JS : canvas introuvable");
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
    // on charge le PNG et on le découpe en 12 symboles
    symbolTextures = await loadSymbolTextures();

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();

    // Première fois : on affiche l’overlay "Touchez pour lancer"
    showMessage("Touchez pour lancer");
    enableStartOverlay();
  } catch (e) {
    console.error("Erreur chargement assets", e);
    const msg = e && e.message ? e.message : "chargement assets";
    showMessage("Erreur assets : " + msg);
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // largeur d'une colonne (un rouleau)
  const reelWidth = w * 0.16;            // un peu plus large qu'avant
  const totalReelWidth = reelWidth * COLS;

  // taille du symbole : NE DOIT PAS dépasser la largeur de la colonne
  const maxSymbolFromHeight = (h * 0.5) / ROWS;   // 50% de la hauteur pour le slot
  const maxSymbolFromWidth  = reelWidth * 0.9;    // 90% de la largeur colonne
  const symbolSize = Math.min(maxSymbolFromHeight, maxSymbolFromWidth);

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  // centrer le bloc de rouleaux
  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.2;

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

      sprite.width  = symbolSize;
      sprite.height = symbolSize;

      // centrer le symbole dans la colonne
      sprite.x = (reelWidth - symbolSize) / 2;
      sprite.y = r * (symbolSize + 4);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }

  // clic / touch = spin
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
  if (e && e.preventDefault) e.preventDefault();

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
    showMessage("Erreur JS : API /spin");
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
}

// --------------------------------------------------
// Démarrage
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    const msg = e && e.message ? e.message : "init";
    showMessage("Erreur JS : " + msg);
  }
});
