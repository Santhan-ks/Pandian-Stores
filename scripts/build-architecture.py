"""Build the Pandian Stores architecture PDFs. Requires reportlab; no app secrets."""

from html import escape
from pathlib import Path
import re
import shutil

from reportlab import rl_config
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
INK = colors.HexColor("#20201c")
GOLD = colors.HexColor("#866213")
WASH = colors.HexColor("#f7f1e1")
LINE = colors.HexColor("#e5e1d6")
MUTED = colors.HexColor("#716f65")
PAGE_W, PAGE_H = A4
WIDTH = PAGE_W - 84
DATE = "19 November 2026"

# Stable PDF metadata and fonts; Windows uses the same family as the app.
rl_config.invariant = True
font_root = Path("C:/Windows/Fonts")
if (font_root / "segoeui.ttf").exists():
    pdfmetrics.registerFont(TTFont("Pandian", str(font_root / "segoeui.ttf")))
    pdfmetrics.registerFont(TTFont("Pandian-Bold", str(font_root / "segoeuib.ttf")))
    pdfmetrics.registerFontFamily("Pandian", normal="Pandian", bold="Pandian-Bold")
    FONT, BOLD = "Pandian", "Pandian-Bold"
else:
    FONT, BOLD = "Helvetica", "Helvetica-Bold"

styles = getSampleStyleSheet()
styles.add(ParagraphStyle("BodyPS", fontName=FONT, fontSize=9.5, leading=14,
                          textColor=INK, spaceAfter=8))
styles.add(ParagraphStyle("SmallPS", parent=styles["BodyPS"], fontSize=8,
                          leading=11, spaceAfter=5))
styles.add(ParagraphStyle("H1PS", fontName=BOLD, fontSize=24, leading=29,
                          textColor=INK, spaceAfter=10))
styles.add(ParagraphStyle("H2PS", fontName=BOLD, fontSize=12, leading=17,
                          textColor=GOLD, spaceBefore=7, spaceAfter=7))
styles.add(ParagraphStyle("CellPS", parent=styles["SmallPS"], fontSize=8.4,
                          leading=11.7, spaceAfter=0))
styles.add(ParagraphStyle("CoverPS", parent=styles["H1PS"], fontSize=30,
                          leading=35))
styles.add(ParagraphStyle("CaptionPS", parent=styles["SmallPS"], textColor=MUTED))


def markup(text):
    text = escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    return text.replace("\n", "<br/>")


def p(text, style="BodyPS"):
    return Paragraph(markup(text), styles[style])


def bullets(items):
    return [p("- " + item) for item in items]


def table(headers, rows, ratios=None, compact=False):
    ratios = ratios or [1 / len(headers)] * len(headers)
    col_widths = [WIDTH * r for r in ratios]
    body = [[p(str(value), "CellPS") for value in row] for row in [headers] + rows]
    result = Table(body, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), WASH),
        ("LINEBELOW", (0, 0), (-1, 0), 1, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5 if compact else 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5 if compact else 7),
    ]))
    return result


def arrow(drawing, x1, y1, x2, y2):
    drawing.add(Line(x1, y1, x2, y2, strokeColor=GOLD, strokeWidth=1))
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 > x1 else -1
        vertices = [x2, y2, x2 - direction * 5, y2 + 3, x2 - direction * 5, y2 - 3]
    else:
        direction = 1 if y2 > y1 else -1
        vertices = [x2, y2, x2 - 3, y2 - direction * 5, x2 + 3, y2 - direction * 5]
    drawing.add(Polygon(vertices, fillColor=GOLD, strokeColor=GOLD))


def box(drawing, x, y, width, height, title, lines=()):
    drawing.add(Rect(x, y, width, height, rx=5, ry=5,
                     fillColor=WASH, strokeColor=LINE))
    drawing.add(String(x + 9, y + height - 18, title, fontName=BOLD,
                       fontSize=9, fillColor=INK))
    for index, value in enumerate(lines):
        drawing.add(String(x + 9, y + height - 34 - index * 12, value,
                           fontName=FONT, fontSize=8, fillColor=MUTED))


def layers():
    drawing = Drawing(WIDTH, 106)
    width = (WIDTH - 34) / 3
    entries = [
        ("Browser workspace", ["React / responsive screens", "Role-aware forms and reports"]),
        ("Next.js application", ["Routes > policy > services", "Validation and transactions"]),
        ("PostgreSQL 17", ["Ledger, snapshots and guards", "NUMERIC / locks / views"]),
    ]
    for index, (title, lines) in enumerate(entries):
        x = index * (width + 17)
        box(drawing, x, 16, width, 82, title, lines)
        if index < 2:
            arrow(drawing, x + width, 57, x + width + 17, 57)
    return drawing


def sequence(labels):
    height = len(labels) * 43 + 7
    drawing = Drawing(WIDTH, height)
    for index, (title, detail) in enumerate(labels):
        y = height - (index + 1) * 43
        box(drawing, 0, y, WIDTH, 35, title, [])
        drawing.add(String(178, y + 13, detail, fontName=FONT, fontSize=8,
                           fillColor=MUTED))
        if index < len(labels) - 1:
            arrow(drawing, WIDTH / 2, y, WIDTH / 2, y - 8)
    return drawing


def er_diagram():
    drawing = Drawing(WIDTH, 276)
    gap, height = 16, 47
    width = (WIDTH - gap * 2) / 3
    columns = [
        [("users", ["PK id; roles + sessions"]), ("territories", ["FK salesman_id > users"]),
         ("customers", ["FK territory_id"]), ("sales_orders", ["FK customer_id, salesman_id"]),
         ("invoices", ["UNIQUE order_id; snapshot"])],
        [("products", ["UNIQUE item_id"]), ("bom_versions / bom_lines", ["FK product / version / item"]),
         ("production_runs", ["FK BOM; PK = stock doc"]), ("stock_documents / lines", ["Category, actor, source, items"]),
         ("dispatches", ["UNIQUE invoice_id; stock doc"])],
        [("inventory_items", ["Kind + base-unit FK"]), ("inventory_movements", ["UNIQUE stock line; immutable"]),
         ("cost snapshots / overheads", ["FK production run"]), ("payments / allocations", ["FK customer / invoice"]),
         ("credits / audit / tombstones", ["Retained financial history"])],
    ]
    for column, entries in enumerate(columns):
        for row, (title, detail) in enumerate(entries):
            x, y = column * (width + gap), 224 - row * 54
            box(drawing, x, y, width, height, title, detail)
            if row < 4 and column < 2:
                arrow(drawing, x + width / 2, y, x + width / 2, y - 7)
    return drawing


def topology():
    drawing = Drawing(WIDTH, 216)
    box(drawing, 0, 131, 235, 76, "Assessment demo", ["pandian-stores-app-1 : 127.0.0.1:3000",
                                                    "pandian-stores-db-1 : 127.0.0.1:5432",
                                                    "Named volume: persistent PostgreSQL data"])
    box(drawing, 276, 131, 235, 76, "Hardened local rehearsal", ["Proxy : 127.0.0.1:3443 (TLS)",
                                                             "Internal app / database networks",
                                                             "Separate data, secrets and credentials"])
    box(drawing, 0, 14, 235, 87, "Demo database boundary", ["Legacy SQL database/schema: nova",
                                                       "Separate nova_test for destructive tests",
                                                       "No seed/reset during normal launcher use",
                                                       "Original volume retained after rebrand"])
    box(drawing, 276, 14, 235, 87, "Production-mode boundary", ["Non-owner pandian_app runtime role",
                                                            "Privileged operator runs migrations",
                                                            "Encrypted backups outside Git",
                                                            "No public deployment approved"])
    arrow(drawing, 117, 131, 117, 101)
    arrow(drawing, 393, 131, 393, 101)
    return drawing


def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.roundRect(42, PAGE_H - 49, 21, 21, 5, fill=1, stroke=0)
    canvas.setFont(BOLD, 9)
    canvas.setFillColor(colors.HexColor("#e5c572"))
    canvas.drawCentredString(52.5, PAGE_H - 42.5, "PS")
    canvas.setFont(BOLD, 8)
    canvas.setFillColor(INK)
    canvas.drawString(71, PAGE_H - 41, "PANDIAN STORES  /  ARCHITECTURE")
    canvas.setStrokeColor(GOLD)
    canvas.line(42, 39, PAGE_W - 42, 39)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7)
    canvas.drawString(42, 26, "NIT Tiruchirappalli assessment | Fictional local demonstration | " + DATE)
    canvas.drawRightString(PAGE_W - 42, 26, str(doc.page))
    canvas.restoreState()


def build(path, story, title):
    document = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=42, rightMargin=42,
                                 topMargin=69, bottomMargin=55, title=title,
                                 author="Pandian Stores", pageCompression=1)
    document.build(story, onFirstPage=chrome, onLaterPages=chrome)


def heading(title, subtitle=None):
    result = [p(title, "H1PS")]
    if subtitle:
        result.append(p(subtitle, "CaptionPS"))
    return result


def complete_story():
    story = heading("System architecture", "Complete implementation guide | PostgreSQL-backed Order-to-Audit prototype")
    story += [layers(), p("Pandian Stores connects the production loop and the sales loop through one source-linked inventory ledger. A transaction is entered at its source and reused by stock, costs, receivables and reports."),
              table(["Loop", "Flow"], [
                  ["Production", "Purchase > raw stock > published BOM > actual material issues > good packets > variance and cost"],
                  ["Sales", "Salesman order > admin review > sample/real invoice > dispatch > payment allocation > outstanding"],
              ], [.19, .81]), Spacer(1, 8), p("System boundaries", "H2PS")]
    story += bullets([
        "One Next.js application and one PostgreSQL database per installation. No external accounting product is required for daily work.",
        "The evaluation installation contains fictional data and explicitly marked sample invoices. A separate hardened local installation refuses demo data.",
        "Business services own authorization and transactions; PostgreSQL guards protect immutable postings and allocation invariants.",
    ])
    story += [p("Reading map", "H2PS"), p("2. Request path and roles   3. Data model   4. Posting and production\n5. Costing   6. Sales and tax   7. Reporting\n8. Security   9. Docker and operations   10. Verification and submission")]

    story += [PageBreak()] + heading("02 / Request path and roles")
    story += [sequence([
        ("1. Browser interaction", "Responsive React forms, tables and role-aware navigation"),
        ("2. HTTP boundary", "Session lookup, origin checks, bounded JSON and Zod input"),
        ("3. Business service", "Current actor, role, customer scope and state transition"),
        ("4. Database transaction", "Locks, SQL guards, posting, snapshot and audit event"),
        ("5. Response / refresh", "Safe errors or committed result; no optimistic stock overwrite"),
    ]), table(["Role", "Operational access", "Boundary"], [
        ["Admin", "Masters, users, billing, stock, production, orders, dispatch, collections", "Full operational role; protected history remains immutable"],
        ["Production", "Suppliers, materials, BOMs, purchases, runs, overheads", "No sales/billing or user administration"],
        ["Salesman", "Assigned customers, own orders and permitted reports", "Ownership plus current territory required"],
        ["Owner", "Business-wide reading and eligible unused/draft deletion", "No create, edit, approval or posting"],
        ["Auditor", "Business-wide reading and report exports", "No mutations or deletion"],
    ], [.16, .45, .39]), Spacer(1, 10), p("Key HTTP routes", "H2PS"),
              p("/api/auth, /api/masters/[resource], /api/boms, /api/inventory, /api/production, /api/sales, /api/billing, /api/reports, /api/dashboard and /api/records. Routes call services rather than implementing a second set of business rules.")]

    story += [PageBreak()] + heading("03 / Data model")
    story += [p("Principal entities and foreign-key paths", "H2PS"), er_diagram(),
              p("The columns show the main identity, production/stock and accounting paths. Each product has a unique finished inventory item. Production and dispatch documents share stock_documents IDs so their movements retain a source.", "SmallPS"),
              table(["Entity group", "Relationships and purpose"], [
                  ["Identity", "Users have accounts, sessions and one assigned business role. Territories point to salesmen; customers point to territories."],
                  ["BOM", "A product has versioned BOMs; each version has material/packaging lines. Published content is immutable and one version is active."],
                  ["Stock", "Documents have lines; each posted line has one immutable movement. Supplier, item, actor and source document remain traceable."],
                  ["Sales", "Orders have lines and at most one invoice. An invoice has at most one full dispatch and one full credit note."],
                  ["Accounting", "Payments belong to customers; allocations link payments and invoices. Run material snapshots and append-only overheads determine reported costs."],
                  ["Supporting", "Units, prices, invoice sequences, demo/real business profiles and HSN settings, login counters, audit events and deletion tombstones."],
              ], [.21, .79], True), Spacer(1, 7),
              p("Derived views stock_summary, production_costs and invoice_balances calculate authoritative balances. Applied migrations 0000-0014 include custom SQL objects not completely represented by the ORM metadata.", "SmallPS")]

    story += [PageBreak()] + heading("04 / Ledger and production posting")
    story += [sequence([
        ("Draft", "Editable input; no inventory effect"),
        ("Post transaction", "Lock document and affected item IDs in sorted order"),
        ("Validate", "Units, complete lines, available stock and request identity"),
        ("Write together", "Signed movements, output receipt, snapshots and audit"),
        ("Commit or roll back", "Every stock effect succeeds together, or none does"),
    ]), p("Stock equation", "H2PS"),
              p("Opening + receipts - issues/sales +/- adjustments = closing. Posting writes movements; no user overwrites a balance. Retries return the original posting, while changed payloads cannot reuse its request key."),
              p("Production", "H2PS"),
              p("A run selects a published BOM revision and snapshots planned/actual quantities, tolerance, damage and good output. Planned component = BOM quantity x requested batches / standard batches. Posting issues all actual ingredients/packaging and receives good packets in one transaction."),
              p("Damaged packaging is a subset of total consumed packaging, not a second issue. The benchmark consumes 194 pouches including six damaged. Only 188 good packets are received."),
              table(["Unit boundary", "Conversion"], [
                  ["Mass", "kg <-> g by 1,000"], ["Volume", "L <-> ml by 1,000"],
                  ["Count", "Pieces and packets remain distinct"],
                  ["Cartons", "Packet conversion requires the product's explicit carton capacity"],
              ], [.25, .75], True)]

    story += [PageBreak()] + heading("05 / Valuation, variance and cost")
    story += [p("Moving weighted average", "H2PS"),
              p("Known signed ledger value divided by on-hand base quantity gives the moving average. Receipt value is quantity x entered rate; issues use the existing average. PostgreSQL NUMERIC retains intermediate precision. Unknown opening value propagates conservatively; zero stock has zero value."),
              table(["Benchmark component", "Calculation", "INR"], [
                  ["Flour", "(100 x 42 + 60 x 45) / 160 = 43.125/kg; issue 40 kg", "1,725"],
                  ["Oil", "10.5 L x 140", "1,470"], ["Spice", "1.2 kg x 200", "240"],
                  ["Pouches", "194 pieces x 2.50", "485"], ["Cartons", "9 pieces x 15", "135"],
                  ["Material total", "Posted issue snapshots", "4,055"],
                  ["Overheads", "Labour 1,200 + gas/power 600", "1,800"],
                  ["Run total", "4,055 + 1,800", "5,855"],
              ], [.22, .62, .16], True), Spacer(1, 9),
              p("Cost per good packet = INR 5,855 / 188 = INR 31.14 for display. Decimal.js uses forty significant digits; money display rounds half-up to two decimal places. Estimated margin at INR 50 is INR 18.86 / 37.71%. This is a run estimate, not realized dispatch profit."),
              p("Variance = (actual - planned) / planned x 100. An absolute unrounded percentage strictly greater than 3% alerts. Yield is -6%, oil +5%, pouch -3% (at tolerance), and carton -10%."),
              p("Valuation boundary", "H2PS"),
              p("Finished receipts include material cost only. Later append-only overheads update the run report without rewriting that receipt. Opening fifty finished packets have no historical value, so total finished-stock value and affected dispatch profit remain unknown. No explicit revaluation or overhead reversal is implemented.")]

    story += [PageBreak()] + heading("06 / Sales, tax and collections")
    story += [sequence([
        ("Submitted order", "Server-validated price list; assigned customer and own history"),
        ("Admin review", "Reasoned revisions, approval/rejection and stock availability"),
        ("Invoice", "Selected profile > immutable seller/customer/product/tax snapshot"),
        ("Full dispatch", "Recheck locked stock; source-linked ledger deduction"),
        ("Payment allocation", "Customer/invoice locks; exact allocation and outstanding"),
    ]), p("Tax and numbering", "H2PS"),
              p("Demo and real profiles/HSNs are separate PostgreSQL configuration. Real issue requires configured name, address, state, GSTIN checks and product HSN. The demo GSTIN is deliberately invalid. Every sample invoice states SAMPLE INVOICE - NOT VALID FOR TAX PURPOSES."),
              p("Same-state supply selects CGST/SGST; interstate supply selects IGST from the configured seller state and customer place of supply. The preview uses the selected profile; posted previews retain snapshot states. The exercise's 5% rate is not a statutory determination. Current supported states are Tamil Nadu and Karnataka."),
              p("Each taxable line and tax component rounds independently to paisa before summing. April-March financial-year counters are transactionally serialized, separately for SAMPLE and PANDIAN prefixes. Invoice retries do not increment again."),
              p("Allocations equal the positive payment amount, match its customer and cannot exceed invoice outstanding. Deferred SQL reconciliation complements application locks. Full credits retain the original invoice, reverse receivables and never return physical stock. Paid credits need a future refund model. There are no reservations or partial dispatches.")]

    story += [PageBreak()] + heading("07 / Reports and owner dashboard")
    story += [table(["Group", "Reports"], [
        ["Sales", "Sales register; customer sales; product sales; order register"],
        ["GST", "Outward GST review with signed full-credit events"],
        ["Purchasing", "Purchase register"],
        ["Stock", "Stock summary / historical stock; stock ledger"],
        ["Production", "Production register; consumption and variance"],
        ["Collections", "Payments; invoice collections/receivables; customer outstanding; ageing"],
    ], [.23, .77]), Spacer(1, 10),
              p("Query boundary", "H2PS"),
              p("Reports and dashboard use authorized SQL in read-only REPEATABLE READ transactions. They use Asia/Kolkata dates. Filters satisfy from <= to <= asOf; timestamp periods end at exclusive next-day midnight. Receivables include eligible older invoices through as-of; stock rolls forward through as-of."),
              p("Financial reports default to real scope; select demo to inspect the sample invoice/payment. Physical stock, purchases, production and unclassified orders are shared operational records. Salesmen retain ownership/territory restrictions; supervisors have four operational report types."),
              p("Exports and limits", "H2PS"),
              p("All fourteen report types export CSV and PDF. CSV can be opened in Excel, escapes values and protects formula-like content. PDFs paginate but currently support ASCII plus the sample-notice em dash; other characters render as question marks."),
              p("Report screens paginate fifty rows. Full totals/exports cap at 5,000 rows and a ten-second statement timeout; larger requests are rejected, not partially summed. Product-filtered collections select whole matching invoices because allocation is not per product."),
              p("The dashboard reads the same report services for orders, stock, variance, cost and dues. GST reports are reconciliation aids, not official GSTR-1/GSTR-3B submissions. Current master labels and order status are not a full historical replay.")]

    story += [PageBreak()] + heading("08 / Security and trust boundaries")
    story += [table(["Boundary", "Implemented control"], [
        ["Identity", "Database-backed Better Auth sessions; public signup disabled; role reloaded from PostgreSQL; eight-hour expiry"],
        ["Requests", "Origin validation, bounded JSON, Zod schemas, safe error responses and server-side role/customer checks"],
        ["Financial history", "Immutable movements/snapshots, transaction audit and reasoned adjustments/credits; protected deletion"],
        ["Sign-in", "Atomic HMAC account counters; hardened mode adds proxy-derived IP/subnet and global limits"],
        ["Runtime", "Non-root app; hardened read-only filesystem, dropped capabilities, bounded CPU/memory/PIDs/logs"],
        ["Secrets", "Private environment for demo; external file-mounted secrets and separate generated credentials for hardened mode"],
    ], [.20, .80]), Spacer(1, 10),
              p("Recorded security status - " + DATE, "H2PS"),
              p("The latest full and production-only npm audits return zero vulnerabilities. Earlier Stage 6 audits failed with sixteen/five high entries for GHSA-fc5q-39xc-vjpf. That advisory was withdrawn without a dependency-code patch. Bounded matcher denial-of-service was reproduced; no attacker-controlled glob pattern path was identified in the reviewed app. Image optimization remains disabled."),
              p("Hardened image scans still fail: app five high, database six high, proxy eight high; zero critical. These nineteen image entries represent nine CVE IDs. The inventory includes OpenSSL, musl, libxml2 and Caddy Go dependencies. Configuration limits exposure, but does not repair dependency code. Full evidence is in docs/security-review.md."),
              p("Public production deployment remains blocked. A host/database owner can bypass database guards. No external tamper-proof audit, MFA, DDoS protection, external penetration-test certification or government tax validation is claimed.")]

    story += [PageBreak()] + heading("09 / Docker, data and operations")
    story += [topology(), p("Naming and migration compatibility", "H2PS"),
              p("The visible business, project, launcher and new demo image use Pandian Stores. The Docker demo project is pandian-stores and its app image is pandian-stores-app:local. Existing posted invoice numbers, audit history, SQL namespace nova and NOVA_* configuration keys are retained for compatibility rather than rewritten."),
              p("Demo data is transferred only from a stopped PostgreSQL volume into a new branded volume, with table counts and row hashes compared. The original volume is retained as a recovery copy. A normal launcher start never seeds, resets or deletes records."),
              p("Hardened startup and recovery", "H2PS"),
              p("Production mode validates HTTPS origin, strong secret, non-owner runtime role, both demo flags false, and absence of demo identities/profiles/invoices before importing Next. Migrations use a separate owner/operator job; the app lacks DDL, TRUNCATE, trigger-disable and ownership privileges."),
              p("AES-256-GCM backups stream pg_dump without host plaintext. Restore authenticates the complete file before creating a new recovery database and compares all application tables/migration history. The operational database is not overwritten. Off-host copies, scheduled retention, alert delivery and loss-of-host recovery remain unproved."),
              p("The hardened TLS address uses a private local CA that is not installed into system trust automatically. No public DNS, hosting or production release is supplied by this local rehearsal.")]

    story += [PageBreak()] + heading("10 / Verification and submission")
    story += [table(["Benchmark check", "Expected result"], [
        ["Closing flour / oil / spice", "120 kg / 19.5 L / 3.8 kg"],
        ["Closing pouches / cartons", "306 / 21"], ["Production", "200 expected / 188 good; yield -6%, oil +5%"],
        ["Finished stock", "50 + 188 = 238; after dispatch 238 - 150 = 88"],
        ["Retailer A", "Taxable 7,500 + CGST 187.50 + SGST 187.50 = INR 7,875"],
        ["Collection / outstanding", "INR 4,000 / INR 3,875"],
        ["Distributor B", "120 requested - 88 available = 32 short; no deduction"],
        ["Run / packet cost", "INR 5,855 / 188 = INR 31.14 displayed"],
    ], [.34, .66], True), Spacer(1, 9),
              p("Validation strategy", "H2PS"),
              p("Vitest uses real isolated PostgreSQL. Browser suites cover mobile order entry, stock/production, each role's screens/exports, forbidden role/origin writes, retries and account switching. The seller-preview regression checks Tamil Nadu/Karnataka, missing real configuration and immutable posted states."),
              p("verify:system creates a disposable database, applies migrations twice, reruns the benchmark and reconciles fourteen report types with CSV/PDF. Normal Docker smoke checks login/logout and access without posting business documents. Run test suites sequentially because they share the isolated test database."),
              p("Reproduce and review", "H2PS"),
              p("Use README.md for Node 24/Docker setup, the six fictional logins and the startup command. Start-Pandian-Stores.cmd starts the configured Windows demo. The complete architecture is supplementary; the separate design note is limited to two pages for the assessment."),
              p("Submit the source repository with its real commit history and an accessible video of at most eight minutes, demonstrating the nine benchmark steps in order. Optional offline sync, batch/expiry, planning, GPS, Tally and Tamil UI are unimplemented. Final executed validation and actual upload status belong in README.md, not an assumed deployment claim."),
              p("Implementation references: src/lib/db/schema.ts; drizzle/0000-0014 SQL; src/modules/*; src/components/*; compose*.yaml; scripts/*; tests/*. No secrets or database contents are embedded in this document.", "CaptionPS")]
    return story


def summary_story():
    story = heading("Architecture design note", "Order-to-Audit | NIT Tiruchirappalli | Required two-page summary")
    story += [layers(), p("One Next.js/TypeScript app connects the sales and production loops through PostgreSQL. Better Auth manages sessions, Zod validates inputs, Drizzle supplies migrations/typed queries, and custom SQL guards the ledger and accounting invariants.", "SmallPS"),
              p("Data model and principal relationships", "H2PS"), er_diagram(),
              p("Users > territories > customers > orders > invoices is the sales path. Products > published BOMs > production runs > stock documents/lines is the production path. Stock movements reference their source line, document, item and actor. Each product has a unique inventory item. Invoices have at most one full dispatch and full credit; payments have multiple invoice allocations.", "SmallPS"),
              p("Supporting tables include accounts/sessions, roles, units, suppliers, prices, profiles/HSNs separated by demo/real mode, financial-year counters, audit events, login counters and deletion tombstones. Views derive stock, run cost and outstanding rather than storing editable totals.", "SmallPS"),
              p("Posting locks the document and item rows in sorted order. Validation, signed movements, snapshots, status and audit share one transaction. All stock effects commit together or roll back. Unique request/source keys protect retries. Published BOMs and posted financial history are immutable.", "SmallPS"),
              p("Sources: schema.ts; migrations 0000-0014; business services. Complete diagrams and operational boundaries: docs/pandian-stores-architecture.pdf.", "CaptionPS")]
    story += [PageBreak()] + heading("Posting, costing and controls")
    sections = [
        ("1 / Stock and units", "Opening + receipts - issues/sales +/- adjustments = closing. Quantities use g, ml, piece and packet; kg/L convert by 1,000 within dimension. Carton conversion needs explicit product capacity. Posting never overwrites balances; protected history uses adjustments/credits."),
        ("2 / BOM and variance", "Runs snapshot the published recipe and actual use/output. Planned component = BOM quantity x planned batches / standard batches. Damage is included in total consumption. Posting issues all actual inputs and receives good packets together. Absolute unrounded variance must exceed 3% to alert."),
        ("3 / Material valuation", "Moving weighted average = known signed ledger value / on-hand base quantity. Issues use that average; unknown opening value propagates. Zero stock has zero value. NUMERIC and Decimal.js avoid authoritative binary floating-point money. Explicit revaluation is unavailable."),
        ("4 / Run costing", "Posted material issue snapshots + append-only labour/utilities, divided by good output, gives run cost per packet. Finished receipts carry material cost only; later overheads do not rewrite them. Forty-significant-digit calculations display money half-up to two decimals. Margin is an estimate, not realized profit."),
        ("5 / Sales and accounting", "Ownership and current territory scope salesman access. Approval/invoice checks stock; full dispatch rechecks locked stock and deducts it. Invoices retain seller/customer/product/tax snapshots. April-March counters separate SAMPLE and PANDIAN. Exact allocations match the payment/customer and cannot overpay invoices; locks and deferred SQL reconciliation enforce this."),
        ("6 / Tax and audit", "Configured seller state drives tax preview and issue; posted previews use immutable states. Same-state CGST/SGST and interstate IGST use configurable rates. Demo GSTIN is deliberately invalid; sample invoices are not tax-valid. The exercise's 5% is not statutory advice. Audit events share the business transaction; a privileged database owner can bypass guards."),
        ("7 / Reporting and operations", "Read-only REPEATABLE READ reports use Asia/Kolkata dates, explicit real/demo financial scope and CSV/PDF exports. Results cap at 5,000 rows and ten seconds. The branded Docker demo is separate from the restricted-role TLS rehearsal. Encrypted recovery is local; off-host recovery/alerts remain unproved."),
        ("8 / Current release restriction", "As of 19 November 2026, both npm audits report zero after withdrawal of GHSA-fc5q-39xc-vjpf, without a code patch. The reproduced matcher primitive and historical failures remain documented. Image scans still fail: app/database/proxy 5/6/8 high entries, zero critical. Public deployment remains blocked; see docs/security-review.md."),
    ]
    for title, text in sections:
        story += [p(title, "H2PS"), p(text, "SmallPS")]
    story += [p("Benchmark: material 4,055 + overheads 1,800 = INR 5,855; 188 good packets => INR 31.14. Invoice 7,875 - payment 4,000 = INR 3,875. Finished 238 - dispatch 150 = 88; next order short 32. Opening fifty packets are unvalued, so affected finished valuation/dispatch profit remains unknown.", "SmallPS")]
    return story


def main():
    DOCS.mkdir(exist_ok=True)
    build(DOCS / "pandian-stores-architecture.pdf", complete_story(), "Pandian Stores - Complete Architecture")
    build(DOCS / "pandian-stores-design-note.pdf", summary_story(), "Pandian Stores - Architecture Design Note")
    legacy_copy = ROOT / "output" / "pdf" / "pandian-stores-design-note.pdf"
    legacy_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(DOCS / "pandian-stores-design-note.pdf", legacy_copy)
    print("Built complete architecture and synchronized the assessment design note.")


if __name__ == "__main__":
    main()
