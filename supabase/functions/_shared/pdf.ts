/**
 * PDF text extraction via pdfjs-dist, shared by the ingestion edge function
 * (imported through Deno's npm: specifier) and local tests (spec section 6:
 * extraction lives in the shared RAG layer, never duplicated per app).
 *
 * Output is Markdown-ish text: pages join with blank lines and headings get
 * a "# " prefix so chunkPassages() can treat them as topic boundaries.
 *
 * Heading detection is FONT-SIZE aware: pdfjs exposes each text item's
 * transform, from which the font size is derived. A line is a heading when
 * its font is meaningfully larger than the page's body text — wrapped body
 * lines never qualify, unlike pure text heuristics.
 */

type TextItem = { str?: string; hasEOL?: boolean; transform?: number[] };

type PdfJsModule = {
  getDocument: (src: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: TextItem[] }>;
      }>;
    }>;
  };
};

const BODY_FONT_SIZE = 11; // typical body text in study PDFs
const HEADING_RATIO = 1.25; // heading = 25%+ larger than body

export class PdfPageLimitError extends Error {
  constructor() {
    super("This PDF has too many pages to process in one upload.");
    this.name = "PdfPageLimitError";
  }
}

/**
 * Fold typographic punctuation to ASCII forms. PDF StandardEncoding maps
 * the ASCII apostrophe byte to U+2019 (\u2019), so extracted text carries
 * curly quotes/dashes that would never match a plain-text query.
 */
function normalizePunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");
}

export async function extractTextFromPdf(
  bytes: Uint8Array,
  maxPages: number,
): Promise<string> {
  // Dynamic import keeps pdfjs out of any main bundle. The specifier MUST be
  // a pinned npm: URL — bare specifiers ("pdfjs-dist") are not resolvable by
  // the Supabase edge deploy-time bundler (deploy 500s with
  // "Relative import path not prefixed with / or ./ or ../"), and unpinned
  // npm: URLs would risk breaking on a new major. Pin matches the web app
  // (web/package.json: pdfjs-dist ^6.3.289).
  // The legacy build is required: pdfjs itself warns that the modern build
  // breaks under Node's crypto (hashOriginal.toHex), while the legacy build
  // works in Node and Deno alike.
  const pdfjs = (await import(
    /* webpackIgnore: true */ "npm:pdfjs-dist@6.3.289/legacy/build/pdf.mjs"
  )) as unknown as PdfJsModule;

  // No DOM worker in edge/Node runtimes — pdfjs falls back to its
  // same-thread fake worker automatically when no workerSrc is set.
  const doc = await pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  if (doc.numPages > maxPages) {
    throw new PdfPageLimitError();
  }

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const { items } = await page.getTextContent();

    // Derive the dominant (body) font size on this page for the ratio check.
    const sizes = items
      .map((item) => item.transform?.[3] ?? 0)
      .filter((size) => size > 0);
    const pageSize =
      sizes.length > 0
        ? sizes.slice().sort((a, b) => a - b)[Math.floor(sizes.length / 2)]
        : BODY_FONT_SIZE;

    let pageText = "";
    let currentSize = 0;
    let lineSoFar = "";

    const flushLine = () => {
      const line = lineSoFar.replace(/\s+/g, " ").trim();
      if (line) {
        const isHeading =
          currentSize >= pageSize * HEADING_RATIO && line.length <= 120;
        pageText += isHeading ? `# ${line}\n` : `${line}\n`;
      }
      lineSoFar = "";
    };

    for (const item of items) {
      if (typeof item.str !== "string") continue;
      const size = item.transform?.[3] ?? pageSize;
      // Flush BEFORE updating the size: pdfjs often delivers an empty
      // end-of-line item at body size right after a heading; flushing on
      // the size change (not the text) keeps the heading judged with its
      // own font size.
      if (lineSoFar && size !== currentSize) {
        flushLine();
      }
      currentSize = size;
      lineSoFar += item.str;
      if (item.hasEOL) flushLine();
    }
    flushLine();

    const cleaned = pageText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");

    if (cleaned) pages.push(cleaned);
  }

  if (pages.length === 0) {
    throw new Error(
      "No extractable text found — this PDF may be scanned images rather than text.",
    );
  }

  return normalizePunctuation(pages.join("\n\n"));
}
