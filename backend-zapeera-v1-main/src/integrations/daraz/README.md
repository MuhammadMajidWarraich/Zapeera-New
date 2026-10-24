# Daraz integration — Zapeera

Provider `daraz` (Tier 1, sales-channel). Handler: `./handler.ts`,
client: `./client.ts`. Registered by `./index.ts`, wired by the single
`import './daraz'` line in `../providers.ts`.

Docs: https://open.daraz.com/ — Getting Started:
https://open.daraz.com/doc/doc.htm?nodeId=27493&docId=118729

## 1. Seller OAuth — the exact flow (do this once, by hand)

Daraz business APIs need **three** things: App Key, App Secret, and a
**seller OAuth access token**. The App Key/Secret alone cannot call any
business API. There is no OAuth redirect/callback in Zapeera yet, so
the token exchange is a manual step; the connect dialog then stores
all four values encrypted (AES-256-GCM, framework).

1. **Seller account.** The shop needs a Daraz seller account
   (CNIC/NTN + bank account; verification takes 24–48h). Without it
   there is nothing to connect to.
2. **Create the app.** In the Daraz Open Platform console
   (open.daraz.com) create an app → you get the **App Key** and
   **App Secret**.
3. **Authorize the app.** In the console, open the app's authorization
   page and authorize it as the seller (response_type=code). Daraz
   redirects with a single-use authorization `code`.
4. **Exchange the code.** `POST https://api.daraz.pk/rest/auth/token/create`
   (signed like every Daraz call — see `client.ts`):
   `app_key`, `timestamp` (ms), `sign_method=sha256`, `code`, `sign`.
   Response data: `access_token`, `refresh_token`, `expires_in`,
   `account`. (The client has `exchangeAuthCode()` for this; there is
   no UI for it yet — run it from the API Explorer or curl.)
5. **Connect in Zapeera.** Settings → Integrations → Daraz → Connect,
   paste App Key, App Secret, Seller Access Token, Seller Refresh
   Token. `connect()` verifies with a cheap vendor read
   (`/products/get`, limit 1) and only then stores anything.
6. **Token renewal is automatic.** Access tokens expire; the client
   refreshes via `/auth/token/refresh` on the first auth failure and
   the handler persists the rotated tokens (encrypted) to the
   connection row. If the refresh token itself expires, reconnect
   (repeat steps 3–5).

## 2. What syncs, which direction

| Sync | Direction | What happens |
|---|---|---|
| Products | out | Branch products → Daraz listings. Already-listed SKUs (matched by SellerSku = Zapeera SKU) get price+stock refreshed. Unlisted products are CREATED only when `darazCategoryId` is set in the connection config (Daraz needs a PrimaryCategory); otherwise they are reported as failed with the reason. New listings use brand "No Brand" and no images (Zapeera products carry none) — both are live-verification items. Name/description edits are NOT pushed in v1. |
| Stock | out | Hourly push (cadence: §4). Price + sellable base-unit stock per listed SKU. Sellable = live batches, qty > 0, not expired. Pushes in chunks of 50 SKUs. SKUs listed on Daraz but absent from this branch are never touched; products with no priced batch are reported, not guessed. |
| Orders | in (poll) | §3. |
| Shipments | out (per-sale) | `createShipment` — the generic fulfilment step. The service builds a vendor-neutral input from a Zapeera sale (recipient, COD = unpaid balance, parcel lines) and the handler marks that sale's Daraz order `packed` via `/order/set_status`. A sale that did not come from Daraz fails loudly; an order Daraz already shows as packed (or further) is an idempotent no-op. Trigger: `POST /api/integrations/daraz/sync { "entity": "shipment", "saleRef": "<sale id or invoice number>" }`. `ready_to_ship` is NOT set — it needs the courier handover (packing UI, wave follow-up). |

## 3. Order polling (Daraz has no webhooks)

- **Cadence:** every ~15 minutes (research + the WooCommerce/Daraz
  integration precedent). **No webhook receiver exists and none was
  faked.**
- **Cursor:** `darazLastOrderPollAt` in the connection row's raw
  config JSON. Each poll fetches `/orders/get` with
  `updated_after = cursor − 5 min` (overlap so boundary updates are
  not lost), `sort_by=updated_at ASC`, paginated at 100 (Daraz caps
  offset+limit < 5000 — shorten the window instead of paging past it).
  First poll (no cursor) looks back 24h.
- **Cursor advance:** only past orders that resolved (imported,
  duplicate, or terminal status). A failed order holds the cursor
  back, so the next poll retries it after the owner fixes the cause
  (usually an unmapped SKU).
- **Dedup:** order numbers are de-duplicated within a poll (the list
  can shift while paging), and import is idempotent via the
  `(companyId, channel, externalOrderId)` unique key on Sale — the
  same Daraz order can never create a second sale.
- **Statuses:** `pending`, `ready_to_ship`, `shipped`, `delivered`
  import; `canceled`/`returned`/`failed` are skipped; any unknown
  status is skipped (never minted into a sale).
- **One unknown SKU fails the whole order** — never a partial sale.
  Map the SKU to a Zapeera product in the mapped branch first.
- **Sale shape:** created through the existing `createSale` engine
  (same FEFO batch path, tax, receipts, stock movements as a counter
  sale). Walk-in sale, `paymentMethod: CASH` (COD tender marker),
  `paymentStatus: PENDING`, `paidAmount: 0` — unpaid until Daraz
  settles. Tagged `channel: 'daraz'`, `externalOrderId: <Daraz order
  number>`. The buyer is matched/created by phone for CRM, but is
  deliberately NOT attached to the sale: a Daraz COD receivable is
  owed by Daraz (settlement), not the end customer, and attaching
  them would post a false SALE_DUE (udhaar) on their khata.
  (Product decision point: the one-line change is `customerId` in
  `buildSalePayload`/`createSaleViaEngine` in `handler.ts`.)
- **Quantities are base units** (UNIT level). Daraz quantities map
  1:1 to Zapeera base units; pack/strip-level mapping is a follow-up.
  Item price is Daraz's `paid_price` (money truth from Daraz).
  Shipping fees and vouchers are NOT folded into the sale total in
  v1 (the seller never receives the shipping fee; the voucher is a
  marketplace discount) — they are visible on the Daraz order.

## 4. Scheduling hook (for the deploy wave — NOT wired here)

No cron was added on the VM and no job is started by this branch.
The wave adds a job module following the existing pattern
(`src/jobs/subscription-cron.ts`: `startSubscriptionCron()` called
from `server.ts`):

```ts
// src/jobs/daraz-order-poll.ts (to be added by the wave)
import { getPrisma } from '../utils/db.util';
import { triggerSync } from '../services/integration.service';

// Every 15 minutes: for each business with a CONNECTED Daraz row,
// triggerSync(prisma, businessId, 'daraz', { entity: 'order' }).
// Every 60 minutes: same call with { entity: 'stock' } (hourly push).
// One poll run = one importOrders() call; the handler owns the cursor,
// pagination, dedup and idempotency, so a missed tick is harmless —
// the next tick re-reads from the cursor.
```

Manual trigger (works today, no scheduler): `POST
/api/integrations/daraz/sync` with `{ "entity": "order" }` (or
`"stock"`, `"product"`), OWNER/MANAGER only. Shipments are per-sale:
`{ "entity": "shipment", "saleRef": "<sale id or invoice number>" }`
— the service builds the shipment input from that sale and the
handler marks its Daraz order packed.

## 5. Branch mapping

One Daraz seller shop ↔ ONE Zapeera branch, enforced in config:
`config.branchId` (set in the connect payload's config object) wins;
otherwise the business's single active branch is used; a
multi-branch business without an explicit `branchId` fails the sync
loudly instead of guessing. The Settings dialog does not collect
`branchId` yet (wave follow-up: branch picker). `darazCategoryId`
lives in the same config object (see §2).

## 6. Honest limitations (also on the provider card)

- No webhooks — polling only (orders every 15 min, hourly stock push).
- No true sandbox: the API Explorer runs against **production** data.
- Seller account required (CNIC/NTN + bank, verification 24–48h).
- Product creation needs a Daraz category id + images may be required
  by Daraz (Zapeera products carry no images) — creation failures
  surface per-SKU in the sync log; list such products in Seller
  Center instead.
- `ready_to_ship` is not set automatically (needs the handover step).
- No token-revoke endpoint is published: disconnect wipes Zapeera's
  stored credentials; revoke the app grant in the Daraz console if
  needed.

## 7. Live-verification checklist (needs a real seller account)

None of this has ever run against live Daraz (no seller account
exists in this workspace). Before trusting the sync, verify in the
Daraz API Explorer, in order:

1. `POST /auth/token/create` with a real code → tokens returned.
2. `GET /products/get` (limit 1) with the token → 200, code "0".
3. Signing: the client test asserts the exact HMAC vector; confirm
   Daraz accepts a real signed call (step 2 proves it).
4. `/product/update/price/quantity` payload shape (one SKU, then 50).
5. `/product/create` payload shape + whether images/package
   dimensions are mandatory for the chosen category.
6. `/orders/get` with `updated_after` + pagination; `/order/get` and
   `/order/items/get` field names (`order_number`, `sku`,
   `paid_price`, address phone fields).
7. `/order/set_status` parameter shape (`order_item_ids` + `status`).
8. Token refresh (`/auth/token/refresh`) + expiry windows.
9. Confirm the PK gateway host (`https://api.daraz.pk/rest`).
