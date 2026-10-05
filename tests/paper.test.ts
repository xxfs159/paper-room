import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractBlocks,
  fromText,
  groupBySections,
  replacePhysicalPageOCR,
  unrecognizedPages,
  type Block,
  type Paper,
  type PaperPage,
} from '../lib/paper.ts';

function physicalPage(number: number, texts: string[], scanned = false): PaperPage {
  return {
    number,
    label: `第 ${number} 页`,
    scanned,
    blocks: texts.map((text, index) => ({ id: `p${number}-b${index + 1}`, page: number, text })),
  };
}

function pdf(physicalPages: PaperPage[]): Paper {
  return { title: 'Test paper', kind: 'pdf', physicalPages, pages: groupBySections(physicalPages) };
}

test('mixed PDFs keep empty and lightly extracted pages separate and incomplete', () => {
  const paper = pdf([
    physicalPage(1, ['Introduction', 'This is the complete text of the introduction.']),
    physicalPage(2, [], true),
    physicalPage(3, ['Figure 1'], true),
    physicalPage(4, ['2 Results', 'The experiment reports the following reliable results.']),
  ]);

  assert.equal(paper.pages.length, 4);
  assert.deepEqual(paper.pages.map(section => section.sourcePages), [[1], [2], [3], [4]]);
  assert.deepEqual(paper.pages.map(section => section.scanned), [false, true, true, false]);
  assert.equal(paper.pages[2].blocks[0].text, 'Figure 1');
  assert.deepEqual(unrecognizedPages(paper), [2, 3]);
  // Translating every extracted block cannot make a page requiring OCR complete.
  const translations = Object.fromEntries(paper.pages.flatMap(section => section.blocks).map(block => [block.id, '译文']));
  const completed = paper.pages.filter(section => !section.scanned && section.blocks.every(block => translations[block.id]));
  assert.equal(completed.length, 2);
});

test('a heading-like first line followed by paragraph text does not create a section', () => {
  const pages = groupBySections([
    physicalPage(1, [
      'Abstract',
      'The abstract has enough content to form the first section.',
      'Introduction\nThis is part of an extracted paragraph, not a separate heading.',
      '2 Methods\nThis sentence belongs to the same extracted paragraph.',
      '2 Methods',
      'The separately extracted method heading begins a real section.',
    ]),
  ]);

  assert.deepEqual(pages.map(section => section.label), ['Abstract', '2 Methods']);
  assert.equal(pages[0].blocks.length, 4);
  assert.equal(pages[1].blocks.length, 2);
});

test('OCR replaces all content from a physical page spanning multiple sections', () => {
  const paper = pdf([
    physicalPage(1, ['1 Introduction', 'This original content introduces the topic.']),
    physicalPage(2, [
      'A paragraph continuing the introduction from page one.',
      '2 Methods',
      'An original paragraph discussing the method on page two.',
    ]),
    physicalPage(3, ['A method paragraph on page three that must remain unchanged.']),
  ]);
  assert.equal(paper.pages.filter(section => section.sourcePages?.includes(2)).length, 2);
  const original = structuredClone(paper);
  const revised = replacePhysicalPageOCR(paper, 2, [
    'A corrected introduction paragraph from page two.',
    '2 Methods',
    'A corrected method paragraph from page two.',
  ]);
  const allBlocks = revised.pages.flatMap(section => section.blocks);
  const pageTwo = allBlocks.filter(block => block.page === 2);

  assert.equal(pageTwo.length, 3);
  assert.deepEqual(pageTwo.map(block => block.id), ['p2-ocr1', 'p2-ocr2', 'p2-ocr3']);
  assert.equal(new Set(allBlocks.map(block => block.id)).size, allBlocks.length);
  assert.ok(allBlocks.every(block => !block.text.includes('original paragraph')));
  assert.deepEqual(revised.physicalPages?.[0], paper.physicalPages?.[0]);
  assert.deepEqual(revised.physicalPages?.[2], paper.physicalPages?.[2]);
  assert.deepEqual(paper, original, 'the source paper must not be mutated');

  const repeated = replacePhysicalPageOCR(revised, 2, ['Final replacement, with no earlier OCR text.']);
  assert.equal(repeated.pages.flatMap(section => section.blocks).filter(block => block.page === 2).length, 1);
  assert.equal(repeated.physicalPages?.[1].blocks[0].text, 'Final replacement, with no earlier OCR text.');
});

test('recognizing a scan clears only its pending OCR status and reconnects sections', () => {
  const paper = pdf([
    physicalPage(1, ['Introduction', 'The introductory text on page one.']),
    physicalPage(2, [], true),
    physicalPage(3, [], true),
  ]);
  const revised = replacePhysicalPageOCR(paper, 2, ['The introduction continues on the recognized second page.']);

  assert.deepEqual(unrecognizedPages(revised), [3]);
  assert.deepEqual(revised.pages[0].sourcePages, [1, 2]);
  assert.equal(revised.pages[0].scanned, false);
  assert.equal(revised.pages[1].scanned, true);
});

test('empty OCR, unknown pages, and non-PDF OCR fail without altering content', () => {
  const paper = pdf([physicalPage(1, [], true)]);
  assert.throws(() => replacePhysicalPageOCR(paper, 1, [' ', '\n']), /未识别出文字/);
  assert.throws(() => replacePhysicalPageOCR(paper, 2, ['Readable text']), /找不到/);
  assert.throws(() => replacePhysicalPageOCR(fromText('Some text', 'Title'), 1, ['Readable text']), /只有 PDF/);
  assert.deepEqual(unrecognizedPages(paper), [1]);
});

test('legacy section-only PDFs reconstruct physical pages before OCR replacement', () => {
  const original = pdf([
    physicalPage(1, ['Introduction', 'This introductory paragraph remains unchanged.']),
    physicalPage(2, ['Continuation text with enough extracted characters.', '2 Methods', 'Old methods text.']),
    physicalPage(3, [], true),
  ]);
  const legacy: Paper = { title: original.title, kind: 'pdf', pages: original.pages };
  const revised = replacePhysicalPageOCR(legacy, 2, ['Corrected page two content.']);

  assert.deepEqual(revised.physicalPages?.map(page => page.number), [1, 2, 3]);
  assert.equal(revised.pages.flatMap(section => section.blocks).filter(block => block.page === 2).length, 1);
  assert.deepEqual(unrecognizedPages(revised), [3]);
});

test('pasted text keeps short valid fragments readable and preserves physical page identity', () => {
  const paper = fromText('Abstract\n\nShort text.\n\nIntroduction\n\nAnother short paragraph.', '  Notes  ');
  assert.equal(paper.title, 'Notes');
  assert.equal(paper.kind, 'text');
  assert.equal(paper.pages.length, 2);
  assert.deepEqual(paper.pages.map(section => section.scanned), [false, false]);
  assert.equal(paper.physicalPages?.length, 1);
  assert.ok(paper.pages.flatMap(section => section.blocks).every(block => block.page === 1));
  assert.deepEqual(unrecognizedPages(paper), []);
});

test('PDF extraction preserves separate headings and gives formula crops physical page IDs', () => {
  const items = [
    { str: 'Introduction', transform: [12, 0, 0, 12, 20, 180], width: 80, height: 12 },
    { str: 'Ordinary prose from the PDF page.', transform: [12, 0, 0, 12, 20, 145], width: 160, height: 12 },
    { str: 'x', transform: [12, 0, 0, 12, 20, 100], width: 6, height: 12 },
    { str: '=', transform: [12, 0, 0, 12, 20, 86], width: 6, height: 12 },
    { str: '√y', transform: [12, 0, 0, 12, 20, 72], width: 12, height: 12 },
  ];
  const blocks: Block[] = extractBlocks(items, 4, 300, 200);
  assert.equal(blocks[0].text, 'Introduction');
  assert.equal(blocks[0].id, 'p4-b1');
  assert.ok(blocks.every(block => block.page === 4));
  const formula = blocks.find(block => block.formulaCrop);
  assert.ok(formula, 'fragmented formula keeps a crop for consulting the original');
  const crop = formula.formulaCrop;
  assert.ok(crop);
  assert.ok(crop.x >= 0 && crop.x <= 1);
  assert.ok(crop.y >= 0 && crop.y <= 1);
});
