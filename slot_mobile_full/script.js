// script.js
// Slot mobile : PIXI v5 + spritesheet.png découpée manuellement

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
  a.volume = 0.7;
});

let audioUnlocked = false;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // petit hack iOS : on fait un play() muet une fois
  Object.values(sounds).forEach((s) => {
    try {
      const prevMuted = s.muted;
      s.muted = true;
      s.play()
        .then(() => {
          s.pause();
          s.currentTime = 0;
          s.muted = prevMuted;
        })
        .catch(() => {
          s.muted = prevMuted;
        });
    } catch (e) {}
  });
}

window.addEventListener(
  "touchend",
  () => {
    unlockAudioOnce();
  },
  { once: true }
);
window.addEventListener(
  "click",
  () => {
    unlockAudioOnce();
  },
  { once: true }
);

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

let messageText; // texte en haut
let infoText; // texte en bas
let isReady = false; // la grille est prête

// --------------------------------------------------
// Helpers UI
// --------------------------------------------------
function showLoader(text) {
  if (!loaderEl) return;
  loaderEl.style.display = "flex";
  loaderEl.textContent = text;
}

function hideLoader() {
  if (!loaderEl) return;
  loaderEl.style.display = "none";
}

function updateInfoText() {
  if (!infoText) return;
  infoText.text = `Solde : ${balance}  |  Mise : ${bet}  |  Dernier gain : ${lastWin}`;
}

function setMessage(text) {
  if (!messageText) return;
  messageText.text = text;
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
    console.error("PIXI introuvable (CDN ?)");
    showLoader("Erreur JS : PIXI introuvable");
    return;
  }

  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: true,
  });

  showLoader("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();
    const fullW = baseTexture.width;
    const fullH = baseTexture.height;

    // 12 symboles = 3 colonnes x 4 lignes dans ton PNG
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
      showLoader("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();
    hideLoader();
    isReady = true;
    setMessage("Touchez SPIN pour lancer");
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showLoader("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3)
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelGapX = 8;
  const reelGapY = 8;
  const reelWidth = symbolSize + reelGapX;
  const totalReelWidth = reelWidth * COLS - reelGapX;

  // container principal pour la grille
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
      sprite.y = r * (symbolSize + reelGapY);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }

  // Texte du haut
  const msgStyle = new PIXI.TextStyle({
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 26,
    fill: 0xffffff,
  });
  messageText = new PIXI.Text("Chargement…", msgStyle);
  messageText.anchor.set(0.5, 0.5);
  messageText.x = w / 2;
  messageText.y = h * 0.12;
  app.stage.addChild(messageText);

  // Texte du bas (solde / mise / dernier gain)
  const infoStyle = new PIXI.TextStyle({
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 22,
    fill: 0xffffff,
  });
  infoText = new PIXI.Text("", infoStyle);
  infoText.anchor.set(0.5, 0.5);
  infoText.x = w / 2;
  infoText.y = slotContainer.y + ROWS * (symbolSize + reelGapY) + 32;
  app.stage.addChild(infoText);
  updateInfoText();

  // Boutons mise -1 / SPIN / +1
  const buttonY = infoText.y + 80;
  const minusX = w / 2 - 170;
  const spinX = w / 2;
  const plusX = w / 2 + 170;

  createBetButton(minusX, buttonY, "-1", () => {
    unlockAudioOnce(); // déverrouille aussi l'audio
    if (bet > 1) {
      bet -= 1;
      updateInfoText();
    }
  });

  createSpinButton(spinX, buttonY, "SPIN", () => {
    unlockAudioOnce();
    onSpinClick();
  });

  createBetButton(plusX, buttonY, "+1", () => {
    unlockAudioOnce();
    bet += 1;
    updateInfoText();
  });
}

// --------------------------------------------------
// Création d’un bouton générique (-1 / +1)
// --------------------------------------------------
function createBetButton(x, y, label, onClick) {
  const btnWidth = 130;
  const btnHeight = 70;
  const radius = 12;

  const container = new PIXI.Container();
  container.x = x - btnWidth / 2;
  container.y = y - btnHeight / 2;

  const g = new PIXI.Graphics();
  g.lineStyle(3, 0xffc857);
  g.beginFill(0x111827);
  g.drawRoundedRect(0, 0, btnWidth, btnHeight, radius);
  g.endFill();
  container.addChild(g);

  const txt = new PIXI.Text(label, {
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 28,
    fill: 0xffffff,
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = btnWidth / 2;
  txt.y = btnHeight / 2;
  container.addChild(txt);

  container.interactive = true;
  container.buttonMode = true;
  container.on("pointertap", (ev) => {
    ev.stopPropagation();
    onClick();
  });

  app.stage.addChild(container);
}

// --------------------------------------------------
// Bouton SPIN
// --------------------------------------------------
function createSpinButton(x, y, label, onClick) {
  const btnWidth = 150;
  const btnHeight = 80;
  const radius = 18;

  const container = new PIXI.Container();
  container.x = x - btnWidth / 2;
  container.y = y - btnHeight / 2;

  const g = new PIXI.Graphics();
  g.lineStyle(4, 0xffc857);
  g.beginFill(0x1f2937);
  g.drawRoundedRect(0, 0, btnWidth, btnHeight, radius);
  g.endFill();
  container.addChild(g);

  const txt = new PIXI.Text(label, {
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 28,
    fill: 0xffffff,
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = btnWidth / 2;
  txt.y = btnHeight / 2;
  container.addChild(txt);

  container.interactive = true;
  container.buttonMode = true;
  container.on("pointertap", (ev) => {
    ev.stopPropagation();
    onClick();
  });

  app.stage.addChild(container);
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
  const safeIndex = index % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
async function onSpinClick() {
  if (!isReady) return;
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  spinning = true;
  lastWin = 0;

  if (bet > balance) bet = balance > 0 ? balance : 1;

  balance -= bet;
  updateInfoText();
  setMessage("Spin en cours…");
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
    }, 300);
  } catch (err) {
    console.error("Erreur API /spin", err);
    if (loaderEl) {
      loaderEl.style.display = "flex";
      loaderEl.textContent = "Erreur JS : API";
    }
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
    setMessage(`Gagné : ${lastWin} — touchez SPIN pour relancer`);
  } else {
    playSound("stop");
    setMessage("Pas de gain — touchez SPIN pour relancer");
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
  }

  updateInfoText();
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
    showLoader("Erreur JS : init (" + msg + ")");
  }
});