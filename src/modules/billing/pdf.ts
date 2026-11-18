import { textPdf } from "../../lib/pdf/text";
import { SAMPLE_NOTICE } from "./notice";
// A small text-only PDF writer for invoice snapshots. Byte offsets use the same ASCII encoding as the stream.
export function invoicePdf(snapshot: Record<string, unknown>): Buffer {
  const rows: string[] = [
    snapshot.mode === "real"
      ? `${businessName} - TAX INVOICE`
      : `${businessName} - ${SAMPLE_NOTICE}`,
    snapshot.mode === "real"
      ? "Amounts in INR"
      : "Exercise GST assumption; amounts in INR",
  ];
  const seller = snapshot.seller as Record<string, string>;
  const buyer = snapshot.customer as Record<string, string>;
  const lines = snapshot.lines as Record<string, string>[];
  function row(text: string) {
    for (let i = 0; i < text.length; i += 90) rows.push(text.slice(i, i + 90));
  }
  row(
    `Invoice: ${snapshot.number}   Date: ${snapshot.date}   FY: ${snapshot.financialYear}`,
  );
  row(`Seller: ${seller.name}`);
  row(`Address: ${seller.address}`);
  row(`GSTIN: ${seller.gstin}   State: ${seller.state}`);
  row(`Bill to: ${buyer.name}`);
  row(`Billing address: ${buyer.address}`);
  row(
    `Buyer GSTIN: ${buyer.gstin ?? "Unregistered"}   Place of supply: ${snapshot.placeOfSupply}`,
  );
  lines.forEach((l, i) => {
    rows.push("");
    row(`${i + 1}. ${l.description}   HSN: ${l.hsn}`);
    row(
      `Quantity: ${l.quantity} ${l.unit}   Rate INR: ${l.rate}   GST: ${l.gstPercent}%`,
    );
    row(
      `Taxable: ${l.taxable}   CGST: ${l.cgst}   SGST: ${l.sgst}   IGST: ${l.igst}`,
    );
    row(`Line total INR: ${l.total}`);
  });
  rows.push("");
  row(`Invoice total INR: ${snapshot.total}`);
  return textPdf(rows);
}
import { businessName } from "../../lib/brand";
