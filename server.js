// server.js
// Backend pour Slot Mobile (mapping aligné avec le front)

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

// Mapping utilisé côté front :
// 0 - 77 mauve
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

// 5 lignes : 3 horizontales + 2 diagonales (indices [row, col])
const PAYLINES = [
  // 0 : ligne du haut
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  // 1 : milieu
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]],
  // 2 : bas
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  // 3 : diagonale haut-gauche → bas-droite (V)
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]],
  // 4 : diagonale bas-gauche → haut-droite (∧)
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]],
];

// Paytable alignée avec ton front : multiplicateurs de mise
const PAYTABLE = {
  // Fruits : pastèque, pomme, cerises, citron
  1: { 3: 2, 4: 3, 5: 4 },   // pastèque
  3: { 3: 2, 4: 3, 5: 4 },   // pomme
  7: { 3: 2, 4: 3, 5: 4 },   // cerises
  10: { 3: 2, 4: 3, 5: 4 },  // citron

  4: { 3: 3, 4: 4, 5: 5 },   // cartes
  8: { 3: 4, 4: 5, 5: 6 },   // pièce
  5: { 3: 10, 4: 12, 5: 14 },// couronne
  2: { 3: 16, 4: 18, 5: 20 },// BAR
  11:{ 3: 20, 4: 25, 5: 30 },// 7 rouge
  0: { 3: 30, 4: 40, 5: 50 },// 77 mauve
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
    for (let c = 0; c < COLS; c++) {
      row.push(randInt(SYMBOLS_COUNT));
    }
    grid.push(row);
  }
  return grid;
}

// ----------------------------
// Évaluation d'une grille
// (logique proche de ton front)
// ----------------------------
function evaluateSpin(grid, bet) {
  let win = 0;
  const winningLines = [];
  let bonusCount = 0;

  // compter les BONUS sur toute la grille
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  // pour chaque ligne
  PAYLINES.forEach((line, lineIndex) => {
    let baseSymbol = null;
    let invalid = false;

    // 1) trouver le symbole de base (premier non-WILD, non-BONUS de gauche à droite)
    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const sym = grid[row][col];

      if (sym === BONUS_ID) {
        // BONUS avant la base ⇒ ligne non payante
        invalid = true;
        break;
      }
      if (sym !== WILD_ID) {
        baseSymbol = sym;
        break;
      }
    }

    if (invalid || baseSymbol === null) return;
    const table = PAYTABLE[baseSymbol];
    if (!table) return; // symbole non-payant

    // 2) compter les symboles consécutifs depuis la gauche
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const sym = grid[row][col];

      if (sym === BONUS_ID) break; // BONUS casse la ligne
      if (sym === baseSymbol || sym === WILD_ID) {
        count++;
      } else {
        break;
      }
    }

    if (count >= 3) {
      const mult = table[count];
      if (!mult) return;

      const lineWin = bet * mult;
      win += lineWin;
      winningLines.push({
        lineIndex,
        symbolId: baseSymbol,
        count,
        payout: lineWin,
      });
    }
  });

  // BONUS : 3+ symboles → 10 free spins, gains ×2
  const bonus = { freeSpins: 0, multiplier: 1 };
  if (bonusCount >= 3) {
    bonus.freeSpins = 10;
    bonus.multiplier = 2;
    if (win > 0) {
      win *= bonus.multiplier;
    }
  }

  return { win, bonus, winningLines };
}

// ----------------------------
// Endpoint SPIN
// ----------------------------
app.post("/spin", (req, res) => {
  const body = req.body || {};
  const bet = Number(body.bet) > 0 ? Number(body.bet) : 1;

  const grid = generateRandomGrid();
  const { win, bonus, winningLines } = evaluateSpin(grid, bet);

  res.json({
    result: grid,
    win,
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