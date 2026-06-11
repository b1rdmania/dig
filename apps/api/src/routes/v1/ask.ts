// Thin re-export — the /v1/ask implementation lives in ./ask/ (auth, tools,
// binding, loop, route). This file keeps the import path in app.ts stable.
export { registerAskRoutes } from "./ask/index.js";
export type { MediaItem, EvidenceItem, ResponseMode } from "./ask/index.js";
