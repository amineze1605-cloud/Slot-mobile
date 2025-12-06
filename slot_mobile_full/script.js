// script.js
// Frontend PIXI pour Slot Mobile (spritesheet.png découpée en 12 symboles)

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

let audioUnlocked = false;

// petit helper audio (avec “déverrouillage” iOS)
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  Object.values(sounds).forEach((s) => {
    try {
      s.muted = true;
      s.play().catch(() => {});
      s.pause();
      s.currentTime = 0;
      s.muted = false;
    } catch (e) {}
  });
}

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

let messageText;
let balanceText;
let betText;
let winText;

let slotContainer; // pour savoir si on clique bien sur la grille

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

function updateHudTexts() {
  if (balanceText) balanceText.text = `Solde : ${balance}`;
  if (betText) betText.text = `Mise : ${bet}`;
  if (winText) winText.text = `Dernier gain : ${lastWin}`;
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

    if (!symbolTextures.length) {
      showMessage("Erreur JS : spritesheet vide");
      return;
    }

    buildSlotScene();
    hideMessage();
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3) + HUD
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const gap = 8;
  const reelWidth = symbolSize + gap;
  const totalReelWidth = reelWidth * COLS;
  const slotHeight = ROWS * (symbolSize + gap);

  // Texte message (en haut)
  messageText = new PIXI.Text("Touchez la grille pour relancer", {
    fill: 0xffffff,
    fontSize: Math.round(h * 0.035),
  });
  messageText.anchor.set(0.5, 0);
  messageText.x = w / 2;
  messageText.y = h * 0.12;
  app.stage.addChild(messageText);

  // Conteneur de la grille
  slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.22;

  // Zone cliquable exactement sur la grille
  slotContainer.interactive = true;
  slotContainer.buttonMode = true;
  slotContainer.hitArea = new PIXI.Rectangle(
    0,
    0,
    totalReelWidth,
    slotHeight
  );
  slotContainer.on("pointertap", onGridTap);

  // Création des rouleaux / symboles
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
      sprite.y = r * (symbolSize + gap);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }

  // HUD du bas (solde / mise / gain)
  const hudY = slotContainer.y + slotHeight + h * 0.04;

  balanceText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: Math.round(h * 0.027),
  });
  betText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: Math.round(h * 0.027),
  });
  winText = new PIXI.Text("", {
    fill: 0xffffff,
    fontSize: Math.round(h * 0.027),
  });

  // positions approximativement comme avant
  balanceText.x = w * 0.08;
  betText.x = w * 0.43;
  winText.x = w * 0.68;

  balanceText.y = betText.y = winText.y = hudY;

  app.stage.addChild(balanceText);
  app.stage.addChild(betText);
  app.stage.addChild(winText);

  updateHudTexts();

  // Boutons +/- mise
  createBetButtons(hudY + h * 0.05);
}

// Création des boutons +1 / -1
function createBetButtons(y) {
  const w = app.renderer.width;
  const buttonWidth = w * 0.3;
  const buttonHeight = buttonWidth * 0.35;
  const cornerRadius = 18;

  function makeButton(label, x, onClick) {
    const g = new PIXI.Graphics();
    g.lineStyle(3, 0xf6c65b);
    g.beginFill(0x050814);
    g.drawRoundedRect(0, 0, buttonWidth, buttonHeight, cornerRadius);
    g.endFill();

    g.x = x - buttonWidth / 2;
    g.y = y;
    g.interactive = true;
    g.buttonMode = true;

    const t = new PIXI.Text(label, {
      fill: 0xffffff,
      fontSize: Math.round(buttonHeight * 0.4),
    });
    t.anchor.set(0.5);
    t.x = buttonWidth / 2;
    t.y = buttonHeight / 2;
    g.addChild(t);

    g.on("pointertap", (ev) => {
      ev.stopPropagation(); // très important : ne pas déclencher le spin
      onClick();
    });

    app.stage.addChild(g);
  }

  makeButton("-1", w * 0.3, () => {
    if (bet > 1) {
      bet -= 1;
      updateHudTexts();
    }
  });

  makeButton("+1", w * 0.7, () => {
    if (bet < 100) {
      bet += 1;
      updateHudTexts();
    }
  });
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
function onGridTap(e) {
  // premier contact → déverrouille l’audio sur iOS
  unlockAudio();

  if (spinning) return;

  // on démarre le spin immédiatement, *avant* tout await → son autorisé par iOS
  startSpin();
}

async function startSpin() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  spinning = true;
  lastWin = 0;
  balance -= bet;
  if (balance < 0) balance = 0;
  updateHudTexts();

  messageText.text = "Spin en cours…";

  // 🔊 son de spin joué immédiatement (toujours dans la même “pile” que l’évènement utilisateur)
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
    messageText.text = `Gagné : ${lastWin} – touchez la grille pour relancer`;
  } else {
    playSound("stop");
    messageText.text = "Touchez la grille pour relancer";
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
  }

  updateHudTexts();
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