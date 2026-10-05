import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeReadingState } from "../lib/reading-state.ts";
import { fromText, groupBySections, replacePhysicalPageOCR, type Paper, type PaperPage } from "../lib/paper.ts";

const snapshot = {
  version: 1,
  paper: {
    title: "A paper",
    kind: "text",
    url: "blob:old",
    pages: [
      {
        number: 1,
        label: "Introduction",
        blocks: [{ id: "p1-b1", text: "Original text.", page: 1 }],
        scanned: false,
        sourcePages: [1],
      },
    ],
  },
  page: 500,
  sourcePage: 99,
  mode: "pdf",
  translations: { "p1-b1": "译文" },
  glossary: [{ term: "model", translation: "模型" }],
  messages: [{ role: "assistant", text: "Explanation." }],
  pageNotes: {},
  apiKey: "do-not-save",
  provider: "openai",
  attachment: { data: "private-screenshot" },
};

test("reading snapshots preserve work but discard credentials, screenshots and stale URLs", () => {
  const state = sanitizeReadingState(snapshot);
  assert.equal(state.page, 0);
  assert.equal(state.sourcePage, 1);
  assert.equal(state.mode, "both");
  assert.deepEqual(state.glossary, snapshot.glossary);
  assert.equal(state.translations["p1-b1"], "译文");
  const json = JSON.stringify(state);
  for (const secret of [
    "apiKey",
    "do-not-save",
    "private-screenshot",
    "blob:old",
  ])
    assert.equal(json.includes(secret), false);
});

test("corrupt or unsupported snapshots are rejected rather than restored", () => {
  assert.throws(() => sanitizeReadingState({ ...snapshot, version: 2 }));
  assert.throws(() =>
    sanitizeReadingState({
      ...snapshot,
      paper: { ...snapshot.paper, pages: [] },
    }),
  );
  assert.throws(() =>
    sanitizeReadingState({
      ...snapshot,
      messages: [{ role: "system", text: "bad" }],
    }),
  );
});

function pdfSnapshot() {
  const physicalPages: PaperPage[] = [
    {
      number: 1, label: "Page one", scanned: false,
      blocks: [
        { id: "p1-b1", text: "Introduction", page: 1 },
        { id: "p1-b2", text: "The paper introduces a useful and reproducible method.", page: 1 },
        { id: "p1-b3", text: "2 Methods", page: 1 },
        { id: "p1-b4", text: "The method is described in detail here.", page: 1 },
      ],
    },
    { number: 2, label: "Page two", scanned: true, blocks: [] },
  ];
  const paper: Paper = {
    title: "PDF paper", kind: "pdf", physicalPages,
    pages: groupBySections(physicalPages),
  };
  return { ...snapshot, paper, page: 1, sourcePage: 1, mode: "both" };
}

test("empty or duplicated source lists and duplicate reading IDs are rejected", () => {
  for (const sourcePages of [[], [1, 1]]) {
    assert.throws(() => sanitizeReadingState({
      ...snapshot,
      paper: { ...snapshot.paper, pages: [{ ...snapshot.paper.pages[0], sourcePages }] },
    }));
  }
  assert.throws(() => sanitizeReadingState({
    ...snapshot,
    paper: {
      ...snapshot.paper,
      pages: [snapshot.paper.pages[0], { ...snapshot.paper.pages[0], number: 2 }],
    },
  }));
});

test("legacy snapshots infer physical pages from blocks rather than section indices", () => {
  const saved = pdfSnapshot();
  delete saved.paper.physicalPages;
  for (const section of saved.paper.pages) {
    if (section.blocks.length) delete section.sourcePages;
  }
  // Both the introduction and methods sections share original PDF page one.
  const state = sanitizeReadingState({ ...saved, sourcePage: 99 });
  assert.equal(state.page, 1);
  assert.equal(state.sourcePage, 1);
  assert.deepEqual(state.paper.pages[1].sourcePages, [1]);
});

test("PDF source ranges and physical page numbers must remain valid", () => {
  const beyondLimit = pdfSnapshot();
  delete beyondLimit.paper.physicalPages;
  beyondLimit.paper.pages[0].sourcePages = [101];
  beyondLimit.paper.pages[0].blocks.forEach(block => { block.page = 101; });
  assert.throws(() => sanitizeReadingState(beyondLimit));

  const nonexistent = pdfSnapshot();
  nonexistent.paper.pages[0].sourcePages?.push(3);
  assert.throws(() => sanitizeReadingState(nonexistent));

  const repeatedPage = pdfSnapshot();
  repeatedPage.paper.physicalPages![1].number = 1;
  assert.throws(() => sanitizeReadingState(repeatedPage));

  const wrongPhysicalBlock = pdfSnapshot();
  wrongPhysicalBlock.paper.physicalPages![0].blocks[0].page = 2;
  assert.throws(() => sanitizeReadingState(wrongPhysicalBlock));
});

test("section content must agree with its canonical physical page", () => {
  const mismatch = pdfSnapshot();
  // groupBySections deliberately shares immutable blocks, so clone the section
  // to simulate a corrupted snapshot rather than changing the original too.
  mismatch.paper.pages[0].blocks = mismatch.paper.pages[0].blocks.map(block => ({ ...block }));
  mismatch.paper.pages[0].blocks[0].text = "Incorrect restored text.";
  assert.throws(() => sanitizeReadingState(mismatch));

  const dropped = pdfSnapshot();
  dropped.paper.pages[0].blocks.pop();
  assert.throws(() => sanitizeReadingState(dropped));

  const incorrectOCRStatus = pdfSnapshot();
  incorrectOCRStatus.paper.pages[2].scanned = false;
  assert.throws(() => sanitizeReadingState(incorrectOCRStatus));

  const invalidCrop = pdfSnapshot();
  invalidCrop.paper.pages[0].blocks[0].formulaCrop = { x: -1, y: 0, w: 0.5, h: 0.5 };
  assert.throws(() => sanitizeReadingState(invalidCrop));
});

test("valid OCR and pasted-text snapshots retain translations and page references", () => {
  const saved = pdfSnapshot();
  saved.paper = replacePhysicalPageOCR(saved.paper, 2, ["This is the recognized text on PDF page two."]);
  const pdfState = sanitizeReadingState(saved);
  assert.equal(pdfState.paper.physicalPages?.[1].blocks[0].id, "p2-ocr1");
  assert.equal(pdfState.paper.pages[1].blocks.at(-1)?.page, 2);

  const text = fromText("Introduction\n\nA readable short paragraph.\n\n2 Methods\n\nA second paragraph.", "Notes");
  const textState = sanitizeReadingState({ ...snapshot, paper: text, page: 1 });
  assert.equal(textState.sourcePage, 1);
  assert.equal(textState.translations["p1-b1"], "译文");
});
