import { readFileSync, rmSync } from "node:fs";
import { generateMultiTopicPdf } from "./generate-test-pdf.mjs";

generateMultiTopicPdf(".tmp-debug.pdf", [
  {
    heading: "Newton's Laws of Motion",
    paragraphs: [
      "Newton first law inertia. Newton second law force equals mass times acceleration. Newton third law action reaction pairs.",
    ],
  },
]);

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(".tmp-debug.pdf")),
  useWorkerFetch: false,
  isEvalSupported: false,
  disableFontFace: true,
} as Parameters<typeof pdfjs.getDocument>[0]).promise;

const page = await doc.getPage(1);
const { items } = await page.getTextContent();
for (const item of items) {
  if (!("str" in item)) continue; // skip TextMarkedContent nodes
  console.log(
    JSON.stringify({
      str: item.str,
      size: item.transform?.[3],
      eol: item.hasEOL,
    }),
  );
}
rmSync(".tmp-debug.pdf", { force: true });
