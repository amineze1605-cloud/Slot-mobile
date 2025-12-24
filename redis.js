// redis.js
const { createClient } = require("redis");

function createRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = createClient({ url });

  client.on("error", (err) => {
    console.error("Redis error:", err);
  });

  // On connecte sans bloquer le démarrage
  client.connect().catch((err) => {
    console.error("Redis connect failed:", err);
  });

  return client;
}

module.exports = { createRedisClient };
