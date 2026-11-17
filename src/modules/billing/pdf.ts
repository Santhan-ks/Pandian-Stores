// A small text-only PDF writer for invoice snapshots. Byte offsets use the same ASCII encoding as the stream.
export function invoicePdf(snapshot: Record<string, unknown>): Buffer {
  const rows: string[] = [
    "NOVA - TAX INVOICE",
    "Exercise GST assumption; amounts in INR",
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
  const pages = [];
  for (let i = 0; i < rows.length; i += 48) pages.push(rows.slice(i, i + 48));
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const ids: number[] = [];
  for (const page of pages) {
    const id = objects.length + 1;
    ids.push(id);
    const commands = page
      .map(
        (r, i) =>
          `${i ? "0 -15 Td " : ""}(${r.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&")}) Tj`,
      )
      .join("\n");
    const stream = `BT /F1 10 Tf 40 800 Td\n${commands}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${ids.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
