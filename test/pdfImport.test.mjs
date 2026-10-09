import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { extractCvFromPdf } from "../setup-wizard.mjs";

test("PDF Import: Non-existent file throws File not found error", async () => {
  await assert.rejects(
    async () => {
      await extractCvFromPdf("non-existent-resume-file-xyz.pdf");
    },
    /File not found/
  );
});

test("PDF Import: pdf-parse v2 module exports PDFParse class with getText method", async () => {
  const mod = await import("pdf-parse");
  const PDFParseClass = mod.PDFParse || mod.default?.PDFParse;
  assert.strictEqual(typeof PDFParseClass, "function");
  assert.strictEqual(typeof PDFParseClass.prototype.getText, "function");
});

test("PDF Import: extractCvFromPdf parses valid PDF and extracts text", async () => {
  const samplePdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
72 712 Td
(Hello World Resume) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000302 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
397
%%EOF`;

  const tmpPdfPath = path.resolve("./test-sample.pdf");
  try {
    fs.writeFileSync(tmpPdfPath, samplePdf, "utf8");
    const extracted = await extractCvFromPdf(tmpPdfPath);
    assert.match(extracted, /Hello World Resume/);
  } finally {
    if (fs.existsSync(tmpPdfPath)) {
      fs.unlinkSync(tmpPdfPath);
    }
  }
});
