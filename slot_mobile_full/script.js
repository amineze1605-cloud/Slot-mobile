// script.js
// Frontend PIXI pour Slot Mobile (spritesheet.png découpé en 12 symboles)

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

// UI PIXI
let uiContainer;
let touchText;
let balanceText;
let betText;
let winText;

// --------------------------------------------------
// Helpers UI (DOM loader)
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
// Chargement de la spritesheet.png avec PIXI.Texture
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve, reject) => {
    try {
      const texture = PIXI.Texture.from("assets/spritesheet.png");
      if (!texture) {
        reject(new Error("PIXI.Texture.from a retourné undefined"));
        return;
      }

      const baseTexture = texture.baseTexture;
      if (!baseTexture) {
        reject(new Error("texture.baseTexture manquant"));
        return;
      }

      // Déjà prête
      if (baseTexture.valid) {
        resolve(baseTexture);
        return;
      }

      // Attente du chargement
      baseTexture.once("loaded", () => {
        resolve(baseTexture);
      });
      baseTexture.once("error", (err) => {
        reject(err || new Error("Erreur chargement baseTexture"));
      });
    } catch (e) {
      reject(e);
    }
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

  showMessage("Chargement…");

  // Création de l'application
  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: true,
  });

  try {
    // 1) on charge la spritesheet
    const baseTexture = await loadSpritesheet();
    const fullW = baseTexture.width;
    const fullH = baseTexture.height;

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

    // 2) on construit la scène + UI
    buildSlotScene();
    buildUI();

    hideMessage(); // on enlève l’overlay DOM, tout est prêt
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
  if (!app) return;

  const w = app.renderer.view.width;
  const h = app.renderer.view.height;

  const symbolSize = Math.min(w, h) * 0.12; // taille des symboles
  const spacing = symbolSize * 0.12; // espace entre symboles
  const reelWidth = symbolSize + spacing;
  const totalReelWidth = reelWidth * COLS;

  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.28; // grille un peu remontée

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

  // Interactions : toucher l'écran pour lancer
  canvas.addEventListener("click", onSpinClick);
  canvas.addEventListener("touchstart", onSpinClick);
}

// --------------------------------------------------
// UI PIXI (texte haut + HUD bas)
// --------------------------------------------------
function buildUI() {
  if (!app) return;

  const w = app.renderer.view.width;
  const h = app.renderer.view.height;

  uiContainer = new PIXI.Container();
  app.stage.addChild(uiContainer);

  const titleStyle = new PIXI.TextStyle({
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontSize: 28,
    fill: 0xffffff,
  });

  const hudStyle = new PIXI.TextStyle({
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontSize: 18,
    fill: 0xffffff,
  });

  // Texte "Touchez pour lancer"
  touchText = new PIXI.Text("Touchez pour lancer", titleStyle);
  touchText.anchor.set(0.5, 0.5);
  touchText.x = w / 2;
  touchText.y = h * 0.12;
  uiContainer.addChild(touchText);

  // HUD bas : balance / bet / win
  balanceText = new PIXI.Text("", hudStyle);
  betText = new PIXI.Text("", hudStyle);
  winText = new PIXI.Text("", hudStyle);

  balanceText.anchor.set(0, 0.5);
  betText.anchor.set(0.5, 0.5);
  winText.anchor.set(1, 0.5);

  const hudY = h * 0.92;
  balanceText.x = w * 0.08;
  betText.x = w * 0.5;
  winText.x = w * 0.92;

  balanceText.y = betText.y = winText.y = hudY;

  uiContainer.addChild(balanceText);
  uiContainer.addChild(betText);
  uiContainer.addChild(winText);

  updateHUD();
}

function updateHUD() {
  if (balanceText) balanceText.text = "Solde : " + balance;
  if (betText) betText.text = "Mise : " + bet;
  if (winText) winText.text = "Dernier gain : " + (lastWin || 0);
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
  updateHUD();
  playSound("spin");

  if (touchText) touchText.text = "Lancement…";

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
    if (touchText) touchText.text = "Erreur API";
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
    // plus tard on pourra afficher un message spécial
  }

  updateHUD();

  if (touchText) {
    if (lastWin > 0) {
      touchText.text = "Gagné : " + lastWin + " — touchez pour relancer";
    } else {
      touchText.text = "Touchez pour relancer";
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
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});