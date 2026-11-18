# NOVA

NOVA is an Order-to-Audit manufacturing management system for the NIT Tiruchirappalli internship assessment. It connects master data and published BOMs to purchasing, an immutable stock ledger, production costing, sales, sample GST invoices, dispatch, collections, reports and an owner dashboard.

**Local demonstration only. Public production deployment is blocked.** Dependency audit currently fails with 16 high affected-package entries overall and five in the production graph, stemming from Picomatch advisory GHSA-fc5q-39xc-vjpf. The [security assessment](#dependency-risk-assessment) records versions, dependency paths, reproduced denial of service, exposure and mitigations. Functional tests passing does not clear this finding.

Submission artifacts: [two-page architecture design note](output/pdf/nova-design-note.pdf) and [recording plan, interview notes and submission checklist](docs/submission-guide.md). No demonstration video has been recorded by this project workflow.

## Architecture and repository

| Component               | Implementation and reason                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application             | Next.js 16 App Router, React 19 and strict TypeScript keep pages, APIs and services in one application.                                                                            |
| Database                | PostgreSQL 17 provides transactions, NUMERIC arithmetic, row locks, constraints and immutable-record triggers. Drizzle supplies typed master queries and versioned SQL migrations. |
| Identity and validation | Better Auth stores credential hashes and sessions in PostgreSQL; Zod validates service inputs. Role and territory checks run on the server.                                        |
| Calculations            | Decimal.js handles service calculations; PostgreSQL NUMERIC performs authoritative stock valuation. Decimal strings cross financial boundaries.                                    |
| Validation              | Vitest/PostgreSQL integration tests, Chromium Playwright flows, HTTP smoke checks, ESLint, Prettier and TypeScript. Exact versions are pinned in the lockfile.                     |

```text
src/app/               Workspace pages and authenticated API routes
src/components/        Business forms, tables and navigation
src/modules/           auth, catalog, inventory, production, sales,
                       billing, payments and reporting services
src/lib/               Database connection/schema, units and text PDF renderer
drizzle/               Migrations 0000-0013, SQL guards/views and metadata
scripts/               Migrations, fictional fixtures, smoke/fresh-system checks
tests/                 PostgreSQL regressions and Chromium browser flows
docker/                First-volume test-database initialization
.github/workflows/     Independent functional validation and blocking audit jobs
docs/                  Recording, interview and manual submission guide
output/pdf/            Two-page design note
```

Services own authorization and transaction boundaries. Inventory and financial SQL objects are maintained by custom migrations and parameterized SQL; ORM metadata snapshots cover the master tables, not the entire database. Derived views supply balances: there is no editable stock balance cache. No queue, Redis, external accounting service or microservice is used.

## Requirements and configuration

Use Node.js **24**, its npm, Docker with Linux containers and Docker Compose supporting `--wait`. The default loopback ports are 5432 for PostgreSQL, 3000 for the app and 3100 for browser tests. The first installation needs registry/image network access. Docker images are pinned by digest; npm installs from `package-lock.json`.

Copy `.env.example` to `.env` (`cp .env.example .env` works in PowerShell and POSIX shells), then edit it locally:

| Variable                        | Local configuration                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`             | Choose a local alphanumeric database password. Compose constructs a URL from it.                                                                           |
| `DATABASE_URL`                  | Match that password, database `nova` and the host database port.                                                                                           |
| `TEST_DATABASE_URL`             | Match that password and port, but use the separate database `nova_test`. Never use the application database.                                               |
| `BETTER_AUTH_SECRET`            | Random value of at least 32 characters. Generate locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.             |
| `BETTER_AUTH_URL`               | Exact browser origin, normally `http://localhost:3000`.                                                                                                    |
| `NOVA_DB_PORT`, `NOVA_APP_PORT` | Optional host ports, default 5432/3000. Bindings remain `127.0.0.1`. If changed, update both database URLs and the browser origin.                         |
| `SMOKE_BASE_URL`                | Optional smoke-test origin in `.env`; set it to the same origin as `BETTER_AUTH_URL` when using an alternate app port. Default is `http://localhost:3000`. |
| `NOVA_ALLOW_DEMO_SEED`          | Set `true` only for this local fictional-data demonstration.                                                                                               |
| `DEMO_PASSWORD`                 | Choose a local password of 12-128 characters for the seeded accounts. No shared password is committed.                                                     |
| `NOVA_ALLOW_DEMO_INVOICES`      | Set `true` for the sample-invoice workflow; the template defaults to `false`.                                                                              |

`.env` is ignored by Git and excluded from Docker builds. Keep it and database backups private. Compose passes the database URL, authentication secret/origin and demo-invoice flag to the app; it does not pass the seed password. Host-side seed commands load the private `.env`. Demo seeding refuses `NODE_ENV=production` and requires explicit opt-in. This is local demo preparation, not a production bootstrap procedure.

## Start a local Docker demonstration

Run from the repository root. Stop on a failed setup command; do not continue with a partially initialized database. Use a new Compose project name for a fresh demonstration, and keep that name in every Compose command. The example below uses `nova-demo`.

```sh
npm ci
docker compose -p nova-demo config --quiet
docker compose -p nova-demo up -d --wait db
npm run db:migrate
npm run db:migrate:test
npm run db:seed -- --sales
npm run db:seed -- --sales
docker compose -p nova-demo up --build -d --wait app
npm run test:smoke
```

Open <http://localhost:3000/login> (or the configured app port). For an alternate app port, set `SMOKE_BASE_URL` to the same browser origin before running the smoke check. In the smoke script, it defaults to `http://localhost:3000`.

These commands seed the complete benchmark, including the sample seller profile, invoice, dispatch and payment. A fresh named volume creates `nova` and `nova_test`; migrations also run before container startup. Only fictional records are used. On unchanged demo data, the second seed reuses request keys and does not post stock or payments again. Seeds preserve existing edits and passwords; they are not reset commands. A password change in `.env` will not reset an existing seeded user.

The checkpoint invoice and payment use **17 November 2026**; stock/production postings use the seed's actual date. To reconcile the complete fixture later, set financial reports to **demo** scope and include 17 November 2026 through the seed's business date in the period/as-of filters. The default current-month range may not include the fixture invoice. For a manual recording, use the actual local transaction dates consistently.

For a recording that shows each posting, seed **masters only** with `npm run db:seed` on a fresh demonstration volume instead. The [recording guide](docs/submission-guide.md) contains the exact opening balances, production inputs and shot sequence. Do not mix a completed `--sales` fixture with manual replay of the same benchmark.

| Seed option    | Checkpoint created on a fresh database                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| No option      | Users, roles, territories, customers, material/product masters, price and published BOM only |
| `--inventory`  | Masters, opening inventory and 60 kg flour purchase                                          |
| `--production` | Inventory checkpoint plus production and labour/utilities                                    |
| `--sales`      | Full production, sales, sample billing, dispatch and collections benchmark                   |

`docker compose -p nova-demo ps` shows readiness. `docker compose -p nova-demo logs app` shows sanitized startup/migration errors. `docker compose -p nova-demo down` stops services and retains data. Changing environment passwords does not change credentials inside an existing PostgreSQL volume. Use a new project/unused ports for a fresh review rather than deleting working data. Keep the app and database on loopback; do not publish them through a tunnel or public host.

For host development after database setup, use `npm run dev -- --hostname 127.0.0.1`. For a host production build, use `npm run build` then `npm run start -- --hostname 127.0.0.1`. Stop the Compose app first if it occupies the same port; leave PostgreSQL running.

## Demo accounts and roles

All initial accounts use the **local `DEMO_PASSWORD` chosen above**. They are fictional test accounts only. One role is assigned per user. Admins can create users/reset passwords; updates invalidate that user's sessions. Owners and auditors have read-only business access.

| Account                   | Permissions                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `salesman.a@example.test` | Retailer A in the assigned Tamil Nadu territory; submit and read own orders/invoices and permitted reports.                                      |
| `salesman.b@example.test` | Distributor B in the assigned Karnataka territory; same isolated salesman access.                                                                |
| `admin@example.test`      | All masters, user/territory administration, opening/purchase/adjustment posting, BOMs, production, sales review, billing, dispatch and payments. |
| `production@example.test` | Suppliers/materials/BOM publication, purchases and production/overheads; inventory and production reports. No sales access.                      |
| `auditor@example.test`    | Read business masters, stock, production, sales, reports and dashboard; no posting.                                                              |
| `owner@example.test`      | Read business masters, stock, production, sales, reports and dashboard; no posting.                                                              |

Sessions are stored in PostgreSQL, expire after eight hours and have a one-hour update interval; cookie session caching is disabled. Public signup is disabled. Auth exposes login, session lookup and logout only. Password hashes/session tokens are excluded from master responses and audit data. Salesman history and PDF access require both order ownership and current customer territory assignment.

## Business rules

**Inventory.** Opening, purchase and adjustment documents begin as editable drafts. Posting locks the document and affected item rows in sorted ID order, validates units/available quantity, inserts immutable movements and appends the audit event in one transaction. Failure rolls everything back; repeat posting returns the original document. Changed payloads cannot reuse request keys. Corrections use separately reasoned adjustment documents, never edited balances. Admin posts all categories; production supervisors post purchases and production.

Quantities use base grams, millilitres, pieces and packets. Kilograms/litres convert by 1,000 within their dimension; carton-to-packet conversion requires the product's explicit capacity. Pieces and packets are not interchangeable. Moving weighted average is signed known ledger value / on-hand base-unit quantity; receipt value is entered quantity x entered unit rate. Issues/adjustments use the existing average. PostgreSQL NUMERIC does not round intermediate stock values to paisa; recurring division follows its numeric precision. Unknown opening value conservatively propagates to positive balances and subsequent issue costs; zero stock has zero value. Explicit revaluation is unavailable.

**BOM and production.** Publishing a complete revision locks the product and serializes its version; exactly one revision is active. Published contents cannot change. A run selects a published revision and scales each component by planned batches / standard BOM batch size. Saved snapshots retain planned/actual quantities, damaged subset, good output, tolerance and variance. Posting reuses the same stock engine to issue all actual inputs and receive good packets atomically. Damaged packaging is already included in total consumption, not issued twice.

Variance is `(actual - planned) / planned x 100`. Alerts use the absolute unrounded difference and a default 3% tolerance: exactly 3% is not flagged. Zero expected quantity has an undefined percentage and flags only nonzero actual use. Material snapshots come from posted issue costs; append-only labour/utilities events add to run cost. Run cost / good output uses a 40-significant-digit Decimal context and displays half-up to two decimal places. Finished receipts include **material cost only**; later overheads change the run report, never those immutable receipts.

**Sales and accounting.** A salesman submits whole-packet quantities at server-validated price-list rates. Admin reviews stock and may revise submitted quantities/rates with a reason before approval. Approved lines are frozen. Orders have one invoice and one full dispatch; there are no reservations. Approval and invoice issue check stock without deducting it. Dispatch rechecks under item locks, then posts the source-linked immutable ledger issues. Competing dispatches cannot create negative stock.

Invoice snapshots preserve seller/buyer details, product descriptions, HSN, quantities, prices and taxes. Seller profiles and per-product HSN settings are stored separately for `demo` and `real` modes in PostgreSQL. Real issue requires validated seller fields, state code/GSTIN format/checksum and configured HSN; local checks do not verify an active registration. Current supported supply states are Tamil Nadu and Karnataka. Tax rates are configurable; 5% is an exercise assumption, not a verified statutory product rate. Same-state supply uses CGST/SGST and interstate supply uses IGST. Taxable amount and each tax component are independently rounded half-up per line to paisa, then summed.

Sample issue is a separate action requiring `NOVA_ALLOW_DEMO_INVOICES=true`. Only its fictional profile is seeded, using deliberately invalid `DEMO-NOT-A-GSTIN`. Every sample PDF/interface carries **SAMPLE INVOICE — NOT VALID FOR TAX PURPOSES**. Real profiles are never seeded. Numbering is transactionally serialized by April-March invoice financial year: `SAMPLE/2026-27/00001` versus `NOVA/2026-27/00001`, with separate counters. Failed issuance rolls back its sequence update; retries return the existing invoice. Historical invoices classified as demo by migration retain their original immutable numbers/snapshots and render the sample warning.

Payments are immutable records with positive amounts, date, reference, method, actor and request key. Allocations must exactly equal the payment amount, belong to that customer and stay within invoice outstanding. Customer/invoice locks and deferred PostgreSQL reconciliation prevent concurrent over-allocation or appended allocations exceeding the original payment. The API supports multiple invoice allocations; the UI records one at a time. Full credits preserve the original invoice, require a reason, reverse receivables and never return physical stock. Paid invoices cannot be credited without a future refund workflow.

**Reports.** Sales, customer/product totals, GST review, purchases, current/historical stock, ledger, production, consumption/variance, payments, receivables, customer balances, ageing and orders use authorized SQL in read-only REPEATABLE READ transactions. Dashboard metrics use the same services and current database business date. Business dates use **Asia/Kolkata**; inclusive timestamp periods become local midnight through exclusive next-day midnight. Dates satisfy `from <= to <= asOf`. Stock rollforward extends through as-of; receivables include all eligible invoices through as-of even when older than the selected period. Product-filtered collections select whole matching invoices because allocations are not per product.

Financial reports default to **real scope**; explicitly select **demo scope** to see the benchmark invoice/collections. Physical stock, purchasing, production and orders are shared operational records. Salesmen see only permitted own/customer reports; supervisors see stock/ledger/production/consumption; admin, owner and auditor see business-wide reports/dashboard. Screens paginate 50 rows; totals/exports use the full permitted result. More than 5,000 rows is rejected, with a ten-second reporting statement limit. CSV quotes/escapes cells and protects formula-like text; PDFs paginate with headers. Current PDFs support ASCII and the sample-notice em dash; other characters render as `?`. Exports are review documents, not government returns.

## Benchmark results

The fresh-database verifier executes masters, opening, purchase, production, overheads, Retailer A order/approval/sample invoice/dispatch, Distributor B's blocked order, payment and reports in that order.

| Result                                 | Exact benchmark outcome                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Flour purchase / moving average        | 60 kg x INR 45 = INR 2,700; after receipt 160 kg / INR 6,900 = INR 43.125/kg                    |
| Final flour / oil / spice              | 120 kg / 19.5 L / 3.8 kg                                                                        |
| Final pouches / cartons                | 306 / 21                                                                                        |
| Production                             | 200 expected, 188 accepted; yield -6%, oil use +5%, both flagged                                |
| Material / labour / utilities          | INR 4,055 / 1,200 / 600                                                                         |
| Run cost / per good packet             | INR 5,855 / 188; displayed INR 31.14                                                            |
| Finished stock before / after dispatch | 50 + 188 = 238; 238 - 150 = 88 packets                                                          |
| Retailer A                             | 150 x INR 50 = INR 7,500 taxable                                                                |
| Assumed intra-state GST / total        | CGST INR 187.50 + SGST INR 187.50; invoice INR 7,875                                            |
| Distributor B                          | 120 requested - 88 available = 32 short; remains submitted, no invoice/dispatch/stock deduction |
| Collection / outstanding               | INR 4,000 / INR 3,875                                                                           |
| Finished stock value / dispatch cost   | Unavailable because the opening 50 packets have no historical value; no profit is fabricated    |

Actual consumption is flour 40 kg, oil 10.5 L, spice 1.2 kg, pouches 194 (including six damaged) and nine cartons. The BOM allows 40 kg / 10 L / 1.2 kg / 200 pouches / ten cartons for 200 expected packets. Pouch variance is -3% (at tolerance, no alert); carton variance is -10% (flagged). Nine cartons cover 180 good packets; eight are assumed loose. No extra carton is invented. A separate integration test verifies an eligible Karnataka invoice uses IGST only; the shortage order does not issue one.

## Validation and schema changes

Keep the application/test URLs separate. These commands exercise the same toolchain as CI; test commands **reset only the explicitly configured `_test` database** and must not run against business data. Install Chromium once.

```sh
npm run db:migrate
npm run db:migrate:test
npm run db:seed:test
npm run db:seed:test
npm run verify:system
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
docker compose -p nova-demo up --build -d --wait app
npm run test:smoke
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

`npm ci` is the clean install step shown above. Both audit commands are expected to **fail** for the documented advisory; record their nonzero status rather than hiding it. Functional validation does not override that release gate. Vitest files run sequentially against the same isolated database. Playwright resets that database and starts a separate production server bound to loopback on port 3100. Smoke checks use the Docker app and seeded local password; they do not create business documents.

`verify:system` creates a uniquely named disposable database through `TEST_DATABASE_URL`, migrates twice, runs/reruns the complete benchmark and generates every report/CSV/PDF, then drops only that database. The local role needs database-creation permission. Optional `-- --measure` builds synthetic load only in that disposable database, measures the allocation index and 5,000-row exports, and checks 5,001-row rejection. Stage 6 local measurements were about 677 ms versus 6.5 ms for the allocation lookup, 419 ms for the report, 36 ms for CSV and 51 ms for PDF. These are local synthetic timings, not throughput/peak-memory guarantees.

Generate future ORM migrations with `npm run db:generate -- --name meaningful_name`, review/commit the SQL and metadata, and version custom SQL constraint changes as well. Never edit an applied migration. The workflow keeps a separate **blocking dependency-audit job** and an independent functional job, read-only token permissions and 15/30-minute limits. No Git remote is configured, no push is authorized and no real GitHub Actions pass is claimed.

Stage 7 verification on 18 November 2026 used a new Compose project/volume on loopback ports 15432/3300, with independently generated private credentials and no existing application data. Clean `npm ci`, application migrations twice, test migrations, full benchmark seed twice, test seed twice, lint, formatting, type checking, **58 tests across eight files**, **six Chromium flows**, the production build, Docker rebuild/readiness and HTTP smoke checks passed. A separate disposable-database system check reconciled the full benchmark. The fresh Docker app also verified all benchmark quantities/costs/taxes/receivables through authenticated APIs, all **14 reports with 14 CSV and 14 PDF exports**, and empty real financial scope. The design note was parsed and visually checked at exactly two pages; document links were checked locally.

Configuration validation rejected a missing authentication secret and confirmed both published service ports stayed on `127.0.0.1`. When selecting a separate environment file for validation, use `DOTENV_CONFIG_PATH` without forcing `DOTENV_CONFIG_OVERRIDE`: subprocess failure tests intentionally supply invalid connection values which must take precedence. Final full and production audits both exited **1**, retaining **16 and five high entries** respectively. Clean installation also emitted upstream deprecation warnings for ESLint 9 and legacy esbuild-kit packages; Stage 7 did not replace the pinned toolchain or weaken CI. No remote CI pass or recorded video is claimed.

## Backup, limitations and release prerequisites

The local Compose PostgreSQL role owns schema/migrations and is not a restricted production runtime role. Backups include credential hashes/session data: keep them outside Git, restrict access and protect off-host copies. The following PowerShell sequence copies a custom-format backup and restores it into a **new, empty** database. Stop if any command fails; choose another unused restore name if it already exists.

```powershell
New-Item -ItemType Directory -Force backups
docker compose -p nova-demo exec -T db pg_dump -U nova -d nova --format=custom --file=/tmp/nova-backup.dump
if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
docker compose -p nova-demo cp db:/tmp/nova-backup.dump ./backups/nova-backup.dump
docker compose -p nova-demo exec -T db createdb -U nova nova_restore_check
if ($LASTEXITCODE -ne 0) { throw 'Choose a new empty restore database' }
docker compose -p nova-demo exec -T db pg_restore -U nova -d nova_restore_check --exit-on-error /tmp/nova-backup.dump
if ($LASTEXITCODE -ne 0) { throw 'Restore failed' }
```

Compare ledger, invoice snapshots, payment totals, audit counts and migration versions after a restore before planning an operator-controlled switchover. Stage 6 tested a disposable restore and matched ledger/invoice/payment checksums and audit count; it did not overwrite working data. The backup directory is excluded from Git and Docker builds.

Known limits: no production bootstrap/password recovery/email delivery/account-deactivation workflow; no stock reservations, partial dispatches, partial credits, refunds or physical returns; no zero-output failed runs, omitted/substituted BOM inputs or overhead reversals; no explicit revaluation/financial close; no closed reporting periods, historical order-state replay, purchase-tax reconstruction, e-invoices/e-way bills or GST-return integration. Master/operational lists remain unpaginated; exports are synchronous, in memory and capped as above. One product represents one pack size; a 500 g pack needs its own product, price, HSN setting and published BOM. Existing 200 g identity/history must remain intact.

Audit events store actor/action/document/time and before/after data in the same transaction as the business change and are immutable under application database guards. A privileged database owner can bypass guards; this is not an external tamper-proof audit system. Eight-hour server sessions, origin checks, a 64 KiB JSON limit, sanitized database errors, non-root app container and response headers are implemented. Account sign-in counters use atomic PostgreSQL HMAC keys (ten attempts per account per 60 seconds); Better Auth's separate IP/general counters remain in process memory and depend on correct proxy/client-IP handling. Distributed denial-of-service protection is not supplied.

Before any public release: remediate the dependency advisory in both npm and Next's bundled copy and rerun security/regressions; establish production credentials/bootstrap, restricted runtime/migration roles, TLS/proxy/IP handling and rate limits, protected backups and a recovery procedure; review real billing/tax configuration and deployment-specific security. None of this authorizes public deployment. The local assessment and functional validation do not establish statutory or security compliance.

### Dependency risk assessment

The follow-up audit reproduces **16 high npm findings from one advisory**, not 16 independent vulnerabilities. The root cause is Picomatch's repeated-extglob parser, [GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Ancestor packages inherit npm's high severity through their dependency edges. Inventory below is from the installed packages, lockfile, `npm ls`, `npm explain` and both full/production npm audits.

For compact paths, **A** means root dev dependency `eslint-config-next@16.4.6`; **T** means `A > typescript-eslint@8.73.0`; **V** means root dev dependency `vitest@5.1.0`, which also satisfies the production dependency `better-auth@1.7.25`'s optional Vitest peer. These are representative paths through the deduplicated dependency graph; shared nodes can have several parents.

| npm-flagged package                  | Installed version | Dependency path / immediate parents                                                                                             | Included by production audit                |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| eslint-config-next                   | 16.4.6            | A (direct dev dependency)                                                                                                       | No                                          |
| @next/eslint-plugin-next             | 16.4.6            | A > @next/eslint-plugin-next                                                                                                    | No                                          |
| fast-glob                            | 3.3.1             | A > @next/eslint-plugin-next > fast-glob                                                                                        | No                                          |
| micromatch                           | 4.0.8             | A > @next/eslint-plugin-next > fast-glob > micromatch                                                                           | No                                          |
| typescript-eslint                    | 8.73.0            | T                                                                                                                               | No                                          |
| @typescript-eslint/eslint-plugin     | 8.73.0            | T > @typescript-eslint/eslint-plugin                                                                                            | No                                          |
| @typescript-eslint/parser            | 8.73.0            | T > @typescript-eslint/parser; also peer of eslint-plugin                                                                       | No                                          |
| @typescript-eslint/type-utils        | 8.73.0            | T > @typescript-eslint/eslint-plugin > @typescript-eslint/type-utils                                                            | No                                          |
| @typescript-eslint/utils             | 8.73.0            | T > eslint-plugin / type-utils > @typescript-eslint/utils                                                                       | No                                          |
| @typescript-eslint/typescript-estree | 8.73.0            | T > parser / type-utils / utils > typescript-estree                                                                             | No                                          |
| eslint-import-resolver-typescript    | 3.10.1            | A > eslint-import-resolver-typescript                                                                                           | No                                          |
| vitest                               | 5.1.0             | V; better-auth > optional peer vitest                                                                                           | Yes, optional peer classified as production |
| vite                                 | 8.3.8             | V > vite (peer); V > @vitest/mocker > vite (optional peer)                                                                      | Yes                                         |
| tinyglobby                           | 0.2.17            | V > tinyglobby; vite > tinyglobby; T > typescript-estree > tinyglobby; A > import-resolver-typescript > tinyglobby              | Yes; shared with dev tooling                |
| fdir                                 | 6.5.0             | tinyglobby > fdir                                                                                                               | Yes                                         |
| picomatch                            | 2.3.2 and 4.0.7   | 2.3.2: micromatch > picomatch. 4.0.7: V > picomatch; vite > picomatch; tinyglobby > picomatch and tinyglobby > fdir > picomatch | 4.0.7 paths: yes; 2.3.2: dev                |

There are four npm-reported physical Picomatch copies: `node_modules/picomatch` (2.3.2), and `node_modules/vitest/node_modules/picomatch`, `node_modules/vite/node_modules/picomatch`, `node_modules/tinyglobby/node_modules/picomatch` (4.0.7). The production-only audit reports five package names: Vitest, Vite, Tinyglobby, Fdir and Picomatch. This classification does not mean the Vitest runner is executed during normal authentication. In Better Auth, the inspected Vitest import is in `dist/test-utils/test-instance.mjs`; NOVA imports the authentication and Drizzle adapter entries, never `better-auth/test-utils`.

**Upgrade/override checks (rechecked 18 November 2026):** the registry's latest Picomatch remains 4.0.7; the advisory lists no patched release. Next.js and ESLint-config-next remain at 16.4.6. Vitest 5.1.1 is now available: an isolated lockfile upgrade from the locked 5.1.0 still resolved Picomatch 4.0.7 and retained all 16 high findings. A separate temporary-copy experiment overriding Fast-glob 3.3.1 with compatible patch 3.3.3 retained Micromatch 4.0.8 and Picomatch 2.3.2 and still reported all 16 findings. `npm audit fix --dry-run --ignore-scripts` changed zero packages and left the findings open. Forced Vitest/ESLint downgrades suggested by npm were not executed. Overriding Picomatch 2.x consumers to 4.0.7 would cross a major boundary while still selecting an affected version, so it is not a safe fix. An isolated `npm ci --omit=dev --omit=peer --ignore-scripts` experiment still installed Vitest/Tinyglobby/Picomatch; pruning with those flags alone is not claimed to remove the risk. The repository's dependency versions and lockfile were not changed by these experiments. The advisory's linked open PR 194 concerns a different extglob parsing issue; it is not treated as a reviewed security patch.

**Additional bundled copy:** Next.js 16.4.6 ships `next/dist/compiled/picomatch`, whose package metadata contains no version. It is outside the separately reported npm package nodes. Bounded subprocess checks reproduced the same problematic behavior in this bundled matcher. Ordinary npm overrides of `picomatch` would not replace this vendored file; a future fix must also verify the Next.js bundle.

**Executed exploitability checks:** in isolated local child processes, `+(*a)` against a failing 25-character subject took approximately 0.38-0.44 seconds. At 41 characters it exceeded a 1.5-second child-process timeout for both installed npm versions and Next's bundled matcher; `+(*)b` also timed out with a 33-character subject. Each child was terminated at the timeout. These probes did not run against the live application or external systems. They confirm a real denial-of-service primitive rather than an audit-only version match; a short pattern/subject length limit alone is not a reliable mitigation.

**NOVA reachability:** application/services contain no imports or calls to Picomatch/Micromatch/Tinyglobby/Fast-glob and accept no user-defined glob configuration. Customer/product/item IDs become parameterized SQL values, not patterns. An authenticated report request with a glob-like customer ID returned an empty result (HTTP 200, measured 275 ms). Current built API traces contain none of the npm-reported package copies; tracing alone is not proof of complete runtime non-reachability. Next's image helpers do import its bundled matcher, but their patterns come from trusted configuration. NOVA defines neither local nor remote image patterns and uses no `next/image` component. Instrumenting the current default local/remote matchers compiled zero globs, and the live image endpoint rejected an unconfigured remote image with HTTP 400. No attacker-controlled path to the vulnerable pattern parser was identified in the reviewed NOVA routes/configuration. That is a bounded exposure assessment, not a claim that the bundled code is safe or that future configuration changes cannot expose it.

**Risk and recommendation:** current HTTP exposure is assessed as low because the attacker cannot supply the dangerous pattern under the reviewed configuration; the underlying primitive remains high severity and is physically shipped in the current Docker image. Build/test/lint tooling is also exposed if unsafe glob patterns/configuration enter the repository. Keep source/configuration trusted, review any image/glob feature changes, avoid exposing dev/test servers, retain loopback-only Compose ports and the blocking audit job. CI jobs now have 15/30-minute resource timeouts. Where application-owned glob matching is ever introduced, disable extglobs/reject unsupported pattern syntax before matching; that option cannot be assumed to protect third-party internal calls. A traced minimal runtime image could remove unused test/lint packages but would not by itself fix Next's bundled matcher; no deployment redesign is claimed here.

Follow-up validation on 18 November 2026 passed test-database migrations, lint, formatting, type checking, all 58 automated tests across eight files, all six Chromium flows, the production build, fresh-database benchmark/report/export reconciliation, Docker rebuild/readiness and HTTP smoke checks. The app still runs as UID 1000. Both dependency audits exited 1: full audit retained 16 high findings and `--omit=dev` retained five. Candidate dependency upgrades were lockfile-only audit experiments in a temporary copy; they were not applied to or tested as NOVA's installed application toolchain. Functional checks do not clear the security finding.

**Stage 6 finalization exception:** the reviewed changes are authorized for commit with this documented, unresolved dependency-security finding. This exception approves the Stage 6 commit only; **public production deployment remains blocked** until maintained, compatible fixes cover both npm and bundled copies and the audit/regressions are rerun. A private, isolated internship demonstration still requires explicit, time-bounded owner risk acceptance of the reviewed configuration; it is not a clean security release. The full and production audits remain failing and the CI audit gate remains blocking. The isolated dependency-test folder stays outside the repository and is excluded from the commit.
