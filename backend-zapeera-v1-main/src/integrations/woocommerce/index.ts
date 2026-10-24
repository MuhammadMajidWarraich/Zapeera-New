// ─── WooCommerce integration module (feature/integration-woocommerce) ────
// Importing this barrel registers the WooCommerce sync handler (the
// provider flips from "Coming soon" to connectable) — see
// src/integrations/providers.ts. The webhook router is imported
// separately by server.ts because it must mount with express.raw BEFORE
// the JSON body parsers.
export * from './handler';
export * from './webhook';
export * from './client';
export * from './mapping';
export { invokeCreateSale } from './sale-invoker';
export type { SaleActor } from './sale-invoker';
