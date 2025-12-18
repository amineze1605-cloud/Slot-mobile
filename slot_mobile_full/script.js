// ==============================
// PART 1/6 — CONFIG + GLOBAL
// ==============================

// script.js — Slot mobile PIXI v5 (5x3)
// ✅ Lag fortement réduit (DPR cap 1.25, antialias OFF, glow OFF, background léger)
// ✅ STOP rouge (2e clic) fiable (stop après réception grid, comme vrais slots)
// ✅ Anti-swap (textures changées uniquement hors écran via recycle)
// ✅ UI stable (stats sous slot, lisible, chiffres ne déplacent pas les labels)
// ✅ Audio désactivé (tu peux supprimer assets/audio)

// --------------------------------------------------
// PERF toggles
// --------------------------------------------------
const ENABLE_GLOW = false;   // garde OFF pour iPhone (on verra plus tard)
const ENABLE_AUDIO = false;  // OFF => tu peux supprimer les mp3

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
let pendingGrid = null;
let gridArrivedAt = 0;

// HUD refs
let messageText;
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

// Stats (3 paires label+value)
let stats = {
  container: null,
  soldeLabel: null,
  soldeValue: null,
  miseLabel: null,
  miseValue: null,
  gainLabel: null,
  gainValue: null,
};

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
// VITESSES (rapide au départ, bounce plus léger)
// --------------------------------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 1.05,
    spinMs: 1500,
    startStaggerMs: 110,
    stopStaggerMs: 120,
    accelMs: 120,
    preDecelMs: 280,
    settleMs: 330,
    bounceMs: 170,
    bounceAmpFactor: 0.08,
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.35,
    spinMs: 1200,
    startStaggerMs: 90,
    stopStaggerMs: 105,
    accelMs: 110,
    preDecelMs: 240,
    settleMs: 300,
    bounceMs: 160,
    bounceAmpFactor: 0.075,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.70,
    spinMs: 980,
    startStaggerMs: 75,
    stopStaggerMs: 90,
    accelMs: 95,
    preDecelMs: 210,
    settleMs: 270,
    bounceMs: 150,
    bounceAmpFactor: 0.07,
  },
];
let speedIndex = 0;

// --------------------------------------------------
// AUDIO (désactivé) — no-op
// --------------------------------------------------
const audio = {
  spin:  { play() {} },
  stop:  { play() {} },
  win:   { play() {} },
  bonus: { play() {} },
  tick:  { play() {} },
};

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
// Helpers
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

function safeId(id) {
  const n = symbolTextures.length || 1;
  return ((id % n) + n) % n;
}
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

// ==============================
// PART 2/6 — ASSETS + BACKGROUND + INIT
// ==============================

// --------------------------------------------------
// Spritesheet load (stable, pas de re-création de textures inutiles)
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
// Background très léger (anti-lag): simple gradient (sans étoiles)
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

  app.stage.addChild(bgContainer);
}

// --------------------------------------------------
// Init PIXI (DPR cap iPhone + antialias OFF => gros gain perf)
// --------------------------------------------------
async function initPixi() {
  if (!canvas) return console.error("Canvas #game introuvable");
  if (!window.PIXI) {
    console.error("PIXI introuvable");
    showMessage("Erreur JS : PIXI introuvable");
    return;
  }

  // ✅ perf iPhone: cap resolution
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);

  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias: false,      // ✅ important
    autoDensity: true,
    resolution: dpr,
    powerPreference: "high-performance",
  });
  app.renderer.roundPixels = true;

  showMessage("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();

    // 4x4 (1024x1024 => 256x256) on utilise 12 cases
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

    // stop proprement
    spinning = false;
    spinInFlight = false;
    stopRequested = false;

    // destroy
    if (slotMask) { slotMask.destroy(true); slotMask = null; }
    if (slotFrame) { slotFrame.destroy(true); slotFrame = null; }
    if (slotContainer) { slotContainer.destroy(true); slotContainer = null; }
    if (paytableOverlay) { paytableOverlay.destroy(true); paytableOverlay = null; }
    if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }

    app.stage.removeChildren();
    reels = [];
    highlightedCells = [];
    stats = { container:null, soldeLabel:null, soldeValue:null, miseLabel:null, miseValue:null, gainLabel:null, gainValue:null };

    buildBackground();
    buildSlotScene();
    buildHUD();

    updateHUDTexts("Appuyez sur SPIN pour lancer");
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// ==============================
// PART 3/6 — SLOT SCENE + REELS (anti-swap)
// ==============================

// --------------------------------------------------
// Symbol cell (1 seul sprite => perf)
// --------------------------------------------------
function createSymbolCell(texture, sizePx) {
  const cell = new PIXI.Container();
  cell.roundPixels = true;

  const mainSprite = new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width = sizePx;
  mainSprite.height = sizePx;
  mainSprite.roundPixels = true;

  cell.addChild(mainSprite);
  return { container: cell, main: mainSprite, symbolId: -1 };
}

function setCellSymbol(cellObj, symbolId) {
  const sid = safeId(symbolId);
  cellObj.symbolId = sid;
  cellObj.main.texture = symbolTextures[sid];
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

  // slot position
  layout.slotW = totalReelWidth;
  layout.slotH = visibleH;
  layout.slotX = Math.round((w - totalReelWidth) / 2);
  layout.slotY = Math.round(topZone + (availableH - visibleH) * 0.30);

  layout.statsY = layout.slotY + visibleH + layout.framePadY + Math.round(h * 0.028);
  layout.buttonsY = layout.statsY + Math.round(h * 0.12);

  slotContainer = new PIXI.Container();
  slotContainer.x = layout.slotX;
  slotContainer.y = layout.slotY;

  // frame slot
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

  // mask stable
  slotMask = new PIXI.Graphics();
  slotMask.beginFill(0xffffff, 1);
  slotMask.drawRect(0, 0, totalReelWidth, visibleH);
  slotMask.endFill();
  slotMask.x = layout.slotX;
  slotMask.y = layout.slotY;
  slotMask.renderable = false;
  app.stage.addChild(slotMask);
  slotContainer.mask = slotMask;

  // reels
  reels = [];
  for (let c = 0; c < COLS; c++) {
    const reelContainer = new PIXI.Container();
    reelContainer.x = Math.round(c * (symbolSize + reelGap));
    reelContainer.y = 0;
    slotContainer.addChild(reelContainer);

    // 5 symboles: extra haut + 3 visibles + extra bas
    const cells = [];
    for (let i = 0; i < ROWS + 2; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx);

      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = Math.round((i - 1) * reelStep + symbolSize / 2);
      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells,      // ordre top->bottom
      offset: 0,
      vel: 0,
      state: "idle",       // idle | spin | settle | bounce | done
      didTick: false,

      // timings
      startAt: 0,
      minStopAt: 0,
      stopAt: 0,
      settleStart: 0,
      preDecelStart: 0,

      // settle injection
      settleQueue: null,
      settleIdx: 0,

      bounceStart: 0,
    });
  }
}

// --------------------------------------------------
// Recycle O(1) : textures changées UNIQUEMENT sur symbol qui remonte en haut (hors écran)
// => anti-swap
// --------------------------------------------------
function recycleReelOneStepDown(reel, newTopId) {
  const s = reel.symbols;

  // décale tous les y d'un step (5 éléments => très léger)
  for (let i = 0; i < s.length; i++) s[i].container.y += reelStep;

  // dernier remonte tout en haut
  const bottom = s.pop();
  bottom.container.y = s[0].container.y - reelStep;

  setCellSymbol(bottom, newTopId); // ✅ hors écran
  s.unshift(bottom);
}

// ==============================
// PART 4/6 — HUD (stats propres) + PAYTABLE
// ==============================

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
    btnSpin._bg.tint = 0xff2d2d;
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

  // message au-dessus du slot
  messageText = makeText(
    "Appuyez sur SPIN pour lancer",
    Math.round(h * 0.032),
    w / 2,
    layout.slotY - layout.framePadY - Math.round(h * 0.05),
    0.5, 0.5, "700"
  );

  // ---- STATS propres (3 colonnes) ----
  stats.container = new PIXI.Container();
  app.stage.addChild(stats.container);

  const frameX = layout.slotX - layout.framePadX;
  const frameW = layout.slotW + layout.framePadX * 2;

  const margin = Math.round(frameW * 0.04);
  const innerW = frameW - margin * 2;
  const colW = innerW / 3;

  const y = layout.statsY;
  stats.container.x = frameX + margin;
  stats.container.y = y;

  const labelSize = Math.round(h * 0.021);
  const valueSize = Math.round(h * 0.024);

  function addStat(colIndex, labelText) {
    const x = Math.round(colIndex * colW);
    const label = new PIXI.Text(labelText, new PIXI.TextStyle({
      fontFamily: "system-ui",
      fontSize: labelSize,
      fill: 0xffffff,
      fontWeight: "800",
    }));
    label.anchor.set(0, 0.5);
    label.x = x;
    label.y = 0;

    const value = new PIXI.Text("0", new PIXI.TextStyle({
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: valueSize,
      fill: 0xffffff,
      fontWeight: "900",
    }));
    value.anchor.set(0, 0.5);
    value.x = x + Math.round(label.width) + 10; // fixe => le label ne bouge jamais
    value.y = 0;

    stats.container.addChild(label, value);
    return { label, value };
  }

  const s0 = addStat(0, "Solde :");
  stats.soldeLabel = s0.label; stats.soldeValue = s0.value;

  const s1 = addStat(1, "Mise :");
  stats.miseLabel = s1.label; stats.miseValue = s1.value;

  const s2 = addStat(2, "Gain :");
  stats.gainLabel = s2.label; stats.gainValue = s2.value;

  // ---- Boutons ----
  const rectW = w * 0.28;
  const rectH = h * 0.072;

  const spinSize = Math.round(Math.min(w * 0.20, h * 0.13));
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

function updateHUDNumbers() {
  if (stats.soldeValue) stats.soldeValue.text = String(balance);
  if (stats.miseValue)  stats.miseValue.text  = String(bet);
  if (stats.gainValue)  stats.gainValue.text  = String(lastWin);

  // re-fixe x des values (car label.width peut changer légèrement selon device)
  if (stats.soldeLabel && stats.soldeValue) stats.soldeValue.x = Math.round(stats.soldeLabel.x + stats.soldeLabel.width + 10);
  if (stats.miseLabel  && stats.miseValue)  stats.miseValue.x  = Math.round(stats.miseLabel.x  + stats.miseLabel.width  + 10);
  if (stats.gainLabel  && stats.gainValue)  stats.gainValue.x  = Math.round(stats.gainLabel.x  + stats.gainLabel.width  + 10);
}

// --------------------------------------------------
// Paytable overlay (inchangé, léger)
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

// ==============================
// PART 5/6 — PAYLINES + HIGHLIGHT + SPIN ENGINE (STOP fiable)
// ==============================

const PAYLINES = [
  // haut
  [[0, 0],[1, 0],[2, 0],[3, 0],[4, 0]],
  // milieu
  [[0, 1],[1, 1],[2, 1],[3, 1],[4, 1]],
  // bas
  [[0, 2],[1, 2],[2, 2],[3, 2],[4, 2]],
  // diagonale V
  [[0, 0],[1, 1],[2, 2],[3, 1],[4, 0]],
  // diagonale ∧
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
// Highlight (léger)
// --------------------------------------------------
function startHighlight(cells) {
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;

    const targetY = row * reelStep + symbolSize / 2;
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
// STOP request (fiable)
// --------------------------------------------------
function requestStop() {
  if (!spinning || stopRequested) return;
  stopRequested = true;
  stopRequestTime = performance.now();
  updateHUDTexts("STOP…");
  // si grid déjà dispo, on recale les timings immédiatement
  if (pendingGrid) recomputeStopTimings(SPEEDS[speedIndex]);
}

// --------------------------------------------------
// Planification des reels
// --------------------------------------------------
function prepareReelPlans(now, preset) {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    r.offset = 0;
    r.vel = 0;
    r.container.y = 0;

    r.state = "spin";
    r.didTick = false;

    r.settleQueue = null;
    r.settleIdx = 0;

    r.startAt = now + c * preset.startStaggerMs;
    r.minStopAt = r.startAt + preset.spinMs + c * preset.stopStaggerMs;

    // tant qu’on n’a pas la grid, on garde ces valeurs (peuvent bouger)
    r.stopAt = r.minStopAt;
    r.settleStart = r.stopAt - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;
  }
}

function buildSettleQueueForReel(grid, col) {
  // ✅ injection 4 steps : [B, M, T, random] => visible devient [T, M, B]
  const topId = safeId(grid[0][col]);
  const midId = safeId(grid[1][col]);
  const botId = safeId(grid[2][col]);
  return [botId, midId, topId, randomSymbolId()];
}

// recalage stop/settle quand grid dispo (et/ou STOP demandé)
function recomputeStopTimings(preset) {
  const now = performance.now();

  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    // on ne peut jamais stopper avant l’arrivée réseau
    const gridReady = Math.max(gridArrivedAt, now);

    // stop normal: max(minStopAt, gridReady + petit stagger)
    const normalStop = Math.max(r.minStopAt, gridReady + c * 55);

    // stop demandé: on stop plus tôt MAIS jamais avant grid
    let stopAt = normalStop;
    if (stopRequested) {
      // “vrai slot”: stop quasi immédiat une fois la grid prête
      const quick = gridReady + 140 + c * 60;
      stopAt = Math.min(normalStop, quick);
      stopAt = Math.max(stopAt, gridReady + 80); // sécurité
    }

    r.stopAt = stopAt;
    r.settleStart = r.stopAt - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs * (stopRequested ? 0.60 : 1.0);

    // si on est déjà au-delà, on force un mini délai pour éviter saut
    if (now > r.settleStart) {
      r.settleStart = now + 60 + c * 20;
      r.preDecelStart = r.settleStart - preset.preDecelMs * 0.6;
    }
  }
}

// --------------------------------------------------
// Animation reels (aucune attente active => moins de lag)
// --------------------------------------------------
function animateSpin(preset) {
  return new Promise((resolve) => {
    let prev = performance.now();
    const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 14);

    function tick(now) {
      // ✅ dt clamp pour éviter énormes sauts quand iOS lag 1 frame
      let dt = Math.max(0, now - prev);
      prev = now;
      dt = Math.min(dt, 34);

      const k = smoothFactor(dt, 115);
      let allDone = true;

      for (let c = 0; c < reels.length; c++) {
        const r = reels[c];

        if (now < r.startAt) { allDone = false; continue; }
        if (r.state !== "done") allDone = false;

        // ---------------- SPIN ----------------
        if (r.state === "spin") {
          // si grid dispo et qu’on est arrivé au settleStart => settle
          if (pendingGrid && now >= r.settleStart) {
            r.state = "settle";
          } else {
            let target = preset.basePxPerMs;

            const tAccel = clamp01((now - r.startAt) / preset.accelMs);
            target *= (0.40 + 0.60 * easeInOutQuad(tAccel));

            if (now >= r.preDecelStart) {
              const denom = Math.max(1, (r.settleStart - r.preDecelStart));
              const t = clamp01((now - r.preDecelStart) / denom);
              const dec = 1 - easeInOutQuad(t) * 0.80;
              target *= dec;
            }

            r.vel = r.vel + (target - r.vel) * k;
            r.offset += r.vel * dt;

            while (r.offset >= reelStep) {
              r.offset -= reelStep;
              recycleReelOneStepDown(r, randomSymbolId());
            }

            r.container.y = Math.round(r.offset);
          }
        }

        // ---------------- SETTLE ----------------
        if (r.state === "settle") {
          if (!r.didTick) { r.didTick = true; } // tick audio désactivé

          if (!r.settleQueue) {
            r.settleQueue = buildSettleQueueForReel(pendingGrid, c);
            r.settleIdx = 0;
          }

          // vitesse calculée pour finir pile à temps
          const tSettle = clamp01((now - r.settleStart) / preset.settleMs);

          const settleEnd = r.settleStart + preset.settleMs;
          const remainingMs = Math.max(1, settleEnd - now);

          const distToNextStep = reelStep - r.offset;
          const remainingSteps = Math.max(0, (r.settleQueue.length - r.settleIdx));
          const remainingDist = distToNextStep + Math.max(0, remainingSteps - 1) * reelStep;

          const baseNeed = remainingDist / remainingMs;
          const ease = 0.96 - 0.34 * easeOutCubic(tSettle);
          const targetSpeed = Math.max(0.28, baseNeed * ease);

          r.vel = r.vel + (targetSpeed - r.vel) * k;
          r.offset += r.vel * dt;

          while (r.offset >= reelStep && r.settleIdx < r.settleQueue.length) {
            r.offset -= reelStep;
            const nextId = r.settleQueue[r.settleIdx++];
            recycleReelOneStepDown(r, nextId);
          }

          r.container.y = Math.round(r.offset);

          if (r.settleIdx >= r.settleQueue.length) {
            // fin propre
            r.offset = 0;
            r.vel = 0;
            r.container.y = 0;
            r.state = "bounce";
            r.bounceStart = now;
          }
        }

        // ---------------- BOUNCE (léger) ----------------
        if (r.state === "bounce") {
          const tb = clamp01((now - r.bounceStart) / preset.bounceMs);
          const s = Math.sin(tb * Math.PI);
          const amp = bounceAmp * (1 - tb * 0.45);
          r.container.y = Math.round(-s * amp);

          if (tb >= 1) {
            r.container.y = 0;
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

// ==============================
// PART 6/6 — SPIN/STOP FLOW + BET + START
// ==============================

async function onSpinOrStop() {
  // si ça tourne -> STOP
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

  // ✅ démarre l’anim immédiatement
  const now = performance.now();
  prepareReelPlans(now, preset);

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
      recomputeStopTimings(preset); // ✅ dès que grid arrive
    })
    .catch((err) => {
      console.error("Erreur API /spin", err);
      pendingGrid = null;
      gridArrivedAt = 0;
    });

  // l’anim tourne jusqu’à ce que pendingGrid arrive (sinon pas de settle)
  // => pas de boucle d’attente active (moins de lag)
  await animateSpin(preset);

  // si jamais le réseau a fail, on sort proprement
  if (!pendingGrid) {
    updateHUDTexts("Erreur réseau /spin");
    spinning = false;
    spinInFlight = false;
    setSpinButtonMode(false);
    return;
  }

  // calcul win
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
    updateHUDTexts(
      freeSpins > 0 ? `Gain : ${win} — free spins : ${freeSpins}` : `Gain : ${win}`
    );

    const cells = [];
    winningLines?.forEach((line) => line.cells.forEach((c) => cells.push(c)));
    if (cells.length) startHighlight(cells);
  } else {
    updateHUDTexts(
      freeSpins > 0
        ? `Pas de gain — free spins : ${freeSpins}`
        : "Pas de gain — appuyez sur SPIN"
    );
  }

  if (bonusTriggered) {
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