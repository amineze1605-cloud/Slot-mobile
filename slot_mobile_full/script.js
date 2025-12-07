// script.js
// Slot mobile avec bouton SPIN + sons simples

// --------------------------------------------------
// Références DOM
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// --------------------------------------------------
// Audio très simple (HTMLAudioElement)
// --------------------------------------------------
function makeSound(path) {
  const a = new Audio(path);
  a.preload = "auto";
  a.volume = 0.7;
  a.setAttribute("playsinline", "playsinline");
  return a;
}

const sounds = {
  spin: makeSound("assets/audio/spin.wav"),
  stop: makeSound("assets/audio/stop.wav"),
  win: makeSound("assets/audio/win.wav"),
  bonus: makeSound("assets/audio/bonus.wav"),
};

let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // petit ping silencieux pour "débloquer" iOS
  Object.values(sounds).forEach((a) => {
    try {
      a.muted = true;
      a.play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {});
    } catch (e) {}
  });
}

window.addEventListener("touchstart", unlockAudio, { once: true });
window.addEventListener("mousedown", unlockAudio, { once: true });

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

// éléments UI PIXI
let msgText;
let infoText;
let spinButton;
let minusButton;
let plusButton;

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
// Initialisation PIXI + chargement spritesheet
// --------------------------------------------------
function initPixi() {
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

  const loader = new PIXI.Loader();
  loader.add("sheet", "assets/spritesheet.png");
  loader.load((_, resources) => {
    try {
      const baseTexture = resources.sheet.texture.baseTexture;
      buildTexturesFromSheet(baseTexture);
      buildScene();
      hideMessage();
      setMainMessage("Touchez SPIN pour relancer");
      updateInfoText();
    } catch (e) {
      console.error(e);
      showMessage("Erreur JS : chargement assets");
    }
  });
}

// découpe la spritesheet 3 colonnes x 4 lignes = 12 symboles
function buildTexturesFromSheet(baseTexture) {
  symbolTextures = [];
  const COLS_SHEET = 3;
  const ROWS_SHEET = 4;
  const frameW = baseTexture.width / COLS_SHEET;
  const frameH = baseTexture.height / ROWS_SHEET;

  for (let r = 0; r < ROWS_SHEET; r++) {
    for (let c = 0; c < COLS_SHEET; c++) {
      const rect = new PIXI.Rectangle(c * frameW, r * frameH, frameW, frameH);
      const tex = new PIXI.Texture(baseTexture, rect);
      symbolTextures.push(tex);
    }
  }
}

// --------------------------------------------------
// Construction de la scène (grille + textes + boutons)
// --------------------------------------------------
function buildScene() {
  app.stage.removeChildren();
  reels = [];

  const w = app.renderer.width;
  const h = app.renderer.height;

  const symbolSize = Math.min(w * 0.16, h * 0.16);
  const reelWidth = symbolSize + 8;
  const totalReelWidth = reelWidth * COLS;

  // conteneur principal pour la grille
  const slotContainer = new PIXI.Container();
  app.stage.addChild(slotContainer);

  slotContainer.x = (w - totalReelWidth) / 2;
  slotContainer.y = h * 0.25;

  // --- Grille de symboles 5x3 ---
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

  // --- Texte principal (message) ---
  const msgFontSize = Math.round(h * 0.035); // plus petit qu'avant
  msgText = new PIXI.Text("Chargement…", {
    fontFamily: "system-ui",
    fontSize: msgFontSize,
    fill: 0xffffff,
  });
  msgText.anchor.set(0.5);
  msgText.x = w / 2;
  msgText.y = h * 0.14;
  app.stage.addChild(msgText);

  // --- Texte infos : solde, mise, gain ---
  const infoFontSize = Math.round(h * 0.03);
  infoText = new PIXI.Text("", {
    fontFamily: "system-ui",
    fontSize: infoFontSize,
    fill: 0xffffff,
  });
  infoText.anchor.set(0.5);
  infoText.x = w / 2;
  infoText.y = slotContainer.y + ROWS * (symbolSize + 8) + h * 0.035;
  app.stage.addChild(infoText);

  // --- Boutons -1 / SPIN / +1 ---
  const buttonsY = infoText.y + h * 0.08;
  const btnWidth = w * 0.25;
  const btnHeight = h * 0.08;
  const btnGap = w * 0.04;
  const baseX = w / 2;

  minusButton = createButton("-1", btnWidth, btnHeight);
  minusButton.x = baseX - btnWidth - btnGap / 2;
  minusButton.y = buttonsY;
  minusButton.on("pointertap", () => changeBet(-1));
  app.stage.addChild(minusButton);

  spinButton = createButton("SPIN", btnWidth, btnHeight);
  spinButton.x = baseX;
  spinButton.y = buttonsY;
  spinButton.on("pointertap", () => {
    onSpinClick();
  });
  app.stage.addChild(spinButton);

  plusButton = createButton("+1", btnWidth, btnHeight);
  plusButton.x = baseX + btnWidth + btnGap / 2;
  plusButton.y = buttonsY;
  plusButton.on("pointertap", () => changeBet(1));
  app.stage.addChild(plusButton);
}

function createButton(label, w, h) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();
  const radius = Math.min(w, h) * 0.18;

  g.lineStyle(3, 0xffcc66);
  g.beginFill(0x222638);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, radius);
  g.endFill();

  const text = new PIXI.Text(label, {
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.4),
    fill: 0xffffff,
  });
  text.anchor.set(0.5);

  container.addChild(g);
  container.addChild(text);

  container.interactive = true;
  container.buttonMode = true;

  return container;
}

function setMainMessage(txt) {
  if (!msgText) return;
  msgText.text = txt;
}

function updateInfoText() {
  if (!infoText) return;
  infoText.text = `Solde : ${balance}  |  Mise : ${bet}  |  Dernier gain : ${lastWin}`;
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
  const safeIndex = ((index % symbolTextures.length) + symbolTextures.length) % symbolTextures.length;
  return symbolTextures[safeIndex] || symbolTextures[0];
}

// --------------------------------------------------
// Gestion de la mise
// --------------------------------------------------
function changeBet(delta) {
  const newBet = bet + delta;
  const minBet = 1;
  const maxBet = 50;

  if (newBet < minBet || newBet > maxBet) return;
  bet = newBet;
  updateInfoText();
}

// --------------------------------------------------
// Gestion du SPIN
// --------------------------------------------------
async function onSpinClick() {
  if (spinning) return;
  if (!app || !symbolTextures.length) return;

  if (bet > balance) {
    setMainMessage("Solde insuffisant");
    playSound("stop");
    return;
  }

  spinning = true;
  lastWin = 0;
  balance -= bet;
  updateInfoText();
  setMainMessage("SPIN en cours…");
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
    setMainMessage("Erreur API");
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
  updateInfoText();

  if (lastWin > 0) {
    playSound("win");
    setMainMessage(`Gagné : ${lastWin} — touchez SPIN pour relancer`);
  } else {
    playSound("stop");
    setMainMessage("Pas de gain — touchez SPIN pour relancer");
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
    showMessage("Erreur JS : init");
  }
});