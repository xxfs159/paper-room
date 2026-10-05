import { z } from "zod";
import type { Paper } from "./paper";

const citation = z.object({
  id: z.string().max(80),
  quote: z.string().max(12000),
});
const block = z.object({
  id: z.string().min(1).max(80),
  text: z.string().max(12000),
  page: z.number().int().positive(),
  formulaCrop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().positive().max(1),
      h: z.number().positive().max(1),
    })
    .optional(),
});
const page = z.object({
  number: z.number().int().positive(),
  label: z.string().max(500),
  blocks: z.array(block).max(20000),
  scanned: z.boolean(),
  sourcePages: z.array(z.number().int().positive()).min(1).max(1000).optional(),
});
const paperSchema = z
  .object({
    title: z.string().max(500),
    kind: z.enum(["pdf", "text"]),
    pages: z.array(page).min(1).max(20000),
    physicalPages: z.array(page).min(1).max(1000).optional(),
  })
  .superRefine((paper, context) => {
    const issue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    const maximumPage = paper.kind === "pdf" ? 100 : 1000;
    const sectionsByID = new Map<string, z.infer<typeof block>>();
    const referencedPages = new Set<number>();

    for (const [index, section] of paper.pages.entries()) {
      if (section.number !== index + 1) {
        issue(["pages", index, "number"], "章节编号必须连续。");
      }
      const sources = section.sourcePages || [
        ...new Set(section.blocks.map((block) => block.page)),
      ];
      if (!sources.length) {
        issue(
          ["pages", index, "sourcePages"],
          "无文字章节必须保留明确的原页编号。",
        );
      }
      if (sources.some((number) => number > maximumPage)) {
        issue(["pages", index, "sourcePages"], "原页编号超过支持范围。");
      }
      if (new Set(sources).size !== sources.length) {
        issue(["pages", index, "sourcePages"], "原页编号不能重复。");
      }
      for (const number of sources) referencedPages.add(number);
      for (const [blockIndex, entry] of section.blocks.entries()) {
        if (sectionsByID.has(entry.id)) {
          issue(
            ["pages", index, "blocks", blockIndex, "id"],
            "段落编号不能重复。",
          );
        }
        sectionsByID.set(entry.id, entry);
        if (!sources.includes(entry.page) || entry.page > maximumPage) {
          issue(
            ["pages", index, "blocks", blockIndex, "page"],
            "段落原页必须属于本节。",
          );
        }
      }
    }

    if (!paper.physicalPages) return;
    if (paper.physicalPages.length > maximumPage) {
      issue(["physicalPages"], "原页数量超过支持范围。");
    }
    const physicalByID = new Map<string, z.infer<typeof block>>();
    for (const [index, physical] of paper.physicalPages.entries()) {
      if (physical.number !== index + 1) {
        issue(["physicalPages", index, "number"], "物理页编号必须连续。");
      }
      if (!referencedPages.has(physical.number)) {
        issue(["physicalPages", index], "原页缺少对应阅读章节。");
      }
      for (const [blockIndex, entry] of physical.blocks.entries()) {
        if (entry.page !== physical.number) {
          issue(
            ["physicalPages", index, "blocks", blockIndex, "page"],
            "段落原页与物理页不一致。",
          );
        }
        if (physicalByID.has(entry.id)) {
          issue(
            ["physicalPages", index, "blocks", blockIndex, "id"],
            "物理页段落编号不能重复。",
          );
        }
        physicalByID.set(entry.id, entry);
        const sectionBlock = sectionsByID.get(entry.id);
        if (
          !sectionBlock ||
          sectionBlock.page !== entry.page ||
          sectionBlock.text !== entry.text ||
          JSON.stringify(sectionBlock.formulaCrop) !==
            JSON.stringify(entry.formulaCrop)
        ) {
          issue(
            ["physicalPages", index, "blocks", blockIndex],
            "物理页与章节的段落内容不一致。",
          );
        }
      }
    }
    if (sectionsByID.size !== physicalByID.size) {
      issue(["pages"], "章节包含不属于原页的段落。");
    }
    for (const number of referencedPages) {
      if (number > paper.physicalPages.length) {
        issue(["pages"], "章节引用了不存在的原页。");
      }
    }
    for (const [index, section] of paper.pages.entries()) {
      const sources = section.sourcePages || [
        ...new Set(section.blocks.map((block) => block.page)),
      ];
      const requiresOCR = sources.some((number) => {
        const physical = paper.physicalPages?.[number - 1];
        return physical && (physical.scanned || !physical.blocks.length);
      });
      if (section.scanned !== requiresOCR) {
        issue(["pages", index, "scanned"], "章节识别状态与物理页不一致。");
      }
    }
  });
export const readingStateSchema = z.object({
  version: z.literal(1),
  paper: paperSchema,
  page: z.number().int().nonnegative(),
  sourcePage: z.number().int().positive(),
  mode: z.enum(["both", "original", "pdf"]),
  translations: z.record(z.string().max(100000)),
  glossary: z
    .array(
      z.object({ term: z.string().max(100), translation: z.string().max(200) }),
    )
    .max(80),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(100000),
        citations: z.array(citation).optional(),
        warnings: z.array(z.string()).optional(),
        scope: z.string().optional(),
      }),
    )
    .max(2000),
  pageNotes: z.record(z.array(z.string())),
});
export type ReadingState = z.infer<typeof readingStateSchema>;

/** An explicit allowlist: credentials, attachment screenshots and blob URLs never persist. */
export function sanitizeReadingState(value: unknown): ReadingState {
  const state = readingStateSchema.parse(value);
  state.page = Math.min(state.page, state.paper.pages.length - 1);
  for (const section of state.paper.pages) {
    // Older snapshots may have only sections. A section number is not a PDF
    // page number, so restore the source list from its blocks first.
    section.sourcePages ||= [
      ...new Set(section.blocks.map((block) => block.page)),
    ];
    if (!section.sourcePages.length) section.sourcePages.push(section.number);
  }
  const sourcePages = state.paper.pages[state.page].sourcePages!;
  if (!sourcePages.includes(state.sourcePage))
    state.sourcePage = sourcePages[0];
  if (state.paper.kind === "text" && state.mode === "pdf") state.mode = "both";
  return state;
}

const DATABASE = "paper-room-reading";
const STORE = "readings";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("请关闭其他 Paper Room 页面后重试。"));
  });
}

export async function saveReading(
  state: ReadingState,
  file: Blob | null,
): Promise<void> {
  const safe = sanitizeReadingState(state);
  if (safe.paper.kind === "pdf" && !file)
    throw new Error("缺少原 PDF，无法保存阅读。");
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ state: safe, file }, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function loadReading(): Promise<{
  state: ReadingState;
  file: Blob | null;
} | null> {
  const db = await database();
  try {
    const saved = await new Promise<
      { state: unknown; file: Blob | null } | undefined
    >((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!saved) return null;
    const state = sanitizeReadingState(saved.state);
    if (
      state.paper.kind === "pdf" &&
      (!(saved.file instanceof Blob) || saved.file.size > 20 * 1024 * 1024)
    ) {
      throw new Error("保存的 PDF 无效，请重新导入。");
    }
    return { state, file: saved.file };
  } finally {
    db.close();
  }
}

export async function clearReading(): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete("current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function restorablePaper(state: ReadingState, url?: string): Paper {
  return { ...state.paper, ...(url ? { url } : {}) };
}
