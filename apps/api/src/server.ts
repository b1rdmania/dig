import { buildApp } from "./app.js";

// Process-level error monitors — must not throw, must not exit.
// These catch async errors that escape route handlers and would otherwise
// crash the process silently (unhandledRejection) or immediately (uncaughtException).
process.on("unhandledRejection", (reason, promise) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    code: "UNHANDLED_REJECTION",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise),
  }));
});

// uncaughtExceptionMonitor fires before the default crash handler.
// We log and allow the default behavior (exit) since the process is already
// in an unknown state — but we get structured output rather than a raw stack dump.
process.on("uncaughtExceptionMonitor", (err) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "fatal",
    code: "UNCAUGHT_EXCEPTION",
    message: err.message,
    stack: err.stack,
  }));
});

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
  await app.listen({ port, host: "::" });
  console.log(`[api] Listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
