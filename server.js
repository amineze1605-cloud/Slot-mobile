"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const cors = require("cors");

// ----------------------------
// CONFIG
// ----------------------------
const PORT = Number(process.env.PORT || 10000);
const FRONT_DIR = path.join(__dirname, "slot_mobile_full");

const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_ME_IN_PROD";
const REDIS_URL = process.env.REDIS_URL || "";
const IS_PROD = process.env.NODE_ENV === "production";

// ----------------------------
// SLOT CONSTANTES
// ----------------------------
const ROWS = 3;
const COLS = 5;
const SYMBOLS_COUNT = 12; // IDs 0..11
const WILD_ID = 9;
const BONUS_ID = 6;

const ALLOWED_BETS_CENTS = [5, 10, 20, 30, 40, 50, 75, 100, 150, 200];

const PAYLINES = [
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]],
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]],
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]],
];

const PAYTABLE = {
  1: { 3: 2, 4: 3, 5: 4 },
  3: { 3: 2, 4: 3, 5: 4 },
  7: { 3: 2, 4: 3, 5: 4 },
  10:{ 3: 2, 4: 3, 5: 4 },

  4: { 3: 3, 4: 4, 5: 5 },
  8: { 3: 4, 4: 5, 5: 6 },
  5: { 3: 10, 4: 12, 5: 14 },
  2: { 3: 16, 4: 18, 5: 20 },
  11:{ 3: 20, 4: 25, 5: 30 },
  0: { 3: 30, 4: 40, 5: 50 },
};

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

function initSessionState(req) {
  const s = req.session;
  if (!s) throw new Error("SESSION_MISSING");

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
      const sym = grid[row]?.[col];

      if (sym === BONUS_ID) { invalid = true; break; }
      if (sym !== WILD_ID) { baseSymbol = sym; break; }
    }
    if (invalid || baseSymbol === null) return;

    const table = PAYTABLE[baseSymbol];
    if (!table) return;

    let count = 0;
    for (let i = 0; i < line.length; i++) {
      const [row, col] = line[i];
      const sym = grid[row]?.[col];

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

  return { baseWinCents, bonusTriggered: bonusCount >= 3, winningLines };
}

let redisClient = null;
let usingRedis = false;

function getRedisStoreCtor(mod) {
  if (typeof mod === "function") return mod;
  if (mod && typeof mod.default === "function") return mod.default;
  if (mod && typeof mod.RedisStore === "function") return mod.RedisStore;
  return null;
}

async function initRedisSessionStore() {
  if (!REDIS_URL) return null;

  try {
    const redisMod = require("./redis");

    if (redisMod && typeof redisMod.getRedisClient === "function") {
      redisClient = redisMod.getRedisClient();
      if (typeof redisMod.waitRedisReady === "function") {
        await redisMod.waitRedisReady();
      } else if (redisClient?.connect && !redisClient.isOpen) {
        await redisClient.connect().catch(() => {});
      }
    } else if (redisMod && typeof redisMod.createRedisClient === "function") {
      redisClient = redisMod.createRedisClient();
      if (redisClient?.connect && !redisClient.isOpen) {
        await redisClient.connect().catch(() => {});
      }
    }
  } catch (_) {}

  if (!redisClient) {
    const { createClient } = require("redis");
    redisClient = createClient({ url: REDIS_URL });

    redisClient.on("error", (err) => {
      console.error("[REDIS] error:", err?.message || err);
    });

    try {
      await redisClient.connect();
    } catch (e) {
      console.error("[REDIS] connect failed:", e?.message || e);
      return null;
    }
  }

  const connectRedis = require("connect-redis");
  const RedisStore = getRedisStoreCtor(connectRedis);
  if (!RedisStore) {
    console.warn("[REDIS] connect-redis export not found. Falling back to MemoryStore.");
    return null;
  }

  const ready = Boolean(redisClient) && (redisClient.isReady === true || redisClient.isOpen === true);
  if (!ready) {
    console.warn("[REDIS] client not ready yet, fallback MemoryStore.");
    return null;
  }

  usingRedis = true;
  console.log("[REDIS] connected/ready ✅");

  return new RedisStore({ client: redisClient, prefix: "slot:" });
}

// ----------------------------
// Helpers HTTP (anti-cache API Safari)
// ----------------------------
function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

// ----------------------------
// MAIN
// ----------------------------
async function main() {
  const app = express();

  // Render/Proxy HTTPS -> cookies secure OK
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // CORS OK (même domaine => pas gênant)
  app.use(cors({ origin: true, credentials: true }));
  app.use((req, res, next) => {
    res.setHeader("Vary", "Origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use(express.json({ limit: "128kb" }));

  const store = await initRedisSessionStore();

  if (!process.env.SESSION_SECRET) {
    console.warn("[SESSION] WARNING: SESSION_SECRET not set. Set it on Render.");
  }
  if (!store) {
    console.warn("[SESSION] Using MemoryStore (NOT recommended in production).");
  } else {
    console.log("[SESSION] Redis session store enabled ✅");
  }

  app.use(
    session({
      name: "slot.sid",
      store: store || undefined,
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: IS_PROD,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    })
  );

  // Static: cache OK pour assets, mais index.html no-store
  app.use(
    express.static(FRONT_DIR, {
      maxAge: IS_PROD ? "7d" : 0,
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) noStore(res);
      },
    })
  );

  // ---------------- API ----------------
  app.get("/health", (req, res) => {
    noStore(res);
    res.json({
      ok: true,
      usingRedis,
      hasRedisUrl: Boolean(REDIS_URL),
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      nodeEnv: process.env.NODE_ENV || "",
      redis: {
        isOpen: Boolean(redisClient && redisClient.isOpen),
        isReady: Boolean(redisClient && redisClient.isReady),
      },
    });
  });

  app.get("/state", (req, res) => {
    noStore(res);
    const st = initSessionState(req);
    res.json(publicState(st));
  });

  app.post("/spin", (req, res) => {
    noStore(res);
    const st = initSessionState(req);

    if (st.spinLock) {
      return res.status(429).json({ error: "SPIN_IN_PROGRESS", ...publicState(st) });
    }
    st.spinLock = true;

    const snap = {
      balanceCents: st.balanceCents,
      freeSpins: st.freeSpins,
      winMultiplier: st.winMultiplier,
      lastWinCents: st.lastWinCents,
      nonce: st.nonce,
      serverSeed: st.serverSeed,
      serverSeedHash: st.serverSeedHash,
      spinLock: false,
    };

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

      st.nonce += 1;

      const usedServerSeed = st.serverSeed;
      const usedServerSeedHash = st.serverSeedHash;
      const usedNonce = st.nonce;

      const grid = generateGridProvablyFair(usedServerSeed, clientSeed, usedNonce);
      const { baseWinCents, bonusTriggered, winningLines } = evaluateSpinBase(grid, betCents);

      if (bonusTriggered) {
        st.freeSpins += 10;
        st.winMultiplier = 2;
      }

      const mult = st.winMultiplier > 1 ? st.winMultiplier : 1;
      const totalWinCents = baseWinCents * mult;

      st.lastWinCents = totalWinCents;
      st.balanceCents += totalWinCents;

      st.serverSeed = newServerSeedHex();
      st.serverSeedHash = sha256Hex(st.serverSeed);

      return res.json({
        result: grid,
        betCents,
        winCents: totalWinCents,
        bonus: { freeSpins: bonusTriggered ? 10 : 0, multiplier: bonusTriggered ? 2 : 1 },
        winningLines,

        balanceCents: st.balanceCents,
        freeSpins: st.freeSpins,
        winMultiplier: st.winMultiplier,
        lastWinCents: st.lastWinCents,

        fair: {
          clientSeed,
          nonce: usedNonce,
          serverSeedReveal: usedServerSeed,
          serverSeedHash: usedServerSeedHash,
          nextServerSeedHash: st.serverSeedHash,
        },
      });
    } catch (e) {
      console.error("[/spin] error:", e?.stack || e);

      st.balanceCents = snap.balanceCents;
      st.freeSpins = snap.freeSpins;
      st.winMultiplier = snap.winMultiplier;
      st.lastWinCents = snap.lastWinCents;
      st.nonce = snap.nonce;
      st.serverSeed = snap.serverSeed;
      st.serverSeedHash = snap.serverSeedHash;

      if (!res.headersSent) {
        return res.status(500).json({ error: "SERVER_ERROR", ...publicState(st) });
      }
    } finally {
      st.spinLock = false;
    }
  });

  // SPA fallback
  app.get("*", (req, res) => {
    noStore(res);
    res.sendFile(path.join(FRONT_DIR, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Slot mobile backend running on port ${PORT}`);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("[FATAL] unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
});

main().catch((e) => {
  console.error("[BOOT] failed:", e?.stack || e);
  process.exit(1);
});