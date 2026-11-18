# Pandian Stores

Pandian Stores is a working prototype for the **NIT Tiruchirappalli Order-to-Audit manufacturing assessment**. It follows a small snack manufacturer's daily work: buy ingredients, make a batch from a recipe, accept a salesman's order, issue an invoice, dispatch stock, collect payment and prepare the auditor's reports.

The application uses a real PostgreSQL database. Stock comes from a ledger of posted movements, and invoices, production postings and payments retain their history.

**For evaluation, use the local demonstration at [http://localhost:3000/login](http://localhost:3000/login).** It contains fictional business data and clearly marked sample invoices. Public production deployment remains blocked by the security and operational limitations described below.

## Start here

- [Open an already configured demo](#open-an-already-configured-demo)
- [Demo logins and roles](#demo-logins-and-roles)
- [Install on another computer](#install-on-another-computer)
- [Understand the screens](#understand-the-screens)
- [Walk through the assessment benchmark](#walk-through-the-assessment-benchmark)
- [Check the expected results](#expected-benchmark-results)
- [Run the checks](#run-the-checks)
- [Read the limitations and security status](#known-limitations)
- [Prepare the submission](#submission-checklist)

## Open an already configured demo

### On Windows

Double-click **[Start-Pandian-Stores.cmd](Start-Pandian-Stores.cmd)** in the project folder.

A terminal opens, starts Docker Desktop if its engine is stopped, starts the demo containers, waits for the database and app to become healthy, and opens the login page in your default browser. Leave time for Docker Desktop to finish starting. The terminal stays open so you can read any error.

You can close the terminal after the login page opens. The containers keep running in the background. To stop them while keeping the database:

```powershell
docker compose -p pandian-stores stop
```

The launcher uses the **`pandian-stores`** Compose project, which is also used in the setup commands in this README. It reuses the existing database. It does not install dependencies, rebuild the app or load/reset benchmark records. Complete the first-time setup below before using it on a new computer.

If your existing installation uses another project name, set `COMPOSE_PROJECT_NAME` in the terminal before launching, and use that same name in every Compose command:

```powershell
$env:COMPOSE_PROJECT_NAME = 'your-existing-demo-project'
.\Start-Pandian-Stores.cmd
```

For an automated startup without the final keypress, use `Start-Pandian-Stores.cmd --no-pause`.

### From a terminal

Run these commands from the project folder:

```sh
docker compose -p pandian-stores up -d --no-build --wait db app
docker compose -p pandian-stores ps
```

Then open [http://localhost:3000/login](http://localhost:3000/login). Both `app` and `db` should be healthy.

The separate HTTPS installation at `https://pandian.localhost:3443` is a hardened deployment rehearsal. It has its own database and generated administrator credentials. Use the HTTP demo above to review the seeded assessment workflow.

## Demo logins and roles

**Password for all six local demo accounts: `123456123456`**

| Role                  | Email                     | What to try                                                                             |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| Factory Admin         | `admin@example.test`      | Review orders, issue sample invoices, dispatch stock, record payments and manage setup. |
| Production Supervisor | `production@example.test` | Record material purchases, manage recipes, post production and add run overheads.       |
| Salesman A            | `salesman.a@example.test` | Place an order for Retailer A in Tamil Nadu and follow its status.                      |
| Salesman B            | `salesman.b@example.test` | Place an order for Distributor B in Karnataka and see the stock shortage.               |
| Owner                 | `owner@example.test`      | Review the dashboard, reports, costs, stock and outstanding balances.                   |
| Accountant / Auditor  | `auditor@example.test`    | Inspect records and download reports without changing business data.                    |

There are **five roles and six demo accounts**, with two separate salesman logins for isolation checks. These accounts and this published password are for fictional local demonstrations only. They do not grant access to the hardened installation.

### How access works

**Factory Admin** has the broadest operational access: users, territories, customers, suppliers, products, prices, materials, BOMs, stock, production, sales and billing settings. Admins approve/reject orders, post dispatches and record collections.

**Production Supervisor** can work with suppliers, raw/packaging materials, BOMs, purchases, production and overheads. Production reports cover stock, ledger, production and consumption/variance. This role cannot enter the sales/billing workflow or manage users.

**Salesmen** can view products/prices, select customers assigned to their current territory, submit orders and review their permitted sales and receivables reports. They cannot approve orders, issue invoices, dispatch stock or record payments. Salesman A cannot access Salesman B's orders or invoice PDFs. Access to sales history requires both order ownership and a current customer-territory assignment.

**Owner** can read the business-wide dashboard, records and reports. The owner can delete eligible unused setup records and drafts, but cannot create/edit business records or approve/post transactions.

**Accountant / Auditor** has read-only business access and export access. This account cannot create, edit, delete or post transactions.

The menu changes with the role, and the server checks permissions again for every operation. Use **Sign out** before switching accounts. Sessions expire after eight hours. An administrator can change a user's password in **Users**; doing so revokes that user's sessions. Changing `DEMO_PASSWORD` in `.env` does not reset existing accounts.

## Install on another computer

### Requirements

Install:

- **Node.js 24** and its npm.
- **Docker Desktop with Linux containers**, or Docker Engine with Compose.
- Git, if cloning the repository.
- Internet access for the first package install and Docker build.

Compose must support `--wait`. Default host ports are **3000** for the demo app and **5432** for PostgreSQL, both bound to `127.0.0.1`. Choose unused ports if another application is already using them.

### 1. Create the private configuration

From the repository root, copy the template **only for a new installation**:

```sh
cp .env.example .env
```

Generate a new authentication secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edit `.env` locally. The following shows the required settings; replace the two labelled values before starting:

```dotenv
POSTGRES_PASSWORD=ChooseYourOwnAlphanumericPassword
DATABASE_URL=postgresql://nova:ChooseYourOwnAlphanumericPassword@localhost:5432/nova
TEST_DATABASE_URL=postgresql://nova:ChooseYourOwnAlphanumericPassword@localhost:5432/nova_test
BETTER_AUTH_SECRET=PASTE_THE_GENERATED_RANDOM_SECRET_HERE
BETTER_AUTH_URL=http://localhost:3000
NOVA_DB_PORT=5432
NOVA_APP_PORT=3000
NOVA_ALLOW_DEMO_SEED=true
NOVA_ALLOW_DEMO_INVOICES=true
DEMO_PASSWORD=123456123456
```

Use the same database password in all three database settings. Use letters and digits because Compose constructs a database URL from it. The app and test databases must remain separate. The authentication secret must be random and at least 32 characters.

If you change ports, update both database URLs or the browser origin as appropriate. For an alternate app port, also set `SMOKE_BASE_URL` to the same origin as `BETTER_AUTH_URL`.

`.env` is excluded from Git and Docker builds. Keep actual credentials and backups private. The `nova` database/schema names and `NOVA_*` settings are retained for compatibility with existing migrations; the visible business name is Pandian Stores.

### 2. Install, migrate and load the demonstration

Run each command in order. **Stop if a command fails**, resolve the error, then continue. The project name `pandian-stores` matches the Windows launcher.

```sh
npm ci
docker compose -p pandian-stores config --quiet
docker compose -p pandian-stores up -d --wait db
npm run db:migrate
npm run db:migrate:test
npm run db:seed -- --sales --catalog
docker compose -p pandian-stores up --build -d --wait app
npm run test:smoke
```

Open [http://localhost:3000/login](http://localhost:3000/login), or double-click the launcher next time.

This loads a **completed benchmark**: opening stock, flour purchase, production, overheads, Retailer A's invoice/dispatch/payment, Distributor B's shortage order and the illustrative catalogue. It is convenient for inspecting the final results.

A fresh database volume creates both `nova` and `nova_test`. Migrations also run before the demo app starts. The seed uses stable request keys: repeating it on unchanged data does not post stock/payments twice. It preserves existing passwords and edits, and is not a reset command.

### 3. Choose completed results or a manual walkthrough

For a recording where you enter the transactions yourself, use a **fresh demonstration database** and replace the full seed command with:

```sh
npm run db:seed -- --catalog
```

This creates users, roles, territories, customers, materials, the benchmark product/price and published BOM, plus the extra illustrative products. It does **not** create opening stock or business transactions. Enter the opening balances in Inventory, then follow the benchmark below.

| Seed option          | What a fresh database contains                                          |
| -------------------- | ----------------------------------------------------------------------- |
| No checkpoint option | Masters, six users, benchmark price and published BOM.                  |
| `--inventory`        | Masters, opening stock and the flour purchase.                          |
| `--production`       | Inventory checkpoint, posted production and labour/utilities.           |
| `--sales`            | Complete benchmark, including invoicing, dispatch and payment.          |
| `--catalog`          | Adds the four extra illustrative products; combine with any checkpoint. |

Do not manually repeat a completed benchmark in the same database: those would be additional real transactions in that demonstration. Use a different Compose project **and unused ports with matching configuration** for an independent walkthrough. Keep working data rather than deleting its volume.

### Docker names and preserved data

The demo project is `pandian-stores`; its app image is `pandian-stores-app:local`, its containers are `pandian-stores-app-1` and `pandian-stores-db-1`, and its database volume is `pandian-stores_postgres_data`. Existing local data was copied from the stopped `nitt_postgres_data` volume. All 37 application/migration table counts and complete-row hashes matched before startup. The original volume remains as a recovery copy. SQL names (`nova`, `nova_test`, the `nova` schema and `NOVA_*` settings) and historical invoice snapshots remain unchanged for compatibility.

### Updating or troubleshooting the demo

After changing source files, rebuild using the same project name:

```sh
docker compose -p pandian-stores up --build -d --wait app
```

Useful checks:

```sh
docker compose -p pandian-stores ps
docker compose -p pandian-stores logs --tail 80 app db
npm run test:smoke
```

| Symptom                                              | What to check                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docker cannot connect                                | Start Docker Desktop and wait for its Linux engine. The launcher attempts this automatically on a normal Windows installation.                                                                   |
| App or database port is occupied                     | Check existing containers/programs. Choose unused ports and update `.env` consistently.                                                                                                          |
| Login fails                                          | Use the complete email and the 12-character demo password above. Existing passwords are preserved by reseeding. Check that you opened the HTTP demo rather than the separate HTTPS installation. |
| Reports appear empty                                 | Choose **demo** financial scope and a date/as-of range covering the fixture. Financial reports default to real scope.                                                                            |
| New product cannot be ordered or produced            | Supply its price and a published BOM; extra illustrative products intentionally have neither.                                                                                                    |
| HTTPS shows a certificate warning                    | The hardened rehearsal uses a private local CA that is not installed in system/browser trust. See the runbook; the HTTP demo does not need that certificate.                                     |
| Database password changed but connection still fails | Editing `.env` does not change the password of an existing PostgreSQL role/volume. Keep the configuration consistent with the existing database.                                                 |

For host development, leave the Docker database running and use `npm run dev -- --hostname 127.0.0.1`. Stop the Compose app first if it occupies port 3000. A host build uses `npm run build`, then `npm run start -- --hostname 127.0.0.1`.

## Understand the screens

The menu shows only the sections available to the signed-in role.

| Screen              | Purpose                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner dashboard** | Summary of orders, stock, production variance, packet cost and outstanding dues. Available to admin, owner and auditor.                         |
| **Sales**           | Create orders, review stock, approve/reject, issue/download invoices, dispatch and record payments. Actions depend on the role and order state. |
| **Inventory**       | Raw material, packaging and finished-goods balances; opening/purchase/adjustment drafts; posting and movement history.                          |
| **Production**      | Select a published recipe, enter planned/actual consumption and good output, post the run, review variance and add labour/utilities.            |
| **Reports**         | Filter authorized reports and export CSV/PDF.                                                                                                   |
| **Products**        | Product/pack identities, illustrative images and readiness for pricing/production. Each pack size is a separate product.                        |
| **Prices**          | Selling prices before GST and configurable product tax percentages.                                                                             |
| **BOMs**            | Recipes, expected yield, component quantities, revision history and publication. BOM means Bill of Materials.                                   |
| **Users**           | Admin account/role/password management; owner/auditor inspection.                                                                               |
| **Customers**       | Customer addresses, states and assigned territories. Salesmen see permitted customers.                                                          |
| **Territories**     | Connect customers to the responsible salesman.                                                                                                  |
| **Suppliers**       | Supplier details for material receipts.                                                                                                         |
| **Materials**       | Raw ingredients and packaging, with consistent base units.                                                                                      |

A **draft** is editable and does not change stock. **Post** is the finalization action: the server validates the document and records the stock movements in one transaction. A posted document is retained as history.

### Products and images

| Product       | Supplied configuration                                                           |
| ------------- | -------------------------------------------------------------------------------- |
| Murukku 200 g | Benchmark price of INR 50 before tax, exercise GST assumption and published BOM. |
| Murukku 500 g | Pack identity and illustration; needs its own price, tax/HSN settings and BOM.   |
| Mixture 200 g | Illustrative product; needs price, tax/HSN settings and BOM.                     |
| Chips 200 g   | Illustrative banana-chip product; needs price, tax/HSN settings and BOM.         |
| Sweets 200 g  | Illustrative sweets product; needs price, tax/HSN settings and BOM.              |

The assessment defines exact business figures only for Murukku 200 g. The other 200 g category packs, their twenty-packet carton capacities and depicted varieties are documented exercise assumptions. No recipes, prices or opening quantities were invented for them. Unpriced products are excluded from order entry; production needs a published recipe.

The gold, white and black interface uses a local SVG monogram and generated illustrative WebP snack images in `public/images/`. The images depict categories, not actual manufactured batches. Murukku pack sizes share an image. See [image provenance](#image-provenance).

### Deleting a record

Admin and owner can delete **eligible unused masters and drafts**, with confirmation. Referenced masters must be retained until their unused dependencies are removed.

Opening/purchase/adjustment drafts, eligible production drafts and submitted orders can be deleted before posting/review. A production draft with overhead history cannot be deleted.

Posted stock, posted production, reviewed orders, invoices, payments, allocations, credits, overheads, published BOMs and audit history are protected. Their Delete controls are disabled where listed. Corrections use a reasoned stock adjustment or the supported credit workflow. A full invoice credit preserves the original invoice and does not return physical stock; paid invoices require a future refund workflow before they can be credited.

The server rejects self-deletion, removal/demotion of the last administrator and deletion that would break references. Deletions are audited. Tombstones retain request keys so delayed retries cannot recreate deleted drafts/orders; such recreation returns HTTP 410. Repeated deletion is idempotent. Derived balances, reports and dashboard totals are calculated results, with no separate record to delete.

## Walk through the assessment benchmark

The [original problem statement](https://docs.google.com/document/d/10mA1m31WpfDf91u79Uzk2zL-ZhzgCHahtlUhcJBsmSY/edit?tab=t.0) asks for this sequence in the demo video. Use a fresh masters-only demonstration for a manual replay.

### Before starting: opening stock and recipe

As admin, enter and post these opening balances in Inventory:

| Item                   | Opening quantity | Rate used for this exercise                 |
| ---------------------- | ---------------- | ------------------------------------------- |
| Flour                  | 100 kg           | INR 42/kg                                   |
| Cooking oil            | 30 L             | INR 140/L                                   |
| Salt and spice mix     | 5 kg             | INR 200/kg                                  |
| 200 g pouches          | 500 pieces       | INR 2.50/piece                              |
| Cartons                | 30 pieces        | INR 15/piece                                |
| Finished Murukku 200 g | 50 packets       | Historical value unknown; leave it unknown. |

The published BOM expects **200 packets per batch** from 40 kg flour, 10 L oil, 1.2 kg spice mix, 200 pouches and ten cartons. One carton holds twenty packets. The default variance tolerance is 3%.

### Steps to show

1. **Buy flour.** As production supervisor or admin, record a purchase of **60 kg at INR 45/kg**, then post it. Flour becomes 160 kg, with a moving weighted-average rate of INR 43.125/kg.
2. **Create the production run.** Select Murukku 200 g and its published BOM for one batch. Enter actual consumption of **40 kg flour, 10.5 L oil and 1.2 kg spice mix**.
3. **Record the output and packaging.** Enter **188 good packets**, **194 total pouches including six damaged**, and **nine cartons**. Post production. Stock updates on both sides together. Check the -6% yield variance and +5% oil variance.
4. **Place Retailer A's order.** Sign in as **Salesman A**, preferably using the mobile layout. Select Retailer A and order **150 packets at INR 50 before tax**.
5. **Approve, invoice and dispatch.** Sign in as **admin**. Review stock, approve the order, choose **Sample exercise invoice**, issue it and download the PDF. Check taxable INR 7,500, CGST INR 187.50, SGST INR 187.50 and total INR 7,875. Post dispatch; finished stock becomes 88 packets.
6. **Show the shortage.** As **Salesman B**, order **120 packets for Distributor B**. As admin, review the shortage of **32 packets**. The order remains submitted; no approval, invoice, dispatch or stock deduction is posted for this shortage.
7. **Record the collection.** As admin, allocate a payment of **INR 4,000** to Retailer A's invoice. Outstanding becomes INR 3,875.
8. **Add overheads.** On the posted production run, add **INR 1,200 labour** and **INR 600 gas/power**. Review the total run cost and cost per good packet.
9. **Generate reports.** As auditor or admin, open Reports, choose the correct dates and **demo** financial scope, then review/download the sales, GST, purchases, stock, production and collection/outstanding reports.

Nine cartons account for 180 good packets; the remaining eight are assumed loose. Damaged pouches are already included in the total consumption of 194 and must not be issued twice.

The completed seed's invoice/payment date is **17 November 2026**. Inventory/production postings use the date when the seed runs. Choose a report range and as-of date covering all of those dates. For a manual video, keep transaction dates consistent.

## Expected benchmark results

| Check                            | Expected outcome                                   |
| -------------------------------- | -------------------------------------------------- |
| Flour purchase                   | 60 kg × INR 45 = INR 2,700                         |
| Flour average after purchase     | (100 × 42 + 60 × 45) / 160 = INR 43.125/kg         |
| Closing flour                    | **120 kg**                                         |
| Closing oil                      | **19.5 L**                                         |
| Closing spice mix                | **3.8 kg**                                         |
| Closing pouches                  | **306 pieces**                                     |
| Closing cartons                  | **21 pieces**                                      |
| Expected / good output           | **200 / 188 packets**                              |
| Yield variance                   | **-6%, flagged**                                   |
| Oil variance                     | **+5%, flagged**                                   |
| Finished stock after production  | **50 + 188 = 238 packets**                         |
| Finished stock after dispatch    | **238 - 150 = 88 packets**                         |
| Retailer A taxable amount        | **INR 7,500**                                      |
| Retailer A CGST / SGST           | **INR 187.50 / INR 187.50**                        |
| Retailer A invoice total         | **INR 7,875**                                      |
| Retailer A payment / outstanding | **INR 4,000 / INR 3,875**                          |
| Distributor B shortage           | **120 - 88 = 32 packets**, with no stock deduction |

Material cost is **INR 4,055**: flour 1,725 + oil 1,470 + spice 240 + pouches 485 + cartons 135. With labour 1,200 and utilities 600, total run cost is **INR 5,855**. Dividing by 188 good packets gives **INR 31.14 per packet**, rounded for display.

The estimated margin against the current INR 50 pre-tax price is **INR 18.86 per packet / 37.71%**. This is an estimate for the production run. The opening fifty finished packets have no historical value, so aggregate finished-stock valuation and dispatch profit remain **unknown** rather than being invented.

Pouch variance is -3%, exactly at tolerance, so it is not flagged. Carton variance is -10% and is flagged. Karnataka supply uses IGST if an otherwise eligible invoice is issued; the benchmark's shortage order never reaches invoice issue.

## Reports and exports

All fourteen report types support authorized CSV and PDF exports. CSV can be opened in Excel; a native XLSX file is not generated.

| Group       | Available reports                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Sales       | Sales register, customer sales, product sales, order register                                   |
| GST         | Outward GST review                                                                              |
| Purchasing  | Purchase register                                                                               |
| Stock       | Stock summary / historical stock, stock ledger                                                  |
| Production  | Production register, consumption and variance                                                   |
| Collections | Payment register, invoice collections and receivables, customer outstanding, receivables ageing |

Dates use **Asia/Kolkata**. Set the period and as-of date so `from <= to <= asOf`. Receivables include eligible older invoices through as-of, even if they predate the selected period. Stock rolls forward through as-of.

Financial reports default to **real** scope. Select **demo** to see the sample invoice and payment. Physical stock, purchases, production and orders are shared operational records rather than separate demo/real ledgers. Salesmen's reports remain restricted to their permitted business; production supervisors receive only their four operational report types.

Report screens show fifty rows per page. Totals and exports use the complete permitted result, with a **5,000-row limit** and a ten-second reporting statement timeout. Larger results are rejected rather than silently truncated. Product-filtered collections select whole matching invoices because payments are allocated to invoices, not individual product lines.

CSV cells are escaped and protected against formula-like content. PDFs paginate with headings. The current PDF renderer supports ASCII and the sample-notice em dash; other characters render as `?`. Exports are review documents, not government returns.

## How the figures and history are kept correct

### Stock and production

Every receipt, issue, dispatch or adjustment writes a source-linked ledger movement. Balances are derived from those movements. Posted documents lock affected items in a consistent order and update stock in one transaction. Failed posts roll back; duplicate request keys return the original result or reject a changed payload.

Base units are grams, millilitres, pieces and packets. Kilograms/litres convert by 1,000 within their dimension. Carton conversion requires the product's configured packet capacity; pieces and packets are not interchangeable.

Moving weighted-average valuation uses known ledger value divided by on-hand quantity. Issues use that average. Unknown opening value carries through to positive balances and issue costs; zero stock has zero value. Explicit revaluation is not implemented.

Published BOM revisions are immutable, with exactly one active revision per product. A production run stores its selected recipe and planned/actual snapshots. Variance is `(actual - planned) / planned × 100`; the absolute unrounded percentage must be **greater than** the tolerance to flag an alert. A zero planned quantity has no defined percentage and flags only nonzero actual use.

Run cost uses posted material issue costs plus append-only overhead events, divided by good output. Decimal.js uses a forty-significant-digit context, with half-up rounding to two decimals for display. Finished-goods receipts carry **material cost only**: adding later overheads changes the run's cost report, not its immutable stock receipt.

### Orders, invoices and payments

Order quantities are whole packets and prices are checked on the server. Admin can revise submitted quantities/prices with a reason before approval. Approved lines are frozen.

Approval and invoice issue check stock; **dispatch** deducts it. There are no reservations. Dispatch checks again while holding item locks, so simultaneous dispatches cannot make stock negative. Each order currently has one invoice and one full dispatch.

Invoices preserve immutable seller/customer details, descriptions, HSN, quantities, prices and tax amounts. Financial-year numbering runs April–March, with separate transactional counters such as `SAMPLE/2026-27/00001` and `PANDIAN/2026-27/00001`. Failed issuance rolls back its sequence update; retries return the existing invoice. Older posted numbers/snapshots remain unchanged.

Payment amounts are positive. Allocations must equal the payment total, belong to the same customer and fit within invoice outstanding. Customer/invoice locks and PostgreSQL reconciliation prevent concurrent over-allocation. The API can allocate one payment to several invoices; the UI handles one invoice at a time.

Audit events retain actor, action, document, time and before/after details in the same transaction as the business change. A privileged database/host administrator can bypass database guards; this is not an externally tamper-proof audit service.

### Sample and real invoices

The benchmark assumes **5% GST for this exercise only**: Tamil Nadu uses 2.5% CGST plus 2.5% SGST; Karnataka uses 5% IGST. Real product rates are configurable and have not been verified as statutory rates.

Sample issuance requires `NOVA_ALLOW_DEMO_INVOICES=true` and a separate fictional business profile in PostgreSQL. Its deliberately invalid GSTIN is `DEMO-NOT-A-GSTIN`. Every sample invoice displays:

> SAMPLE INVOICE — NOT VALID FOR TAX PURPOSES

Real issuance requires configured seller name, address, state, GSTIN and product HSN, with local state/format/checksum validation. The invalid demo GSTIN cannot pass real validation. Only the fictional profile is seeded; seller details and HSN are not hardcoded in generation logic. Current supported supply states are Tamil Nadu and Karnataka. Local validation does not establish an active registration or statutory compliance.

Taxable values and tax components are independently rounded half-up per line to paisa, then summed. PostgreSQL NUMERIC and Decimal.js keep calculations out of floating-point money arithmetic. Download an authorized invoice PDF and attach it manually to email/WhatsApp; integrated message delivery is not implemented.

## Architecture and repository

### Coverage against the assessment

| Scope tier    | Implemented behavior                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must have     | Role-based login, product/customer/material/BOM masters, mobile order entry, admin approval, GST PDF, atomic production stock updates, planned/actual variance, stock summary/ledger and CSV sales/stock exports. |
| Should have   | Suppliers/purchases, payments/outstanding/ageing, overhead-based packet cost, GST review, tolerance alerts and owner dashboard.                                                                                   |
| Stretch goals | Not claimed. Offline sync, batch/expiry, planning/reorder alerts, GPS, Tally export, government formats and Tamil UI remain outside the implementation.                                                           |

### Technical choices

Next.js 16, React 19 and strict TypeScript keep the pages, APIs and business services in one application, which is practical for this prototype. PostgreSQL 17 provides transactions, decimal arithmetic, row locks and integrity guards; Drizzle provides typed queries and versioned migrations. Better Auth manages credentials/sessions, Zod validates inputs, and Decimal.js handles financial calculations.

```text
src/app/          Pages, layouts and HTTP routes
src/components/   Forms, tables, navigation and product presentation
src/modules/      Authorization and business services
src/lib/          Configuration, database/schema, units and PDF utilities
drizzle/          Versioned migrations 0000–0014 and metadata
scripts/          Migrations, seeds, fixtures, launchers and verification
tests/            PostgreSQL, browser, cross-role and deployment checks
docker/           Database initialization, runtime grants and TLS proxy
docs/             Hardened runbook, detailed security evidence and design note
output/pdf/       Two-page architecture design note
.github/workflows/ Functional checks and a separate blocking dependency audit
```

Services own authorization and transaction boundaries; HTTP handlers call them. Custom SQL migrations maintain the stock/financial constraints and views. ORM metadata describes master tables, not every SQL guard. No Tally, queue, Redis or external accounting service is required for daily work.

For future schema changes, use `npm run db:generate -- --name meaningful_name`, review the generated SQL/metadata, and version custom SQL changes too. Never edit a migration already applied to a database.

## Run the checks

Use a separate `TEST_DATABASE_URL` ending in `_test`. Test preparation resets **that database**. Never point it at working business data. Run database and browser suites **sequentially** because they share the isolated test database.

### Core checks

```sh
npm run db:migrate:test
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run verify:system
npm run test:smoke
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

`test:smoke` checks the running demo without creating business documents. `verify:system` creates a uniquely named disposable database, applies migrations twice, repeats the benchmark and verifies reports/CSV/PDF before removing only that database. Its database role needs permission to create databases. `npm run verify:system -- --measure` adds synthetic performance checks in that disposable database.

### Browser checks

Install the engines once:

```sh
npx playwright install chromium firefox webkit
```

For each engine, run the four suites in order. For example:

```sh
npm run test:e2e -- --browser=chromium
npm run test:review -- --browser=chromium
npm run test:cross -- --browser=chromium
npm run test:billing -- --browser=chromium
```

Repeat with `--browser=firefox`, then `--browser=webkit`. Workflow, role-review, cross-access and billing-profile suites use ports 3100, 3200, 3400 and 3300 respectively. Each starts a separate server so independent tests do not accumulate sign-in attempts against the same in-memory IP limit. No rate limiter is disabled. The six-account review checks each role's tabs and reports. Cross tests check role-write restrictions, foreign salesman identifiers, origin checks, retries and account switching. They include 110 cross-role write denials and 97 cross-origin denials per engine while checking that business state is preserved.

### Recorded validation

The latest complete local validation on **19 November 2026** recorded:

| Check                                   | Result                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Vitest with real PostgreSQL             | 78 tests passed across ten files                                                                                   |
| Playwright                              | 57 executions passed: 19 cases across Chromium, Firefox and WebKit                                                 |
| Workflow / role / cross / billing cases | 7 / 6 / 5 / 1 per engine, with no retries                                                                          |
| Code checks                             | Lint, formatting and TypeScript passed                                                                             |
| Build and demo                          | Production build, Docker build/readiness and HTTP smoke passed                                                     |
| Fresh benchmark                         | Stock, taxes, payments, costs, fourteen reports and CSV/PDF reconciliation passed                                  |
| Hardened local rehearsal                | TLS/login, restricted database role, startup refusal checks, 200 TLS probes and encrypted populated restore passed |
| npm audits                              | Full and production-only audits each reported zero vulnerabilities, exit 0                                         |
| Hardened image scans                    | **Failed**: app 5 high, database 6 high, proxy 8 high; zero critical                                               |

The launcher was also tested by restarting a stopped app and running it again with the app already healthy.

During this README/launcher review on 19 November 2026, 78 automated tests, all six Chromium role reviews, the six published logins against the running demo, fresh benchmark/report/export reconciliation, HTTP smoke, lint, formatting, TypeScript, the production build and both npm audits passed again. Local documentation links/headings were checked, and private environment values were absent from the edited documentation/launcher files. The subsequent clean GitHub clone recheck passed all 57 browser executions (including the new billing-profile case in each engine), all 78 database tests, lint/format/type checking, the production build, repeated seed and benchmark/report/export reconciliation. The earlier hardened deployment evidence remains separately recorded.

These are local results, not a remote CI pass, physical-device certification, human usability study or production load guarantee. CI is configured for independent functional and blocking audit jobs. Security findings are not suppressed.

## Backups and the separate hardened installation

The normal demo database role owns its schema and migrations. The hardened rehearsal instead uses a restricted runtime role, a separate privileged operator job, internal app/database networks, loopback TLS, file-mounted secrets and resource limits.

Follow **[docs/production-runbook.md](docs/production-runbook.md)** for setup, credential recovery, password rotation, encrypted backups and restore verification.

```sh
npm run production:init
npm run production:up -- --bootstrap
npm run production:verify
npm run production:recovery-drill
```

Use `--bootstrap` only for an empty installation. Subsequent starts use `npm run production:up`. Generated credentials are stored privately outside the repository in the operator account file; the published demo password does not work there. Neither the demo data nor fictional seller profile is seeded into its operational database.

The hardened tools stream backups through AES-256-GCM and authenticate them before restoring into a new recovery database. The populated drill compares all application tables and migration history without overwriting the operational database. Backups include credential hashes and session data, so protect both backups and their separately stored key.

For a simple **unencrypted, local demo-only backup**:

```powershell
New-Item -ItemType Directory -Force backups
docker compose -p pandian-stores exec -T db pg_dump -U nova -d nova --format=custom --file=/tmp/nova-backup.dump
if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
docker compose -p pandian-stores cp db:/tmp/nova-backup.dump ./backups/nova-backup.dump
if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed' }
```

Keep this file private and out of Git. The `backups/` directory is ignored. A successful dump is not proof of recoverability: rehearse restoration into a new empty database and compare ledger, invoices, payments, audit records and migration versions before planning any switchover. Local encrypted recovery has been exercised; off-host disaster recovery has not.

## Known limitations

- **Optional assessment features:** offline order sync, batch/expiry tracking, production planning/reorder alerts, GPS, Tamil UI, Tally integration and government e-invoice/e-way-bill formats are not implemented.
- **Sales corrections:** no reservations, partial dispatch, partial credits, refunds or physical returns.
- **Production/accounting:** no zero-output failed runs, omitted/substituted BOM inputs, overhead reversals, explicit revaluation, financial close or closed periods. Historical order-state replay and purchase-tax reconstruction are unavailable.
- **Identity:** no public registration, email password recovery, MFA, invitations or account-deactivation workflow. Admin reset and privileged hardened recovery are available.
- **Scale:** master/operational lists are unpaginated; exports are synchronous/in-memory and capped at 5,000 rows. Local synthetic measurements are not a capacity SLA.
- **Tax:** rates, local GSTIN checks and review exports do not certify legal compliance, registration status or government-return readiness.
- **Operations:** no proved off-host recovery, scheduled retention, external alert delivery or contractual recovery objectives.

## Security status and deployment restriction

**Public production deployment remains blocked.** Latest recorded full and production-only npm audits return zero vulnerabilities after withdrawal of **GHSA-fc5q-39xc-vjpf / CVE-2026-112366**. Earlier Stage 6 audits failed with sixteen/five high dependency entries. The unchanged matcher code still reproduces bounded denial-of-service behavior; advisory withdrawal is not a code patch. No attacker-controlled glob-pattern route was identified in the reviewed app; image optimization is disabled, configuration is trusted, access stays on loopback, and login/resource limits remain active. No patched Picomatch release was available in that review, and no forced upgrade or suppression was used.

Recorded paths include `eslint-config-next@16.4.6 > @next/eslint-plugin-next@16.4.6 > fast-glob@3.3.1 > micromatch@4.0.8 > picomatch@2.3.2`, and `better-auth@1.7.25`'s optional `vitest@5.1.0` peer with `vite@8.3.8`, `tinyglobby@0.2.17`, `fdir@6.5.0` and `picomatch@4.0.7`. Next.js 16.4.6 also contains an unversioned bundled matcher. Isolated 41/33-character failing subjects exceeded the 1.5-second child-process limit. Complete paths, reproduction conditions, exposure assessment and mitigations remain in [docs/security-review.md](docs/security-review.md).

The latest recorded hardened image scans still fail: **app five high, database six high, proxy eight high; zero critical**. These nineteen image-level entries represent nine CVE IDs. Resolve or independently adjudicate these findings and prove live TLS/DNS, protected off-host recovery, alerting and real business/tax settings before public release. Functional checks and a clean npm audit do not approve deployment.

## Submission checklist

Source and commit history are published at [Santhan-ks/Pandian-Stores](https://github.com/Santhan-ks/Pandian-Stores). The [two-page design note](docs/pandian-stores-design-note.pdf) meets the assessment page limit; the [complete architecture PDF](docs/pandian-stores-architecture.pdf) is supplementary. Both use the app's gold, white and black theme.

The required **unlisted video of at most eight minutes** remains pending. It must show the exact benchmark in order, including mobile salesman and admin views; add its actual accessible link once recorded. Confirm the organizer's submission form/deadline. A localhost URL works only on the evaluator's own machine after setup and is not a hosted demo link.

## Image provenance

The local Murukku, Mixture, Chips and Sweets WebP illustrations were generated for this prototype and depict categories rather than actual manufactured batches. Both Murukku pack sizes share an image. The logo is a local SVG monogram. No product label, tax marking or manufactured-batch claim is implied.

Thank You...
