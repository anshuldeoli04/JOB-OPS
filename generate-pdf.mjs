#!/usr/bin/env node
/**
 * PDF generator for JOB-OPS resume builder.
 * Uses the project's Playwright dependency so Windows users do not need
 * Python WeasyPrint/native GTK libraries just to export a resume PDF.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "playwright";

async function main() {
  const [, , htmlFileArg, pdfFileArg] = process.argv;

  if (!htmlFileArg || !pdfFileArg) {
    console.error("Usage: node generate-pdf.mjs input.html output.pdf");
    process.exit(1);
  }

  const htmlFile = path.resolve(htmlFileArg);
  const pdfFile = path.resolve(pdfFileArg);

  if (!fs.existsSync(htmlFile)) {
    console.error(`ERROR: HTML file not found: ${htmlFile}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(pdfFile), { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ["--headless=new"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: pdfFile,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  const stats = fs.statSync(pdfFile);
  if (stats.size < 1000) {
    console.error(`ERROR: PDF generated but looks empty: ${pdfFile}`);
    process.exit(1);
  }

  console.log(`SUCCESS: ${pdfFile}`);
}

export { main };

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
