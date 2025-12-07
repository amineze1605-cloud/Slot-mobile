// script.js
// Frontend PIXI pour Slot Mobile (PIXI v5 + spritesheet.png)

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

// Déblocage audio iOS au premier touch / clic
let audioUnlocked = false;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  Object.values(sounds).forEach((a) => {
    const oldVolume = a.volume;
    a.volume = 0;
    a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.volume = oldVolume;
      })
      .catch(() => {
        a.volume = oldVolume;
      });
  });

  window.removeEventListener("touchstart", unlockAudioOnce);
  window.removeEventListener("mousedown", unlockAudioOnce);
}

window.addEventListener("touchstart", unlockAudioOnce, { passive: true });
window.addEventListener("mousedown", unlockAudioOnce);

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
let gridContainer;
let messageText;
let footerText;
let betMinusBtn;
let betPlusBtn;

// --------------------------------------------------
// Helpers UI HTML
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

// Création des 12 textures (3 colonnes x 4 lignes)
function createSymbolTextures(baseTexture) {
  const fullW = baseTexture.width;
  const fullH = baseTexture.height;

  const COLS_SHEET = 3;
  const ROWS_SHEET = 4;
  const frameW = fullW / COLS_SHEET;
  const frameH = fullH / ROWS_SHEET;

  const textures = [];

  for (let r = 0; r < ROWS_SHEET; r++) {
    for (let c = 0; c < COLS_SHEET; c++) {
      const rect = new PIXI.Rectangle(c * frameW, r * frameH, frameW, frameH);
      const tex = new PIXI.Texture(baseTexture, rect);
      textures.push(tex);
    }
  }

  return textures;
}

// --------------------------------------------------
// Initialisation PIXI + scène
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
    const baseTexture = await loadSpritesheet();
    symbolTextures = createSymbolTextures(baseTexture);

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();
    buildUI();

    hideMessage();
    setMessage("Touchez la grille pour relancer");
    updateFooterText();
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

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelSpacing = 8;
  const rowSpacing = 8;

  const reelWidth = symbolSize + reelSpacing;
  const totalReelWidth = reelWidth * COLS - reelSpacing;
  const totalReelHeight = ROWS * symbolSize + (ROWS - 1) * rowSpacing;

  gridContainer = new PIXI.Container();
  app.stage.addChild(gridContainer);

  gridContainer.x = (w - totalReelWidth) / 2;
  gridContainer.y = h * 0.25;

  gridContainer.interactive = true;
  gridContainer.buttonMode = true;
  gridContainer.hitArea = new PIXI.Rectangle(
    0,
    0,
    totalReelWidth,
    totalReelHeight
  );

  gridContainer.on("pointerdown", onSpinClick);

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    gridContainer.addChild(reelContainer);
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
      sprite.y = r * (symbolSize + rowSpacing);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }
}

// --------------------------------------------------
// UI PIXI : texte + boutons de mise
// --------------------------------------------------
function buildUI() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // Styles un peu plus petits
  const headerStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 22,
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });

  const footerStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 18,
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });

  const buttonTextStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 22,
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });

  // Message en haut
  messageText = new PIXI.Text("Chargement…", headerStyle);
  messageText.anchor.set(0.5, 0.5);
  messageText.x = w / 2;
  messageText.y = h * 0.12;
  app.stage.addChild(messageText);

  // Footer "Solde / Mise / Dernier gain"
  footerText = new PIXI.Text("", footerStyle);
  footerText.anchor.set(0.5, 0.5);
  footerText.x = w / 2;
  footerText.y = gridContainer.y + gridContainer.height + 40;
  app.stage.addChild(footerText);

  // Boutons de mise
  const btnWidth = 120;
  const btnHeight = 70;
  const btnRadius = 12;
  const btnY = footerText.y + 80;
  const btnMargin = 60;

  // Fonction utilitaire pour créer un bouton rectangulaire
  function createButton(label, onClick) {
    const container = new PIXI.Container();

    const g = new PIXI.Graphics();
    g.lineStyle(3, 0xffd36a, 1);
    g.beginFill(0x15192b);
    g.drawRoundedRect(-btnWidth / 2, -btnHeight / 2, btnWidth, btnHeight, btnRadius);
    g.endFill();
    container.addChild(g);

    const txt = new PIXI.Text(label, buttonTextStyle);
    txt.anchor.set(0.5);
    container.addChild(txt);

    container.interactive = true;
    container.buttonMode = true;
    container.on("pointerdown", (e) => {
      e.stopPropagation(); // ne pas déclencher le spin
      onClick();
    });

    return container;
  }

  betMinusBtn = createButton("-1", () => {
    if (bet > 1) {
      bet -= 1;
      updateFooterText();
    }
  });

  betPlusBtn = createButton("+1", () => {
    if (bet < 1000) {
      bet += 1;
      updateFooterText();
    }
  });

  betMinusBtn.x = w / 2 - (btnWidth / 2 + btnMargin);
  betPlusBtn.x = w / 2 + (btnWidth / 2 + btnMargin);
  betMinusBtn.y = betPlusBtn.y = btnY;

  app.stage.addChild(betMinusBtn);
  app.stage.addChild(betPlusBtn);
}

function setMessage(text) {
  if (messageText) {
    messageText.text = text;
  }
}

function updateFooterText() {
  if (!footerText) return;
  footerText.text = `Solde : ${balance}   |   Mise : ${bet}   |   Dernier gain : ${lastWin}`;
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
  e.stopPropagation();
  e.preventDefault();

  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  spinning = true;
  lastWin = 0;
  balance -= bet;
  if (balance < 0) balance = 0;
  updateFooterText();
  playSound("spin");
  setMessage("Spin en cours…");

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
    }, 350);
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

  updateFooterText();

  if (lastWin > 0) {
    setMessage(`Gain : ${lastWin} — touchez la grille pour relancer`);
  } else {
    setMessage("Pas de gain — touchez la grille pour relancer");
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