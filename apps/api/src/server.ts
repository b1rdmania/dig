import { buildApp } from "./app.js";

const port = Number(process.env["PORT"] ?? 3000);
const databaseUrl = process.env["DATABASE_URL"];
const redisUrl = process.env["REDIS_URL"];

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { app } = await buildApp({
  databaseUrl,
  redisUrl,
  enableRateLimit: !!redisUrl,
});

try {
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[api] Listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
