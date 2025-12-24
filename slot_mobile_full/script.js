// script.js — Slot mobile PIXI v5 (5x3) — PRO CASINO MODE (Render-ready)
// ✅ anti-float front: affichage en centimes (int), aucun calcul de wallet
// ✅ utilise résultat serveur: data.winCents / data.bonus / data.winningLines + état autoritaire
// ✅ bande mise: tap = sélection (pas de mouvement), drag, inertia, snap LEFT
// ✅ + AbortController timeout client /spin
// ✅ + anti double-tap iOS sur SPIN (start only)
// ✅ + lock visuel + lock input bande mise pendant spin

PIXI.settings.ROUND_PIXELS = true;
PIXI.settings.MIPMAP_TEXTURES = PIXI.MIPMAP_MODES.OFF;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

let app;
let symbolTextures = [];
let reels = [];

const COLS = 5;
const ROWS = 3;

const STRIP_COUNT = 7;
const TOP_EXTRA = 2;

const BONUS_ID = 6;
const WILD_ID = 9;

// ------------------ état affiché (CENTIMES) ------------------
let balanceCents = 1000 * 100;
let betCents = 10; // 0.10€
let lastWinCents = 0;

let spinning = false;
let freeSpins = 0;
let winMultiplier = 1;

// STOP / réseau
const MIN_SPIN_BEFORE_STOP_MS = 260;
const STOP_PREDECEL_BOOST = 0.40;

let stopRequested = false;
let stopArmedAt = 0;
let spinInFlight = false;

let pendingGrid = null;
let gridArrivedAt = 0;

// outcome serveur complet
let pendingOutcome = null; // { winCents, bonus, winningLines, balanceCents, freeSpins, winMultiplier, lastWinCents, fair?, error? }

// highlight
let highlightedCells = [];
let highlightTimer = 0;

// refs
let slotContainer = null;
let slotFrame = null;
let slotMask = null;
let bgContainer = null;

// layout
let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;
let visibleH = 0;

// cadres
let layout = {
  slotX: 0,
  slotY: 0,
  slotW: 0,
  slotH: 0,
  framePadX: 14,
  framePadY: 14,
  frameRadius: 22,
};

// vitesses
const SPEEDS = [
  { name: "LENT",   basePxPerMs: 1.05, spinMs: 1850, startStaggerMs: 115, stopStaggerMs: 130, accelMs: 110, preDecelMs: 360, settleMs: 380, snapMs: 140, bounceMs: 190, bounceAmpFactor: 0.085 },
  { name: "NORMAL", basePxPerMs: 1.35, spinMs: 1500, startStaggerMs: 95,  stopStaggerMs: 110, accelMs: 105, preDecelMs: 310, settleMs: 340, snapMs: 135, bounceMs: 180, bounceAmpFactor: 0.08  },
  { name: "RAPIDE", basePxPerMs: 1.70, spinMs: 1200, startStaggerMs: 80,  stopStaggerMs: 95,  accelMs: 95,  preDecelMs: 260, settleMs: 300, snapMs: 125, bounceMs: 170, bounceAmpFactor: 0.075 },
];
let speedIndex = 0;

// ------------------ money helpers ------------------
function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  n = Math.round(n);
  return Math.max(min, Math.min(max, n));
}
function fmtMoneyFromCents(cents) {
  return (clampInt(cents, -999999999, 999999999) / 100).toFixed(2);
}

// ------------------ provably fair clientSeed ------------------
const CLIENT_SEED_KEY = "slotClientSeed";
function getClientSeed() {
  let s = localStorage.getItem(CLIENT_SEED_KEY);
  if (!s) {
    const arr = new Uint8Array(16);
    const c = window.crypto || window.msCrypto;
    if (!c?.getRandomValues) {
      // fallback (rare)
      s = (Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 32);
    } else {
      c.getRandomValues(arr);
      s = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    localStorage.setItem(CLIENT_SEED_KEY, s);
  }
  return s;
}
const clientSeed = getClientSeed();

// ------------------ safe areas ------------------
function getSafeTopPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(16, Math.round(h * 0.03));
}
function getSafeBottomPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(18, Math.round(h * 0.035));
}

// ------------------ loader DOM ------------------
function showMessage(text) {
  if (!loaderEl) return;
  loaderEl.style.display = "flex";
  loaderEl.textContent = text;
}
function hideMessage() {
  if (!loaderEl) return;
  loaderEl.style.display = "none";
}

// ------------------ AbortController fetch timeout (réel côté client) ------------------
const SPIN_REQUEST_TIMEOUT_MS = 3200;

async function fetchJsonWithTimeout(url, fetchOpts = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, { ...fetchOpts, signal: controller.signal });
    let data = null;

    try { data = await r.json(); }
    catch (_) { data = { error: "SERVER_ERROR" }; }

    if (!r.ok && !data?.error) data.error = "SERVER_ERROR";
    return data;
  } catch (e) {
    if (e?.name === "AbortError") return { error: "TIMEOUT" };
    return { error: "NETWORK_ERROR" };
  } finally {
    clearTimeout(id);
  }
}

// ------------------ anti double-tap iOS sur SPIN (start only) ------------------
let lastSpinStartTapAt = 0;
const SPIN_START_COOLDOWN_MS = 280;

function canStartSpinNow() {
  const now = performance.now();
  if (now - lastSpinStartTapAt < SPIN_START_COOLDOWN_MS) return false;
  lastSpinStartTapAt = now;
  return true;
}

// ------------------ spritesheet ------------------
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

// ------------------ sync state serveur ------------------
async function syncStateFromServer({ clearError = true } = {}) {
  try {
    const r = await fetch("/state", { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP_${r.status}`);

    const data = await r.json();

    balanceCents = Number(data.balanceCents) || balanceCents;
    freeSpins = Number(data.freeSpins) || 0;
    winMultiplier = Number(data.winMultiplier) || 1;
    lastWinCents = Number(data.lastWinCents) || 0;

    if (Array.isArray(data.allowedBetsCents) && data.allowedBetsCents.length) {
      hud.betValuesCents = data.allowedBetsCents.map(n => Math.round(Number(n)));
      if (!hud.betValuesCents.includes(betCents)) betCents = hud.betValuesCents[0];
    }

    hudUpdateNumbers();
    hudUpdateFsBadge();

    if (clearError && hud?.statusText && /ERREUR|TIMEOUT|RÉSEAU/i.test(hud.statusText.text)) {
      if (spinning) hudSetStatusMessage("SPIN…");
      else if (freeSpins > 0) hudSetStatusMessage("FREE SPINS !");
      else hudSetStatusMessage("METTEZ VOTRE MISE, S'IL VOUS PLAÎT");
    }

    return true;
  } catch (e) {
    console.log("syncStateFromServer failed", e);
    return false;
  }
}

// ------------------ init PIXI ------------------
async function initPixi() {
  if (!canvas) return console.error("Canvas #game introuvable");
  if (!window.PIXI) {
    console.error("PIXI introuvable");
    showMessage("Erreur JS : PIXI introuvable");
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 1.35);

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

  showMessage("Chargement…");

  try {
    const baseTexture = await loadSpritesheet();

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

    await syncStateFromServer();

    hudSetStatusMessage(freeSpins > 0 ? "FREE SPINS !" : "METTEZ VOTRE MISE, S'IL VOUS PLAÎT");
    hudUpdateFsBadge();

    app.ticker.add(updateHighlight);
    window.addEventListener("resize", rebuildAll);
  } catch (e) {
    console.error("Erreur chargement", e);
    showMessage("Erreur chargement assets (" + (e?.message || String(e)) + ")");
  }
}

function rebuildAll() {
  try {
    if (!app) return;

    if (slotMask) { slotMask.destroy(true); slotMask = null; }
    if (slotFrame) { slotFrame.destroy(true); slotFrame = null; }
    if (slotContainer) { slotContainer.destroy(true); slotContainer = null; }
    if (bgContainer) { bgContainer.destroy(true); bgContainer = null; }

    if (paytableOverlay) { paytableOverlay.destroy({ children: true }); paytableOverlay = null; }
    if (hud?.root) { hud.root.destroy({ children: true }); hud.root = null; }

    app.stage.removeChildren();
    reels = [];
    highlightedCells = [];

    buildBackground();
    buildSlotScene();
    buildHUD();

    if (spinning) hudSetStatusMessage("SPIN…");
    else if (freeSpins > 0) hudSetStatusMessage("FREE SPINS !");
    else hudSetStatusMessage("METTEZ VOTRE MISE, S'IL VOUS PLAÎT");

    hudUpdateFsBadge();
    hudUpdateNumbers();

    hudSetBetBandLocked(spinning); // ✅ keep lock visuel si rebuild pendant spin
  } catch (e) {
    console.error("Resize rebuild error:", e);
  }
}

// ------------------ background ------------------
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

// ---------- symbol helpers ----------
function safeId(id) {
  const n = symbolTextures.length || 1;
  return ((id % n) + n) % n;
}
function randomSymbolId() {
  return Math.floor(Math.random() * symbolTextures.length);
}

function createSymbolCell(texture, sizePx) {
  const cell = new PIXI.Container();
  const mainSprite = new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width = sizePx;
  mainSprite.height = sizePx;
  cell.addChild(mainSprite);
  return { container: cell, main: mainSprite, symbolId: -1 };
}
function setCellSymbol(cellObj, symbolId) {
  const sid = safeId(symbolId);
  cellObj.symbolId = sid;
  cellObj.main.texture = symbolTextures[sid];
}

// ---------- slot scene ----------
function buildSlotScene() {
  const w = app.screen.width;
  const h = app.screen.height;
  const safeTop = getSafeTopPx();

  reelGap = 8;

  const sideMargin = w * 0.08;
  const maxTotalWidth = w - sideMargin * 2;
  const symbolFromWidth = (maxTotalWidth - reelGap * (COLS - 1)) / COLS;

  const topZone = safeTop + Math.round(h * 0.11);
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

  slotContainer = new PIXI.Container();
  slotContainer.x = layout.slotX;
  slotContainer.y = layout.slotY;

  slotFrame = new PIXI.Graphics();
  slotFrame.lineStyle(3, 0xf2b632, 1);
  slotFrame.beginFill(0x060b1a, 0.75);
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
    slotContainer.addChild(reelContainer);

    const cells = [];
    for (let i = 0; i < STRIP_COUNT; i++) {
      const idx = randomSymbolId();
      const cellObj = createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx);

      cellObj.container.x = Math.round(symbolSize / 2);
      cellObj.container.y = Math.round((i - TOP_EXTRA) * reelStep + symbolSize / 2);

      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells,
      offset: 0,
      vel: 0,
      state: "idle",
      settleQueue: null,
      settleIdx: 0,
      bounceStart: 0,
      snapStart: 0,
      startAt: 0,
      minStopAt: 0,
      settleStart: 0,
      preDecelStart: 0,
      userStopAt: Infinity,
      finalApplied: false,
    });
  }
}

// ------------------ HUD ------------------
let hud = {
  root: null,

  topPanel: null,
  fsBadge: null,

  meterPanel: null,
  statusText: null,
  soldeValue: null,
  gainValue: null,

  betBand: null,
  betStrip: null,
  betChips: [],
  betLockOverlay: null, // ✅ overlay “LOCK” visuel

  betValuesCents: [5, 10, 20, 30, 40, 50, 75, 100, 150, 200],

  btnSpin: null,
  btnSpeed: null,
  btnInfo: null,

  _spinDiam: 0,
  _sideDiam: 0,
  _chipW: 0,
  _chipH: 0,
  _chipGap: 0,

  _betScrollX: 0,
  _betDrag: null,
  _betVel: 0,
  _betInertiaRunning: false,

  _betContentW: 0,
  _betBandW: 0,
  _betLeftPad: 16,
  _betLocked: false,
};

function makeTextStyleLabel(size) {
  return new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: size,
    fill: 0xF3F4F6,
    fontWeight: "560",
    stroke: 0x000000,
    strokeThickness: 1,
    dropShadow: true,
    dropShadowAlpha: 0.18,
    dropShadowBlur: 2,
    dropShadowDistance: 1,
  });
}
function makeTextStyleValue(size) {
  return new PIXI.TextStyle({
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: size,
    fill: 0xFFFFFF,
    fontWeight: "720",
    stroke: 0x000000,
    strokeThickness: 2,
    dropShadow: true,
    dropShadowAlpha: 0.22,
    dropShadowBlur: 3,
    dropShadowDistance: 1,
  });
}
function makeTextStyleButton(size) {
  return new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: size,
    fill: 0xFFFFFF,
    fontWeight: "820",
    stroke: 0x000000,
    strokeThickness: 3,
    dropShadow: true,
    dropShadowAlpha: 0.22,
    dropShadowBlur: 3,
    dropShadowDistance: 1,
    align: "center",
  });
}

function makePanelTexture(w, h, top = "#111827", mid = "#0b1220", bot = "#050814") {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.floor(w));
  c.height = Math.max(2, Math.floor(h));
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, top);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const v = ctx.createRadialGradient(
    c.width * 0.5, c.height * 0.2, 10,
    c.width * 0.5, c.height * 0.5,
    Math.max(w, h)
  );
  v.addColorStop(0, "rgba(255,255,255,0.035)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, c.width, c.height);

  return PIXI.Texture.from(c);
}

function makeRoundedPanel(w, h, radius, borderColor = 0xf2b632) {
  const cont = new PIXI.Container();
  const bg = new PIXI.Sprite(makePanelTexture(w, h));
  bg.width = w; bg.height = h;
  cont.addChild(bg);

  const border = new PIXI.Graphics();
  border.lineStyle(2, borderColor, 1);
  border.drawRoundedRect(0, 0, w, h, radius);
  cont.addChild(border);

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.028);
  shine.drawRoundedRect(6, 6, w - 12, h * 0.30, Math.min(radius, 16));
  shine.endFill();
  cont.addChild(shine);

  return cont;
}

function makeRoundButton(diam) {
  const c = new PIXI.Container();
  c.interactive = true;
  c.buttonMode = true;

  const r = diam / 2;

  const ring = new PIXI.Graphics();
  ring.beginFill(0x0b1220, 0.92);
  ring.lineStyle(Math.max(3, Math.round(diam * 0.030)), 0xf2b632, 1);
  ring.drawCircle(0, 0, r);
  ring.endFill();

  const inner = new PIXI.Graphics();
  inner.beginFill(0x111827, 0.95);
  inner.lineStyle(2, 0x0ea5e9, 0.18);
  inner.drawCircle(0, 0, r * 0.72);
  inner.endFill();

  const t = new PIXI.Text("BTN", makeTextStyleButton(Math.round(diam * 0.26)));
  t.anchor.set(0.5);

  c.addChild(ring, inner, t);
  c._ring = ring;
  c._inner = inner;
  c._text = t;

  c.on("pointerdown", () => c.scale.set(0.985));
  c.on("pointerup", () => c.scale.set(1.0));
  c.on("pointerupoutside", () => c.scale.set(1.0));

  return c;
}

function hudSetSpinButtonMode(isStop) {
  if (!hud.btnSpin) return;
  if (isStop) {
    hud.btnSpin._text.text = "STOP";
    hud.btnSpin._ring.tint = 0xff2d2d;
    hud.btnSpin._inner.tint = 0x7f1d1d;
  } else {
    hud.btnSpin._text.text = "SPIN";
    hud.btnSpin._ring.tint = 0xffffff;
    hud.btnSpin._inner.tint = 0xffffff;
  }
}

function hudRefreshSpeedButtonLabel() {
  const active = Math.min(3, speedIndex + 1);
  const arrows = [0, 1, 2].map(i => (i < active ? "›" : "·")).join(" ");
  hud.btnSpeed._text.text = `VIT\n${arrows}`;
  hud.btnSpeed._text.style = makeTextStyleButton(Math.round(hud._sideDiam * 0.24));
}

function hudSetStatusMessage(msg) {
  if (hud.statusText) hud.statusText.text = String(msg || "");
}

function hudUpdateFsBadge() {
  if (!hud.fsBadge) return;
  if (freeSpins > 0) {
    const mult = (winMultiplier > 1) ? `×${winMultiplier}` : "";
    hud.fsBadge.text = `FS ${freeSpins} ${mult}`.trim();
    hud.fsBadge.alpha = 0.95;
  } else {
    hud.fsBadge.text = "";
    hud.fsBadge.alpha = 0.0;
  }
}

function hudUpdateNumbers() {
  if (hud.soldeValue) hud.soldeValue.text = fmtMoneyFromCents(balanceCents);
  if (hud.gainValue) hud.gainValue.text = fmtMoneyFromCents(lastWinCents);

  if (hud.betChips?.length) {
    hud.betChips.forEach((c) => setChipSelected(c, c._valueCents === betCents));
  }
}

// ✅ lock visuel + lock input bande de mise pendant spin
function hudSetBetBandLocked(locked) {
  hud._betLocked = !!locked;
  if (!hud.betBand) return;

  hud.betBand.alpha = locked ? 0.55 : 1.0;
  hud.betBand.interactiveChildren = !locked;
  hud.betBand.interactive = !locked;

  if (hud.betLockOverlay) {
    hud.betLockOverlay.visible = locked;
    hud.betLockOverlay.alpha = locked ? 1.0 : 0.0;
  }

  if (locked) {
    hudStopBetInertia();
    hud._betDrag = null;
  }
}

function setChipSelected(chip, selected) {
  if (!chip?._bg) return;
  chip._bg.tint = selected ? 0x22c55e : 0xffffff;
  chip._bg.alpha = selected ? 1.0 : 0.95;
}

// Chip “EUR / 0.10 / MISE”
function makeBetChip(valueCents, w, h) {
  const c = new PIXI.Container();
  c.interactive = true;
  c.buttonMode = true;

  const g = new PIXI.Graphics();
  g.beginFill(0x0b1220, 0.88);
  g.lineStyle(2, 0xf2b632, 1);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, Math.min(14, h * 0.38));
  g.endFill();

  const eur = new PIXI.Text("EUR", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.22),
    fill: 0xffffff,
    fontWeight: "700",
    stroke: 0x000000,
    strokeThickness: 2,
  }));
  eur.anchor.set(0.5);
  eur.y = -h * 0.30;

  const val = new PIXI.Text(fmtMoneyFromCents(valueCents), new PIXI.TextStyle({
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: Math.round(h * 0.40),
    fill: 0xffffff,
    fontWeight: "900",
    stroke: 0x000000,
    strokeThickness: 3,
  }));
  val.anchor.set(0.5);
  val.y = -h * 0.02;

  const mise = new PIXI.Text("MISE", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.22),
    fill: 0xffffff,
    fontWeight: "800",
    stroke: 0x000000,
    strokeThickness: 2,
  }));
  mise.anchor.set(0.5);
  mise.y = h * 0.30;

  c.addChild(g, eur, val, mise);
  c._bg = g;

  return c;
}

function makeActionChip(label, w, h) {
  const c = new PIXI.Container();
  c.interactive = true;
  c.buttonMode = true;

  const g = new PIXI.Graphics();
  g.beginFill(0x0b1220, 0.88);
  g.lineStyle(2, 0xf2b632, 1);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, Math.min(14, h * 0.4));
  g.endFill();

  const t = new PIXI.Text(label, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.46),
    fill: 0xffffff,
    fontWeight: "900",
    stroke: 0x000000,
    strokeThickness: 3,
  }));
  t.anchor.set(0.5);

  c.addChild(g, t);
  c._bg = g;
  c._text = t;

  return c;
}

function buildHUD() {
  const w = app.screen.width;
  const h = app.screen.height;
  const safeTop = getSafeTopPx();
  const safeBottom = getSafeBottomPx();

  if (hud.root) hud.root.destroy({ children: true });
  hud.root = new PIXI.Container();
  app.stage.addChild(hud.root);

  // mini bandeau FS
  const topW = Math.min(w * 0.52, 320);
  const topH = Math.max(34, Math.round(h * 0.045));

  hud.topPanel = makeRoundedPanel(topW, topH, 16);
  hud.topPanel.x = Math.round(w - topW - 14);
  hud.topPanel.y = safeTop + 8;

  hud.fsBadge = new PIXI.Text("", new PIXI.TextStyle({
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: Math.round(topH * 0.36),
    fill: 0xffffff,
    fontWeight: "820",
    stroke: 0x000000,
    strokeThickness: 3,
  }));
  hud.fsBadge.anchor.set(1, 0.5);
  hud.fsBadge.x = topW - 12;
  hud.fsBadge.y = topH / 2;
  hud.fsBadge.alpha = 0.0;

  hud.topPanel.addChild(hud.fsBadge);
  hud.root.addChild(hud.topPanel);

  // boutons
  hud._spinDiam = Math.round(Math.min(w * 0.24, h * 0.125));
  hud._sideDiam = Math.round(hud._spinDiam * 0.62);
  const spinY = Math.round(h - safeBottom - hud._spinDiam / 2 - 10);

  // bet band
  hud._chipW = Math.round(Math.min(92, w * 0.200));
  hud._chipH = Math.round(Math.max(56, h * 0.070));
  hud._chipGap = Math.round(hud._chipW * 0.14);

  const bandW = Math.min(w * 0.92, 720);
  const bandH = Math.round(Math.max(64, h * 0.080));
  const bandX = Math.round((w - bandW) / 2);
  const bandY = Math.round(spinY - hud._spinDiam / 2 - bandH - 10);

  hud.root.addChild(hudBuildBetBand(bandX, bandY, bandW, bandH));

  // panneau bas: solde / statut / dernier gain
  const meterW = bandW;
  const meterH = Math.round(Math.max(74, h * 0.090));
  const meterX = bandX;
  const meterY = Math.round(bandY - meterH - 10);

  hud.meterPanel = makeRoundedPanel(meterW, meterH, 18);
  hud.meterPanel.x = meterX;
  hud.meterPanel.y = meterY;
  hud.root.addChild(hud.meterPanel);

  const colW = meterW / 3;

  // SOLDE
  const soldeLabel = new PIXI.Text("SOLDE:", makeTextStyleLabel(Math.round(meterH * 0.20)));
  soldeLabel.x = 14;
  soldeLabel.y = 10;

  hud.soldeValue = new PIXI.Text(fmtMoneyFromCents(balanceCents), makeTextStyleValue(Math.round(meterH * 0.38)));
  hud.soldeValue.x = 14;
  hud.soldeValue.y = soldeLabel.y + soldeLabel.height + 2;

  const soldeEur = new PIXI.Text("EUR", makeTextStyleLabel(Math.round(meterH * 0.18)));
  soldeEur.x = 14;
  soldeEur.y = hud.soldeValue.y + hud.soldeValue.height - 2;

  // STATUT
  hud.statusText = new PIXI.Text("METTEZ VOTRE MISE, S'IL VOUS PLAÎT", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(meterH * 0.20),
    fill: 0xffffff,
    fontWeight: "800",
    stroke: 0x000000,
    strokeThickness: 2,
    align: "center",
    wordWrap: true,
    wordWrapWidth: Math.round(colW * 0.92),
  }));
  hud.statusText.anchor.set(0.5, 0.5);
  hud.statusText.x = colW * 1.5;
  hud.statusText.y = meterH * 0.52;

  // DERNIER GAIN
  const gainLabel = new PIXI.Text("DERNIER GAIN:", makeTextStyleLabel(Math.round(meterH * 0.20)));
  gainLabel.anchor.set(1, 0);
  gainLabel.x = meterW - 14;
  gainLabel.y = 10;

  hud.gainValue = new PIXI.Text(fmtMoneyFromCents(lastWinCents), makeTextStyleValue(Math.round(meterH * 0.38)));
  hud.gainValue.anchor.set(1, 0);
  hud.gainValue.x = meterW - 14;
  hud.gainValue.y = gainLabel.y + gainLabel.height + 2;

  const gainEur = new PIXI.Text("EUR", makeTextStyleLabel(Math.round(meterH * 0.18)));
  gainEur.anchor.set(1, 0);
  gainEur.x = meterW - 14;
  gainEur.y = hud.gainValue.y + hud.gainValue.height - 2;

  hud.meterPanel.addChild(soldeLabel, hud.soldeValue, soldeEur, hud.statusText, gainLabel, hud.gainValue, gainEur);

  // buttons row
  hud.btnSpin = makeRoundButton(hud._spinDiam);
  hud.btnSpin._text.text = "SPIN";
  hud.btnSpin.x = Math.round(w / 2);
  hud.btnSpin.y = spinY;
  hud.root.addChild(hud.btnSpin);

  // ✅ anti double-tap iOS + stopPropagation (évite event fantôme)
  hud.btnSpin.on("pointerdown", (e) => { e?.stopPropagation?.(); });
  hud.btnSpin.on("pointerup", (e) => {
    e?.stopPropagation?.();
    onSpinOrStop();
  });
  hud.btnSpin.on("pointerupoutside", (e) => { e?.stopPropagation?.(); });

  hud.btnSpeed = makeRoundButton(hud._sideDiam);
  hud.root.addChild(hud.btnSpeed);

  hud.btnInfo = makeRoundButton(hud._sideDiam);
  hud.btnInfo._text.text = "INFO";
  hud.root.addChild(hud.btnInfo);

  const sideGap = Math.round(hud._spinDiam * 0.10);
  const sideOffset = (hud._spinDiam / 2) + (hud._sideDiam / 2) + sideGap;

  hud.btnSpeed.x = hud.btnSpin.x - sideOffset;
  hud.btnSpeed.y = spinY;

  hud.btnInfo.x = hud.btnSpin.x + sideOffset;
  hud.btnInfo.y = spinY;

  hud.btnSpeed.on("pointerup", () => {
    if (spinning) return;
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    hudRefreshSpeedButtonLabel();
    hudSetStatusMessage(`VITESSE : ${SPEEDS[speedIndex].name}`);
  });

  hud.btnInfo.on("pointerup", () => togglePaytable());

  hudRefreshSpeedButtonLabel();
  hudUpdateNumbers();
  hudUpdateFsBadge();
  hudSetSpinButtonMode(false);

  hudSetBetBandLocked(spinning); // ✅ applique lock visuel si besoin
}

// ================== BET BAND (tap=no move, drag, inertia, snap LEFT) ==================
function hudSetBetScroll(x) {
  const bandW = hud._betBandW || hud.betBand.width;
  const contentW = hud._betContentW || hud.betStrip.width;

  const minX = Math.min(0, bandW - contentW);
  const maxX = 0;

  hud._betScrollX = Math.max(minX, Math.min(maxX, x));
  hud.betStrip.x = hud._betScrollX;
}

function hudStopBetInertia() { hud._betInertiaRunning = false; hud._betVel = 0; }

function hudTweenBetScrollTo(targetX, ms = 220) {
  const startX = hud._betScrollX;
  const startT = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function tick() {
    const now = performance.now();
    const t = Math.min(1, (now - startT) / ms);
    hudSetBetScroll(startX + (targetX - startX) * ease(t));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function hudSnapBetToLeftSmooth(ms = 200) {
  if (!hud.betChips?.length) return;

  const leftPad = hud._betLeftPad ?? 16;
  const bandW = hud._betBandW || hud.betBand.width;

  if ((hud._betContentW || 0) <= bandW) return;

  let best = null;
  let bestD = Infinity;

  for (const chip of hud.betChips) {
    const chipLeft = chip.x - hud._chipW / 2;
    const visibleLeft = hud._betScrollX + chipLeft;
    const d = Math.abs(visibleLeft - leftPad);
    if (d < bestD) { bestD = d; best = chip; }
  }
  if (!best) return;

  const chipLeft = best.x - hud._chipW / 2;
  const targetScroll = leftPad - chipLeft;
  hudTweenBetScrollTo(targetScroll, ms);
}

function hudStartBetInertia() {
  if (hud._betInertiaRunning) return;
  hud._betInertiaRunning = true;

  const friction = 0.92;
  const minVel = 0.02;
  let last = performance.now();

  function step() {
    if (!hud._betInertiaRunning) return;
    const now = performance.now();
    const dt = Math.max(1, now - last);
    last = now;

    hudSetBetScroll(hud._betScrollX + hud._betVel * dt);
    hud._betVel *= Math.pow(friction, dt / 16.6);

    if (Math.abs(hud._betVel) < minVel) {
      hudStopBetInertia();
      hudSnapBetToLeftSmooth(200);
      return;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function hudBuildBetBand(x, y, w, h) {
  hud._betBandW = w;
  hud._betLeftPad = 16;

  hud.betBand = new PIXI.Container();
  hud.betBand.x = x;
  hud.betBand.y = y;

  hud.betBand.addChild(makeRoundedPanel(w, h, Math.min(18, h * 0.45)));

  hud.betStrip = new PIXI.Container();
  hud.betStrip.x = 0;
  hud.betStrip.y = 0;

  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff, 1);
  mask.drawRoundedRect(6, 6, w - 12, h - 12, Math.min(16, h * 0.45));
  mask.endFill();
  mask.renderable = false;

  hud.betBand.addChild(mask);
  hud.betBand.addChild(hud.betStrip);
  hud.betStrip.mask = mask;

  hud.betChips.forEach(c => c.destroy({ children: true }));
  hud.betChips = [];

  const chipW = hud._chipW;
  const chipH = hud._chipH;
  const gap = hud._chipGap;

  const leftPad = hud._betLeftPad;
  const rightPad = 16;

  let cx = leftPad + chipW / 2;
  const cy = h / 2;

  const N = hud.betValuesCents.length;
  hud._betContentW = leftPad + rightPad + (N * chipW) + ((N - 1) * gap);

  const TAP_THRESHOLD = 8;

  const dragStart = (globalX) => {
    hudStopBetInertia();
    hud._betDrag = { startX: globalX, lastX: globalX, startScroll: hud._betScrollX, lastT: performance.now(), moved: 0 };
  };

  const dragMove = (globalX) => {
    if (!hud._betDrag) return;

    const now = performance.now();
    const dt = Math.max(1, now - hud._betDrag.lastT);

    const dxTotal = globalX - hud._betDrag.startX;
    hudSetBetScroll(hud._betDrag.startScroll + dxTotal);

    const instDx = globalX - hud._betDrag.lastX;
    const v = instDx / dt;
    hud._betVel = hud._betVel * 0.75 + v * 0.25;

    hud._betDrag.moved = Math.max(hud._betDrag.moved, Math.abs(dxTotal));
    hud._betDrag.lastX = globalX;
    hud._betDrag.lastT = now;
  };

  const dragEnd = () => {
    if (!hud._betDrag) return 0;
    const moved = hud._betDrag.moved || 0;
    hud._betDrag = null;

    if (moved >= TAP_THRESHOLD) {
      if (Math.abs(hud._betVel) > 0.06) hudStartBetInertia();
      else hudSnapBetToLeftSmooth(180);
    } else {
      hudStopBetInertia();
    }
    return moved;
  };

  hud.betValuesCents.forEach((vCents) => {
    const chip = makeBetChip(vCents, chipW, chipH);
    chip.x = cx;
    chip.y = cy;
    chip._valueCents = vCents;

    setChipSelected(chip, vCents === betCents);

    // ✅ stopPropagation => évite double drag (chip + betBand)
    chip.on("pointerdown", (e) => { if (!spinning) { e.stopPropagation(); dragStart(e.data.global.x); }});
    chip.on("pointermove", (e) => { if (!spinning) { e.stopPropagation(); dragMove(e.data.global.x); }});

    chip.on("pointerup", (e) => {
      if (spinning) return;
      e.stopPropagation();
      const moved = dragEnd();
      if (moved < TAP_THRESHOLD) {
        betCents = vCents;
        hudUpdateNumbers();
      }
    });

    chip.on("pointerupoutside", (e) => { if (!spinning) e.stopPropagation(); dragEnd(); });

    hud.betStrip.addChild(chip);
    hud.betChips.push(chip);

    cx += chipW + gap;
  });

  // écoute drag sur bande (hors chips)
  hud.betBand.interactive = true;
  hud.betBand.hitArea = new PIXI.Rectangle(0, 0, w, h);

  hud.betBand.on("pointerdown", (e) => { if (!spinning) dragStart(e.data.global.x); });
  hud.betBand.on("pointermove", (e) => { if (!spinning) dragMove(e.data.global.x); });
  hud.betBand.on("pointerup", () => { dragEnd(); });
  hud.betBand.on("pointerupoutside", () => { dragEnd(); });

  // ✅ overlay lock visuel (au-dessus)
  const lock = new PIXI.Container();
  const dim = new PIXI.Graphics();
  dim.beginFill(0x000000, 0.35);
  dim.drawRoundedRect(6, 6, w - 12, h - 12, Math.min(16, h * 0.45));
  dim.endFill();
  lock.addChild(dim);

  const t = new PIXI.Text("MISE BLOQUÉE", new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize: Math.round(h * 0.28),
    fill: 0xffffff,
    fontWeight: "900",
    stroke: 0x000000,
    strokeThickness: 3,
  }));
  t.anchor.set(0.5);
  t.x = w / 2;
  t.y = h / 2;
  lock.addChild(t);

  lock.visible = false;
  lock.alpha = 0.0;
  hud.betLockOverlay = lock;
  hud.betBand.addChild(lock);

  hudSetBetScroll(0);
  return hud.betBand;
}

// ================== PAYTABLE ==================
let paytableOverlay = null;

function togglePaytable() {
  if (paytableOverlay) {
    paytableOverlay.destroy({ children: true });
    paytableOverlay = null;
    return;
  }

  const w = app.screen.width;
  const h = app.screen.height;

  paytableOverlay = new PIXI.Container();
  paytableOverlay.interactive = true;

  const dim = new PIXI.Graphics();
  dim.beginFill(0x000000, 0.55);
  dim.drawRect(0, 0, w, h);
  dim.endFill();
  paytableOverlay.addChild(dim);

  const boxW = Math.min(w * 0.90, 560);
  const boxH = Math.min(h * 0.70, 660);

  const box = makeRoundedPanel(boxW, boxH, 24);
  box.x = Math.round((w - boxW) / 2);
  box.y = Math.round((h - boxH) / 2);
  paytableOverlay.addChild(box);

  const pad = 22;

  const title = new PIXI.Text("Table des gains", makeTextStyleLabel(Math.round(boxH * 0.070)));
  title.anchor.set(0.5, 0);
  title.x = boxW / 2;
  title.y = pad;
  box.addChild(title);

  const bodyText =
`Fruits : 3=2x | 4=3x | 5=4x

Cartes : 3x | 4x | 5x
Pièce : 4x | 5x | 6x
Couronne : 10x | 12x | 14x
BAR : 16x | 18x | 20x
7 rouge : 20x | 25x | 30x
77 mauve : 30x | 40x | 50x

WILD : remplace tout sauf BONUS
BONUS : 3+ => 10 free spins (gains x2)`;

  const btnH = Math.round(Math.max(54, boxH * 0.11));
  const btnW = Math.round(boxW * 0.60);

  const scrollTop = title.y + title.height + 14;
  const scrollBottom = boxH - (btnH + pad + 12);
  const scrollH = Math.max(160, scrollBottom - scrollTop);

  const scroll = new PIXI.Container();
  scroll.x = pad;
  scroll.y = scrollTop;

  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff, 1);
  mask.drawRect(0, 0, boxW - pad * 2, scrollH);
  mask.endFill();
  mask.renderable = false;

  const fontSize = Math.round(boxH * 0.040);
  const txt = new PIXI.Text(bodyText, new PIXI.TextStyle({
    fontFamily: "system-ui",
    fontSize,
    fill: 0xffffff,
    fontWeight: "650",
    stroke: 0x000000,
    strokeThickness: 2,
    lineHeight: Math.round(fontSize * 1.30),
    wordWrap: true,
    wordWrapWidth: boxW - pad * 2,
  }));
  txt.x = 0;
  txt.y = 0;

  scroll.addChild(txt);
  scroll.mask = mask;

  const hit2 = new PIXI.Graphics();
  hit2.beginFill(0xffffff, 0.001);
  hit2.drawRect(0, 0, boxW - pad * 2, scrollH);
  hit2.endFill();
  hit2.interactive = true;

  let drag = null;
  const clampScroll = () => {
    const minY = Math.min(0, scrollH - txt.height);
    txt.y = Math.max(minY, Math.min(0, txt.y));
  };

  hit2.on("pointerdown", (e) => {
    const p = e.data.global;
    drag = { y: p.y, startTxtY: txt.y };
  });
  hit2.on("pointermove", (e) => {
    if (!drag) return;
    const p = e.data.global;
    const dy = p.y - drag.y;
    txt.y = drag.startTxtY + dy;
    clampScroll();
  });
  const end = () => { drag = null; clampScroll(); };
  hit2.on("pointerup", end);
  hit2.on("pointerupoutside", end);

  box.addChild(mask);
  box.addChild(scroll);
  box.addChild(hit2);

  const btn = makeActionChip("FERMER", btnW, btnH);
  btn.x = boxW / 2;
  btn.y = boxH - pad - btnH / 2;
  btn.on("pointerup", () => togglePaytable());
  box.addChild(btn);

  dim.interactive = true;
  dim.on("pointerup", () => togglePaytable());

  app.stage.addChild(paytableOverlay);
}

// -------- easing --------
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t) {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function smoothFactor(dt, tauMs) { return 1 - Math.exp(-dt / Math.max(1, tauMs)); }

// recycle O(1)
function recycleReelOneStepDown(reel, newTopId) {
  const s = reel.symbols;
  for (let i = 0; i < s.length; i++) s[i].container.y += reelStep;

  const bottom = s.pop();
  bottom.container.y = s[0].container.y - reelStep;
  setCellSymbol(bottom, newTopId);
  s.unshift(bottom);
}

// STOP pro (synchro)
function requestStop(preset) {
  if (!spinning || stopRequested) return;
  stopRequested = true;
  stopArmedAt = performance.now();

  const globalStopAt = stopArmedAt;
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    const earliest = r.startAt + MIN_SPIN_BEFORE_STOP_MS;
    r.userStopAt = Math.max(earliest, globalStopAt);
  }

  if (gridArrivedAt) ensurePlansAfterGrid(preset);
  hudSetStatusMessage("STOP…");
}

function prepareReelPlans(now, preset) {
  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];

    r.userStopAt = Infinity;
    r.offset = 0;
    r.vel = 0;
    r.container.y = 0;

    r.state = "spin";
    r.settleQueue = null;
    r.settleIdx = 0;

    r.snapStart = 0;
    r.startAt = now + c * preset.startStaggerMs;

    const baseStop = r.startAt + preset.spinMs + c * preset.stopStaggerMs;
    r.minStopAt = baseStop;

    r.settleStart = baseStop - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;

    r.finalApplied = false;
  }
}

function ensurePlansAfterGrid(preset) {
  const now = performance.now();

  for (let c = 0; c < reels.length; c++) {
    const r = reels[c];
    const needsGridTime = gridArrivedAt || 0;

    const normalStopAt = Math.max(r.minStopAt, needsGridTime);
    const u = Number.isFinite(r.userStopAt) ? r.userStopAt : now;
    const requestedStopAt = stopRequested ? Math.max(u, needsGridTime) : normalStopAt;
    const stopAt = stopRequested ? requestedStopAt : normalStopAt;

    r.settleStart = stopAt - preset.settleMs;
    r.settleStart = Math.max(r.startAt + 80, r.settleStart);

    const preBoost = stopRequested ? STOP_PREDECEL_BOOST : 1.0;
    r.preDecelStart = r.settleStart - preset.preDecelMs * preBoost;
    r.preDecelStart = Math.max(r.startAt, r.preDecelStart);
  }
}

function buildSettleQueueForReel(grid, col) {
  const t = safeId(grid[0][col]);
  const m = safeId(grid[1][col]);
  const b = safeId(grid[2][col]);
  return [randomSymbolId(), b, m, t];
}

function animateSpinUntilDone(preset) {
  return new Promise((resolve) => {
    let prev = performance.now();
    const bounceAmp = Math.min(reelStep * preset.bounceAmpFactor, 14);

    function tick(now) {
      const dt = Math.max(0, now - prev);
      prev = now;

      let allDone = true;
      const k = smoothFactor(dt, 110);

      for (let c = 0; c < reels.length; c++) {
        const r = reels[c];

        if (now < r.startAt) { allDone = false; continue; }
        if (r.state !== "done") allDone = false;

        if (r.state === "spin") {
          if (now >= r.settleStart && pendingGrid) {
            r.state = "settle";
          } else {
            let target = preset.basePxPerMs;

            const tAccel = clamp01((now - r.startAt) / preset.accelMs);
            target *= (0.35 + 0.65 * easeInOutQuad(tAccel));

            if (now >= r.preDecelStart) {
              const t = clamp01((now - r.preDecelStart) / Math.max(1, (r.settleStart - r.preDecelStart)));
              target *= (1 - easeInOutQuad(t) * 0.78);
            }

            r.vel = r.vel + (target - r.vel) * k;
            r.offset += r.vel * dt;

            while (r.offset >= reelStep) {
              r.offset -= reelStep;
              recycleReelOneStepDown(r, randomSymbolId());
            }
            r.container.y = r.offset;
          }
        }

        if (r.state === "settle") {
          if (!r.settleQueue) {
            r.settleQueue = buildSettleQueueForReel(pendingGrid, c);
            r.settleIdx = 0;
          }

          const tSettle = clamp01((now - r.settleStart) / preset.settleMs);
          const settleEnd = r.settleStart + preset.settleMs;
          const remainingMs = Math.max(1, settleEnd - now);

          const distToNextStep = reelStep - r.offset;
          const remainingSteps = Math.max(0, (r.settleQueue.length - r.settleIdx));
          const remainingDist = distToNextStep + Math.max(0, remainingSteps - 1) * reelStep;

          const baseNeed = remainingDist / remainingMs;
          const ease = 0.95 - 0.30 * easeOutCubic(tSettle);
          const targetSpeed = Math.max(0.25, baseNeed * ease);

          r.vel = r.vel + (targetSpeed - r.vel) * k;
          r.offset += r.vel * dt;

          while (r.offset >= reelStep && r.settleIdx < r.settleQueue.length) {
            r.offset -= reelStep;
            const nextId = r.settleQueue[r.settleIdx++];
            recycleReelOneStepDown(r, nextId);
          }

          r.container.y = r.offset;

          if (r.settleIdx >= r.settleQueue.length) {
            if (!r.finalApplied && pendingGrid) {
              for (let row = 0; row < ROWS; row++) {
                setCellSymbol(r.symbols[TOP_EXTRA + row], safeId(pendingGrid[row][c]));
              }
              r.finalApplied = true;
            }
            r.state = "snap";
            r.snapStart = now;
          }
        }

        if (r.state === "snap") {
          const t = clamp01((now - r.snapStart) / preset.snapMs);
          r.offset = r.offset * (1 - easeOutCubic(t));
          if (r.offset < 0.25) r.offset = 0;
          r.container.y = r.offset;

          if (t >= 1 || r.offset === 0) {
            r.state = "bounce";
            r.bounceStart = now;
            r.container.y = 0;
            r.offset = 0;
            r.vel = 0;
          }
        }

        if (r.state === "bounce") {
          const tb = clamp01((now - r.bounceStart) / preset.bounceMs);
          const s = Math.sin(tb * Math.PI);
          const amp = bounceAmp * (1 - tb * 0.35);
          r.container.y = -s * amp;

          if (tb >= 1) {
            r.container.y = 0;
            r.state = "done";
          }
        }
      }

      if (allDone) {
        for (let c = 0; c < reels.length; c++) {
          const r = reels[c];
          r.container.y = 0;
          r.offset = 0;
          r.vel = 0;
        }
        return resolve();
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

// Highlight
function startHighlight(cells) {
  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  cells.forEach(([col, row]) => {
    const reel = reels[col];
    if (!reel) return;
    const idx = TOP_EXTRA + row;
    const cellObj = reel.symbols[idx];
    if (cellObj) highlightedCells.push(cellObj);
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

// PAYLINES front (coords [col,row] pour highlight)
const PAYLINES_UI = [
  [[0, 0],[1, 0],[2, 0],[3, 0],[4, 0]],
  [[0, 1],[1, 1],[2, 1],[3, 1],[4, 1]],
  [[0, 2],[1, 2],[2, 2],[3, 2],[4, 2]],
  [[0, 0],[1, 1],[2, 2],[3, 1],[4, 0]],
  [[0, 2],[1, 1],[2, 0],[3, 1],[4, 2]],
];

async function onSpinOrStop() {
  // STOP doit rester réactif : pas de cooldown ici
  if (spinning) {
    requestStop(SPEEDS[speedIndex]);
    hudSetSpinButtonMode(true);
    return;
  }

  // ✅ anti double-tap iOS sur START uniquement
  if (!canStartSpinNow()) return;

  if (spinInFlight) return;
  if (!app || !symbolTextures.length) return;

  spinInFlight = true;
  spinning = true;
  stopRequested = false;
  stopArmedAt = 0;

  pendingGrid = null;
  gridArrivedAt = 0;
  pendingOutcome = null;

  hudSetSpinButtonMode(true);

  highlightedCells.forEach((cell) => (cell.container.alpha = 1));
  highlightedCells = [];

  hudSetStatusMessage("SPIN…");
  lastWinCents = 0;
  hudUpdateNumbers();

  // ✅ lock visuel + input bet band pendant le spin
  hudSetBetBandLocked(true);

  const preset = SPEEDS[speedIndex];
  const now = performance.now();
  prepareReelPlans(now, preset);

  // ✅ /spin avec AbortController timeout réel
  (async () => {
    const data = await fetchJsonWithTimeout(
      "/spin",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ betCents, clientSeed }),
      },
      SPIN_REQUEST_TIMEOUT_MS
    );

    if (data.error) {
      pendingOutcome = { error: data.error, ...data };
      pendingGrid = null;
      gridArrivedAt = performance.now();
      ensurePlansAfterGrid(preset);
      return;
    }

    pendingGrid = data.result;
    pendingOutcome = {
      winCents: Number(data.winCents) || 0,
      bonus: data.bonus || { freeSpins: 0, multiplier: 1 },
      winningLines: Array.isArray(data.winningLines) ? data.winningLines : [],
      balanceCents: Number(data.balanceCents),
      freeSpins: Number(data.freeSpins),
      winMultiplier: Number(data.winMultiplier),
      lastWinCents: Number(data.lastWinCents),
      fair: data.fair,
    };

    gridArrivedAt = performance.now();
    ensurePlansAfterGrid(preset);
  })();

  const SPIN_TIMEOUT_MS = 7000; // (si tu l’as déjà, garde une seule définition)
  const MAX_WAIT_MS = SPIN_TIMEOUT_MS + 300;

  const startWait = performance.now();
  while (!pendingGrid && !pendingOutcome?.error && performance.now() - startWait < MAX_WAIT_MS) {
  await new Promise((res) => setTimeout(res, 25));
}

  // erreur => cut propre
  if (!pendingGrid || !pendingOutcome || pendingOutcome.error) {
    spinning = false;
    spinInFlight = false;
    hudSetSpinButtonMode(false);

    // ✅ unlock bet band
    hudSetBetBandLocked(false);

    if (pendingOutcome?.error === "INSUFFICIENT_FUNDS") hudSetStatusMessage("SOLDE INSUFFISANT");
    else if (pendingOutcome?.error === "BET_NOT_ALLOWED") hudSetStatusMessage("MISE NON AUTORISÉE");
    else if (pendingOutcome?.error === "TIMEOUT") hudSetStatusMessage("TIMEOUT RÉSEAU");
    else if (pendingOutcome?.error === "NETWORK_ERROR") hudSetStatusMessage("ERREUR RÉSEAU");
    else hudSetStatusMessage("ERREUR SERVEUR");

    await syncStateFromServer({ clearError: false });
    return;
  }

  await animateSpinUntilDone(preset);

  // appliquer état autoritaire
  balanceCents = pendingOutcome.balanceCents;
  freeSpins = pendingOutcome.freeSpins;
  winMultiplier = pendingOutcome.winMultiplier;
  lastWinCents = pendingOutcome.lastWinCents;

  spinning = false;
  spinInFlight = false;
  hudSetSpinButtonMode(false);

  // ✅ unlock bet band
  hudSetBetBandLocked(false);

  hudUpdateNumbers();
  hudUpdateFsBadge();

  const winCents = clampInt(pendingOutcome.winCents, 0, 999999999);
  const bonus = pendingOutcome.bonus || { freeSpins: 0, multiplier: 1 };
  const winningLines = pendingOutcome.winningLines || [];

  // status + highlight
  if ((bonus.freeSpins || 0) > 0) {
    hudSetStatusMessage("BONUS ! +10 FREE SPINS (GAINS ×2)");
  } else if (winCents > 0) {
    hudSetStatusMessage("GAIN : " + fmtMoneyFromCents(winCents) + " EUR");

    const cells = [];
    for (const line of winningLines) {
      const li = clampInt(line.lineIndex, 0, PAYLINES_UI.length - 1);
      const cnt = clampInt(line.count, 0, 5);
      const coords = PAYLINES_UI[li];
      for (let i = 0; i < Math.min(cnt, coords.length); i++) {
        cells.push(coords[i]);
      }
    }
    if (cells.length) startHighlight(cells);
  } else {
    hudSetStatusMessage("PAS DE GAIN");
  }
}

// Start
window.addEventListener("load", () => {
  try {
    initPixi();
  } catch (e) {
    console.error(e);
    showMessage("Erreur init (" + (e?.message || String(e)) + ")");
  }
});