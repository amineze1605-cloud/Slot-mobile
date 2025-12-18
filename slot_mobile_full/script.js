// script.js — Slot mobile PIXI v5 (5x3)
// ✅ Anti-LAG: l'animation démarre instantanément (fetch en parallèle)
// ✅ Anti-SWAP: positions Y verrouillées (pas de dérive), bounce via scale (ne révèle rien)
// ✅ STOP rouge (2e clic) + tick par rouleau au stop
// ✅ Glow "cheap" (sans GlowFilter) => beaucoup plus fluide sur iPhone
// ✅ UI: slot centré, stats sous slot, valeurs fixes mono, boutons alignés

// --------------------------------------------------
// PIXI global settings
// --------------------------------------------------
PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// --------------------------------------------------
// DOM & globales
// --------------------------------------------------
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

// IDs mapping
const PREMIUM77_ID = 0;
const BONUS_ID = 6;
const WILD_ID = 9;

// état
let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;
let freeSpins = 0;
let winMultiplier = 1;

// STOP / réseau
let stopRequested = false;
let stopRequestTime = 0;
let spinInFlight = false;

// résultat serveur (arrive en async)
let pendingGrid = null;
let gridArrivedAt = 0;

// HUD refs
let messageText;
let statsLabelText;
let statsValueText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

// highlight
let highlightedCells = [];
let highlightTimer = 0;

// slot refs
let slotContainer = null;
let slotFrame = null;
let slotMask = null;

// background
let bgContainer = null;

// layout
let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;
let visibleH = 0;

let layout = {
  slotX: 0,
  slotY: 0,
  slotW: 0,
  slotH: 0,
  framePadX: 18,
  framePadY: 18,
  frameRadius: 26,
  statsY: 0,
  buttonsY: 0,
};

// --------------------------------------------------
// SAFE TOP (notch)
// --------------------------------------------------
function getSafeTopPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(16, Math.round(h * 0.03));
}

// --------------------------------------------------
// VITESSES (départ plus rapide, bounce discret)
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 1.10,
    spinMs: 1500,
    startStaggerMs: 110,
    stopStaggerMs: 130,
    accelMs: 120,
    preDecelMs: 300,
    settleMs: 340,
    snapMs: 120,
    bounceMs: 180,
    bounceScaleAmp: 0.018, // bounce via scale (anti swap)
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.40,
    spinMs: 1220,
    startStaggerMs: 90,
    stopStaggerMs: 110,
    accelMs: 110,
    preDecelMs: 260,
    settleMs: 300,
    snapMs: 110,
    bounceMs: 170,
    bounceScaleAmp: 0.017,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.75,
    spinMs: 980,
    startStaggerMs: 75,
    stopStaggerMs: 95,
    accelMs: 100,
    preDecelMs: 220,
    settleMs: 270,
    snapMs: 100,
    bounceMs: 160,
    bounceScaleAmp: 0.016,
  },
];
let speedIndex = 0;

// --------------------------------------------------
// Glow cheap (très perf, pas de GlowFilter)
// --------------------------------------------------
const GLOW_COLORS = {
  wild: 0x2bff5a,
  bonus: 0x3aa6ff,
  premium77: 0xd45bff,
};

// --------------------------------------------------
// AUDIO (pool anti-lag / overlap)
// --------------------------------------------------
function makeAudioPool(url, size = 6, volume = 0.7) {
  const pool = [];
  for (let i = 0; i < size; i++) {
    const a = new Audio(url);
    a.preload = "auto";
    a.volume = volume;
    pool.push(a);
  }
  let idx = 0;
  return {
    play(vol) {
      const a = pool[idx];
      idx = (idx + 1) % pool.length;
      try {
        if (typeof vol === "number") a.volume = vol;
        a.currentTime = 0;
        a.play().catch(() => {});
      } catch (e) {}
    },
  };
}

const audio = {
  spin:  makeAudioPool("assets/audio/spin.mp3", 3, 0.70),
  stop:  makeAudioPool("assets/audio/stop.mp3", 5, 0.65),
  win:   makeAudioPool("assets/audio/win.mp3",  3, 0.70),
  bonus: makeAudioPool("assets/audio/bonus.mp3",3, 0.70),
  tick:  makeAudioPool("assets/audio/stop.mp3", 8, 0.22),
};

// iOS: "unlock" audio au 1er tap (sinon parfois silence)
let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try { audio.tick.play(0.001); } catch (e) {}
  try { audio.tick.play(0.001); } catch (e) {}
}

// --------------------------------------------------
// Loader helpers
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
// Spritesheet load
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = "assets/spritesheet.png?v=11";
    img.onload = () => {
      try {
        const baseTexture = PIXI.BaseTexture.from(img);
        baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
        baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
        baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
        baseTexture.update();
        resolve(baseTexture);
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => reject(e || new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// --------------------------------------------------
// Background (pas de cadre écran)
// --------------------------------------------------
function makeGradientTexture(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.floor(w));
  c.height = Math.max(2, Math.floor(h));
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.0, "#040712");
  g.addColorStop(0.45, "#070C1F");
  g.addColorStop(1.0, "#030510");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const v = ctx.createRadialGradient(
    c.width * 0.5, c.height * 0.35, 10,
    c.width * 0.5, c.height * 0.5,
    Math.max(c.width, c.height) * 0.75
  );
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, c.width, c.height);

  return PIXI.Texture.from(c);
}

function buildBackground() {
  const w = app.screen.width;
  const h = app.screen.height;

  if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }
  bgContainer = new PIXI.Container();

  const bg = new PIXI.Sprite(makeGradientTexture(w, h));
  bg.width = w;
  bg.height = h;
  bgContainer.addChild(bg);

  const stars = new PIXI.Graphics();
  const count = Math.floor((w * h) / 22000);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.80;
    const a = 0.08 + Math.random() * 0.28;
    const r = 0.6 + Math.random() * 1.2;
    stars.beginFill(0xffffff, a);
    stars.drawCircle(x, y, r);
    stars.endFill();
  }
  bgContainer.addChild(stars);

  app.stage.addChild(bgContainer);
}

// --------------------------------------------------
// Init PIXI
// --------------------------------------------------
async function initPixi() {
  if (!canvas) return console.error("Canvas #game introuvable");
  if (!window.PIXI) {
    console.error("PIXI introuvable");
    showMessage("Erreur JS : PIXI introuvable");
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: true,
    autoDensity: true,
    resolution: dpr,
    powerPreference: "high-performance",
  });
  app.renderer.roundPixels = true;

  // unlock audio au 1er touch/click
  app.view.addEventListener("pointerdown", unlockAudioOnce, { passive: true });

  showMessage("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();

    // 4x4 => 16 cases; on utilise 12 cases
    const fullW = baseTexture.width;
    const fullH = baseTexture.height;
    const COLS_SHEET = 4;
    const ROWS_SHEET = 4;
    const cellW = Math.round(fullW / COLS_SHEET);
    const cellH = Math.round(fullH / ROWS_SHEET);

    const positions = [
      [0, 0],[1, 0],[2, 0],[3, 0],
      [0, 1],[1, 1],[2, 1],[3, 1],
      [0, 2],[1, 2],[2, 2],[3, 2],
    ];

    symbolTextures = positions.map(([c, r]) => {
      const rect = new PIXI.Rectangle(c * cellW, r * cellH, cellW, cellH);
      return new PIXI.Texture(baseTexture, rect);
    });

    buildBackground();
    buildSlotScene();
    buildHUD();

    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");
    app.ticker.add(updateHighlight);

    window.addEventListener("resize", rebuildAll);
  } catch (e) {
    console.error("Erreur chargement", e);
    showMessage("Erreur JS : chargement assets (" + (e?.message || String(e)) + ")");
  }
}

// --------------------------------------------------
// Rebuild (resize)
// --------------------------------------------------
function rebuildAll() {
  try {
    if (!app) return;

    if (slotMask) { slotMask.destroy(true); slotMask = null; }
    if (slotFrame) { slotFrame.destroy(true); slotFrame = null; }
    if (slotContainer) { slotContainer.destroy(true); slotContainer = null; }
    if (paytableOverlay) { paytableOverlay.destroy(true); paytableOverlay = null; }
    if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }

    app.stage.removeChildren();
    reels = [];
    highlightedCells = [];

    buildBackground();
    buildSlotScene();
    buildHUD();

    updateHUDTexts(spinning ? "Spin…" : "Appuyez sur SPIN pour lancer");
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// --------------------------------------------------
// Symbol cell (glowSprite + mainSprite) — glow cheap
// --------------------------------------------------
function createSymbolCell(texture, sizePx) {
  const cell = new PIXI.Container();
  cell.roundPixels = true;

  const glowSprite = new PIXI.Sprite(texture);
  glowSprite.anchor.set(0.5);
  glowSprite.width = sizePx;
  glowSprite.height = sizePx;
  glowSprite.visible = false;
  glowSprite.roundPixels = true;
  glowSprite.alpha = 0.0;
  glowSprite.blendMode = PIXI.BLEND_MODES.ADD;
  glowSprite.scale.set(1.12); // halo un peu plus large

  const mainSprite = new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width = sizePx;
  mainSprite.height = sizePx;
  mainSprite.roundPixels = true;

  cell.addChild(glowSprite, mainSprite);
  return { container: cell, glow: glowSprite, main: mainSprite, symbolId: -1 };
}

function applySymbolVisual(cellObj, symbolId) {
  cellObj.symbolId = symbolId;

  cellObj.glow.visible = false;
  cellObj.glow.tint = 0xffffff;
  cellObj.glow.alpha = 0.0;

  if (symbolId === WILD_ID) {
    cellObj.glow.visible = true;
    cellObj.glow.tint = GLOW_COLORS.wild;
    cellObj.glow.alpha = 0.35;
  } else if (symbolId === BONUS_ID) {
    cellObj.glow.visible = true;
    cellObj.glow.tint = GLOW_COLORS.bonus;
    cellObj.glow.alpha = 0.35;
  } else if (symbolId === PREMIUM77_ID) {
    cellObj.glow.visible = true;
    cellObj.glow.tint = GLOW_COLORS.premium77;
    cellObj.glow.alpha = 0.30;
  }
}

function safeId(id) {
  const n = symbolTextures.length || 1;
  return ((id % n) + n) % n;
}
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

// allowGlow: false pendant spin/settle (perf), true à la fin
function setCellSymbol(cellObj, symbolId, allowGlow) {
  const sid = safeId(symbolId);
  const tex = symbolTextures[sid];
  cellObj.main.texture = tex;
  cellObj.glow.texture = tex;

  if (allowGlow) applySymbolVisual(cellObj, sid);
  else {
    cellObj.symbolId = sid;
    cellObj.glow.visible = false;
    cellObj.glow.alpha = 0.0;
  }
}

// --------------------------------------------------
// Slot scene + frame + mask + reels
// --------------------------------------------------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;
  const safeTop = getSafeTopPx();

  reelGap = 8;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  const symbolFromWidth = (maxTotalWidth - reelGap * (COLS - 1)) / COLS;

  const topZone = safeTop + Math.round(h * 0.10);
  const bottomZone = Math.round(h * 0.64);
  const availableH = Math.max(260, bottomZone - topZone);
  const symbolFromHeight = availableH * 0.36;

  const MAX_SYMBOL_PX = 256;
  symbolSize = Math.min(MAX_SYMBOL_PX, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

  reelStep = symbolSize + reelGap;
  visibleH = ROWS * reelStep - reelGap;

  const totalReelWidth = COLS * symbolSize + reelGap * (COLS - 1);

  layout.slotW = totalReelWidth;
  layout.slotH = visibleH;
  layout.slotX = Math.round((w - totalReelWidth) / 2);
  layout.slotY = Math.round(topZone + (availableH - visibleH) * 0.30);

  layout.statsY = layout.slotY + visibleH + layout.framePadY + Math.round(h * 0.03);
  layout.buttonsY = layout.statsY + Math.round(h * 0.12);

  slotContainer = new PIXI.Container();
  slotContainer.x = layout.slotX;
  slotContainer.y = layout.slotY;

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(6, 0xf2b632, 1);
  slotFrame.beginFill(0x060b1a, 0.78);
  slotFrame.drawRoundedRect(
    layout.slotX - layout.framePadX,
    layout.slotY - layout.framePadY,
    totalReelWidth + layout.framePadX * 2,
    visibleH + layout.framePadY * 2,
    layout.frameRadius
  );
  slotFrame.endFill();

  app.stage.addChild(slotFrame);
  app.stage.addChild(slotContainer);

  slotMask = new PIXI.Graphics();
  slotMask.beginFill(0xffffff, 1);
  slotMask.drawRect(0, 0, totalReelWidth, visibleH);
  slotMask.endFill();
  slotMask.x = layout.slotX;
  slotMask.y = layout.slotY;
  slotMask.renderable = false;
  app.stage.addChild(slotMask);
  slotContainer.mask = slotMask;

  reels = [];

  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    reelContainer.x = Math.round(c * (symbolSize + reelGap));
    reelContainer.y = 0;
    reelContainer.scale.y = 1;
    slotContainer.addChild(reelContainer);

    // 5 symboles: positions -1,0,1,2,3 (1 extra haut + 3 visibles + 1 extra bas)
    const cells = [];
    for (let i = 0; i < ROWS + 2; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx, true); // glow ON au repos

      cellObj.container.x = Math.round(symbolSize / 2);
      // y verrouillé (pas de dérive)
      cellObj.container.y = Math.round((i - 1) * reelStep + symbolSize / 2);

      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells,     // ordre top->bottom (0..4)
      offset: 0,
      vel: 0,

      state: "idle",      // idle | spin | settle | snap | bounce | done
      settleQueue: null,
      settleIdx: 0,
      didTick: false,

      bounceStart: 0,
      snapStart: 0,

      startAt: 0,
      minStopAt: 0,
      settleStart: 0,
      preDecelStart: 0,
    });
  }
}

// --------------------------------------------------
// Recycle anti-swap (Y LOCKED)
// - Pas de +reelStep infini
// - On garde toujours les Y sur [-1..3] * reelStep
// --------------------------------------------------
function recycleReelOneStepDown(reel, newTopId, allowGlow) {
  const s = reel.symbols;

  // bottom -> top
  const bottom = s.pop();
  s.unshift(bottom);

  // change texture hors écran (position -1)
  setCellSymbol(bottom, newTopId, allowGlow);

  // ✅ verrouillage des positions (anti swap / anti jitter iPhone)
  const half = symbolSize / 2;
  for (let i = 0; i < s.length; i++) {
    s[i].container.y = Math.round((i - 1) * reelStep + half);
  }
}

// --------------------------------------------------
// HUD
// --------------------------------------------------
function makeText(txt, size, x, y, anchorX = 0.5, anchorY = 0.5, weight = "600", mono = false) {
  const style = new PIXI.TextStyle({
    fontFamily: mono ? "ui-monospace, Menlo, monospace" : "system-ui",
    fontSize: size,
    fill: 0xffffff,
    fontWeight: weight,
  });
  const t = new PIXI.Text(txt, style);
  t.anchor.set(anchorX, anchorY);
  t.x = x;
  t.y = y;
  app.stage.addChild(t);
  return t;
}

function makeButton(label, width, height, opts = {}) {
  const container = new PIXI.Container();
  const g = new PIXI.Graphics();

  const bg = opts.bg ?? 0x0f172a;
  const bgA = opts.bgA ?? 0.78;
  const border = opts.border ?? 0xf2b632;

  g.beginFill(bg, bgA);
  g.lineStyle(4, border, 1);
  g.drawRoundedRect(-width / 2, -height / 2, width, height, Math.min(18, height * 0.35));
  g.endFill();

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.06);
  shine.drawRoundedRect(-width / 2 + 6, -height / 2 + 6, width - 12, height * 0.35, Math.min(14, height * 0.28));
  shine.endFill();

  const t = new PIXI.Text(label, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.40, 30),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  t.anchor.set(0.5);

  container.addChild(g, shine, t);
  container.interactive = true;
  container.buttonMode = true;

  container.on("pointerdown", () => (g.alpha = 0.75));
  container.on("pointerup", () => (g.alpha = 1.0));
  container.on("pointerupoutside", () => (g.alpha = 1.0));

  app.stage.addChild(container);
  container._bg = g;
  container._shine = shine;
  container._text = t;
  return container;
}

function setSpinButtonMode(isStop) {
  if (!btnSpin) return;
  if (isStop) {
    btnSpin._text.text = "STOP";
    btnSpin._bg.tint = 0xff2d2d; // rouge
    btnSpin._shine.alpha = 0.10;
  } else {
    btnSpin._text.text = "SPIN";
    btnSpin._bg.tint = 0xffffff;
    btnSpin._shine.alpha = 0.06;
  }
}

function makeSpeedButton(width, height) {
  const b = makeButton("", width, height);
  b._text.destroy();

  const tTop = new PIXI.Text("VITESSE", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.26, 18),
    fill: 0xffffff,
    fontWeight: "700",
  }));
  const tBottom = new PIXI.Text(SPEEDS[speedIndex].name, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.min(height * 0.34, 22),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  tTop.anchor.set(0.5);
  tBottom.anchor.set(0.5);
  tTop.y = -height * 0.18;
  tBottom.y = height * 0.18;

  b.addChild(tTop, tBottom);
  b._tBottom = tBottom;
  return b;
}

function updateSpeedButtonLabel() {
  if (btnSpeed) btnSpeed._tBottom.text = SPEEDS[speedIndex].name;
}

function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;

  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.032),
    w / 2,
    layout.slotY - layout.framePadY - Math.round(h * 0.05),
    0.5, 0.5, "700"
  );

  // Stats sous slot: labels fixes + valeurs mono (ne bouge pas)
  const labelSize = Math.round(h * 0.022);
  const valueSize = Math.round(h * 0.024);
  const statsX = w / 2;
  const y = layout.statsY;

  statsLabelText = makeText("Solde :      Mise :      Gain :", labelSize, statsX, y, 0.5, 0.5, "700", false);
  statsValueText = makeText("", valueSize, statsX, y, 0.5, 0.5, "900", true);

  const rectW = w * 0.28;
  const rectH = h * 0.072;

  const spinSize = Math.round(Math.min(w * 0.20, h * 0.13)); // carré + gros
  const yBtn = layout.buttonsY;

  btnSpin = makeButton("SPIN", spinSize, spinSize);
  btnSpin.x = w / 2;
  btnSpin.y = yBtn;

  btnMinus = makeButton("-1", rectW, rectH);
  btnPlus  = makeButton("+1", rectW, rectH);

  const gap = Math.round(w * 0.06);
  btnMinus.x = btnSpin.x - (spinSize / 2 + gap + rectW / 2);
  btnPlus.x  = btnSpin.x + (spinSize / 2 + gap + rectW / 2);
  btnMinus.y = yBtn;
  btnPlus.y  = yBtn;

  const secondY = yBtn + spinSize / 2 + rectH * 0.75;

  btnSpeed = makeSpeedButton(rectW, rectH * 0.92);
  btnSpeed.x = btnSpin.x - (rectW / 2 + gap / 2);
  btnSpeed.y = secondY;

  btnInfo = makeButton("INFO", rectW, rectH * 0.92);
  btnInfo.x = btnSpin.x + (rectW / 2 + gap / 2);
  btnInfo.y = secondY;

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinOrStop);
  btnInfo.on("pointerup", togglePaytable);

  btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    updateSpeedButtonLabel();
  });

  updateHUDNumbers();
  setSpinButtonMode(false);
}

function updateHUDTexts(msg) {
  if (messageText) messageText.text = msg;
}

function formatStatsValues() {
  const solde = String(balance).padStart(6, " ");
  const mise  = String(bet).padStart(3, " ");
  const gain  = String(lastWin).padStart(4, " ");
  return `${solde}      ${mise}      ${gain}`;
}
function updateHUDNumbers() {
  if (statsValueText) statsValueText.text = formatStatsValues();
}

// --------------------------------------------------
// Paytable overlay
// --------------------------------------------------
function createPaytableOverlay() {
  const w = app.screen.width;
  const h = app.screen.height;

  const container = new PIXI.Container();
  container.visible = false;
  container.interactive = true;

  const backdrop = new PIXI.Graphics();
  backdrop.beginFill(0x000000, 0.75);
  backdrop.drawRect(0, 0, w, h);
  backdrop.endFill();
  backdrop.interactive = true;
  container.addChild(backdrop);

  const panelWidth = w * 0.86;
  const panelHeight = h * 0.7;
  const panelX = (w - panelWidth) / 2;
  const panelY = (h - panelHeight) / 2;

  const panel = new PIXI.Graphics();
  panel.beginFill(0x111827, 0.95);
  panel.lineStyle(6, 0xf2b632, 1);
  panel.drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 24);
  panel.endFill();
  container.addChild(panel);

  const title = new PIXI.Text("Table des gains", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.035),
    fill: 0xffffff,
    fontWeight: "900",
  }));
  title.anchor.set(0.5, 0);
  title.x = w / 2;
  title.y = panelY + Math.round(h * 0.02);
  container.addChild(title);

  const bodyText =
    "Fruits (pastèque, pomme, cerises, citron) :\n" +
    "  3 : 2× mise | 4 : 3× | 5 : 4×\n\n" +
    "Cartes : 3× / 4× / 5×\n" +
    "Pièce : 4× / 5× / 6×\n" +
    "Couronne : 10× / 12× / 14×\n" +
    "BAR : 16× / 18× / 20×\n" +
    "7 rouge : 20× / 25× / 30×\n" +
    "77 mauve : 30× / 40× / 50×\n\n" +
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ déclenchent 10 free spins (gains ×2)";

  const body = new PIXI.Text(bodyText, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.024),
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: panelWidth * 0.80,
    lineHeight: Math.round(h * 0.03),
  }));
  body.anchor.set(0.5, 0);
  body.x = w / 2;
  body.y = title.y + title.height + Math.round(h * 0.02);
  container.addChild(body);

  const close = makeButton("FERMER", panelWidth * 0.35, Math.round(h * 0.06));
  close.x = w / 2;
  close.y = panelY + panelHeight - Math.round(h * 0.06);
  close.on("pointerup", () => togglePaytable(false));
  container.addChild(close);

  app.stage.addChild(container);
  return container;
}

function togglePaytable(forceVisible) {
  if (!paytableOverlay) paytableOverlay = createPaytableOverlay();
  if (typeof forceVisible === "boolean") paytableOverlay.visible = forceVisible;
  else paytableOverlay.visible = !paytableOverlay.visible;
}

// --------------------------------------------------
// Paylines / Paytable
// --------------------------------------------------
const PAYLINES = [
  [[0, 0],[1, 0],[2, 0],[3, 0],[4, 0]],
  [[0, 1],[1, 1],[2, 1],[3, 1],[4, 1]],
  [[0, 2],[1, 2],[2, 2],[3, 2],[4, 2]],
  [[0, 0],[1, 1],[2, 2],[3, 1],[4, 0]],
  [[0, 2],[1, 1],[2, 0],[3, 1],[4, 2]],
];

const PAYTABLE = {
  1:  { 3: 2, 4: 3, 5: 4 },
  3:  { 3: 2, 4: 3, 5: 4 },
  7:  { 3: 2, 4: 3, 5: 4 },
  10: { 3: 2, 4: 3, 5: 4 },
  4:  { 3: 3, 4: 4, 5: 5 },
  8:  { 3: 4, 4: 5, 5: 6 },
  5:  { 3: 10, 4: 12, 5: 14 },
  2:  { 3: 16, 4: 18, 5: 20 },
  11: { 3: 20, 4: 25, 5: 30 },
  0:  { 3: 30, 4: 40, 5: 50 },
};

function evaluateGrid(grid, betValue) {
  let baseWin = 0;
  const winningLines = [];
  let bonusCount = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  PAYLINES.forEach((coords, lineIndex) => {
    let base = null;
    let invalid = false;

    for (let i = 0; i < coords.length; i++) {
      const [col, row] = coords[i];
      const sym = grid[row][col];
      if (sym === BONUS_ID) { invalid = true; break; }
      if (sym !== WILD_ID) { base = sym; break; }
    }
    if (invalid || base === null) return;
    if (!PAYTABLE[base]) return;

    let count = 0;
    const cells = [];

    for (let i = 0; i < coords.length; i++) {
      const [col, row] = coords[i];
      const sym = grid[row][col];
      if (sym === BONUS_ID) break;

      if (sym === base || sym === WILD_ID) { count++; cells.push([col, row]); }
      else break;
    }

    if (count >= 3) {
      const mult = PAYTABLE[base]?.[count] || 0;
      if (mult > 0) {
        const lineWin = betValue * mult;
        baseWin += lineWin;
        winningLines.push({ lineIndex, cells, symbolId: base, count, amount: lineWin });
      }
    }
  });

  return { baseWin, winningLines, bonusTriggered: bonusCount >= 3 };
}

// --------------------------------------------------
// Highlight
// --------------------------------------------------
function startHighlight(cells) {
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;

    const targetY = row * reelStep + symbolSize / 2;

    // visibles = indices 1..3
    let best = reel.symbols[1];
    let bestD = Math.abs(best.container.y - targetY);
    for (let i = 2; i <= 3; i++) {
      const d = Math.abs(reel.symbols[i].container.y - targetY);
      if (d < bestD) { bestD = d; best = reel.symbols[i]; }
    }
    highlightedCells.push(best);
  });

  highlightTimer = 0;
}

function updateHighlight(delta) {
  if (!highlightedCells.length) return;

  highlightTimer += delta;
  const alpha = Math.sin(highlightTimer * 0.25) > 0 ? 0.35 : 1.0;
  highlightedCells.forEach((cell) => (cell.container.alpha = alpha));

  if (highlightTimer > 80) {
    highlightedCells.forEach((cell) => (cell.container.alpha = 1));
    highlightedCells = [];
    highlightTimer = 0;
  }
}

// --------------------------------------------------
// Easing / smoothing
// --------------------------------------------------
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t) {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function smoothFactor(dt, tauMs) {
  return 1 - Math.exp(-dt / Math.max(1, tauMs));
}

// --------------------------------------------------
// Stop + plans
// --------------------------------------------------
function requestStop() {
  if (!spinning || stopRequested) return;
  stopRequested = true;
  stopRequestTime = performance.now();
  audio.stop.play(0.60);
  updateHUDTexts("STOP…");
}

// initialise les timings (baseline)
function prepareReelPlans(now, preset) {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    r.offset = 0;
    r.vel = 0;
    r.container.y = 0;
    r.container.scale.y = 1;

    r.state = "spin";
    r.settleQueue = null;
    r.settleIdx = 0;
    r.didTick = false;

    r.startAt = now + c * preset.startStaggerMs;

    const baseStop = r.startAt + preset.spinMs + c * preset.stopStaggerMs;
    r.minStopAt = baseStop;

    r.settleStart = baseStop - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;
  }
}

// timing dynamique (jamais avant le réseau)
function computeDynamicSettleStart(now, r, col, preset) {
  const baseline = r.settleStart;

  // si grid pas arrivée => on ne settle pas
  if (!pendingGrid) return baseline;

  const gridReady = gridArrivedAt + col * 55;
  let desired = Math.max(baseline, gridReady);

  // STOP demandé => settle ASAP mais jamais avant gridReady
  if (stopRequested) {
    desired = Math.max(gridReady, now + 20);
  }

  return desired;
}

function computeDynamicPreDecelStart(settleStart, preset) {
  const mult = stopRequested ? 0.65 : 1.0;
  return settleStart - preset.preDecelMs * mult;
}

function buildSettleQueueForReel(grid, col) {
  // IMPORTANT: injection [B, M, T, random] => final visible = [T, M, B]
  const topId = safeId(grid[0][col]);
  const midId = safeId(grid[1][col]);
  const botId = safeId(grid[2][col]);
  return [botId, midId, topId, randomSymbolId()];
}

function applyGlowForAllVisible() {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    for (let i = 1; i <= 3; i++) applySymbolVisual(r.symbols[i], r.symbols[i].symbolId);
  }
}

// --------------------------------------------------
// Animation (démarre tout de suite, attend la grid sans bloquer)
// --------------------------------------------------
function animateSpinUntilDone(preset) {
  return new Promise((resolve) => {
    let prev = performance.now();

    function tick(now) {
      const dt = Math.max(0, now - prev);
      prev = now;

      let allDone = true;
      const k = smoothFactor(dt, 110);

      for (let c = 0; c < reels.length; c++) {
        const r = reels[c];

        if (now < r.startAt) { allDone = false; continue; }
        if (r.state !== "done") allDone = false;

        // ---------------- SPIN ----------------
        if (r.state === "spin") {
          const settleStartDyn = computeDynamicSettleStart(now, r, c, preset);
          const preDecelDyn = computeDynamicPreDecelStart(settleStartDyn, preset);

          // si on est en zone settle ET grid dispo => settle
          if (pendingGrid && now >= settleStartDyn) {
            r.state = "settle";
            r._settleStartDyn = settleStartDyn;
          } else {
            let target = preset.basePxPerMs;

            const tAccel = clamp01((now - r.startAt) / preset.accelMs);
            const accel = easeInOutQuad(tAccel);
            target *= (0.42 + 0.58 * accel);

            // pré décél (sans jamais forcer settle avant grid)
            if (now >= preDecelDyn) {
              const denom = Math.max(1, (settleStartDyn - preDecelDyn));
              const t = clamp01((now - preDecelDyn) / denom);
              const dec = 1 - easeInOutQuad(t) * 0.78;
              target *= dec;
            }

            r.vel = r.vel + (target - r.vel) * k;
            r.offset += r.vel * dt;

            while (r.offset >= reelStep) {
              r.offset -= reelStep;
              recycleReelOneStepDown(r, randomSymbolId(), false); // glow OFF
            }

            r.container.y = Math.round(r.offset);
          }
        }

        // ---------------- SETTLE ----------------
        if (r.state === "settle") {
          if (!r.didTick) { audio.tick.play(0.22); r.didTick = true; }

          const settleStartDyn = r._settleStartDyn || now;
          const settleEnd = settleStartDyn + preset.settleMs;
          const tSettle = clamp01((now - settleStartDyn) / preset.settleMs);

          if (!r.settleQueue) {
            r.settleQueue = buildSettleQueueForReel(pendingGrid, c);
            r.settleIdx = 0;
          }

          const remainingMs = Math.max(1, settleEnd - now);
          const distToNextStep = reelStep - r.offset;
          const remainingSteps = Math.max(0, (r.settleQueue.length - r.settleIdx));
          const remainingDist = distToNextStep + Math.max(0, remainingSteps - 1) * reelStep;

          const baseNeed = remainingDist / remainingMs;
          const ease = 0.95 - 0.30 * easeOutCubic(tSettle);
          const targetSpeed = Math.max(0.28, baseNeed * ease);

          r.vel = r.vel + (targetSpeed - r.vel) * k;
          r.offset += r.vel * dt;

          while (r.offset >= reelStep && r.settleIdx < r.settleQueue.length) {
            r.offset -= reelStep;
            const nextId = r.settleQueue[r.settleIdx++];
            recycleReelOneStepDown(r, nextId, false); // glow OFF
          }

          r.container.y = Math.round(r.offset);

          // queue finie => SNAP vers 0
          if (r.settleIdx >= r.settleQueue.length) {
            r.state = "snap";
            r.snapStart = now;
          }
        }

        // ---------------- SNAP ----------------
        if (r.state === "snap") {
          const t = clamp01((now - r.snapStart) / preset.snapMs);
          r.offset = r.offset * (1 - easeOutCubic(t));
          if (r.offset < 0.25) r.offset = 0;
          r.container.y = Math.round(r.offset);

          if (t >= 1 || r.offset === 0) {
            r.state = "bounce";
            r.bounceStart = now;
            r.container.y = 0;
            r.offset = 0;
            r.vel = 0;
            r.container.scale.y = 1;
          }
        }

        // ---------------- BOUNCE (via scale) ----------------
        if (r.state === "bounce") {
          const tb = clamp01((now - r.bounceStart) / preset.bounceMs);
          const s = Math.sin(tb * Math.PI);

          r.container.scale.y = 1 + s * preset.bounceScaleAmp;

          if (tb >= 1) {
            r.container.scale.y = 1;
            r.state = "done";
          }
        }
      }

      if (allDone) return resolve();
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

// --------------------------------------------------
// SPIN / STOP bouton
// --------------------------------------------------
async function onSpinOrStop() {
  // 2e clic => STOP
  if (spinning) {
    requestStop();
    setSpinButtonMode(true);
    return;
  }

  if (spinInFlight) return;
  if (!app || !symbolTextures.length) return;

  spinInFlight = true;
  spinning = true;
  stopRequested = false;
  stopRequestTime = 0;

  pendingGrid = null;
  gridArrivedAt = 0;

  setSpinButtonMode(true);

  // reset highlight
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  if (freeSpins <= 0) winMultiplier = 1;

  const preset = SPEEDS[speedIndex];
  const effectiveBet = bet;
  const paidSpin = freeSpins <= 0;

  if (!paidSpin) {
    freeSpins--;
  } else {
    if (balance < bet) {
      updateHUDTexts("Solde insuffisant");
      spinning = false;
      spinInFlight = false;
      setSpinButtonMode(false);
      return;
    }
    balance -= bet;
  }

  lastWin = 0;
  updateHUDNumbers();
  updateHUDTexts(paidSpin ? "Spin…" : `Free spin… restants : ${freeSpins}`);
  audio.spin.play(0.70);

  // ✅ démarre l'anim tout de suite
  const now = performance.now();
  prepareReelPlans(now, preset);
  const animPromise = animateSpinUntilDone(preset);

  // fetch en parallèle
  fetch("/spin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bet: effectiveBet }),
  })
    .then((r) => r.json())
    .then((data) => {
      pendingGrid = data.result || data.grid || data;
      gridArrivedAt = performance.now();
    })
    .catch((err) => {
      console.error("Erreur API /spin", err);
      pendingGrid = null;
      gridArrivedAt = 0;
    });

  // on attend la grid (sans bloquer l'animation)
  while (!pendingGrid) {
    await new Promise((res) => setTimeout(res, 25));
  }

  // on attend la fin de l'animation
  await animPromise;

  // glow ON à la fin
  applyGlowForAllVisible();

  const { baseWin, winningLines, bonusTriggered } = evaluateGrid(pendingGrid, effectiveBet);

  let totalWin = baseWin;
  if (bonusTriggered) {
    freeSpins += 10;
    winMultiplier = 2;
  }
  if (winMultiplier > 1) totalWin *= winMultiplier;

  lastWin = totalWin;
  balance += totalWin;
  updateHUDNumbers();

  finishSpin(totalWin, winningLines, bonusTriggered);
}

function finishSpin(win, winningLines, bonusTriggered) {
  spinning = false;
  spinInFlight = false;
  setSpinButtonMode(false);

  if (win > 0) {
    audio.win.play(0.70);
    updateHUDTexts(
      freeSpins > 0 ? `Gain : ${win} — free spins : ${freeSpins}` : `Gain : ${win}`
    );

    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
    audio.stop.play(0.55);
    updateHUDTexts(
      freeSpins > 0
        ? `Pas de gain — free spins : ${freeSpins}`
        : "Pas de gain — appuyez sur SPIN"
    );
  }

  if (bonusTriggered) {
    audio.bonus.play(0.70);
    updateHUDTexts("BONUS ! +10 free spins (gains ×2)");
  }
}

// --------------------------------------------------
// Bet
// --------------------------------------------------
function onBetMinus() {
  if (spinning) return;
  if (bet > 1) { bet -= 1; updateHUDNumbers(); }
}
function onBetPlus() {
  if (spinning) return;
  bet += 1;
  updateHUDNumbers();
}

// --------------------------------------------------
// Start
// --------------------------------------------------
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    showMessage("Erreur JS : init (" + (e?.message || String(e)) + ")");
  }
});