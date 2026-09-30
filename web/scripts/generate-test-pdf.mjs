/**
 * Generates a REAL multi-section PDF (valid xref table, Helvetica text
 * objects) for the RAG end-to-end test. ASCII-only content keeps byte
 * offsets equal to string offsets, which the xref table requires.
 */

import { writeFileSync } from "node:fs";

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + " " + w : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Writes a PDF with one heading + wrapped paragraphs per topic, multiple
 * pages when content exceeds one page.
 */
export function generateMultiTopicPdf(filePath, topics) {
  // Build content streams: one per page.
  const pages = [];
  let currentOps = [];
  let y = 760;

  function newPage() {
    if (currentOps.length > 0) pages.push(currentOps.join("\n"));
    currentOps = [];
    y = 760;
  }

  function ensureSpace(lines) {
    if (y - lines * 16 < 60) newPage();
  }

  for (const topic of topics) {
    // Heading: larger font (18) — extraction uses font size for headings.
    ensureSpace(3);
    currentOps.push(
      "BT /F2 18 Tf 60 " + y + " Td (" + esc(topic.heading) + ") Tj ET",
    );
    y -= 30;

    for (const paragraph of topic.paragraphs) {
      const lines = wrap(paragraph, 80);
      for (const line of lines) {
        ensureSpace(1);
        currentOps.push(
          "BT /F1 11 Tf 60 " + y + " Td (" + esc(line) + ") Tj ET",
        );
        y -= 16;
        // Paragraph gap after the last line of this paragraph.
        if (line === lines[lines.length - 1]) y -= 10;
      }
    }
    y -= 8;
  }
  newPage();

  // Wrap each page's ops into a stream object (no filter — plain text).
  const objects = []; // strings, index = object number - 1
  // 1: Catalog, 2: Pages, then per page: page obj + content obj, then fonts.
  const pageObjNums = [];
  const contentObjNums = [];
  const firstPageObj = 3;

  const pageCount = pages.length;
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(firstPageObj + i * 2);
    contentObjNums.push(firstPageObj + i * 2 + 1);
  }
  const fontRegularNum = firstPageObj + pageCount * 2;
  const fontHeadingNum = fontRegularNum + 1;

  objects.push("<< /Type /Catalog /Pages 2 0 R >>"); // obj 1
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  objects.push(
    `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`,
  ); // obj 2

  pages.forEach((ops, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontHeadingNum} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`,
    );
    objects.push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  });

  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  );
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,
  );

  // Assemble with a valid xref table.
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  const count = objects.length + 1;
  pdf += `xref\n0 ${count}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < count; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  writeFileSync(filePath, pdf, "latin1");
}
