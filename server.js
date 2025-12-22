// server.js — Backend Slot Mobile (anti-float: tout en centimes)

// ----------------------------
// Imports + app
// ----------------------------
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// ----------------------------
// Serve frontend
// ----------------------------
app.use(express.static(path.join(__dirname, "slot_mobile_full")));

// ----------------------------
// CONSTANTES SLOT
// ----------------------------
const ROWS = 3;
const COLS = 5;
const SYMBOLS_COUNT = 12; // IDs 0..11

const WILD_ID = 9;
const BONUS_ID = 6;

// 5 lignes : 3 horizontales + 2 diagonales (indices [row, col])
const PAYLINES = [
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]],
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]],
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]],
];

// Multiplicateurs (entiers)
const PAYTABLE = {
  1: { 3: 2, 4: 3, 5: 4 },    // pastèque
  3: { 3: 2, 4: 3, 5: 4 },    // pomme
  7: { 3: 2, 4: 3, 5: 4 },    // cerises
  10:{ 3: 2, 4: 3, 5: 4 },    // citron

  4: { 3: 3, 4: 4, 5: 5 },    // cartes
  8: { 3: 4, 4: 5, 5: 6 },    // pièce
  5: { 3: 10, 4: 12, 5: 14 }, // couronne
  2: { 3: 16, 4: 18, 5: 20 }, // BAR
  11:{ 3: 20, 4: 25, 5: 30 }, // 7 rouge
  0: { 3: 30, 4: 40, 5: 50 }, // 77 mauve
};

// ----------------------------
// Helpers
// ----------------------------
function randInt(max) {
  return Math.floor(Math.random() * max);
}

function generateRandomGrid() {
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push(randInt(SYMBOLS_COUNT));
    grid.push(row);
  }
  return grid;
}

function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  n = Math.round(n);
  return Math.max(min, Math.min(max, n));
}

// ----------------------------
// Évaluation en CENTIMES (int)
// ----------------------------
function evaluateSpin(grid, betCents) {
  let winCents = 0;
  const winningLines = [];
  let bonusCount = 0;

  // compter les BONUS
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  PAYLINES.forEach((line, lineIndex) => {
    let baseSymbol = null;
    let invalid = false;

    // base = premier non-WILD, non-BONUS
    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const sym = grid[row][col];

      if (sym === BONUS_ID) { invalid = true; break; }
      if (sym !== WILD_ID) { baseSymbol = sym; break; }
    }

    if (invalid || baseSymbol === null) return;
    const table = PAYTABLE[baseSymbol];
    if (!table) return;

    // compter consécutifs
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const sym = grid[row][col];

      if (sym === BONUS_ID) break;
      if (sym === baseSymbol || sym === WILD_ID) count++;
      else break;
    }

    if (count >= 3) {
      const mult = table[count];
      if (!mult) return;

      const lineWinCents = betCents * mult; // ✅ int
      winCents += lineWinCents;

      winningLines.push({
        lineIndex,
        symbolId: baseSymbol,
        count,
        payoutCents: lineWinCents,
      });
    }
  });

  // BONUS
  const bonus = { freeSpins: 0, multiplier: 1 };
  if (bonusCount >= 3) {
    bonus.freeSpins = 10;
    bonus.multiplier = 2;
    winCents *= bonus.multiplier; // ✅ int
  }

  return { winCents, bonus, winningLines };
}

// ----------------------------
// Endpoint SPIN
// ----------------------------
app.post("/spin", (req, res) => {
  const body = req.body || {};

  // ✅ on préfère betCents (int). fallback possible sur bet (EUR)
  let betCents = 0;

  if (body.betCents != null) {
    betCents = clampInt(body.betCents, 1, 1000000); // 0.01€ -> 10000€ max
  } else {
    const betEUR = Number(body.bet);
    betCents = Number.isFinite(betEUR) && betEUR > 0 ? Math.round(betEUR * 100) : 100;
  }

  // Debug (tu verras la mise reçue côté serveur)
  console.log("SPIN:", { betCents, betEUR: (betCents / 100).toFixed(2) });

  const grid = generateRandomGrid();
  const { winCents, bonus, winningLines } = evaluateSpin(grid, betCents);

  res.json({
    result: grid,
    betCents,
    winCents,
    win: winCents / 100, // pratique debug
    bonus,
    winningLines,
  });
});

// ----------------------------
// Fallback index.html
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