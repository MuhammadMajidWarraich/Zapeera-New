# WooCommerce integration for Zapeera

One WooCommerce store maps to **one Zapeera branch**. Products and stock
flow **out** of Zapeera; orders flow **in** as Zapeera sales. Zapeera is
the master for products and stock; WooCommerce is the master for orders
placed on the store.

## Merchant setup

1. **In WooCommerce → Settings → Advanced → REST API → Add key**
   (user with access to orders/products, **Read/Write** permissions).
   Copy the **Consumer key** and **Consumer secret** (the secret is shown
   once).
2. **In Zapeera → Settings → Integrations → WooCommerce → Connect.**
   Enter the Store URL (`https://mystore.com`), the consumer key and the
   consumer secret. Turn on the syncs you want (Products / Stock levels /
   Orders). The connection is verified against the store before anything
   is saved.
   - The store URL must be **HTTPS** (Basic Auth over plain HTTP would
     send the secret in the clear). `http://` is allowed only for a
     localhost staging site.
   - **Branch binding:** if the business has exactly one active branch,
     the store binds to it automatically. With several branches, the
     connection must carry the branch id in its config (`branchId`) —
     there is no branch picker in the Settings dialog yet, so set it via
     the connect API call (`POST /api/v1/integrations/woocommerce/connect`
     with `config: { branchId: "<branch id>", … }`). The sync refuses to
     run rather than guess a branch.
3. **Webhooks (optional, for real-time order import).** In WooCommerce →
   Settings → Advanced → Webhooks → Add webhook, for each topic:
   - `order.created` and `order.updated` → delivery URL
     `https://<your-zapeera-host>/api/v1/integrations/webhooks/woocommerce/<business-id>`
     (the business id is the Zapeera business the store is bound to;
     find it in Settings → Branches, or in the URL of the business).
   - `product.updated` → same delivery URL.
   - Set a **Secret** on each webhook (any random string) and paste that
     same secret into the **Webhook secret** field when connecting (or
     reconnecting) WooCommerce in Zapeera. **The signature is keyed by
     this per-webhook secret — not by the consumer secret.** Deliveries
     with a missing or wrong secret are rejected (401) and never touch
     your data.
   - WooCommerce retries a delivery that does not get a 2xx response,
     and auto-disables a webhook after 5 consecutive failures — keep the
     Zapeera server reachable, and re-run a manual **Orders** sync any
     time you suspect a delivery was missed.

## What syncs, and how

| Direction | Entity | How |
|---|---|---|
| Out | Products | Zapeera product → WooCommerce product, matched by **SKU**. Variants → variations (matched by variant SKU). Price = the selling price of the FEFO batch the POS would sell. A product with no priced batch is skipped, not pushed priceless. |
| Out | Stock | Base-unit batch stock of the bound branch → `stock_quantity` (`manage_stock: true`). Simple products at product level, variants at variation level. |
| In | Orders | WooCommerce `processing` / `completed` orders → Zapeera sales through the **existing `createSale` engine** (same FEFO batch deduction, receipt, customer stats, khata, tax, FBR as a POS sale). `pending` / `on-hold` / `cancelled` / `refunded` / `failed` orders are never imported — an unpaid or dead order must not decrement stock. |
| In | Customers | Matched by billing phone, then billing email (within this business); otherwise created. |

**Idempotency.** Each imported sale is tagged `Sale.channel =
'woocommerce'` + `Sale.externalOrderId = "<order id>"` (the same tag
Shopify and Daraz use). Re-importing the same order (manual sync,
webhook retry, or a second `order.updated` delivery) finds the tag and
creates nothing. Imports are serialised per business in-process so two
concurrent deliveries of one order cannot both create a sale, and the
`(companyId, channel, externalOrderId)` unique index is the
multi-instance guard — a concurrent duplicate is rejected inside the
sale transaction itself, never as a second sale to void.

## Honest limitations (read before relying on this)

- **Totals are recomputed by Zapeera.** An imported sale's total comes
  from its line prices through Zapeera's tax engine. WooCommerce
  **shipping charges and WooCommerce tax are not carried over** (Zapeera
  sales have no shipping-line field), so an imported total can differ
  from the WooCommerce order total by shipping + tax.
- **Paid-ness comes from `date_paid`, not status.** A `processing`
  order paid by card imports as paid; a COD `processing` order imports
  **unpaid** (khata due until the rider's cash is collected).
- **Payment method is mapped, not preserved.** WooCommerce method ids
  map to Zapeera tenders (`cod`→CASH, `bacs`/`cheque`→BANK_TRANSFER,
  card gateways→CARD, `jazzcash`→JAZZCASH, `easypaisa`→EASYPAISA,
  anything else→MOBILE). The WooCommerce method title is not stored.
- **Quantities are base units.** A WooCommerce line quantity is treated
  as base units (tablets/pieces). A merchant selling packs on
  WooCommerce must sell them as separate SKUs (one SKU per pack size).
- **SKU is the join key.** Every product and variant pushed or imported
  needs a SKU, and the SKU must belong to the bound branch. An order
  line whose SKU cannot be matched fails the **whole order** (no
  partial sale is ever created) — fix the SKU and re-sync.
- **Prescription products cannot auto-import.** An order containing a
  `requiresPrescription` product fails the same way a POS sale without
  an attached prescription would (pharmacy businesses with enforcement
  on). Attach the prescription in Zapeera, or exclude the product.
- **Promotions are re-evaluated, not copied.** The imported sale runs
  Zapeera's own promotions engine; WooCommerce coupons/discounts are not
  carried over (line prices are taken as-is).
- **Webhook product pushes re-assert Zapeera.** A `product.updated`
  delivery re-pushes that product from Zapeera, overwriting a
  WooCommerce-side edit. Edit products in Zapeera, not in WooCommerce.
- **No live store was available in the build sandbox.** All vendor
  behaviour is covered by mocked tests only (see
  `tests/integrations-woocommerce.test.ts`). Verify against a real
  staging WordPress/WooCommerce site before relying on it: connect,
  push one product, push stock, import one COD and one paid order,
  re-import the same order, and fire one webhook per topic.
- **`prisma generate` cannot run in the sandbox** (Prisma CDN failure —
  pre-existing, framework-known). Regenerate the client in the VM
  assembly container at deploy time. No schema change was made here, so
  no migration is needed.
