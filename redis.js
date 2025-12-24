// redis.js
const { createClient } = require("redis");

let redisClient = null;
let redisConnectPromise = null;

function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (redisClient) return redisClient;

  redisClient = createClient({
    url,
    socket: { connectTimeout: 5000 },
  });

  redisClient.on("error", (err) => console.error("[REDIS] error:", err?.message || err));
  redisClient.on("connect", () => console.log("[REDIS] connect…"));
  redisClient.on("ready", () => console.log("[REDIS] ready ✅"));
  redisClient.on("reconnecting", () => console.log("[REDIS] reconnecting…"));

  redisConnectPromise = redisClient.connect().catch((err) => {
    console.error("[REDIS] connect failed:", err?.message || err);
    throw err; // ✅ important
  });

  return redisClient;
}

async function waitRedisReady() {
  if (redisConnectPromise) await redisConnectPromise;
}

module.exports = { getRedisClient, waitRedisReady };