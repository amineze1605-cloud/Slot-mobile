// server.js — Slot Mobile "Casino mode" (server authoritative)
// ✅ Solde/FS/multiplicateur/gain gérés serveur (session)
// ✅ Anti-float: tout en CENTIMES (int)
// ✅ Provably fair: serverSeed commit+reveal + clientSeed + nonce

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// IMPORTANT (Render/Proxy HTTPS) : permet cookie secure derrière proxy
app.set("trust proxy", 1);

app.use(express.json({ limit: "256kb" }));

// ----------------------------
// CORS (OPTIONNEL)
// ----------------------------
// ✅ Ton cas actuel (front+back même domaine): pas besoin de CORS.
// ✅ Si un jour tu héberges le front ailleurs: ajoute sur Render
//    CORS_ORIGIN=https://ton-site-front.com
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "").trim();
if (CORS_ORIGIN) {
  app.use(
    cors({
      origin: CORS_ORIGIN.split(",").map(s => s.trim()),
      credentials: true,
    })
  );
  app.options("*", cors({ origin: CORS_ORIGIN.split(",").map(s => s.trim()), credentials: true }));
}

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
      secure: process.env.NODE_ENV === "production", // OK avec trust proxy (Render HTTPS)
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
  11: { 3: 20, 4: 25, 5: 30 },
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
  const h = sha256Hex(`${serverSeed}:${clientSeed}:${nonce}:${index}`);
  const slice = h.slice(0, 8); // 32-bit
  const x = parseInt(slice, 16) >>> 0;
  return x % max;
}

function initSessionState(req) {
  const s = req.session;
  if (!s.state) {
    s.state = {
      balanceCents: 1000 * 100,
      freeSpins: 0,
      winMultiplier: 1,
      lastWinCents: 0,
      spinLock: false,
      nonce: 0,
      serverSeed: newServerSeedHex(),
      serverSeedHash: "",
    };
    s.state.serverSeedHash = sha256Hex(s.state.serverSeed);
  }
  return s.state;
}

function publicState(st) {
  return {
    balanceCents: st.balanceCents,
    freeSpins: st.freeSpins,
    winMultiplier: st.winMultiplier,
    lastWinCents: st.lastWinCents,
    allowedBetsCents: ALLOWED_BETS_CENTS,
    fair: {
      serverSeedHash: st.serverSeedHash,
      nonce: st.nonce,
    },
  };
}

// ----------------------------
// Évaluation d'une grille (CENTIMES)
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
  res.json(publicState(st));
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
    const body = req.body || {};
    const betCents = clampInt(body.betCents, 1, 1_000_000);

    if (!ALLOWED_BETS_CENTS.includes(betCents)) {
      return res.status(400).json({ error: "BET_NOT_ALLOWED", ...publicState(st) });
    }

    const clientSeed =
      typeof body.clientSeed === "string" && body.clientSeed.length >= 6
        ? body.clientSeed.slice(0, 64)
        : "default-client-seed";

    // reset multiplier si plus de FS
    if (st.freeSpins <= 0) st.winMultiplier = 1;

    const paidSpin = st.freeSpins <= 0;

    if (paidSpin) {
      if (st.balanceCents < betCents) {
        return res.status(400).json({ error: "INSUFFICIENT_FUNDS", ...publicState(st) });
      }
      st.balanceCents -= betCents;
    } else {
      st.freeSpins -= 1;
    }

    st.lastWinCents = 0;

    // provably fair: on utilise serverSeed courant pour CE spin, puis on rotate
    st.nonce += 1;

    const usedServerSeed = st.serverSeed;
    const usedServerSeedHash = st.serverSeedHash;
    const usedNonce = st.nonce;

    const grid = generateGridProvablyFair(usedServerSeed, clientSeed, usedNonce);

    const { baseWinCents, bonusTriggered, winningLines } = evaluateSpinBase(grid, betCents);

    // bonus
    if (bonusTriggered) {
      st.freeSpins += 10;
      st.winMultiplier = 2;
    }

    const totalWinCents = baseWinCents * (st.winMultiplier > 1 ? st.winMultiplier : 1);
    st.lastWinCents = totalWinCents;
    st.balanceCents += totalWinCents;

    // rotate seed (important)
    st.serverSeed = newServerSeedHex();
    st.serverSeedHash = sha256Hex(st.serverSeed);

    res.json({
      result: grid,

      betCents,

      winCents: totalWinCents,
      win: totalWinCents / 100,

      bonus: { freeSpins: bonusTriggered ? 10 : 0, multiplier: bonusTriggered ? 2 : 1 },
      winningLines,

      // état autoritaire renvoyé au client
      balanceCents: st.balanceCents,
      freeSpins: st.freeSpins,
      winMultiplier: st.winMultiplier,
      lastWinCents: st.lastWinCents,

      // provably fair (reveal du seed utilisé + hash du prochain)
      fair: {
        clientSeed,
        nonce: usedNonce,
        serverSeedReveal: usedServerSeed,
        serverSeedHash: usedServerSeedHash,
        nextServerSeedHash: st.serverSeedHash,
      },
    });
  } finally {
    st.spinLock = false;
  }
});

// ----------------------------
// Fallback index.html
// ----------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "slot_mobile_full", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Slot mobile backend running on port ${PORT}`);
});