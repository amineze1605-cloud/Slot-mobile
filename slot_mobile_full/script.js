// script.js — Slot mobile PIXI v5 (5x3)
// ✅ STOP accélère la décélération
// ✅ 7 sprites / reel (2 extra haut + 3 visibles + 2 extra bas)
// ✅ Blur léger pendant spin (OFF à la fin)
// ✅ Anti-swap : textures changées uniquement hors écran
// ✅ Audio OFF (tu peux supprimer les mp3)

const MAX_DPR = 1.25;
const ENABLE_GLOW = true;
const ENABLE_AUDIO = false;

const EXTRA_SYMBOLS = 2;                 // ✅ 2 au-dessus + 2 en dessous
const REEL_SYMBOLS = ROWS_PLUS_EXTRAS(); // (helper plus bas)

function ROWS_PLUS_EXTRAS(){ return 3 + EXTRA_SYMBOLS*2; } // = 7

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

const PREMIUM77_ID = 0;
const BONUS_ID = 6;
const WILD_ID = 9;

let balance = 1000;
let bet = 1;
let lastWin = 0;
let spinning = false;
let freeSpins = 0;
let winMultiplier = 1;

let spinInFlight = false;
let pendingGrid = null;
let gridArrivedAt = 0;

let stopRequested = false;
let stopRequestedAt = 0;
let stopPlanApplied = false;
let currentPreset = null;

let messageText;
let stats = { soldeLabel:null, soldeValue:null, miseLabel:null, miseValue:null, gainLabel:null, gainValue:null };
let btnMinus, btnPlus, btnSpin, btnInfo, btnSpeed;
let paytableOverlay = null;

let highlightedCells = [];
let highlightTimer = 0;

let slotContainer = null;
let slotFrame = null;
let slotMask = null;
let bgContainer = null;

let symbolSize = 0;
let reelGap = 8;
let reelStep = 0;
let visibleH = 0;

let layout = {
  slotX: 0, slotY: 0, slotW: 0, slotH: 0,
  framePadX: 18, framePadY: 18, frameRadius: 26,
  statsY: 0, buttonsY: 0,
};

function getSafeTopPx() {
  const h = app?.screen?.height || window.innerHeight || 800;
  return Math.max(16, Math.round(h * 0.03));
}

// ----------------------------
// SPEEDS (spin plus long, départ rapide, bounce doux)
// ----------------------------
const SPEEDS = [
  {
    name: "LENT",
    basePxPerMs: 1.05,
    spinMs: 2050,
    startStaggerMs: 115,
    stopStaggerMs: 135,
    accelMs: 85,
    preDecelMs: 380,
    settleMs: 420,
    snapMs: 140,
    bounceMs: 190,
    bounceAmpFactor: 0.06,
    stopAfterGridMs: 120,
    minSpinMs: 520,
    stopBrakeMs: 220,          // ✅ freinage fort après STOP
    stopBrakePower: 0.82,      // ✅ intensité (0.75->0.9)
    blurMax: 3.2,              // ✅ blur max léger
  },
  {
    name: "NORMAL",
    basePxPerMs: 1.35,
    spinMs: 1700,
    startStaggerMs: 95,
    stopStaggerMs: 120,
    accelMs: 78,
    preDecelMs: 330,
    settleMs: 380,
    snapMs: 130,
    bounceMs: 180,
    bounceAmpFactor: 0.055,
    stopAfterGridMs: 110,
    minSpinMs: 480,
    stopBrakeMs: 200,
    stopBrakePower: 0.82,
    blurMax: 3.4,
  },
  {
    name: "RAPIDE",
    basePxPerMs: 1.70,
    spinMs: 1350,
    startStaggerMs: 80,
    stopStaggerMs: 105,
    accelMs: 70,
    preDecelMs: 280,
    settleMs: 330,
    snapMs: 120,
    bounceMs: 170,
    bounceAmpFactor: 0.05,
    stopAfterGridMs: 95,
    minSpinMs: 420,
    stopBrakeMs: 180,
    stopBrakePower: 0.82,
    blurMax: 3.6,
  },
];
let speedIndex = 0;

// ----------------------------
// Glow
// ----------------------------
const GLOW_COLORS = { wild: 0x2bff5a, bonus: 0x3aa6ff, premium77: 0xd45bff };
const GLOW_PARAMS = {
  wild:    { distance: 6, outer: 0.70, inner: 0.20, quality: 0.22 },
  bonus:   { distance: 6, outer: 0.65, inner: 0.20, quality: 0.22 },
  premium: { distance: 7, outer: 0.85, inner: 0.20, quality: 0.24 },
};
let glowFilters = null;

function buildGlowFilters() {
  if (!ENABLE_GLOW) return null;
  const hasGlow = !!(PIXI.filters && PIXI.filters.GlowFilter);
  if (!hasGlow) return null;

  const r = app.renderer.resolution || 1;

  const fWild = new PIXI.filters.GlowFilter(
    GLOW_PARAMS.wild.distance, GLOW_PARAMS.wild.outer, GLOW_PARAMS.wild.inner,
    GLOW_COLORS.wild, GLOW_PARAMS.wild.quality
  );
  const fBonus = new PIXI.filters.GlowFilter(
    GLOW_PARAMS.bonus.distance, GLOW_PARAMS.bonus.outer, GLOW_PARAMS.bonus.inner,
    GLOW_COLORS.bonus, GLOW_PARAMS.bonus.quality
  );
  const fPremium = new PIXI.filters.GlowFilter(
    GLOW_PARAMS.premium.distance, GLOW_PARAMS.premium.outer, GLOW_PARAMS.premium.inner,
    GLOW_COLORS.premium77, GLOW_PARAMS.premium.quality
  );

  fWild.resolution = r; fBonus.resolution = r; fPremium.resolution = r;
  fWild.padding = GLOW_PARAMS.wild.distance * 2;
  fBonus.padding = GLOW_PARAMS.bonus.distance * 2;
  fPremium.padding = GLOW_PARAMS.premium.distance * 2;

  return { wild: fWild, bonus: fBonus, premium: fPremium };
}

// ----------------------------
// AUDIO (OFF)
// ----------------------------
function makeAudioPoolNoop(){ return { play(){} }; }
function makeAudioPool(url, size=3, volume=0.7){
  if (!ENABLE_AUDIO) return makeAudioPoolNoop();
  const pool=[]; for(let i=0;i<size;i++){ const a=new Audio(url); a.preload="auto"; a.volume=volume; pool.push(a); }
  let idx=0;
  return { play(vol){ const a=pool[idx]; idx=(idx+1)%pool.length; try{ if(typeof vol==="number") a.volume=vol; a.currentTime=0; a.play().catch(()=>{});}catch(e){} } };
}
const audio = {
  spin: makeAudioPool("assets/audio/spin.mp3",2,0.7),
  stop: makeAudioPool("assets/audio/stop.mp3",3,0.65),
  win:  makeAudioPool("assets/audio/win.mp3",2,0.7),
  bonus:makeAudioPool("assets/audio/bonus.mp3",2,0.7),
  tick: makeAudioPool("assets/audio/stop.mp3",6,0.22),
};

// ----------------------------
// Loader
// ----------------------------
function showMessage(text){ if(!loaderEl) return; loaderEl.style.display="flex"; loaderEl.textContent=text; }
function hideMessage(){ if(!loaderEl) return; loaderEl.style.display="none"; }

// ----------------------------
// Spritesheet
// ----------------------------
function loadSpritesheet(){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.src="assets/spritesheet.png?v=12";
    img.onload=()=>{
      try{
        const bt = PIXI.BaseTexture.from(img);
        bt.mipmap = PIXI.MIPMAP_MODES.OFF;
        bt.wrapMode = PIXI.WRAP_MODES.CLAMP;
        bt.scaleMode = PIXI.SCALE_MODES.LINEAR;
        bt.update();
        resolve(bt);
      }catch(e){ reject(e); }
    };
    img.onerror=(e)=>reject(e||new Error("Impossible de charger assets/spritesheet.png"));
  });
}

// ----------------------------
// Background
// ----------------------------
function makeGradientTexture(w,h){
  const c=document.createElement("canvas");
  c.width=Math.max(2,Math.floor(w));
  c.height=Math.max(2,Math.floor(h));
  const ctx=c.getContext("2d");
  const g=ctx.createLinearGradient(0,0,0,c.height);
  g.addColorStop(0.0,"#040712"); g.addColorStop(0.45,"#070C1F"); g.addColorStop(1.0,"#030510");
  ctx.fillStyle=g; ctx.fillRect(0,0,c.width,c.height);
  const v=ctx.createRadialGradient(c.width*0.5,c.height*0.35,10,c.width*0.5,c.height*0.5,Math.max(c.width,c.height)*0.75);
  v.addColorStop(0,"rgba(0,0,0,0)"); v.addColorStop(1,"rgba(0,0,0,0.55)");
  ctx.fillStyle=v; ctx.fillRect(0,0,c.width,c.height);
  return PIXI.Texture.from(c);
}

function buildBackground(){
  const w=app.screen.width, h=app.screen.height;
  if(bgContainer){ bgContainer.destroy(true); bgContainer=null; }
  bgContainer=new PIXI.Container();
  const bg=new PIXI.Sprite(makeGradientTexture(w,h));
  bg.width=w; bg.height=h;
  bgContainer.addChild(bg);
  app.stage.addChild(bgContainer);
}

// ----------------------------
// Init
// ----------------------------
async function initPixi(){
  if(!canvas) return console.error("Canvas #game introuvable");
  if(!window.PIXI){ showMessage("Erreur JS : PIXI introuvable"); return; }

  const dpr = Math.min(window.devicePixelRatio||1, MAX_DPR);

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

  try{
    const baseTexture = await loadSpritesheet();
    const fullW=baseTexture.width, fullH=baseTexture.height;
    const cellW=Math.round(fullW/4), cellH=Math.round(fullH/4);

    const positions = [
      [0,0],[1,0],[2,0],[3,0],
      [0,1],[1,1],[2,1],[3,1],
      [0,2],[1,2],[2,2],[3,2],
    ];
    symbolTextures = positions.map(([c,r])=>new PIXI.Texture(baseTexture, new PIXI.Rectangle(c*cellW, r*cellH, cellW, cellH)));

    glowFilters = buildGlowFilters();

    buildBackground();
    buildSlotScene();
    buildHUD();

    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");

    app.ticker.add(updateHighlight);
    window.addEventListener("resize", rebuildAll);
  }catch(e){
    console.error(e);
    showMessage("Erreur chargement assets");
  }
}

function rebuildAll(){
  try{
    if(!app) return;
    if(slotMask){ slotMask.destroy(true); slotMask=null; }
    if(slotFrame){ slotFrame.destroy(true); slotFrame=null; }
    if(slotContainer){ slotContainer.destroy(true); slotContainer=null; }
    if(paytableOverlay){ paytableOverlay.destroy(true); paytableOverlay=null; }
    if(bgContainer){ bgContainer.destroy(true); bgContainer=null; }

    app.stage.removeChildren();
    reels=[];
    highlightedCells=[];

    glowFilters = buildGlowFilters();
    buildBackground();
    buildSlotScene();
    buildHUD();

    updateHUDTexts(spinning ? "Spin…" : "Appuyez sur SPIN pour lancer");
  }catch(e){ console.error("Resize rebuild error:", e); }
}

function safeId(id){ const n=symbolTextures.length||1; return ((id % n) + n) % n; }
function randomSymbolId(){ return Math.floor(Math.random()*symbolTextures.length); }

function createSymbolCell(texture, sizePx){
  const cell=new PIXI.Container(); cell.roundPixels=true;

  const glowSprite=new PIXI.Sprite(texture);
  glowSprite.anchor.set(0.5);
  glowSprite.width=sizePx; glowSprite.height=sizePx;
  glowSprite.visible=false; glowSprite.roundPixels=true; glowSprite.alpha=0.55;

  const mainSprite=new PIXI.Sprite(texture);
  mainSprite.anchor.set(0.5);
  mainSprite.width=sizePx; mainSprite.height=sizePx;
  mainSprite.roundPixels=true;

  cell.addChild(glowSprite, mainSprite);
  return { container:cell, glow:glowSprite, main:mainSprite, symbolId:-1 };
}

function applySymbolVisual(cellObj, symbolId){
  if(!ENABLE_GLOW || !glowFilters){
    cellObj.glow.visible=false; cellObj.glow.filters=null; cellObj.glow.tint=0xffffff;
    return;
  }
  cellObj.glow.visible=false; cellObj.glow.filters=null; cellObj.glow.tint=0xffffff;

  if(symbolId===WILD_ID){
    cellObj.glow.alpha=0.45; cellObj.glow.visible=true; cellObj.glow.filters=[glowFilters.wild];
  }else if(symbolId===BONUS_ID){
    cellObj.glow.alpha=0.45; cellObj.glow.visible=true; cellObj.glow.filters=[glowFilters.bonus];
  }else if(symbolId===PREMIUM77_ID){
    cellObj.glow.alpha=0.35; cellObj.glow.tint=GLOW_COLORS.premium77;
    cellObj.glow.visible=true; cellObj.glow.filters=[glowFilters.premium];
  }
}

function setCellSymbol(cellObj, symbolId, allowGlow){
  const sid=safeId(symbolId);
  const tex=symbolTextures[sid];
  cellObj.symbolId=sid;
  cellObj.main.texture=tex;
  cellObj.glow.texture=tex;

  if(allowGlow) applySymbolVisual(cellObj, sid);
  else { cellObj.glow.visible=false; cellObj.glow.filters=null; }
}

// ----------------------------
// Slot scene
// ----------------------------
function buildSlotScene(){
  const w=app.screen.width, h=app.screen.height;
  const safeTop=getSafeTopPx();

  reelGap=8;

  const sideMargin=w*0.08;
  const maxTotalWidth=w - sideMargin*2;
  const symbolFromWidth=(maxTotalWidth - reelGap*(COLS-1))/COLS;

  const topZone=safeTop + Math.round(h*0.10);
  const bottomZone=Math.round(h*0.64);
  const availableH=Math.max(260, bottomZone - topZone);
  const symbolFromHeight=availableH*0.36;

  const MAX_SYMBOL_PX=256;
  symbolSize=Math.min(MAX_SYMBOL_PX, Math.round(Math.min(symbolFromWidth, symbolFromHeight)));

  reelStep=symbolSize + reelGap;
  visibleH=ROWS*reelStep - reelGap;

  const totalReelWidth=COLS*symbolSize + reelGap*(COLS-1);

  layout.slotW=totalReelWidth;
  layout.slotH=visibleH;
  layout.slotX=Math.round((w - totalReelWidth)/2);
  layout.slotY=Math.round(topZone + (availableH - visibleH)*0.30);

  layout.statsY=layout.slotY + visibleH + layout.framePadY + Math.round(h*0.03);
  layout.buttonsY=layout.statsY + Math.round(h*0.14);

  slotContainer=new PIXI.Container();
  slotContainer.x=layout.slotX;
  slotContainer.y=layout.slotY;

  slotFrame=new PIXI.Graphics();
  slotFrame.lineStyle(6,0xf2b632,1);
  slotFrame.beginFill(0x060b1a,0.78);
  slotFrame.drawRoundedRect(
    layout.slotX - layout.framePadX,
    layout.slotY - layout.framePadY,
    totalReelWidth + layout.framePadX*2,
    visibleH + layout.framePadY*2,
    layout.frameRadius
  );
  slotFrame.endFill();

  app.stage.addChild(slotFrame);
  app.stage.addChild(slotContainer);

  slotMask=new PIXI.Graphics();
  slotMask.beginFill(0xffffff,1);
  slotMask.drawRect(0,0,totalReelWidth,visibleH);
  slotMask.endFill();
  slotMask.x=layout.slotX;
  slotMask.y=layout.slotY;
  slotMask.renderable=false;
  app.stage.addChild(slotMask);
  slotContainer.mask=slotMask;

  reels=[];

  for(let c=0;c<COLS;c++){
    const reelContainer=new PIXI.Container();
    reelContainer.x=Math.round(c*(symbolSize+reelGap));
    reelContainer.y=0;

    // ✅ blur filter par reel (léger)
    let blurFilter = null;
    if (PIXI.filters && PIXI.filters.BlurFilter) {
      blurFilter = new PIXI.filters.BlurFilter(0, 1);
      blurFilter.blur = 0;
      blurFilter.quality = 1;
      blurFilter.resolution = app.renderer.resolution || 1;
    }

    slotContainer.addChild(reelContainer);

    // ✅ 7 symboles: i=0..6 => positions (i-2) => [-2,-1,0,1,2,3,4]
    const cells=[];
    for(let i=0;i<ROWS + EXTRA_SYMBOLS*2;i++){
      const idx=randomSymbolId();
      const cellObj=createSymbolCell(symbolTextures[idx], symbolSize);
      setCellSymbol(cellObj, idx, true);

      cellObj.container.x=Math.round(symbolSize/2);
      cellObj.container.y=Math.round((i - EXTRA_SYMBOLS)*reelStep + symbolSize/2);
      reelContainer.addChild(cellObj.container);
      cells.push(cellObj);
    }

    reels.push({
      container: reelContainer,
      symbols: cells,
      blur: blurFilter,

      offset: 0,
      vel: 0,
      state: "idle",

      startAt: 0,
      stopAt: 0,
      minStopAt: 0,
      settleStart: 0,
      preDecelStart: 0,

      settleQueue: null,
      settleIdx: 0,
      didTick: false,

      snapStart: 0,
      bounceStart: 0,
    });
  }
}

// ----------------------------
// Recycle O(1) — texture changée hors écran (anti-swap)
// ----------------------------
function recycleReelOneStepDown(reel, newTopId, allowGlow){
  const s=reel.symbols;

  for(let i=0;i<s.length;i++) s[i].container.y += reelStep;

  const bottom=s.pop();
  bottom.container.y = s[0].container.y - reelStep; // hors écran
  setCellSymbol(bottom, newTopId, allowGlow);
  s.unshift(bottom);
}

function makeText(txt, size, x, y, ax=0.5, ay=0.5, weight="600", mono=false){
  const style=new PIXI.TextStyle({
    fontFamily: mono ? "ui-monospace, Menlo, monospace" : "system-ui",
    fontSize: size,
    fill: 0xffffff,
    fontWeight: weight,
  });
  const t=new PIXI.Text(txt, style);
  t.anchor.set(ax,ay);
  t.x=x; t.y=y;
  app.stage.addChild(t);
  return t;
}

function makeButton(label, width, height, opts={}){
  const container=new PIXI.Container();
  const g=new PIXI.Graphics();

  const bg=opts.bg ?? 0x0f172a;
  const bgA=opts.bgA ?? 0.78;
  const border=opts.border ?? 0xf2b632;

  g.beginFill(bg,bgA);
  g.lineStyle(4,border,1);
  g.drawRoundedRect(-width/2,-height/2,width,height,Math.min(18,height*0.35));
  g.endFill();

  const shine=new PIXI.Graphics();
  shine.beginFill(0xffffff,0.06);
  shine.drawRoundedRect(-width/2+6,-height/2+6,width-12,height*0.35,Math.min(14,height*0.28));
  shine.endFill();

  const t=new PIXI.Text(label,new PIXI.TextStyle({
    fontFamily:"system-ui",
    fontSize:Math.min(height*0.40,30),
    fill:0xffffff,
    fontWeight:"900",
  }));
  t.anchor.set(0.5);

  container.addChild(g,shine,t);
  container.interactive=true;
  container.buttonMode=true;

  container.on("pointerdown",()=>g.alpha=0.75);
  container.on("pointerup",()=>g.alpha=1.0);
  container.on("pointerupoutside",()=>g.alpha=1.0);

  app.stage.addChild(container);
  container._bg=g; container._shine=shine; container._text=t;
  return container;
}

function setSpinButtonMode(isStop){
  if(!btnSpin) return;
  if(isStop){
    btnSpin._text.text="STOP";
    btnSpin._bg.tint=0xff2d2d;
    btnSpin._shine.alpha=0.10;
  }else{
    btnSpin._text.text="SPIN";
    btnSpin._bg.tint=0xffffff;
    btnSpin._shine.alpha=0.06;
  }
}

function makeSpeedButton(width,height){
  const b=makeButton("",width,height);
  b._text.destroy();
  const tTop=new PIXI.Text("VITESSE",new PIXI.TextStyle({ fontFamily:"system-ui", fontSize:Math.min(height*0.26,18), fill:0xffffff, fontWeight:"700" }));
  const tBottom=new PIXI.Text(SPEEDS[speedIndex].name,new PIXI.TextStyle({ fontFamily:"system-ui", fontSize:Math.min(height*0.34,22), fill:0xffffff, fontWeight:"900" }));
  tTop.anchor.set(0.5); tBottom.anchor.set(0.5);
  tTop.y=-height*0.18; tBottom.y=height*0.18;
  b.addChild(tTop,tBottom);
  b._tBottom=tBottom;
  return b;
}
function updateSpeedButtonLabel(){ if(btnSpeed) btnSpeed._tBottom.text=SPEEDS[speedIndex].name; }

function updateHUDTexts(msg){ if(messageText) messageText.text=msg; }

function updateHUDNumbers(){
  if(!stats.soldeValue) return;
  stats.soldeValue.text=String(balance);
  stats.miseValue.text=String(bet);
  stats.gainValue.text=String(lastWin);
}

function buildHUD(){
  const w=app.screen.width, h=app.screen.height;

  messageText = makeText("Appuyez sur SPIN pour lancer", Math.round(h*0.032), w/2,
    layout.slotY - layout.framePadY - Math.round(h*0.05), 0.5,0.5,"800");

  // stats en 3 colonnes alignées au slot
  const y=layout.statsY;
  const panelW=layout.slotW + layout.framePadX*2;
  const panelX0=layout.slotX - layout.framePadX;
  const colW=panelW/3;
  const cx1=panelX0 + colW*0.5;
  const cx2=panelX0 + colW*1.5;
  const cx3=panelX0 + colW*2.5;

  const labelSize=Math.round(h*0.020);
  const valueSize=Math.round(h*0.026);

  stats.soldeLabel=makeText("SOLDE", labelSize, cx1, y - Math.round(h*0.014), 0.5,0.5,"800");
  stats.miseLabel =makeText("MISE",  labelSize, cx2, y - Math.round(h*0.014), 0.5,0.5,"800");
  stats.gainLabel =makeText("GAIN",  labelSize, cx3, y - Math.round(h*0.014), 0.5,0.5,"800");

  stats.soldeValue=makeText(String(balance), valueSize, cx1, y + Math.round(h*0.010), 0.5,0.5,"900", true);
  stats.miseValue =makeText(String(bet),     valueSize, cx2, y + Math.round(h*0.010), 0.5,0.5,"900", true);
  stats.gainValue =makeText(String(lastWin), valueSize, cx3, y + Math.round(h*0.010), 0.5,0.5,"900", true);

  // boutons
  const rectW=w*0.28;
  const rectH=h*0.072;
  const spinSize=Math.round(Math.min(w*0.20,h*0.13));
  const yBtn=layout.buttonsY;

  btnSpin=makeButton("SPIN", spinSize, spinSize);
  btnSpin.x=w/2; btnSpin.y=yBtn;

  btnMinus=makeButton("-1", rectW, rectH);
  btnPlus =makeButton("+1", rectW, rectH);

  const gap=Math.round(w*0.06);
  btnMinus.x=btnSpin.x - (spinSize/2 + gap + rectW/2);
  btnPlus.x =btnSpin.x + (spinSize/2 + gap + rectW/2);
  btnMinus.y=yBtn; btnPlus.y=yBtn;

  const secondY=yBtn + spinSize/2 + rectH*0.75;

  btnSpeed=makeSpeedButton(rectW, rectH*0.92);
  btnSpeed.x=btnSpin.x - (rectW/2 + gap/2);
  btnSpeed.y=secondY;

  btnInfo=makeButton("INFO", rectW, rectH*0.92);
  btnInfo.x=btnSpin.x + (rectW/2 + gap/2);
  btnInfo.y=secondY;

  btnMinus.on("pointerup", onBetMinus);
  btnPlus.on("pointerup", onBetPlus);
  btnSpin.on("pointerup", onSpinOrStop);
  btnInfo.on("pointerup", togglePaytable);

  btnSpeed.on("pointerup", ()=>{
    if(spinning) return;
    speedIndex=(speedIndex+1)%SPEEDS.length;
    updateSpeedButtonLabel();
  });

  updateHUDNumbers();
  setSpinButtonMode(false);
}

// paytable simple
function createPaytableOverlay(){ /* (inchangé chez toi: si tu veux je te le remets) */ 
  const w=app.screen.width, h=app.screen.height;
  const container=new PIXI.Container(); container.visible=false; container.interactive=true;
  const backdrop=new PIXI.Graphics(); backdrop.beginFill(0x000000,0.75); backdrop.drawRect(0,0,w,h); backdrop.endFill();
  container.addChild(backdrop);

  const pw=w*0.86, ph=h*0.7, px=(w-pw)/2, py=(h-ph)/2;
  const panel=new PIXI.Graphics();
  panel.beginFill(0x111827,0.95); panel.lineStyle(6,0xf2b632,1);
  panel.drawRoundedRect(px,py,pw,ph,24); panel.endFill();
  container.addChild(panel);

  const title=new PIXI.Text("Table des gains", new PIXI.TextStyle({fontFamily:"system-ui",fontSize:Math.round(h*0.035),fill:0xffffff,fontWeight:"900"}));
  title.anchor.set(0.5,0); title.x=w/2; title.y=py+Math.round(h*0.02);
  container.addChild(title);

  const bodyText =
    "WILD : remplace tout sauf BONUS\n" +
    "BONUS : 3+ => 10 free spins (gains ×2)\n\n" +
    "Fruits : 3=2× | 4=3× | 5=4×\n" +
    "Cartes : 3× / 4× / 5×\n" +
    "Pièce : 4× / 5× / 6×\n" +
    "Couronne : 10× / 12× / 14×\n" +
    "BAR : 16× / 18× / 20×\n" +
    "7 rouge : 20× / 25× / 30×\n" +
    "77 mauve : 30× / 40× / 50×";

  const body=new PIXI.Text(bodyText,new PIXI.TextStyle({
    fontFamily:"system-ui", fontSize:Math.round(h*0.024), fill:0xffffff,
    wordWrap:true, wordWrapWidth:pw*0.80, lineHeight:Math.round(h*0.03)
  }));
  body.anchor.set(0.5,0); body.x=w/2; body.y=title.y + title.height + Math.round(h*0.02);
  container.addChild(body);

  const close=makeButton("FERMER", pw*0.35, Math.round(h*0.06));
  close.x=w/2; close.y=py+ph - Math.round(h*0.06);
  close.on("pointerup", ()=>togglePaytable(false));
  container.addChild(close);

  app.stage.addChild(container);
  return container;
}
function togglePaytable(forceVisible){
  if(!paytableOverlay) paytableOverlay=createPaytableOverlay();
  if(typeof forceVisible==="boolean") paytableOverlay.visible=forceVisible;
  else paytableOverlay.visible=!paytableOverlay.visible;
}

// paylines / paytable
const PAYLINES = [
  [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,1],[1,1],[2,1],[3,1],[4,1]],
  [[0,2],[1,2],[2,2],[3,2],[4,2]],
  [[0,0],[1,1],[2,2],[3,1],[4,0]],
  [[0,2],[1,1],[2,0],[3,1],[4,2]],
];
const PAYTABLE = {
  1:{3:2,4:3,5:4}, 3:{3:2,4:3,5:4}, 7:{3:2,4:3,5:4}, 10:{3:2,4:3,5:4},
  4:{3:3,4:4,5:5}, 8:{3:4,4:5,5:6}, 5:{3:10,4:12,5:14}, 2:{3:16,4:18,5:20},
  11:{3:20,4:25,5:30}, 0:{3:30,4:40,5:50},
};

function evaluateGrid(grid, betValue){
  let baseWin=0;
  const winningLines=[];
  let bonusCount=0;

  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(grid[r][c]===BONUS_ID) bonusCount++;

  PAYLINES.forEach((coords,lineIndex)=>{
    let base=null, invalid=false;
    for(let i=0;i<coords.length;i++){
      const [col,row]=coords[i];
      const sym=grid[row][col];
      if(sym===BONUS_ID){ invalid=true; break; }
      if(sym!==WILD_ID){ base=sym; break; }
    }
    if(invalid || base===null) return;
    if(!PAYTABLE[base]) return;

    let count=0; const cells=[];
    for(let i=0;i<coords.length;i++){
      const [col,row]=coords[i];
      const sym=grid[row][col];
      if(sym===BONUS_ID) break;
      if(sym===base || sym===WILD_ID){ count++; cells.push([col,row]); }
      else break;
    }

    if(count>=3){
      const mult=PAYTABLE[base]?.[count]||0;
      if(mult>0){
        const lineWin=betValue*mult;
        baseWin += lineWin;
        winningLines.push({ lineIndex, cells, symbolId: base, count, amount: lineWin });
      }
    }
  });

  return { baseWin, winningLines, bonusTriggered: bonusCount>=3 };
}

// highlight (✅ indices visibles = EXTRA_SYMBOLS..EXTRA_SYMBOLS+ROWS-1 => 2..4)
function startHighlight(cells){
  highlightedCells.forEach((cell)=>cell.container.alpha=1);
  highlightedCells=[];

  const firstVisible = EXTRA_SYMBOLS;
  const lastVisible = EXTRA_SYMBOLS + ROWS - 1;

  cells.forEach(([col,row])=>{
    const reel=reels[col]; if(!reel) return;
    const targetY = row*reelStep + symbolSize/2;

    let best=reel.symbols[firstVisible];
    let bestD=Math.abs(best.container.y - targetY);
    for(let i=firstVisible+1;i<=lastVisible;i++){
      const d=Math.abs(reel.symbols[i].container.y - targetY);
      if(d<bestD){ bestD=d; best=reel.symbols[i]; }
    }
    highlightedCells.push(best);
  });

  highlightTimer=0;
}

function updateHighlight(delta){
  if(!highlightedCells.length) return;
  highlightTimer += delta;
  const alpha = (Math.sin(highlightTimer*0.25) > 0) ? 0.35 : 1.0;
  highlightedCells.forEach((cell)=>cell.container.alpha=alpha);

  if(highlightTimer>80){
    highlightedCells.forEach((cell)=>cell.container.alpha=1);
    highlightedCells=[]; highlightTimer=0;
  }
}

function clamp01(t){ return Math.max(0,Math.min(1,t)); }
function easeOutCubic(t){ t=clamp01(t); return 1 - Math.pow(1-t,3); }
function easeInOutQuad(t){ t=clamp01(t); return t<0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
function smoothFactor(dt, tauMs){ return 1 - Math.exp(-dt/Math.max(1,tauMs)); }

// planning
function prepareReelPlans(now, preset){
  for(let c=0;c<reels.length;c++){
    const r=reels[c];

    r.offset=0; r.vel=0; r.container.y=0;
    r.state="spin";
    r.settleQueue=null; r.settleIdx=0; r.didTick=false;

    r.startAt = now + c*preset.startStaggerMs;

    const baseStop = r.startAt + preset.spinMs + c*preset.stopStaggerMs;
    r.minStopAt = r.startAt + preset.minSpinMs + c*40;

    r.stopAt = baseStop;
    r.settleStart = r.stopAt - preset.settleMs;
    r.preDecelStart = r.settleStart - preset.preDecelMs;

    // blur OFF au repos
    if (r.blur) r.container.filters = null;
  }
}

function ensurePlanAfterGrid(preset){
  if(!pendingGrid) return;
  const base = gridArrivedAt + preset.stopAfterGridMs;
  for(let c=0;c<reels.length;c++){
    const r=reels[c];
    const needed = base + c*60;
    if(r.stopAt < needed){
      r.stopAt = needed;
      r.settleStart = r.stopAt - preset.settleMs;
      r.preDecelStart = r.settleStart - preset.preDecelMs;
    }
  }
}

function applyStopPlanIfPossible(){
  if(!stopRequested) return;
  if(!pendingGrid) return;
  if(stopPlanApplied) return;
  if(!currentPreset) return;

  const preset=currentPreset;
  const now=performance.now();
  const base=Math.max(now, gridArrivedAt) + preset.stopAfterGridMs;

  for(let c=0;c<reels.length;c++){
    const r=reels[c];
    const stopAt = Math.max(base + c*70, r.minStopAt);
    r.stopAt = stopAt;
    r.settleStart = r.stopAt - preset.settleMs;

    // ✅ STOP: on force la pré-décélération à démarrer immédiatement
    r.preDecelStart = Math.min(r.preDecelStart, stopRequestedAt);

    // petit "coup de frein" instant
    r.vel *= 0.86;
  }

  stopPlanApplied=true;
}

function buildSettleQueueForReel(grid, col){
  const topId=safeId(grid[0][col]);
  const midId=safeId(grid[1][col]);
  const botId=safeId(grid[2][col]);
  return [botId, midId, topId, randomSymbolId()];
}

function applyGlowForAllVisible(){
  if(!ENABLE_GLOW) return;
  const firstVisible=EXTRA_SYMBOLS;
  const lastVisible=EXTRA_SYMBOLS + ROWS - 1;
  for(let c=0;c<reels.length;c++){
    const r=reels[c];
    for(let i=firstVisible;i<=lastVisible;i++){
      applySymbolVisual(r.symbols[i], r.symbols[i].symbolId);
    }
    if (r.blur) r.container.filters = null; // blur OFF à la fin
  }
}

function requestStop(){
  if(!spinning || stopRequested) return;
  stopRequested=true;
  stopRequestedAt=performance.now();
  updateHUDTexts("STOP…");
  audio.stop.play(0.60);

  // si grille déjà arrivée => stop immédiat
  applyStopPlanIfPossible();
  setSpinButtonMode(true);
}

function animateSpinUntilDone(preset){
  return new Promise((resolve)=>{
    let prev=performance.now();
    const bounceAmp=Math.min(reelStep * preset.bounceAmpFactor, 12);

    function tick(now){
      const dt=Math.max(0, now-prev);
      prev=now;

      let allDone=true;
      const k=smoothFactor(dt,110);

      for(let c=0;c<reels.length;c++){
        const r=reels[c];

        if(now < r.startAt){ allDone=false; continue; }
        if(r.state !== "done") allDone=false;

        // -------- SPIN --------
        if(r.state==="spin"){
          // blur ON pendant spin
          if (r.blur) {
            if (!r.container.filters) r.container.filters = [r.blur];
          }

          // si settleStart atteint mais pas de grille => on continue
          if(now >= r.settleStart && pendingGrid){
            r.state="settle";
          }else{
            let target=preset.basePxPerMs;

            // départ rapide
            const tAccel=clamp01((now - r.startAt)/preset.accelMs);
            target *= (0.35 + 0.65*easeInOutQuad(tAccel));

            // pré-décélération normale
            if(now >= r.preDecelStart){
              const denom=Math.max(1, (r.settleStart - r.preDecelStart));
              const t=clamp01((now - r.preDecelStart)/denom);
              target *= (1 - easeInOutQuad(t)*0.78);
            }

            // ✅ STOP: freinage fort immédiatement (accélère la décélération)
            if(stopRequested && pendingGrid){
              const tS = clamp01((now - stopRequestedAt) / preset.stopBrakeMs);
              const brake = 1 - preset.stopBrakePower * easeOutCubic(tS);
              target *= brake; // diminue vite la vitesse cible
            }

            r.vel = r.vel + (target - r.vel)*k;
            r.offset += r.vel*dt;

            while(r.offset >= reelStep){
              r.offset -= reelStep;
              recycleReelOneStepDown(r, randomSymbolId(), false);
            }

            r.container.y = r.offset;

            // blur dynamique très léger selon vitesse
            if (r.blur) {
              const strength = Math.min(preset.blurMax, Math.max(0, r.vel*2.0));
              r.blur.blur = strength;
            }
          }
        }

        // -------- SETTLE --------
        if(r.state==="settle"){
          if(!r.didTick){ audio.tick.play(0.22); r.didTick=true; }

          if(!r.settleQueue){
            r.settleQueue = buildSettleQueueForReel(pendingGrid, c);
            r.settleIdx = 0;
          }

          // blur ON pendant settle (mais plus faible)
          if (r.blur) {
            if (!r.container.filters) r.container.filters = [r.blur];
            r.blur.blur = Math.min(preset.blurMax, 1.4);
          }

          const tSettle=clamp01((now - r.settleStart)/preset.settleMs);
          const settleEnd=r.settleStart + preset.settleMs;
          const remainingMs=Math.max(1, settleEnd - now);

          const distToNextStep=reelStep - r.offset;
          const remainingSteps=Math.max(0, (r.settleQueue.length - r.settleIdx));
          const remainingDist=distToNextStep + Math.max(0, remainingSteps-1)*reelStep;

          const baseNeed=remainingDist/remainingMs;
          const ease=0.95 - 0.30*easeOutCubic(tSettle);
          const targetSpeed=Math.max(0.25, baseNeed*ease);

          r.vel = r.vel + (targetSpeed - r.vel)*k;
          r.offset += r.vel*dt;

          while(r.offset >= reelStep && r.settleIdx < r.settleQueue.length){
            r.offset -= reelStep;
            const nextId=r.settleQueue[r.settleIdx++];
            recycleReelOneStepDown(r, nextId, false);
          }

          r.container.y = r.offset;

          if(r.settleIdx >= r.settleQueue.length){
            r.state="snap";
            r.snapStart=now;
          }
        }

        // -------- SNAP --------
        if(r.state==="snap"){
          // blur OFF dès snap
          if (r.blur) r.container.filters = null;

          const t=clamp01((now - r.snapStart)/preset.snapMs);
          r.offset = r.offset * (1 - easeOutCubic(t));
          if(r.offset < 0.25) r.offset=0;
          r.container.y=r.offset;

          if(t>=1 || r.offset===0){
            r.state="bounce";
            r.bounceStart=now;
            r.container.y=0;
            r.offset=0;
            r.vel=0;
          }
        }

        // -------- BOUNCE --------
        if(r.state==="bounce"){
          const tb=clamp01((now - r.bounceStart)/preset.bounceMs);
          const s=Math.sin(tb*Math.PI);
          const amp=bounceAmp*(1 - tb*0.55);
          r.container.y = -s*amp;
          if(tb>=1){
            r.container.y=0;
            r.state="done";
          }
        }
      }

      if(allDone) return resolve();
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

// -------- MAIN button --------
async function onSpinOrStop(){
  if(spinning){ requestStop(); return; }
  if(spinInFlight) return;
  if(!app || !symbolTextures.length) return;

  spinInFlight=true;
  spinning=true;

  stopRequested=false;
  stopRequestedAt=0;
  stopPlanApplied=false;

  pendingGrid=null;
  gridArrivedAt=0;

  const preset=SPEEDS[speedIndex];
  currentPreset=preset;

  setSpinButtonMode(true);

  highlightedCells.forEach((cell)=>cell.container.alpha=1);
  highlightedCells=[];

  if(freeSpins<=0) winMultiplier=1;

  const effectiveBet=bet;
  const paidSpin = freeSpins<=0;

  if(!paidSpin){
    freeSpins--;
  }else{
    if(balance < bet){
      updateHUDTexts("Solde insuffisant");
      spinning=false; spinInFlight=false; currentPreset=null;
      setSpinButtonMode(false);
      return;
    }
    balance -= bet;
  }

  lastWin=0;
  updateHUDNumbers();
  updateHUDTexts(paidSpin ? "Spin…" : `Free spin… restants : ${freeSpins}`);
  audio.spin.play(0.70);

  const now=performance.now();
  prepareReelPlans(now, preset);

  fetch("/spin",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ bet: effectiveBet }),
  })
  .then(r=>r.json())
  .then(data=>{
    pendingGrid = data.result || data.grid || data;
    gridArrivedAt = performance.now();

    if(stopRequested) applyStopPlanIfPossible();
    else ensurePlanAfterGrid(preset);
  })
  .catch(err=>{
    console.error("Erreur API /spin", err);
    pendingGrid=null;
    gridArrivedAt=0;
  });

  await animateSpinUntilDone(preset);

  if(!pendingGrid){
    updateHUDTexts("Erreur réseau");
    spinning=false; spinInFlight=false; currentPreset=null;
    setSpinButtonMode(false);
    return;
  }

  applyGlowForAllVisible();

  const { baseWin, winningLines, bonusTriggered } = evaluateGrid(pendingGrid, effectiveBet);

  let totalWin=baseWin;
  if(bonusTriggered){ freeSpins += 10; winMultiplier=2; }
  if(winMultiplier>1) totalWin *= winMultiplier;

  lastWin=totalWin;
  balance += totalWin;
  updateHUDNumbers();

  finishSpin(totalWin, winningLines, bonusTriggered);
}

function finishSpin(win, winningLines, bonusTriggered){
  spinning=false;
  spinInFlight=false;
  currentPreset=null;
  stopPlanApplied=false;

  setSpinButtonMode(false);

  if(win>0){
    audio.win.play(0.70);
    updateHUDTexts(freeSpins>0 ? `Gain : ${win} — free spins : ${freeSpins}` : `Gain : ${win}`);
    const cells=[];
    winningLines?.forEach(line=>line.cells.forEach(c=>cells.push(c)));
    if(cells.length) startHighlight(cells);
  }else{
    audio.stop.play(0.55);
    updateHUDTexts(freeSpins>0 ? `Pas de gain — free spins : ${freeSpins}` : "Pas de gain — appuyez sur SPIN");
  }

  if(bonusTriggered){
    audio.bonus.play(0.70);
    updateHUDTexts("BONUS ! +10 free spins (gains ×2)");
  }
}

// bet
function onBetMinus(){ if(spinning) return; if(bet>1){ bet--; updateHUDNumbers(); } }
function onBetPlus(){ if(spinning) return; bet++; updateHUDNumbers(); }

// start
window.addEventListener("load", ()=>{ try{ initPixi(); } catch(e){ console.error(e); showMessage("Erreur JS : init"); } });