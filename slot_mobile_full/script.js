// script.js
// Slot mobile avec spritesheet PNG, animation simple, boutons de mise et feedback de gain

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
  } catch (_) {}
}

// --------------------------------------------------
// Variables de jeu
// --------------------------------------------------
let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

const MIN_BET = 1;
const MAX_BET = 10;

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;

// UI PIXI
let slotContainer;
let statusText;
let uiContainer;
let balanceText;
let betText;
let lastWinText;
let minusButton;
let plusButton;

// animation "shuffle"
let shuffleFn = null;

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

function setStatus(text) {
  if (statusText) {
    statusText.text = text;
  }
}

function updateInfoTexts() {
  if (!balanceText || !betText || !lastWinText) return;
  balanceText.text = `Solde : ${balance}`;
  betText.text = `Mise : ${bet}`;
  lastWinText.text = `Dernier gain : ${lastWin}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        resolve({
          baseTexture,
          width: img.width,
          height: img.height,
        });
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
    const { baseTexture, width: fullW, height: fullH } = await loadSpritesheet();
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
    hideMessage();
    setStatus("Touchez pour lancer");
  } catch (e) {
    console.error("Erreur chargement spritesheet.png", e);
    const msg = e && e.message ? e.message : String(e);
    showMessage("Erreur JS : chargement assets (" + msg + ")");
  }
}

// --------------------------------------------------
// Construction de la scène slot (5x3) + UI
// --------------------------------------------------
function buildSlotScene() {
  const w = app.renderer.width;
  const h = app.renderer.height;

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;

  // Conteneur des rouleaux
  slotContainer = new PIXI.Container();
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

  // Texte de statut (instruction / gain)
  const statusStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 28,
    fontWeight: "bold",
    dropShadow: true,
    dropShadowDistance: 2,
    dropShadowColor: 0x000000,
  });

  statusText = new PIXI.Text("Touchez pour lancer", statusStyle);
  statusText.anchor.set(0.5, 0.5);
  statusText.x = w / 2;
  statusText.y = h * 0.15;
  app.stage.addChild(statusText);

  // UI bas (solde, mise, dernier gain + boutons)
  uiContainer = new PIXI.Container();
  app.stage.addChild(uiContainer);

  const infoStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 18,
  });

  balanceText = new PIXI.Text("", infoStyle);
  betText = new PIXI.Text("", infoStyle);
  lastWinText = new PIXI.Text("", infoStyle);

  balanceText.anchor.set(0, 0.5);
  betText.anchor.set(0.5, 0.5);
  lastWinText.anchor.set(1, 0.5);

  const infoY = h - 30;

  balanceText.position.set(16, infoY);
  betText.position.set(w / 2, infoY);
  lastWinText.position.set(w - 16, infoY);

  uiContainer.addChild(balanceText, betText, lastWinText);

  // Boutons de mise +/- au-dessus de la barre d'info
  const buttonY = h * 0.72;
  const buttonSpacing = 90;

  minusButton = createButton("-1", w / 2 - buttonSpacing, buttonY, () => {
    changeBet(-1);
  });

  plusButton = createButton("+1", w / 2 + buttonSpacing, buttonY, () => {
    changeBet(1);
  });

  uiContainer.addChild(minusButton, plusButton);

  updateInfoTexts();

  // Clic sur tout le stage = SPIN (sauf boutons qui stopPropagation)
  app.stage.interactive = true;
  app.stage.on("pointertap", onSpinClick);
}

// --------------------------------------------------
// Création d'un bouton simple PIXI
// --------------------------------------------------
function createButton(label, x, y, onClick) {
  const container = new PIXI.Container();

  const bg = new PIXI.Graphics();
  const width = 70;
  const height = 36;
  const radius = 8;

  bg.beginFill(0x222638);
  bg.drawRoundedRect(-width / 2, -height / 2, width, height, radius);
  bg.endFill();

  const border = new PIXI.Graphics();
  border.lineStyle(2, 0xf6c14b);
  border.drawRoundedRect(-width / 2, -height / 2, width, height, radius);

  const txtStyle = new PIXI.TextStyle({
    fill: 0xffffff,
    fontSize: 18,
    fontWeight: "bold",
  });

  const txt = new PIXI.Text(label, txtStyle);
  txt.anchor.set(0.5, 0.5);

  container.addChild(bg, border, txt);
  container.position.set(x, y);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointertap", (e) => {
    e.stopPropagation(); // évite de déclencher le spin
    if (onClick) onClick();
  });

  return container;
}

function changeBet(delta) {
  bet += delta;
  if (bet < MIN_BET) bet = MIN_BET;
  if (bet > MAX_BET) bet = MAX_BET;

  // Option : ne pas dépasser le solde
  if (bet > balance) bet = balance > 0 ? balance : MIN_BET;

  updateInfoTexts();
}

// --------------------------------------------------
// Animation "shuffle" pendant le spin
// --------------------------------------------------
function startShuffleAnimation() {
  if (!app || !symbolTextures.length) return;
  if (shuffleFn) return;

  shuffleFn = () => {
    for (const reel of reels) {
      for (const sprite of reel.symbols) {
        const idx = Math.floor(Math.random() * symbolTextures.length);
        sprite.texture = symbolTextures[idx];
      }
    }
  };

  app.ticker.add(shuffleFn);
}

function stopShuffleAnimation() {
  if (!app || !shuffleFn) return;
  app.ticker.remove(shuffleFn);
  shuffleFn = null;
}

// petit flash quand il y a un gain
function flashWin() {
  if (!app) return;

  const g = new PIXI.Graphics();
  g.beginFill(0xffffff, 0.35);
  g.drawRect(0, 0, app.renderer.width, app.renderer.height);
  g.endFill();
  app.stage.addChild(g);

  const fadeFn = (delta) => {
    g.alpha -= 0.08 * (delta || 1);
    if (g.alpha <= 0) {
      app.ticker.remove(fadeFn);
      app.stage.removeChild(g);
      g.destroy();
    }
  };

  app.ticker.add(fadeFn);
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
  if (e && e.data && e.data.originalEvent && e.data.originalEvent.preventDefault) {
    e.data.originalEvent.preventDefault();
  }

  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  if (balance < bet || bet <= 0) {
    setStatus("Solde insuffisant");
    playSound("stop");
    return;
  }

  spinning = true;
  lastWin = 0;
  balance -= bet;
  updateInfoTexts();
  setStatus("Lancement…");
  playSound("spin");

  startShuffleAnimation();

  let data;
  try {
    const response = await fetch("/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet }),
    });
    data = await response.json();
  } catch (err) {
    console.error("Erreur API /spin", err);
    stopShuffleAnimation();
    spinning = false;
    setStatus("Erreur réseau, réessayez");
    playSound("stop");
    return;
  }

  const grid = data && data.result ? data.result : [];
  const win = data && data.win ? data.win : 0;
  const bonus = data && data.bonus ? data.bonus : { freeSpins: 0, multiplier: 1 };

  // laisse tourner au minimum un peu
  await wait(600);

  stopShuffleAnimation();
  applyResultToReels(grid);
  finishSpin(win, bonus);
}

// --------------------------------------------------
// Fin de spin
// --------------------------------------------------
function finishSpin(win, bonus) {
  spinning = false;

  lastWin = win || 0;
  balance += lastWin;
  updateInfoTexts();

  if (lastWin > 0) {
    setStatus(`Gagné : ${lastWin}`);
    playSound("win");
    flashWin();
  } else {
    setStatus("Touchez pour relancer");
    playSound("stop");
  }

  if (bonus && (bonus.freeSpins > 0 || bonus.multiplier > 1)) {
    playSound("bonus");
    // Tu peux personnaliser le message bonus ici si tu veux
    // setStatus(`BONUS ! +${bonus.freeSpins} tours x${bonus.multiplier}`);
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