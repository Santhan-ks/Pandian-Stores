export function textPdf(rows: string[], header: string[] = []): Buffer {
  const pages = [];
  const capacity = 48 - header.length;
  for (let i = 0; i < rows.length; i += capacity)
    pages.push([...header, ...rows.slice(i, i + capacity)]);
  if (!pages.length) pages.push(header);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const ids: number[] = [];
  for (const page of pages) {
    const id = objects.length + 1;
    ids.push(id);
    const commands = page
      .map(
        (r, i) =>
          `${i ? "0 -15 Td " : ""}(${r
            .replace(/\u2014/g, "\x97")
            .replace(/[^\x20-\x7e\x97]/g, "?")
            .replace(/[\\()]/g, "\\$&")}) Tj`,
      )
      .join("\n");
    const stream = `BT /F1 10 Tf 40 800 Td\n${commands}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${ids.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
