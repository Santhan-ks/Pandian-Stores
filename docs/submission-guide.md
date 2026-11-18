# Local demonstration and submission guide

This is a recording plan and interview aid, not a recorded video. Public production deployment remains blocked by the dependency finding documented in the README. Use fictional local records and sample invoices only.

## Prepare the recording

1. Follow the README setup with a new Compose project and unused loopback ports if another Pandian Stores instance is running. Keep the same project name in every command. Do not reuse or erase working business data.
2. For a manual walkthrough, run `npm run db:seed -- --catalog` without checkpoint flags on that fresh database. This creates masters and the published BOM, with no opening stock or transactions. Do not run `--sales` first; that would complete the workflow before filming.
3. Set the local demo password, seed opt-in and demo-invoice opt-in as described in the README. Verify login for admin, both salesmen, supervisor and auditor. Hide password entry, environment files, cookies and database URLs during recording. The README publishes the fictional local test password; operational credentials and authentication/database secrets must remain private.
4. Create the fictional supplier in Suppliers: name `Demo flour supplier (invented)`, Tamil Nadu, with an explicitly invented address. Configure the **demo** business profile in Sales using fictional manufacturer name/address, Tamil Nadu, `DEMO-NOT-A-GSTIN` and exercise-only HSN `1905` for Murukku. Leave the real profile unconfigured. This preparation creates no stock movement or invoice.
5. Confirm Murukku **200 g**, INR 50 before the assumed 5% tax, 20 packets/carton, and published revision 1. Its one-batch plan is flour 40 kg, oil 10 L, spice 1.2 kg, pouches 200 pieces and cartons ten pieces; expected output is 200 packets.
6. Use a desktop window for admin/supervisor, a 360 px browser viewport for the salesman shot, and an auditor login for the final read-only view (owner additionally has eligible-record deletion). Rehearse role switches; reuse existing authorized sessions where practical rather than repeatedly hitting login limits. Use only the real application, not edited mock screens.

If you want a completed review dataset rather than a manual recording, use the README's twice-run `--sales` seed instead. Choose one approach per fresh database. Checkpoint seeds are not general reset/replay commands for manually modified data.

The automatic checkpoint uses invoice/payment date **17 November 2026**, while its stock postings use the seed date. Include both in report filters when reviewing that dataset in a later month; default current-month filters may hide the invoice. The manual sequence below uses the recording's actual local dates.

## Exact inputs and checkpoints

Opening stock is an admin **opening** document. Leave the finished-packet value unavailable; do not enter zero as an invented historical value.

| Item             | Opening quantity | Rate per entered unit     |
| ---------------- | ---------------- | ------------------------- |
| Flour            | 100 kg           | INR 42/kg                 |
| Oil              | 30 L             | INR 140/L                 |
| Salt/spice mix   | 5 kg             | INR 200/kg                |
| Pouches          | 500 pieces       | INR 2.50/piece            |
| Cartons          | 30 pieces        | INR 15/piece              |
| Finished Murukku | 50 packets       | Unknown; leave rate blank |

Post a **purchase** of 60 kg flour at INR 45/kg from the fictional supplier. Flour becomes 160 kg, INR 6,900, average INR 43.125/kg.

Create one production run using revision 1, one planned batch, **188 good packets** and **3% tolerance**:

| Component | Actual total consumption | Damaged subset | Issue cost |
| --------- | ------------------------ | -------------- | ---------- |
| Flour     | 40 kg                    | 0              | INR 1,725  |
| Oil       | 10.5 L                   | 0              | INR 1,470  |
| Spice     | 1.2 kg                   | 0              | INR 240    |
| Pouches   | 194 pieces               | 6 pieces       | INR 485    |
| Cartons   | 9 pieces                 | 0              | INR 135    |

The six damaged pouches are included in 194, not added to it. Nine cartons hold 180 of the 188 good packets; eight are assumed loose. Post once, then add labour INR 1,200 and gas/power INR 600 with clear benchmark reasons. Materials INR 4,055 + overheads INR 1,800 = **INR 5,855**; divide by 188, display **INR 31.14**. Yield is -6%, oil +5% (both flagged); pouches -3% is at tolerance and unflagged, cartons -10% is flagged. Finished stock is 50 + 188 = **238**.

Salesman A submits **150 packets for Retailer A** at INR 50. Admin approves and uses **Issue demo invoice**, not the real-issue action. Select the actual local recording date. In Tamil Nadu, taxable INR 7,500 + CGST INR 187.50 + SGST INR 187.50 = **INR 7,875**. Download the PDF and show its sample warning. Post the full dispatch: **238 - 150 = 88** packets.

Salesman B submits **120 packets for Distributor B**. Admin attempts approval; it must report **32 short**, leaving the order submitted with no invoice, dispatch or stock deduction. An interstate preview uses IGST; do not claim that this blocked order issued an invoice.

Record a **Retailer A** payment of **INR 4,000** against that invoice, using a clearly fictional reference such as `DEMO-RETAILER-A-4000` and the local date. Outstanding is **INR 3,875**. In Reports, select a period/as-of covering the posting and invoice/payment dates and choose **demo** scope for financial reports. Operational stock/production reports share stock across modes. The final stock is flour **120 kg**, oil **19.5 L**, spice **3.8 kg**, pouches **306**, cartons **21**, finished packets **88**.

## Shot plan: target 7 minutes 40 seconds

The times below are a plan, not measured recording durations. Allow a 20-second margin under eight minutes. Rehearse typing beforehand; a cut may shorten typing or login, but must not conceal errors, replace results or suggest an operation was executed when it was not.

| Time      | Screen/action                                     | Suggested narration and evidence                                                                                                               |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:30 | Local login, role/navigation overview             | "Pandian Stores links orders to production, stock and audit records. This is an isolated local exercise." Show assigned role; hide password.   |
| 0:30-1:20 | Admin opening document and posting                | Show all six opening lines, unknown finished valuation, and immutable-post confirmation.                                                       |
| 1:20-1:50 | Flour purchase and stock summary                  | "Sixty kilograms at 45 adds 2,700. The moving average is 43.125 per kilogram."                                                                 |
| 1:50-3:10 | Supervisor production draft/posting and overheads | Show revision 1, actual inputs/damage, 188 good packets, oil/yield alerts, material cost, labour/utilities and 31.14 displayed unit cost.      |
| 3:10-3:30 | Inventory/production result                       | Show 238 finished packets and source-linked issues. Explain that run cost does not resolve unknown opening valuation.                          |
| 3:30-4:10 | Salesman A at 360 px                              | Select Retailer A, enter 150, submit. Show only assigned customers.                                                                            |
| 4:10-5:00 | Admin approval and sample PDF                     | Show stock review, sample action, 7,500 / 187.50 / 187.50 / 7,875 and the full non-tax-valid warning.                                          |
| 5:00-5:25 | Full dispatch and ledger                          | Confirm once; show source invoice, 150-packet movement and remaining 88.                                                                       |
| 5:25-6:00 | Salesman B order/admin shortage                   | Submit 120 for Distributor B, attempt approval, show 32 short and unchanged stock.                                                             |
| 6:00-6:35 | Admin payment and receivable                      | Allocate 4,000 to Retailer A's invoice, show 3,875 outstanding.                                                                                |
| 6:35-7:15 | Demo monthly reports and read-only view           | Show sales/tax/collections, final stock, production cost and one CSV/PDF export; show auditor/owner restrictions.                              |
| 7:15-7:40 | Security disclosure and closing                   | "The dependency audit fails with 16 high entries, five in production. Public deployment is blocked. This submission is a local demonstration." |

Before sharing the recording: verify duration <= 8:00, legible numbers, sample notice, correct roles, no leaked credentials, unchanged shortage stock and reconciled payment. Do not claim a recorded video exists until an actual file has been recorded and reviewed.

## Interview notes

| Topic             | Explanation grounded in the implementation                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema            | Products reference distinct finished inventory items; versioned BOMs reference shared raw/packaging items. Stock documents/lines produce immutable movements. Production extends stock documents. Orders lead to immutable invoice snapshots, full dispatch and payment allocations. Profiles/HSNs are mode-specific.                                                                  |
| Isolation         | Posting services use PostgreSQL transactions with explicit document/customer/invoice locks and sorted item locks; they do not globally force SERIALIZABLE. Reports/dashboard use read-only REPEATABLE READ for consistent snapshots. Concurrent dispatch and allocation regressions exercise the invariants.                                                                           |
| Inventory posting | A draft affects no balance. Posting validates all lines and inserts signed base-unit movements, source links, state and audit event atomically. The summary sums movements. Repeated posting returns the original document; failed posting rolls back.                                                                                                                                 |
| BOM calculation   | Planned component = revision quantity x requested batches / standard batch size. Run snapshots preserve selected revision, planned/actual use, damage, tolerance and accepted output. Published contents are immutable.                                                                                                                                                                |
| Costing           | Moving weighted-average material costs are fixed by the issue movements. Run total is that snapshot plus append-only overhead events. Benchmark 5,855 / 188 displays 31.14. Finished receipt value includes materials only; unknown opening stock prevents a supported aggregate finished valuation/profit figure.                                                                     |
| GST               | Configurable price-list rates; 5% is the exercise assumption. Same-state supply splits CGST/SGST; interstate uses IGST. Each taxable/tax component is rounded half-up per line before summing. Validation is not a statutory-rate or active-registration verification.                                                                                                                 |
| Invoice numbering | April-March financial year comes from invoice date. A transactional upsert serializes counters, separately for sample and real mode; failure rolls back increments and a retry returns the existing invoice.                                                                                                                                                                           |
| Access control    | Better Auth sessions resolve the current server-side role. Service/API policy enforces writes and report scopes. A salesman needs order ownership and current customer territory assignment; hiding a button is not authorization.                                                                                                                                                     |
| Audit logging     | Business changes and actor/action/document/time/before-after events share a transaction. Database guards prevent application updates/deletes. A privileged database owner remains able to bypass guards; there is no external tamper-proof log.                                                                                                                                        |
| Payments          | Allocations must equal the immutable payment amount, match the customer and not exceed outstanding. Customer/invoice locks and deferred reconciliation prevent races and invalid appended allocations. No unapplied cash/refund model is claimed.                                                                                                                                      |
| Security          | No attacker-controlled dangerous glob path was identified in the reviewed configuration, but bounded probes reproduce denial of service in npm and Next's bundled matcher. No patch was available at review; audits fail and CI retains the failing gate. Public deployment is blocked. Local secrets, loopback ports and a non-root app limit exposure without fixing the dependency. |

### Exercise: add a 500 g pack

Create a new **Murukku 500 g product**, which gets a separate finished-item identity, and specify its own carton capacity. Reuse appropriate raw/packaging masters; do not change the 200 g product's identity or historical snapshots. Configure its own price, assumed/verified tax rate as appropriate and mode-specific HSN. Publish a separate BOM with explicitly justified expected output and packaging consumption; do not blindly multiply every 200 g line by 2.5. Produce/post against that revision, then order/invoice that product normally. Shared raw stock still uses the same ledger and locks, while finished balances and product filters remain separate.

Before implementing that exercise, add focused checks for pack identity preservation, BOM scaling/units, shared-material shortages, independent finished balances, multi-product tax/snapshot totals and reports. The final catalogue review now supplies an illustrative 500 g product identity through `--catalog`, but does not invent its price, tax/HSN or recipe. The remaining configuration and operational exercise still require approved values. See the README catalogue assumptions.

## Manual submission checklist

- Review the committed README and two-page design note against the application; retain the dependency disclosure with the submission.
- Run the documented clean local setup and preserve actual test/audit results. The audit is a failure, not a clean-security certificate.
- Record, inspect and submit the actual <= 8-minute video through the assessment's required channel. No video file is supplied here.
- Confirm the assessment's repository/PDF/video naming and delivery requirements; no portal upload or email is performed by this workflow.
- Exclude `.env`, backups, database volumes, browser cookies, `node_modules`, build/test artifacts and the isolated dependency-test folder from shared source packages.
- Git has no configured remote at review. Add/push a remote only with explicit authorization; observe a real Actions run before claiming remote CI passed. Its audit job is expected to remain failing.
- Public production release requires maintained fixes covering npm and Next's bundled matcher, renewed audit/regressions, production bootstrap/credentials, restricted database roles, TLS/proxy/rate-limit configuration, protected backups/recovery and a separate deployment review. No public instance is authorized.
