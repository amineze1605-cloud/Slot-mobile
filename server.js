// server.js
// Backend ultra simple pour Slot Mobile

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
const SYMBOLS_COUNT = 12; // 0..11

// 5 lignes : 3 horizontales + 2 diagonales en "V"
const PAYLINES = [
  // 0 : ligne du haut
  [ [0,0], [0,1], [0,2], [0,3], [0,4] ],
  // 1 : milieu
  [ [1,0], [1,1], [1,2], [1,3], [1,4] ],
  // 2 : bas
  [ [2,0], [2,1], [2,2], [2,3], [2,4] ],
  // 3 : diagonale haut-gauche → bas-droite (V)
  [ [0,0], [1,1], [2,2], [1,3], [0,4] ],
  // 4 : diagonale bas-gauche → haut-droite (∧)
  [ [2,0], [1,1], [0,2], [1,3], [2,4] ],
];

// Paytable (multiplicateur de mise) pour 3/4/5 symboles
// 0 = cerise, 1 = pastèque, 2 = pomme, 3 = citron,
// 4 = symboles carte, 5 = pièce, 6 = couronne,
// 7 = BAR, 8 = 7, 9 = 777
// 10 = WILD (pas de gain direct), 11 = BONUS (pas de gain direct)
const PAYTABLE = {
  0: { 3: 2, 4: 3, 5: 4 },
  1: { 3: 2, 4: 3, 5: 4 },
  2: { 3: 2, 4: 3, 5: 4 },
  3: { 3: 2, 4: 3, 5: 4 },
  4: { 3: 3, 4: 4, 5: 5 },
  5: { 3: 4, 4: 5, 5: 6 },
  6: { 3: 10, 4: 12, 5: 14 },
  7: { 3: 16, 4: 18, 5: 20 },
  8: { 3: 20, 4: 25, 5: 30 },
  9: { 3: 30, 4: 40, 5: 50 },
};

const WILD_ID = 10;
const BONUS_ID = 11;

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

// Evaluation d'une grille
function evaluateSpin(grid, bet) {
  let win = 0;
  const winningLines = [];

  // Compter les BONUS sur la grille
  let bonusCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  // Parcours des 5 lignes
  PAYLINES.forEach((line, lineIndex) => {
    let baseSymbol = null;
    let count = 0;

    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const symbol = grid[row][col];

      if (i === 0) {
        // première case de la ligne
        if (symbol === BONUS_ID) {
          // commence par bonus -> pas de combo payant
          break;
        }
        if (symbol === WILD_ID) {
          // wild au début : on attend de voir le premier non-wild/non-bonus
          count = 1;
          continue;
        }
        baseSymbol = symbol;
        count = 1;
      } else {
        if (baseSymbol === null) {
          // On n'a pas encore de symbole de base
          if (symbol === BONUS_ID) break;
          if (symbol === WILD_ID) {
            count++;
            continue;
          }
          baseSymbol = symbol;
          count++;
        } else {
          // On a déjà un symbole de base
          if (symbol === baseSymbol || symbol === WILD_ID) {
            count++;
          } else {
            break;
          }
        }
      }
    }

    if (baseSymbol === null) return;
    const table = PAYTABLE[baseSymbol];
    if (!table) return;

    const multiplier = table[count];
    if (!multiplier) return;

    const lineWin = bet * multiplier;
    win += lineWin;
    winningLines.push({
      lineIndex,
      symbolId: baseSymbol,
      count,
      payout: lineWin,
    });
  });

  const bonus = { freeSpins: 0, multiplier: 1 };

  if (bonusCount >= 3) {
    bonus.freeSpins = 10;
    bonus.multiplier = 2;
  }

  if (bonus.multiplier > 1 && win > 0) {
    win *= bonus.multiplier;
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