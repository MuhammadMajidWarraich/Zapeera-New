// ─── PostEx provider module (feature/integration-postex) ─────────────────
// Registers the PostEx handler at import time (framework pattern — the
// server imports the barrel in src/integrations/providers.ts, so adding
// `import './postex';` there is what flips PostEx from "Coming soon" to
// connectable). Re-exports the pieces tests and the webhook route use.
import { registerIntegrationHandler } from '../registry';
import { postexHandler, processPostExWebhook, createPostExHandler, buildPostExOrderPayload } from './handler';
import { PostExClient, postExCredentialsFromRecord, POSTEX_ENDPOINTS } from './client';
import { clearPostExTokenCache } from './client';

registerIntegrationHandler(postexHandler);

export { postexHandler, processPostExWebhook, createPostExHandler, buildPostExOrderPayload };
export { PostExClient, postExCredentialsFromRecord, POSTEX_ENDPOINTS, clearPostExTokenCache };
