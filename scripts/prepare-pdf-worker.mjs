import { copyFileSync, mkdirSync } from "node:fs";

export function preparePdfWorker() {
  const output = new URL("../public/pdfjs/", import.meta.url);
  mkdirSync(output, { recursive: true });
  // Serve the matching worker unchanged: framework HMR code requires window,
  // which does not exist inside a Web Worker.
  copyFileSync(
    new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
    new URL("pdf.worker.mjs", output),
  );
}
