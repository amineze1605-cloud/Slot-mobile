const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "slot_mobile_full")));

// ----------------------------
// SLOT MACHINE LOGIC
// ----------------------------

function randInt(max) {
    return Math.floor(Math.random() * max);
}

function generateGrid() {
    const rows = 3, cols = 5;
    const grid = [];

    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            row.push(randInt(6));
        }
        grid.push(row);
    }
    return grid;
}

function evaluate(grid, bet) {
    let win = 0;
    const mid = grid[1];

    if (mid[0] === mid[1] && mid[1] === mid[2]) {
        win = bet * 5;
    }

    const bonus = { freeSpins: 0, multiplier: 1 };

    if (Math.random() < 0.10) bonus.freeSpins = 5;
    if (Math.random() < 0.05) bonus.multiplier = 2;

    return { win, bonus };
}

// Endpoint SPIN
// Route /spin très légère pour tests frontend
app.post("/spin", (req, res) => {
  const body = req.body || {};
  const bet = Number(body.bet) > 0 ? Number(body.bet) : 1;

  const ROWS = 3;
  const COLS = 5;
  const SYMBOLS = 12; // 0..11 = les 12 symboles de ta spritesheet

  // --- grille aléatoire légère
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      row.push(Math.floor(Math.random() * SYMBOLS));
    }
    grid.push(row);
  }

  // --- petit calcul de gain simple :
  // si la ligne du milieu a 5 symboles identiques -> gain 10x la mise
  let win = 0;
  const mid = 1;
  const firstSym = grid[mid][0];
  let allSame = true;
  for (let c = 1; c < COLS; c++) {
    if (grid[mid][c] !== firstSym) {
      allSame = false;
      break;
    }
  }
  if (allSame) {
    win = bet * 10;
  }

  const bonus = { freeSpins: 0, multiplier: 1 };

  res.json({ result: grid, win, bonus });
});

// ----------------------------
// FALLBACK → SERVE index.html
// ----------------------------
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "slot_mobile_full", "index.html"));
});

// ----------------------------
// START
// ----------------------------
app.listen(PORT, () => {
    console.log(`Slot mobile backend running on port ${PORT}`);
});
