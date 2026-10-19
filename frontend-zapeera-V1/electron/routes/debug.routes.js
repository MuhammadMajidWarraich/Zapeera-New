/**
 * Debug Routes — REMOVED (QA fix 2026-10-19, Track C 1.6)
 *
 * This module previously registered GET /api/debug/postgresql WITHOUT the
 * auth middleware. The handler returned the remote database URL (password
 * masked), connectivity state, and sample cloud user rows (id / email /
 * username / role) pulled live from PostgreSQL — readable by any local
 * process and, combined with the old reflect-any-origin CORS, by any web
 * page the user visited. No caller exists in the frontend or the main
 * process (verified by grep), so the endpoint is removed outright rather
 * than gated.
 *
 * The registration call in routes/index.js has been removed as well. This
 * stub keeps the module importable (no-op) so any stale require elsewhere
 * fails safe instead of crashing the server.
 */

function registerDebugRoutes(/* app, authMiddleware, deps */) {
  // Intentionally registers nothing.
}

module.exports = {
  registerDebugRoutes
};
