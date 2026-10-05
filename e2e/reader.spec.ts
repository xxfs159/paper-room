import { expect, test, type Page } from "@playwright/test";
import type { ModelResult } from "../lib/paper";

const emptyResult: ModelResult = {
  translations: [],
  answer: "",
  citations: [],
  warnings: [],
  glossary: [],
  transcript: [],
  summary: [],
  highlights: [],
};

async function mockAI(page: Page) {
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/assist", async (route) => {
    const request = route.request().postDataJSON();
    const result = { ...emptyResult };
    if (request.action === "translate") {
      result.translations = request.blocks.map((block: { id: string }) => ({
        id: block.id,
        text: "已核对的中文译文。",
      }));
      Object.assign(result, {
        glossary: [{ term: "test-term", translation: "测试术语" }],
      });
    } else if (request.action === "ocr") {
      Object.assign(result, {
        transcript: [
          "Results",
          "Recognized evidence from the scanned second page with enough readable text.",
        ],
      });
    }
    await route.fulfill({ json: result });
  });
}

async function connect(page: Page) {
  await page.getByRole("button", { name: "连接 AI", exact: true }).click();
  await page.getByLabel("模型服务").selectOption("openai");
  await page.getByRole("button", { name: "完成", exact: true }).click();
}

async function savedText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const opening = indexedDB.open("paper-room-reading", 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db
            .transaction("readings")
            .objectStore("readings")
            .get("current");
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(request.result?.state || {}));
          };
        };
      }),
  );
}

test("translation and glossary survive a new conversation and reload; clearing storage removes the saved reading", async ({
  page,
}) => {
  await mockAI(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "粘贴原文" }).click();
  await page.getByLabel("论文标题（可选）").fill("Reading recovery");
  await page
    .getByLabel("论文原文", { exact: true })
    .fill(
      "Introduction\n\nOriginal evidence for a reproducible reading session.",
    );
  await page.getByRole("button", { name: "开始阅读" }).click();
  await connect(page);
  await page.getByRole("button", { name: "翻译本节", exact: true }).click();
  await expect(page.getByText("已核对的中文译文。").first()).toBeVisible();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "test-term 测试术语" }),
  ).toBeVisible();
  await expect.poll(() => savedText(page)).toContain("已核对的中文译文。");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reading recovery", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("已核对的中文译文。").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "test-term 测试术语" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除本地保存", exact: true }).click();
  await expect(
    page.getByText("已清除本机保存，自动保存已关闭。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reading recovery", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始阅读" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "粘贴原文" })).toBeVisible();
});

function mixedPDF(): Buffer {
  const streams = [
    "BT /F1 12 Tf 40 740 Td (Introduction) Tj 0 -24 Td (Original evidence has enough text to avoid OCR.) Tj ET",
    "BT /F1 12 Tf 40 740 Td (Fig.) Tj ET",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...streams.map(
      (stream) =>
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("a lightly extracted PDF page has an OCR entry and remains recoverable after OCR", async ({
  page,
}) => {
  await mockAI(page);
  await page.goto("/");
  await page
    .getByLabel("选择论文 PDF")
    .setInputFiles({
      name: "Mixed scan.pdf",
      mimeType: "application/pdf",
      buffer: mixedPDF(),
    });
  await expect(
    page.getByRole("heading", { name: "Mixed scan", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /第 2 页 · 待识别/ }).click();
  await expect(
    page.getByRole("button", { name: "识别本页文字" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "翻译本节", exact: true }),
  ).toBeDisabled();
  await connect(page);
  await page.getByRole("button", { name: "识别本页文字" }).click();
  await expect(
    page.getByText(
      "Recognized evidence from the scanned second page with enough readable text.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "翻译本节", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() => savedText(page))
    .toContain("Recognized evidence from the scanned second page");
  await page.reload();
  await expect(
    page.getByText(
      "Recognized evidence from the scanned second page with enough readable text.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /第 2 页 · 待识别/ }),
  ).toHaveCount(0);
});
