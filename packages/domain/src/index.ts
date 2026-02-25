/**
 * @dig/domain — shared retrieval services, business logic, and types.
 *
 * This package is imported by apps/api, apps/mcp, and apps/ingest.
 * It contains no framework-specific code — just pure domain logic
 * that operates on the DB via @dig/db.
 */

export { healthCheck } from "./health.js";
