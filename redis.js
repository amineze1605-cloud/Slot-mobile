// redis.js
const { createClient } = require("redis");

let redisClient = null;
let redisConnectPromise = null;

function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (redisClient) return redisClient;

  redisClient = createClient({ url });

  redisClient.on("error", (err) => {
    console.error("Redis error:", err);
  });

  // Connexion unique (promise mémorisée)
  redisConnectPromise = redisClient.connect().catch((err) => {
    console.error("Redis connect failed:", err);
  });

  return redisClient;
}

// Optionnel: si tu veux attendre la connexion dans server.js
async function waitRedisReady() {
  if (redisConnectPromise) await redisConnectPromise;
}

module.exports = { getRedisClient, waitRedisReady };