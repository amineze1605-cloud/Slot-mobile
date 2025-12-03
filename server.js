const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(express.json());

// Serve frontend files
app.use(express.static(path.join(__dirname, "slot_mobile_full")));

// ---------------------------------------------
// SLOT MACHINE LOGIC
// ---------------------------------------------

function randInt(max) {
    return Math.floor(Math.random() * max);
}

function generateGrid() {
    const rows = 3, cols = 5;
    const grid = [];

    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            row.push(randInt(6)); // 6 symboles
        }
        grid.push(row);
    }
    return grid;
}

function evaluate(grid, bet) {
    let win = 0;
    const mid = grid[1]; // ligne du milieu

    // Exemple de combinaison gagnante : 3 symboles identiques au centre
    if (mid[0] === mid[1] && mid[1] === mid[2]) {
        win = bet * 5;
    }

    // Ajout des bonus
    const bonus = { freeSpins: 0, multiplier: 1 };

    if (Math.random() < 0.10) bonus.freeSpins = 5;   // 10% de chances
    if (Math.random() < 0.05) bonus.multiplier = 2;  // 5% de chances

    return { win, bonus };
}

// API route : SPIN
app.post("/spin", (req, res) => {
    const { bet = 1 } = req.body || {};
    const b = Number(bet) > 0 ? Number(bet) : 1;

    const grid = generateGrid();
    const evalRes = evaluate(grid, b);

    res.json({
        result: grid,
        win: evalRes.win,
        bonus: evalRes.bonus
    });
});

// ---------------------------------------------
// FALLBACK : envoyer index.html pour toute autre route
// ---------------------------------------------
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "slot_mobile_full", "index.html"));
});

// ---------------------------------------------
// START SERVER
// ---------------------------------------------
app.listen(PORT, () => {
    console.log(`Slot mobile backend running on port ${PORT}`);
});
