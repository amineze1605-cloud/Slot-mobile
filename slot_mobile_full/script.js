
(() => {
  const REELS = 5;
  const ROWS = 3;
  const SYMBOL_SIZE = 140;
  const SERVER_URL = "/spin";

  const SYMBOLS = ["A","K","Q","J","10","W","B"];

  const canvas = document.getElementById("game");
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x020617,
    antialias: true
  });

  const loaderOverlay = document.getElementById("loader");

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const audioBuffers = {};

  function unlockAudio() {
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.start(0);
    audioCtx.resume();
  }

  async function loadAudio() {
    const names = ["spin","stop","win","bonus"];
    for (const n of names) {
      try {
        const resp = await fetch("assets/audio/" + n + ".wav");
        const ab = await resp.arrayBuffer();
        audioBuffers[n] = await audioCtx.decodeAudioData(ab);
      } catch (e) {
        console.warn("Audio load failed for", n, e);
      }
    }
  }

  function playSound(name) {
    const buf = audioBuffers[name];
    if (!buf) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  }

  let reels = [];
  let balance = 1000;
  let freeSpins = 0;
  let multiplier = 1;
  let busy = false;

  const uiContainer = new PIXI.Container();
  app.stage.addChild(uiContainer);

  const balanceText = new PIXI.Text("Solde: 1000", {fill: 0xf9fafb, fontSize: 18});
  balanceText.x = 16;
  balanceText.y = 12;
  uiContainer.addChild(balanceText);

  const freeText = new PIXI.Text("Free spins: 0", {fill: 0x93c5fd, fontSize: 16});
  freeText.x = 16;
  freeText.y = 34;
  uiContainer.addChild(freeText);

  const multiText = new PIXI.Text("Multiplicateur: x1", {fill: 0xf97316, fontSize: 16});
  multiText.x = 16;
  multiText.y = 54;
  uiContainer.addChild(multiText);

  const msgText = new PIXI.Text("Touchez pour lancer le spin", {fill: 0x22c55e, fontSize: 16});
  msgText.x = 16;
  msgText.y = 80;
  uiContainer.addChild(msgText);

  function updateUI() {
    balanceText.text = "Solde: " + balance.toFixed(2) + " €";
    freeText.text = "Free spins: " + freeSpins;
    multiText.text = "Multiplicateur: x" + multiplier;
  }

  const board = new PIXI.Container();
  app.stage.addChild(board);

  const reelsContainer = new PIXI.Container();
  board.addChild(reelsContainer);

  function colorForSymbol(sym) {
    switch(sym) {
      case "A": return 0xfbbf24;
      case "K": return 0xf97316;
      case "Q": return 0x38bdf8;
      case "J": return 0xa855f7;
      case "10": return 0xf472b6;
      case "W": return 0xfacc15;
      case "B": return 0xfb7185;
      default: return 0x6b7280;
    }
  }

  function createSymbolGraphics(sym) {
    const cont = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.beginFill(colorForSymbol(sym));
    g.drawRoundedRect(-SYMBOL_SIZE/2 + 6, -SYMBOL_SIZE/2 + 6, SYMBOL_SIZE-12, SYMBOL_SIZE-12, 18);
    g.endFill();
    cont.addChild(g);
    const txt = new PIXI.Text(sym, {fill: 0x020617, fontWeight: "800", fontSize: 34});
    txt.anchor.set(0.5);
    cont.addChild(txt);
    return cont;
  }

  function layout() {
    const w = app.renderer.width;
    const h = app.renderer.height;
    board.x = w/2;
    board.y = h/2 - 20;
  }

  function createReels() {
    const gap = 12;
    const totalWidth = REELS * SYMBOL_SIZE + (REELS-1)*gap;
    reelsContainer.x = -totalWidth/2;
    reelsContainer.y = -(ROWS * SYMBOL_SIZE)/2;

    for (let c=0; c<REELS; c++) {
      const colContainer = new PIXI.Container();
      colContainer.x = c * (SYMBOL_SIZE + gap);
      reelsContainer.addChild(colContainer);

      const reel = {
        container: colContainer,
        symbols: [],
        pos: 0,
        blur: new PIXI.filters.BlurFilter()
      };
      colContainer.filters = [reel.blur];

      for (let r=0; r<ROWS; r++) {
        const symId = SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)];
        const sym = new PIXI.Container();
        sym.y = r*SYMBOL_SIZE;
        const gfx = createSymbolGraphics(symId);
        sym.addChild(gfx);
        reel.symbols.push(sym);
        colContainer.addChild(sym);
      }

      reels.push(reel);
    }
  }

  function animateToResult(resultGrid) {
    return new Promise(resolve => {
      const baseDuration = 0.9;

      reels.forEach((reel, colIndex) => {
        const extraSpins = 10 + colIndex * 2;
        reel.blur.blurY = 20;

        const startPos = reel.pos;
        const targetPos = startPos + extraSpins;

        const tween = { value: startPos };

        const ticker = (delta) => {
          tween.value += (targetPos - tween.value) * 0.2;
          reel.pos = tween.value;

          for (let r=0; r<ROWS; r++) {
            const idx = (Math.floor(reel.pos) + r) % SYMBOLS.length;
            const symId = SYMBOLS[idx];
            const sym = reel.symbols[r];

            sym.removeChildren();
            const gfx = createSymbolGraphics(symId);
            sym.addChild(gfx);
            sym.y = (r - 1) * SYMBOL_SIZE + (reel.pos % 1) * SYMBOL_SIZE;
          }

          if (Math.abs(targetPos - tween.value) < 0.05) {
            app.ticker.remove(ticker);
            reel.pos = targetPos;
            reel.blur.blurY = 0;

            for (let r=0; r<ROWS; r++) {
              const sym = reel.symbols[r];
              sym.removeChildren();
              const symIndex = resultGrid[r][colIndex];
              const symId = SYMBOLS[symIndex];
              const gfx = createSymbolGraphics(symId);
              sym.addChild(gfx);
              sym.y = r * SYMBOL_SIZE;
            }

            if (colIndex === REELS-1) {
              resolve();
            }
          }
        };

        app.ticker.add(ticker);
      });
    });
  }

  async function requestSpin() {
    const bet = 1;
    const payload = { bet, freeSpins, multiplier };

    const resp = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      throw new Error("Erreur serveur");
    }
    return await resp.json();
  }

  async function doSpin() {
    if (busy) return;
    busy = true;
    msgText.text = "Spin en cours...";

    if (freeSpins <= 0) {
      const bet = 1;
      if (balance < bet) {
        msgText.text = "Solde insuffisant";
        busy = false;
        return;
      }
      balance -= bet;
    } else {
      freeSpins--;
    }
    updateUI();
    playSound("spin");

    let result;
    try {
      result = await requestSpin();
    } catch (e) {
      console.error(e);
      msgText.text = "Erreur de connexion";
      busy = false;
      return;
    }

    const grid = result.result;
    await animateToResult(grid);
    playSound("stop");

    const win = result.win || 0;
    if (win > 0) {
      const totalWin = win * multiplier;
      balance += totalWin;
      msgText.text = "Gagné " + totalWin.toFixed(2) + " €";
      playSound("win");
    } else {
      msgText.text = "Raté, retente ta chance";
    }

    if (result.bonus) {
      if (result.bonus.freeSpins) {
        freeSpins += result.bonus.freeSpins;
        msgText.text += " | Bonus: +" + result.bonus.freeSpins + " free spins";
        playSound("bonus");
      }
      if (result.bonus.multiplier && result.bonus.multiplier > 1) {
        multiplier = result.bonus.multiplier;
      } else {
        multiplier = 1;
      }
    } else {
      multiplier = 1;
    }

    updateUI();
    busy = false;

    if (freeSpins > 0) {
      setTimeout(doSpin, 500);
    }
  }

  window.addEventListener("resize", layout);

  async function initGame() {
    unlockAudio();
    await loadAudio();
    createReels();
    layout();
    updateUI();
    loaderOverlay.style.display = "none";
    msgText.text = "Touchez pour SPIN";
    app.view.addEventListener("pointerdown", () => {
      if (!busy) doSpin();
    });
  }

  document.addEventListener("touchstart", () => {
    initGame();
  }, { once: true });

  document.addEventListener("mousedown", () => {
    initGame();
  }, { once: true });
})();
