// --------------------------------------------------
// script.js — version stable avec affichage correct + nouveau mapping
// --------------------------------------------------

// DOM
const canvas = document.getElementById("game");
const loaderEl = document.getElementById("loader");

// --------------------------------------------------
// AUDIO
// --------------------------------------------------
const sounds = {
  spin: new Audio("assets/audio/spin.mp3"),
  stop: new Audio("assets/audio/stop.mp3"),
  win: new Audio("assets/audio/win.mp3"),
  bonus: new Audio("assets/audio/bonus.mp3"),
};
Object.values(sounds).forEach(a => {
  a.preload = "auto";
  a.volume = 0.6;
});
function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  try {
    s.currentTime = 0;
    s.play().catch(() => {});
  } catch (e) {}
}

// --------------------------------------------------
// CONSTANTES JEU
// --------------------------------------------------
const COLS = 5;
const ROWS = 3;

// Nouveau mapping symboles
// 0 - 777 violet
// 1 - pastèque
// 2 - BAR
// 3 - pomme
// 4 - cartes
// 5 - couronne
// 6 - BONUS
// 7 - cerises
// 8 - pièce
// 9 - WILD
// 10 - citron
// 11 - 7 rouge
const WILD_ID = 9;
const BONUS_ID = 6;

// Paytable mise à jour
const PAYTABLE = {
  1: { 3: 2, 4: 3, 5: 4 },   // pastèque
  3: { 3: 2, 4: 3, 5: 4 },   // pomme
  7: { 3: 2, 4: 3, 5: 4 },   // cerises
  10: { 3: 2, 4: 3, 5: 4 },  // citron
  4: { 3: 3, 4: 4, 5: 5 },   // cartes
  8: { 3: 4, 4: 5, 5: 6 },   // pièce
  5: { 3: 10, 4: 12, 5: 14 },// couronne
  2: { 3: 16, 4: 18, 5: 20 },// BAR
  11: { 3: 20, 4: 25, 5: 30 },// 7 rouge
  0: { 3: 30, 4: 40, 5: 50 }, // 777 violet
};

// 5 lignes classiques
const PAYLINES = [
  [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,1],[1,1],[2,1],[3,1],[4,1]],
  [[0,2],[1,2],[2,2],[3,2],[4,2]],
  [[0,0],[1,1],[2,2],[3,1],[4,0]],
  [[0,2],[1,1],[2,0],[3,1],[4,2]],
];

// --------------------------------------------------
// VARIABLES GLOBALES
// --------------------------------------------------
let app, symbolTextures=[], reels=[];
let balance=1000, bet=1, lastWin=0;
let spinning=false, freeSpins=0, winMultiplier=1;
let messageText, statsText, btnMinus, btnPlus, btnSpin, btnInfo;
let paytableOverlay=null, highlightedSprites=[], highlightTimer=0;

// --------------------------------------------------
// CHARGEMENT SPRITESHEET
// --------------------------------------------------
function loadSpritesheet() {
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.src = "assets/spritesheet.png";
    img.onload = () => {
      try {
        const base = PIXI.BaseTexture.from(img);
        resolve(base);
      } catch(e){ reject(e); }
    };
    img.onerror = (e)=>reject(e||new Error("Erreur spritesheet"));
  });
}

// --------------------------------------------------
// INIT PIXI
// --------------------------------------------------
async function initPixi(){
  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050814,
    antialias:true
  });
  showMessage("Chargement…");

  try{
    const base = await loadSpritesheet();
    const fullW = base.width, fullH = base.height;
    const COLS_SHEET=3, ROWS_SHEET=4;
    const frameW=fullW/COLS_SHEET, frameH=fullH/ROWS_SHEET;
    for(let r=0;r<ROWS_SHEET;r++){
      for(let c=0;c<COLS_SHEET;c++){
        const rect=new PIXI.Rectangle(c*frameW,r*frameH,frameW,frameH);
        symbolTextures.push(new PIXI.Texture(base,rect));
      }
    }

    buildSlotScene();
    buildHUD();
    hideMessage();
    updateHUDTexts("Appuyez sur SPIN pour lancer");

    app.ticker.add(updateHighlight);
  }catch(e){
    console.error(e);
    showMessage("Erreur JS : "+e.message);
  }
}

// --------------------------------------------------
// BUILD SLOT (ancienne logique, stable)
// --------------------------------------------------
function buildSlotScene(){
  const w=app.renderer.width, h=app.renderer.height;
  const symbolSize=Math.min(w*0.16,h*0.16);
  const reelWidth=symbolSize+8;
  const totalW=reelWidth*COLS;

  const slotContainer=new PIXI.Container();
  slotContainer.x=(w-totalW)/2;
  slotContainer.y=h*0.22;
  app.stage.addChild(slotContainer);

  const frame=new PIXI.Graphics();
  frame.lineStyle(6,0xf2b632,1);
  frame.beginFill(0x060b1a,0.9);
  frame.drawRoundedRect(
    slotContainer.x-18,
    slotContainer.y-18,
    totalW+36,
    ROWS*(symbolSize+8)-8+36,
    26
  );
  frame.endFill();
  app.stage.addChildAt(frame,0);

  reels=[];
  for(let c=0;c<COLS;c++){
    const rc=new PIXI.Container();
    slotContainer.addChild(rc);
    rc.x=c*reelWidth;
    const reel={container:rc,symbols:[]};
    for(let r=0;r<ROWS;r++){
      const idx=Math.floor(Math.random()*symbolTextures.length);
      const sp=new PIXI.Sprite(symbolTextures[idx]);
      sp.width=sp.height=symbolSize;
      sp.y=r*(symbolSize+8);
      rc.addChild(sp);
      reel.symbols.push(sp);
    }
    reels.push(reel);
  }

  // sauvegarder les références globales
  window.slotContainer = slotContainer;
  window.frameGfx = frame;
}

// --------------------------------------------------
// HUD + BOUTONS
// --------------------------------------------------
function makeText(txt,size,y,center=true){
  const w=app.renderer.width;
  const style=new PIXI.TextStyle({
    fontFamily:"system-ui",fontSize:size,fill:0xffffff,align:center?"center":"left"
  });
  const t=new PIXI.Text(txt,style);
  t.anchor.set(center?0.5:0,0.5);
  t.x=center?w/2:w*0.05;
  t.y=y;
  app.stage.addChild(t);
  return t;
}
function makeButton(label,w,h){
  const c=new PIXI.Container(), g=new PIXI.Graphics();
  g.beginFill(0x111827).lineStyle(4,0xf2b632,1)
   .drawRoundedRect(-w/2,-h/2,w,h,18).endFill();
  const t=new PIXI.Text(label,{fontFamily:"system-ui",fontSize:Math.min(h*0.45,28),fill:0xffffff});
  t.anchor.set(0.5);
  c.addChild(g,t);
  c.interactive=true; c.buttonMode=true;
  c.on("pointerdown",()=>g.alpha=0.7);
  c.on("pointerup",()=>g.alpha=1);
  c.on("pointerupoutside",()=>g.alpha=1);
  app.stage.addChild(c);
  return c;
}
function buildHUD(){
  const w=app.renderer.width,h=app.renderer.height;
  messageText=makeText("Appuyez sur SPIN pour lancer",Math.round(h*0.035),h*0.10);
  statsText=makeText("",Math.round(h*0.028),h*0.72);
  const bw=w*0.26,bh=h*0.07,spx=w*0.06,by=h*0.82;
  btnMinus=makeButton("-1",bw,bh);
  btnSpin=makeButton("SPIN",bw,bh);
  btnPlus=makeButton("+1",bw,bh);
  btnSpin.x=w/2; btnSpin.y=by;
  btnMinus.x=btnSpin.x-(bw+spx); btnMinus.y=by;
  btnPlus.x=btnSpin.x+(bw+spx); btnPlus.y=by;
  const infoW=bw*0.9,infoH=bh*0.75;
  btnInfo=makeButton("INFO",infoW,infoH);
  btnInfo.x=w/2; btnInfo.y=by+bh+h*0.02;
  btnMinus.on("pointerup",onBetMinus);
  btnPlus.on("pointerup",onBetPlus);
  btnSpin.on("pointerup",onSpinClick);
  btnInfo.on("pointerup",togglePaytable);
  updateHUDNumbers();
}
function updateHUDTexts(msg){ if(messageText) messageText.text=msg; }
function updateHUDNumbers(){ if(statsText) statsText.text=`Solde : ${balance}   Mise : ${bet}   Dernier gain : ${lastWin}`; }

// --------------------------------------------------
// PAYTABLE OVERLAY
// --------------------------------------------------
function createPaytableOverlay(){
  const w=app.renderer.width,h=app.renderer.height;
  const c=new PIXI.Container();
  c.visible=false;c.interactive=true;
  const bg=new PIXI.Graphics();bg.beginFill(0x000000,0.75).drawRect(0,0,w,h).endFill();
  c.addChild(bg);
  const pW=w*0.86,pH=h*0.62,pX=(w-pW)/2,pY=(h-pH)/2;
  const panel=new PIXI.Graphics();
  panel.beginFill(0x111827).lineStyle(6,0xf2b632,1)
       .drawRoundedRect(pX,pY,pW,pH,24).endFill();
  c.addChild(panel);
  const title=new PIXI.Text("Table des gains",{fontFamily:"system-ui",fontSize:Math.round(h*0.035),fill:0xffffff});
  title.anchor.set(0.5,0);title.x=w/2;title.y=pY+h*0.02;c.addChild(title);
  const body=new PIXI.Text(
    "Fruits : 3=2×, 4=3×, 5=4×\nCartes : 3/4/5×\nPièce : 4/5/6×\nCouronne : 10/12/14×\nBAR : 16/18/20×\n7 rouge : 20/25/30×\n777 violet : 30/40/50×\n\nWILD remplace tout sauf BONUS\n3 BONUS = 10 tours gratuits ×2",
    {fontFamily:"system-ui",fontSize:Math.round(h*0.026),fill:0xffffff,wordWrap:true,wordWrapWidth:pW*0.8,lineHeight:Math.round(h*0.031)}
  );
  body.anchor.set(0.5,0);body.x=w/2;body.y=title.y+title.height+h*0.02;c.addChild(body);
  const close=makeButton("FERMER",pW*0.35,h*0.06);
  close.x=w/2;close.y=pY+pH-h*0.08;close.on("pointerup",()=>togglePaytable(false));
  c.addChild(close);app.stage.addChild(c);
  return c;
}
function togglePaytable(force){
  if(!paytableOverlay) paytableOverlay=createPaytableOverlay();
  if(typeof force==="boolean") paytableOverlay.visible=force;
  else paytableOverlay.visible=!paytableOverlay.visible;
}

// --------------------------------------------------
// APPLICATION DE LA GRILLE
// --------------------------------------------------
function applyResultToReels(grid){
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const v=grid[r][c];
      const reel=reels[c];
      if(!reel||!reel.symbols[r])continue;
      reel.symbols[r].texture=getTextureByIndex(v);
    }
  }
}
function getTextureByIndex(i){
  if(!symbolTextures.length)return PIXI.Texture.WHITE;
  return symbolTextures[i%symbolTextures.length]||symbolTextures[0];
}

// --------------------------------------------------
// EVALUATION DES LIGNES + BONUS
// --------------------------------------------------
function evaluateGrid(grid,betVal){
  let total=0,winLines=[],bonusCount=0;
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(grid[r][c]===BONUS_ID)bonusCount++;
  PAYLINES.forEach((line,li)=>{
    let base=null,count=0;
    for(let i=0;i<line.length;i++){
      const [col,row]=line[i],s=grid[row][col];
      if(s===BONUS_ID)break;
      if(base===null&&s!==WILD_ID){base=s;count=1;}
      else if(base!==null&&(s===base||s===WILD_ID))count++;
      else break;
    }
    if(count>=3&&PAYTABLE[base]){
      const mult=PAYTABLE[base][count]||0;
      if(mult>0){const w=betVal*mult;total+=w;winLines.push({lineIndex:li,count});}
    }
  });
  const bonusTriggered=bonusCount>=3;
  return {baseWin:total,bonusTriggered};
}

// --------------------------------------------------
// SPIN
// --------------------------------------------------
async function onSpinClick(){
  if(spinning)return;if(!app||!symbolTextures.length)return;
  spinning=true;clearHighlights();
  if(balance<bet){updateHUDTexts("Solde insuffisant");spinning=false;return;}
  balance-=bet;lastWin=0;updateHUDNumbers();playSound("spin");
  updateHUDTexts("Bonne chance !");
  try{
    const res=await fetch("/spin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bet})});
    const data=await res.json();const grid=data.result||data.grid||data;
    applyResultToReels(grid);
    const evalRes=evaluateGrid(grid,bet);
    let totalWin=evalRes.baseWin;
    if(evalRes.bonusTriggered){freeSpins+=10;winMultiplier=2;playSound("bonus");updateHUDTexts("BONUS ! +10 tours ×2");}
    if(winMultiplier>1)totalWin*=winMultiplier;
    lastWin=totalWin;balance+=totalWin;updateHUDNumbers();
    if(totalWin>0){playSound("win");updateHUDTexts(`Gain : ${totalWin}`);}
    else playSound("stop");
  }catch(err){console.error(err);updateHUDTexts("Erreur API");}
  spinning=false;
}

// --------------------------------------------------
// BOUTONS
// --------------------------------------------------
function onBetMinus(){if(spinning)return;if(bet>1){bet--;updateHUDNumbers();}}
function onBetPlus(){if(spinning)return;if(bet<100){bet++;updateHUDNumbers();}}

// --------------------------------------------------
// HIGHLIGHT
// --------------------------------------------------
function clearHighlights(){highlightedSprites.forEach(s=>s.alpha=1);highlightedSprites=[];}
function updateHighlight(delta){
  if(!highlightedSprites.length)return;
  highlightTimer+=delta;const a=Math.sin(highlightTimer*0.25)>0?0.4:1;
  highlightedSprites.forEach(s=>s.alpha=a);
  if(highlightTimer>80)clearHighlights();
}

// --------------------------------------------------
window.addEventListener("load",()=>{try{initPixi();}catch(e){showMessage("Erreur JS : "+e.message);}});