// ─── Daraz provider module (feature/integration-daraz) ─────────────────────
// Importing this file registers the Daraz handler (side effect). The
// barrel (../providers.ts) imports this file — that one line is what
// flips Daraz from "Coming soon" to connectable. See ./README.md for
// the OAuth flow, polling design and live-verification checklist.
import { registerIntegrationHandler } from '../registry';
import { darazHandler } from './handler';

registerIntegrationHandler(darazHandler);

export { darazHandler } from './handler';
export { DarazClient, buildDarazSign, DARAZ_API_BASE_URL } from './client';
export type { DarazCredentials, DarazRefreshedTokens } from './client';
