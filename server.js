
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("slot_mobile_full"));

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function generateGrid() {
  const rows = 3, cols = 5;
  const grid = [];
  for (let r=0;r<rows;r++) {
    const row = [];
    for (let c=0;c<cols;c++) row.push(randInt(7));
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
  if (Math.random() < 0.1) bonus.freeSpins = 3;
  if (Math.random() < 0.05) bonus.multiplier = 3;
  return { win, bonus };
}

app.post("/spin", (req, res) => {
  const { bet = 1 } = req.body || {};
  const b = Number(bet) > 0 ? Number(bet) : 1;
  const grid = generateGrid();
  const evalRes = evaluate(grid, b);
  res.json({ result: grid, win: evalRes.win, bonus: evalRes.bonus });
});

app.listen(PORT, () => {
  console.log("Slot mobile backend running on http://localhost:" + PORT);
});
