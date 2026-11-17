# NOVA

NOVA is an Order-to-Audit manufacturing system for the NIT Tiruchirappalli internship assessment. Stage 1 implements credential login, five roles, territory-scoped customers, suppliers, materials, products and pack sizes, prices, unit conversions, and published BOM revisions. Stage 0's PostgreSQL health endpoint remains available. Stage 2 adds opening documents, purchases, controlled adjustments and an immutable inventory ledger. Stage 3 adds BOM-driven production, variance and run costing. Stage 4 adds sales orders, GST invoices, dispatch and payment allocations. Stage 5 reports are not implemented.

## Run locally

Requires Node.js 24, npm, Docker and Docker Compose.

1. Copy `.env.example` to `.env`. Set the same local database password in all three database values. Use letters and digits because Compose constructs its database URL from the password.
2. Set `BETTER_AUTH_SECRET` to a random value of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Set `BETTER_AUTH_URL` to the exact browser origin, normally `http://localhost:3000`.
3. Run `npm ci`, then `docker compose up -d db`.
4. Run `npm run db:migrate` and `npm run db:migrate:test`.
5. For local fixtures only, set `NOVA_ALLOW_DEMO_SEED=true` and choose a `DEMO_PASSWORD` of at least 12 characters in `.env`. Run `npm run db:seed` twice to verify rerun behavior.
6. Run `npm run dev`, or `docker compose up --build -d app` for the production build. Visit <http://localhost:3000/login>.

The `.env` file is ignored by Git and Docker builds. Compose passes only the database URL, auth secret and origin to the app. It applies versioned migrations before startup. The test database is created on the PostgreSQL volume's first initialization. Stop services with `docker compose down`; this retains data. Do not delete the volume unless you intend to discard its databases.

Demo emails are `salesman.a@example.test`, `salesman.b@example.test`, `admin@example.test`, `production@example.test`, `auditor@example.test`, and `owner@example.test`. All initially use your local `DEMO_PASSWORD`. No password is committed. Rerunning the seed preserves existing passwords and edits; it is not a password reset. Admins can create users, assign one role per user and reset passwords through Users. Updating a user invalidates their sessions. Seed execution is refused when `NODE_ENV=production` or the explicit demo flag is absent. Production bootstrap and password recovery workflows are not provided in this stage.

## Architecture and data

Next.js App Router keeps the UI and server routes in one TypeScript application. PostgreSQL supplies transactions and constraints, while Drizzle tracks versioned SQL. This keeps the later ledger and production logic in the same application without adding services.

- `src/modules/auth`: Better Auth configuration, session validation and role policy. Passwords use the library's password hashing; sessions are stored in PostgreSQL, expire after eight hours and are renewed according to the library's one-hour update interval. Cookie session caching is disabled so logout and expiry are checked against the database. Public signup is disabled. Only login, session lookup and logout are exposed from the auth handler. Origin checks protect application writes; login has a ten-attempt-per-minute limit and general auth traffic a 120-request-per-minute limit per client.
- `src/modules/catalog`: validated, authorized master services and BOM publication. Zod rejects unknown fields and invalid decimals. Writes and audit records share a transaction. APIs return validation, permission and conflict errors without database details.
- `src/lib/db/schema.ts` and `drizzle/`: users, accounts, sessions and verification records; roles and user-role assignments; territories linked to salesmen and customers linked to territories; suppliers; units and inventory items; finished products linked to inventory items; one current price per product; BOM versions linked to products and component lines linked to items/units; append-only audit events.
- `src/lib/units`: exact decimal conversions. Grams, millilitres, pieces and packets are base units. Carton-to-packet conversion requires an explicit capacity; pieces and packets are not interchangeable. Each finished product represents one named pack size and has an explicit pack weight and carton capacity. Changing pack identity requires a new product.

BOM creation publishes a complete revision atomically. Revision numbers are serialized by locking the product. Exactly one revision may be active per product. PostgreSQL triggers prevent modifying or deleting published contents, adding lines to a published BOM, incompatible component units and finished goods as components. Revisions retain their original batch size, expected packet output, component quantities and display units. The active flag can move to a new revision. There is no saved draft workflow in Stage 1.

Money and quantities enter services as decimal strings and are stored as PostgreSQL NUMERIC. Prices accept at most two decimal places; quantities accept at most six. Excess precision is rejected rather than silently rounded. The later invoicing stage will define invoice rounding. No authoritative financial or quantity calculation uses JavaScript floating-point arithmetic.

## Access policy

| Role                  | Read                                         | Write                                                                                           |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Salesman              | Own territory customers, products, prices    | None in Stage 1                                                                                 |
| Factory Admin         | All master data and BOMs                     | Users/roles, territories, customers, suppliers, materials, products, prices and BOM publication |
| Production Supervisor | Suppliers, materials, products, prices, BOMs | Suppliers, materials, BOM publication                                                           |
| Accountant/Auditor    | All master data and BOMs                     | None                                                                                            |
| Owner                 | All master data and BOMs                     | None                                                                                            |

Restrictions are enforced in services and APIs as well as navigation. Salesman customer queries join the assigned territory on the server. Password hashes and session tokens are never included in master responses or audit records.

## Benchmark fixtures

The seed creates Murukku 200 g at INR 50 before the exercise's configurable 5% GST rate, 20 packets per carton, and a BOM for one batch yielding 200 packets: flour 40 kg, oil 10 L, salt/spice 1.2 kg, pouches 200 pieces, cartons 10 pieces. Retailer A belongs to Salesman A's Tamil Nadu territory; Distributor B belongs to Salesman B's Karnataka territory. All fixture IDs use a `demo-` prefix and addresses are explicitly invented. No supplier is invented by the benchmark seed because the source names none.

The default Stage 1 seed still creates only masters. Run `npm run db:seed -- --inventory` for the Stage 2 opening and purchase checkpoint. The Stage 3 checkpoint is available with `npm run db:seed -- --production`; it posts opening stock, the purchase, production and overheads idempotently. Use `--sales` to continue through Stage 4 with an explicitly invented exercise-only seller identity.

## Validation

```sh
npm ci
npm run db:migrate
npm run db:migrate:test
npm run db:seed
npm run db:seed
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
docker compose up --build -d app
npm run test:smoke
```

`npm test` resets application test tables in the explicitly configured isolated database whose name ends in `_test`, then seeds fixtures and tests authentication, expiry, authorization, customer isolation, validation, SQL constraints, conversions, BOM preservation and seed reruns. Never point `TEST_DATABASE_URL` at an application database. Playwright uses this same test database with a separate server on port 3100; the browser command resets and seeds its isolated test database before starting. Its mobile Chromium flows cover login/logout, supplier creation, BOM revision and auditor restrictions. `test:smoke` checks the running app at `SMOKE_BASE_URL` (default localhost:3000), using the seeded local demo credentials; it tests HTTP permissions, territory isolation and logout without creating business data.

The CI workflow runs these checks against a PostgreSQL service. To evolve the schema, run `npm run db:generate -- --name meaningful_name`, review its SQL and commit the migration; custom constraint migrations must also be versioned. Never edit an already applied migration.

## Current limitations

This stage is a local assessment foundation, with one app instance. Auth rate limiting is held in process memory; multiple instances would need shared rate-limit storage. HTTPS and deployment-specific secrets are required outside localhost. There is no email delivery, password recovery, account deactivation, or production bootstrap command. Master lists are not paginated. Prices retain audit history but do not yet have effective dates or customer-specific price lists. Users have one assigned role. BOMs are published immediately rather than saved as drafts. Remaining business benchmark modules, exports, the final design note and the submission walkthrough belong to later stages.

## Stage 2 inventory

The Inventory page supports opening and purchase drafts, draft edits, posting, purchase history, stock summary/valuation, adjustments, movement details and item/category/UTC date filters. Admins can post all three document categories; production supervisors can create and post purchases. Owners and auditors can read; salesmen cannot access inventory.

Migrations 0004 and 0005 define `stock_documents`, `stock_document_lines`, `inventory_movements`, the derived `stock_summary` view and posting/immutability triggers. These SQL objects are maintained through custom Drizzle migrations and accessed through parameterized Drizzle SQL services. Documents have explicit purchase/opening/adjustment categories; each movement has a foreign-key document and line, item, base unit, actor, time, signed quantity/value, and original/corrected quantity. There is no editable balance cache.

Posting locks the document, then all affected inventory item rows in item-ID order. PostgreSQL validates units, quantities and available stock, inserts the movements, updates the document and appends its audit event in one transaction. A line failure rolls everything back. Repeated posting returns the existing document; unique request keys protect draft creation, and changed payloads with reused keys are rejected. Published movements and posted documents/lines cannot be edited or deleted. Draft changes are audited. Corrections are signed adjustment documents with mandatory reasons; adjustments never overwrite balances.

Moving average is total signed known ledger value divided by on-hand base-unit quantity. Receipt value is entered quantity times its unit rate; issues and positive adjustments use the existing average. PostgreSQL arbitrary-precision NUMERIC performs the authoritative arithmetic without a two-decimal intermediate rounding step. Recurring division follows PostgreSQL NUMERIC precision. Currency display alone uses decimal half-up rounding to two places. The 50 finished packets have unknown value; unknown movements conservatively keep subsequent positive balances unvalued (zero stock has zero value). Explicit revaluation is not available in this stage.

`npm run db:seed -- --inventory` creates the exact opening quantities and the 60 kg flour purchase, with an explicitly invented demo flour supplier. Run it again to check idempotency. Its checkpoint is: flour 160 kg / INR 6,900 / INR 43.125 per kg; oil 30 L; spice 5 kg; pouches 500; cartons 30; finished Murukku 50 packets with unavailable valuation. The `--inventory` flag stops before production; `--production` continues through the next checkpoint. The integration suite asserts each checkpoint value before testing later adjustments.

`npm test` includes database tests for posting/reruns, request idempotency, exact receipt value, weighted average, competing issues, insufficient stock, rollback, units, immutable records, reconciliation and permissions. Test files run sequentially because they reset the same isolated database. The browser suite adds opening/purchase form posting to Stage 1 regressions. Lists remain unpaginated and there is no purchase cancellation or explicit revaluation workflow; a posted correction is a separate adjustment with a reason. This is a single PostgreSQL database design, with no external accounting service.

## Stage 3 production

Production runs are drafts linked one-to-one to Stage 2 stock documents. Select a finished product, published BOM revision and planned batch count; the service scales each component and expected output by `planned batches / BOM standard batch size`. Enter total actual consumption, included damaged/wasted quantities, good packets and a variance tolerance (default 3%). Drafts can be edited with audit history and never affect stock. Admins and production supervisors can create/edit/post runs and add overheads. Owners and auditors can read; salesmen cannot access production.

Migrations 0006–0008 add `production_runs`, `production_inputs`, `production_cost_snapshots`, `production_overheads` and the `production_costs` view. BOM identity, revision, planned quantities, actual consumption, damage and tolerance are saved in each run snapshot. Posting preserves that snapshot and rejects later changes. It reuses the inventory `postDocument` service and the existing `post_stock_document` trigger, extended for production documents. All affected items are locked in deterministic order; actual material/packaging issues and the accepted finished output are posted together, or all roll back. Posting retries do not add movements. The finished receipt is valued at the sum of actual consumed material costs from the issue movements. A material cost snapshot is created in that same transaction.

Damage is a subset of total consumption, never an extra issue: benchmark pouches are 194 total, including 6 damaged and 188 used on good packets. Packaging status is not separately tracked; nine cartons cover 180 of the 188 good packets, so the remaining eight are assumed loose. No extra carton is fabricated. Every BOM component currently requires positive actual consumption and each run requires positive whole good output; zero-output failed runs and omitted/substituted components are not supported.

Variance is `(actual - planned) / planned * 100`, computed with decimal arithmetic. Alerts compare the absolute unrounded difference against tolerance using cross multiplication, so exactly 3% is not flagged. A zero expected quantity yields an undefined percentage and flags only nonzero actual use. The run preserves the tolerance used. Users may configure it per draft. Material and yield variance displays come from the saved snapshot.

Overheads are positive append-only events with category, reason, actor, time and idempotency key. They may be recorded before or after posting. Each addition records before/after run-cost information in the audit trail; run cost is material snapshot plus overhead events, divided by good output. Existing material snapshots and ledger entries never change. Overhead corrections/reversals and a formal costing-close workflow are not implemented. Draft material costs are unavailable until posting. Production computations use decimal strings and a 40-significant-digit Decimal context; authoritative stock valuation remains PostgreSQL NUMERIC. Currency display uses two-place half-up rounding.

Finished inventory valuation remains provisional: produced receipts carry material cost only. Subsequent overheads affect the run report, not those immutable receipts. The initial 50 packets remain explicitly unvalued; consequently aggregate finished inventory value stays unavailable even though this production run has a measurable cost. NOVA does not spread the run cost across all 238 packets or invent an opening value. A future financial close/revaluation design is needed before treating this as final financial inventory valuation.

The complete `--production` checkpoint (also asserted against isolated PostgreSQL in the test suite) is:

| Result                               | Value                                |
| ------------------------------------ | ------------------------------------ |
| Flour / oil / spice                  | 120 kg / 19.5 L / 3.8 kg             |
| Pouches / cartons / finished packets | 306 / 21 / 238                       |
| Yield / oil variance                 | -6% / +5%, both flagged              |
| Flour / oil / spice costs            | INR 1,725 / 1,470 / 240              |
| Pouches / cartons costs              | INR 485 / 135                        |
| Materials / overheads / total        | INR 4,055 / 1,800 / 5,855            |
| Cost per accepted packet             | INR 5,855 / 188, displayed INR 31.14 |

Other consumption variances are flour 0%, spice 0%, pouches -3% (at tolerance, no alert), and cartons -10% (flagged). The fixture uses the unchanged benchmark revision 1 and does not dispatch anything. Browser tests cover supervisor draft/posting, overhead addition and read-only auditor costing, alongside Stages 0–2 regressions. Lists remain unpaginated and costing is a run report rather than a statutory accounting report.

## Stage 4 sales and receivables

`/sales` provides mobile order entry/history, admin review with quantity/rate changes and reasons, invoice/PDF, full dispatch, partial payments and outstanding balances. Salesmen select only their territory customers, submit at server-validated price-list rates and read only their own orders/invoices. Admins write; auditors and owners read; production supervisors cannot access sales. Orders progress from submitted to approved, invoiced and dispatched, or are rejected/cancelled. Approved lines are immutable. Invoice snapshots preserve seller/buyer details, prices, description, HSN and taxes. Changes and financial/physical posting create actor/time audit events.

Migrations 0009-0010 add `sales_orders`, `sales_order_lines`, `invoices`, `invoice_sequences`, `dispatches`, `payments`, `payment_allocations`, `credit_notes` and the `invoice_balances` view. These follow the existing custom SQL migration pattern; metadata snapshots cover ORM-managed master tables. Financial records are append-only. Orders support multiple distinct products, one invoice and one full dispatch. There are no reservations: approval and invoice issue check on-hand under sorted item locks without reducing stock. Competing orders may consume stock before dispatch. Dispatch rechecks via the existing PostgreSQL stock posting function and locks, preventing negative balances. Its source invoice and quantities are validated. Errors roll back dispatch document, lines, ledger and order state. Dispatch alone reduces stock.

The benchmark assumes 5% GST, taken from the configurable product price list. The dedicated decimal tax service compares seller state and customer state (place of supply): matching states use CGST/SGST, otherwise IGST. Per line, taxable amount and each tax component are independently rounded half-up to paisa, then summed. Very small lines can therefore have two independently rounded half-paisa components. No authoritative financial calculation uses floating point. This exercise policy does not establish universal rates or statutory compliance. Admin must enter seller name, address, GSTIN, state and HSN, with optional customer GSTIN; the app supplies no invented seller default. Seller/HSN are entered per invoice, with one HSN for all lines. Registration verification, multiple HSNs, e-invoices and e-way bills are not implemented.

Financial years run April-March using the entered invoice date. A transactional PostgreSQL upsert serializes the sequence per year, producing `NOVA/2026-27/00001`. Sequence increments roll back on failed issue. Reissuing the same order returns its existing invoice. Server-side invoice PDFs preserve snapshots and enforce the same read authorization. The dependency-free text PDF renderer paginates long invoices; it currently supports ASCII text, replacing other characters with `?`. English demo data is supported.

Payments preserve date, reference, method, actor, amount and idempotency key. Allocations must sum exactly to payment amount, belong to the customer and not exceed outstanding. The API accepts multiple invoice allocations; the UI enters one invoice allocation at a time. Customer and invoice locks prevent concurrent over-allocation. Database triggers check ownership/balance and defer full-payment reconciliation until commit. There is no unapplied-credit or refund model. Full credit notes link to the immutable original invoice, reverse receivable and retain reason/actor/time. Invoices with payments cannot be credited until a refund workflow exists. Credits never reverse physical dispatch. Partial credits, partial dispatch, returns, offline capture and pagination are not implemented.

Dispatch uses existing weighted-average valuation. Opening finished packets remain unvalued, so benchmark cost of goods sold and aggregate remaining inventory value stay explicitly unknown. Stage 3's known run cost is preserved; gross profit is not fabricated.

`npm run db:seed -- --sales` continues the earlier checkpoints through the full sales benchmark and is rerunnable on unchanged demo data. Its manufacturer, GSTIN, address and HSN are explicitly invented exercise-only fixtures, never application defaults or real billing identities. It asserts 88 finished packets, INR 7,875 invoice, INR 4,000 paid, INR 3,875 outstanding and 32-packet shortage. Tax on INR 7,500 is INR 187.50 CGST plus INR 187.50 SGST. Distributor B remains submitted; interstate preview shows IGST. PostgreSQL tests cover the benchmark, concurrency, permissions, immutability, numbering, credits, allocations and rollback. Chromium covers mobile salesman order through admin approval/invoice/PDF/dispatch/payment and auditor read-only access.
