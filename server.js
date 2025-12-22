// server.js — Slot Mobile "Casino mode" (server authoritative)
// ✅ Solde/FS/multiplicateur/gain gérés serveur (session)
// ✅ Anti-float: tout en CENTIMES (int)
// ✅ RNG crypto + provably fair (serverSeed/clientSeed/nonce)

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --------- SESSION (autorité serveur) ----------
app.use(
  session({
    name: "slot.sid",
    secret: process.env.SESSION_SECRET || "CHANGE_ME_IN_PROD",
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // HTTPS en prod
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    },
  })
);

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

// Bets autorisées (CENTIMES)
const ALLOWED_BETS_CENTS = [5, 10, 20, 30, 40, 50, 75, 100, 150, 200];

// 5 lignes : indices [row, col]
const PAYLINES = [
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]],
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]],
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]],
];

// Multiplicateurs (int)
const PAYTABLE = {
  1: { 3: 2, 4: 3, 5: 4 },
  3: { 3: 2, 4: 3, 5: 4 },
  7: { 3: 2, 4: 3, 5: 4 },
  10: { 3: 2, 4: 3, 5: 4 },

  4: { 3: 3, 4: 4, 5: 5 },
  8: { 3: 4, 4: 5, 5: 6 },
  5: { 3: 10, 4: 12, 5: 14 },
  2: { 3: 16, 4: 18, 5: 20 },
  11:{ 3: 20, 4: 25, 5: 30 },
  0: { 3: 30, 4: 40, 5: 50 },
};

// ----------------------------
// Helpers
// ----------------------------
function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  n = Math.round(n);
  return Math.max(min, Math.min(max, n));
}

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function newServerSeedHex() {
  return crypto.randomBytes(32).toString("hex");
}

// Provably fair int in [0, max)
function pfRandInt(max, serverSeed, clientSeed, nonce, index) {
  // hash = sha256(serverSeed:clientSeed:nonce:index)
  const h = sha256Hex(`${serverSeed}:${clientSeed}:${nonce}:${index}`);
  // prendre 8 hex (32 bits) -> uint32
  const slice = h.slice(0, 8);
  const x = parseInt(slice, 16) >>> 0;
  return x % max;
}

function initSessionState(req) {
  const s = req.session;
  if (!s.state) {
    s.state = {
      balanceCents: 1000 * 100,
      freeSpins: 0,
      winMultiplier: 1, // 2 pendant FS
      lastWinCents: 0,
      spinLock: false,
      nonce: 0,         // incrémenté à chaque spin (provably fair)
      serverSeed: newServerSeedHex(),
      serverSeedHash: "", // commit
    };
    s.state.serverSeedHash = sha256Hex(s.state.serverSeed);
  }
  return s.state;
}

// ----------------------------
// Évaluation d'une grille (CENTIMES)
// retourne baseWinCents + bonusTriggered + winningLines
// ----------------------------
function evaluateSpinBase(grid, betCents) {
  let baseWinCents = 0;
  const winningLines = [];
  let bonusCount = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === BONUS_ID) bonusCount++;
    }
  }

  PAYLINES.forEach((line, lineIndex) => {
    let baseSymbol = null;
    let invalid = false;

    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const sym = grid[row][col];

      if (sym === BONUS_ID) { invalid = true; break; }
      if (sym !== WILD_ID) { baseSymbol = sym; break; }
    }
    if (invalid || baseSymbol === null) return;

    const table = PAYTABLE[baseSymbol];
    if (!table) return;

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

      const lineWinCents = betCents * mult;
      baseWinCents += lineWinCents;
      winningLines.push({
        lineIndex,
        symbolId: baseSymbol,
        count,
        payoutCents: lineWinCents,
      });
    }
  });

  const bonusTriggered = bonusCount >= 3;
  return { baseWinCents, bonusTriggered, winningLines };
}

// ----------------------------
// RNG + grid (provably fair)
// ----------------------------
function generateGridProvablyFair(serverSeed, clientSeed, nonce) {
  const grid = [];
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      row.push(pfRandInt(SYMBOLS_COUNT, serverSeed, clientSeed, nonce, idx++));
    }
    grid.push(row);
  }
  return grid;
}

// ----------------------------
// API : état serveur
// ----------------------------
app.get("/state", (req, res) => {
  const st = initSessionState(req);
  res.json({
    balanceCents: st.balanceCents,
    freeSpins: st.freeSpins,
    winMultiplier: st.winMultiplier,
    lastWinCents: st.lastWinCents,
    allowedBetsCents: ALLOWED_BETS_CENTS,
    fair: {
      serverSeedHash: st.serverSeedHash, // commit seed courant (à vérifier après reveal)
      nonce: st.nonce,
    },
  });
});

// ----------------------------
// Endpoint SPIN (autoritaire)
// ----------------------------
app.post("/spin", (req, res) => {
  const st = initSessionState(req);

  if (st.spinLock) {
    return res.status(429).json({ error: "SPIN_IN_PROGRESS", ...publicState(st) });
  }
  st.spinLock = true;

  try {
    const body = req