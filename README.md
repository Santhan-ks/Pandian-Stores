# NOVA

NOVA is an Order-to-Audit manufacturing system for the NIT Tiruchirappalli internship assessment. Stage 1 implements credential login, five roles, territory-scoped customers, suppliers, materials, products and pack sizes, prices, unit conversions, and published BOM revisions. Stage 0's PostgreSQL health endpoint remains available. Stock movements, purchases, production posting, invoices, payments and reports are not implemented.

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

No opening stock or transaction is seeded. The full benchmark's stock, tax invoice, variance and costing acceptance results remain unimplemented; no results are claimed for them.

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

`npm test` resets Stage 1 tables only in the explicitly configured isolated database whose name ends in `_test`, then seeds fixtures and tests authentication, expiry, authorization, customer isolation, validation, SQL constraints, conversions, BOM preservation and seed reruns. Never point `TEST_DATABASE_URL` at an application database. Playwright uses this same test database with a separate server on port 3100; run `npm test` before it. Its mobile Chromium flows cover login/logout, supplier creation, BOM revision and auditor restrictions. `test:smoke` checks the running app at `SMOKE_BASE_URL` (default localhost:3000), using the seeded local demo credentials; it tests HTTP permissions, territory isolation and logout without creating business data.

The CI workflow runs these checks against a PostgreSQL service. To evolve the schema, run `npm run db:generate -- --name meaningful_name`, review its SQL and commit the migration; custom constraint migrations must also be versioned. Never edit an already applied migration.

## Current limitations

This stage is a local assessment foundation, with one app instance. Auth rate limiting is held in process memory; multiple instances would need shared rate-limit storage. HTTPS and deployment-specific secrets are required outside localhost. There is no email delivery, password recovery, account deactivation, or production bootstrap command. Master lists are not paginated. Prices retain audit history but do not yet have effective dates or customer-specific price lists. Users have one assigned role. BOMs are published immediately rather than saved as drafts. Business benchmark modules, exports, the final design note and the submission walkthrough belong to later stages.
