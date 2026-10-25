// ─── Integrations framework — provider module barrel (feature/integration-framework) ─
// Provider builders: import + register your handler module HERE (one line
// per provider). Each provider module registers itself as a side effect
// of being imported (it calls registerIntegrationHandler() at module
// load). server.ts imports this barrel once at startup, so a provider
// becomes connectable the moment its line lands here — no other wiring.
//
// Example (what the Shopify builder adds):
//   import './shopify';
//
// The framework ships with ZERO provider lines below on purpose: every
// provider card renders "Coming soon" until its builder lands.
import './woocommerce';
import './shopify';
import './daraz';

export {};
