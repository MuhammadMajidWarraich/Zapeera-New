// ─── Shopify integration — sync handler (feature/integration-shopify) ────
// Implements IntegrationSyncHandler for provider 'shopify' and registers
// itself on import (the one line in ../providers.ts flips the card from
// "Coming soon" to connectable).
//
// AUTH: OAuth 2.0 (offline Admin API access token) — see ./oauth.ts —
// or a pasted custom-app token via the Settings connect dialog (registry
// credentialFields: shopDomain, accessToken). The token is encrypted by
// the framework before storage and never logged.
//
// VERIFICATION: connect()/getStatus() do a real vendor round-trip
// (GraphQL shop query) and only return { ok: true } when Shopify
// answers — the stored status never lies.
//
// DISCONNECT: Shopify exposes no token-revoke endpoint for custom-app /
// OAuth tokens — the merchant removes the app in Shopify admin. This is
// a deliberate no-op: the framework wipes the stored credentials
// regardless (a failed revoke never leaves credentials stored).
//
// SYNC DIRECTIONS: products + stock OUT (Zapeera -> Shopify), orders IN
// (Shopify -> Zapeera sales). One Shopify store maps to ONE Zapeera
// branch (config.branchId, else the first active branch) — enforced in
// ./sync-core.ts. Honest limitation (registry card): Stripe/PayPal
// checkout does not work in Pakistan — PK merchants use COD or local
// gateways.
import { registerIntegrationHandler } from '../registry';
import type { IntegrationSyncHandler } from '../types';
import { fetchShop, requireShopifyCredentials } from './client';
import { importShopifyOrders, syncShopifyProducts, syncShopifyStock } from './sync-core';

export const shopifyHandler: IntegrationSyncHandler = {
  provider: 'shopify',

  async connect(credentials) {
    const creds = requireShopifyCredentials(credentials);
    const shop = await fetchShop(creds);
    return { ok: true, message: `Connected to ${shop.name} (${shop.myshopifyDomain}).` };
  },

  async disconnect() {
    // No vendor-side revoke exists for Shopify Admin API tokens — the
    // merchant removes the app/token in Shopify admin. Local credential
    // wipe is done by the framework regardless.
    return undefined;
  },

  async getStatus(credentials) {
    const creds = requireShopifyCredentials(credentials);
    const shop = await fetchShop(creds);
    return { ok: true, message: `Shopify reachable — ${shop.name} (${shop.myshopifyDomain}).` };
  },

  async syncProducts(ctx) {
    return syncShopifyProducts(ctx);
  },

  async syncStock(ctx) {
    return syncShopifyStock(ctx);
  },

  async importOrders(ctx) {
    return importShopifyOrders(ctx);
  }
};

registerIntegrationHandler(shopifyHandler);

export default shopifyHandler;
