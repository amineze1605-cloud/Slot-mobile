// script.js
// Slot Mobile frontend – PIXI v5 + spritesheet manuelle

// --------------------------------------------------
// Références DOM
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// --------------------------------------------------
// Audio (MP3)
// --------------------------------------------------
const sounds = {
  spin: new Audio("assets/audio/spin.mp3"),
  stop: new Audio("assets/audio/stop.mp3"),
  win: new Audio("assets/audio/win.mp3"),
  bonus: new Audio("assets/audio/bonus.mp3"),
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
    // on ignore les erreurs iOS / autoplay
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

// UI PIXI
let messageText;
let hudText;
let minusButton;
let plusButton;
let spinButton;

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

function setMessage(txt) {
  if (!messageText) return;
  messageText.text = txt || "";
}

function updateHudText() {
  if (!hudText) return;
  hudText.text = `Solde : ${balance}  |  Mise : ${bet}  |  Dernier gain : ${lastWin}`;
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
        // PIXI v5 : Texture.from => baseTexture
        const texture = PIXI.Texture.from(img);
        const baseTexture = texture.baseTexture;
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
    buildUi();

    hideMessage();
    setMessage("Touchez SPIN pour lancer");
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
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;
  const visibleHeight = ROWS * (symbolSize + 8) - 8;

  const slotContainer = new PIXI.Container();
  slotContainer.name = "slotContainer";
  slotContainer.sortableChildren = true;
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.24;

  // Cadre de la grille – fond sombre + bord doré
  const paddingX = symbolSize * 0.35;
  const paddingY = symbolSize * 0.35;

  const frame = new PIXI.Graphics();
  frame.beginFill(0x111623);
  frame.lineStyle(4, 0xf6c144, 0.85);
  frame.drawRoundedRect(
    -paddingX,
    -paddingY,
    totalReelWidth + paddingX * 2,
    visibleHeight + paddingY * 2,
    22
  );
  frame.endFill();
  frame.zIndex = 0;
  slotContainer.addChild(frame);

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    reelContainer.zIndex = 1;
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

      // mise à l’échelle en gardant le ratio
      const scale = symbolSize / Math.max(texture.width, texture.height);
      sprite.scale.set(scale);
      sprite.x = (reelWidth - symbolSize) / 2;
      sprite.y = r * (symbolSize + 8);

      reelContainer.addChild(sprite);
      reel.symbols.push(sprite);
    }

    reels.push(reel);
  }
}

// --------------------------------------------------
// UI PIXI : message, HUD, boutons -1 / SPIN / +1
// --------------------------------------------------
function buildUi() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  // Message en haut
  messageText = new PIXI.Text(
    "",
    new PIXI.TextStyle({
      fill: 0xffffff,
      fontSize: Math.round(h * 0.035),
      fontWeight: "bold",
    })
  );
  messageText.anchor.set(0.5, 0.5);
  messageText.x = w / 2;
  messageText.y = h * 0.11;
  app.stage.addChild(messageText);

  // HUD en bas (solde / mise / gain)
  hudText = new PIXI.Text(
    "",
    new PIXI.TextStyle({
      fill: 0xffffff,
      fontSize: Math.round(h * 0.028),
    })
  );
  hudText.anchor.set(0.5, 0.5);
  hudText.x = w / 2;
  hudText.y = h * 0.72;
  app.stage.addChild(hudText);
  updateHudText();

  // Boutons
  const btnWidth = w * 0.25;
  const btnHeight = h * 0.075;
  const btnY = h * 0.84;
  const gap = w * 0.04;

  minusButton = createButton("-1", btnWidth, btnHeight, () => changeBet(-1));
  spinButton = createButton("SPIN", btnWidth, btnHeight, onSpinClick);
  plusButton = createButton("+1", btnWidth, btnHeight, () => changeBet(1));

  minusButton.x = w / 2 - btnWidth - gap;
  spinButton.x = w / 2;
  plusButton.x = w / 2 + btnWidth + gap;

  minusButton.y = spinButton.y = plusButton.y = btnY;

  app.stage.addChild(minusButton, spinButton, plusButton);
}

function createButton(label, width, height, onClick) {
  const container = new PIXI.Container();
  container.interactive = true;
  container.buttonMode = true;

  const g = new PIXI.Graphics();
  const radius = 16;
  g.lineStyle(3, 0xf6c144);
  g.beginFill(0x151b2e);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, radius);
  g.endFill();

  const text = new PIXI.Text(
    label,
    new PIXI.TextStyle({
      fill: 0xffffff,
      fontSize: Math.round(height * 0.4),
      fontWeight: "bold",
    })
  );
  text.anchor.set(0.5);

  container.addChild(g, text);

  const handler = (e) => {
    e.stopPropagation();
    onClick();
  };
  container.on("pointertap", handler);

  return container;
}

// --------------------------------------------------
// Gestion de la mise
// --------------------------------------------------
function changeBet(delta) {
  let newBet = bet + delta;
  if (newBet < 1) newBet = 1;
  if (newBet > 100) newBet = 100;
  bet = newBet;
  updateHudText();
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
  const safeIndex =
    ((index | 0) % symbolTextures.length + symbolTextures.length) %
    symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Gestion du SPIN via le bouton
// --------------------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  if (balance < bet) {
    setMessage("Solde insuffisant");
    return;
  }

  spinning = true;
  lastWin = 0;
  balance -= bet;
  updateHudText();
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
    setMessage("Erreur réseau /spin");
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
  updateHudText();

  if (lastWin > 0) {
    playSound("win");
    setMessage(`Vous gagnez ${lastWin} — touchez SPIN pour relancer`);
  } else {
    playSound("stop");
    setMessage("Pas de gain — touchez SPIN pour relancer");
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
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : init (" + msg + ")");
  }
});