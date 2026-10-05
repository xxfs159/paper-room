export type Block = {
  id: string;
  text: string;
  /** Original PDF page (or original text fragment), never a section index. */
  page: number;
  formulaCrop?: { x: number; y: number; w: number; h: number };
};

export type PaperPage = {
  number: number;
  label: string;
  blocks: Block[];
  scanned: boolean;
  sourcePages?: number[];
};

export type Paper = {
  title: string;
  /** Reading sections derived from physicalPages. */
  pages: PaperPage[];
  /** Canonical page content: OCR replaces a physical page before regrouping. */
  physicalPages?: PaperPage[];
  url?: string;
  kind: 'pdf' | 'text';
};

export type ModelResult = {
  translations: { id: string; text: string }[];
  answer: string;
  citations: { id: string; quote: string }[];
  warnings: string[];
  glossary: { term: string; translation: string }[];
  transcript: string[];
  summary: string[];
  highlights: { id: string; quote: string }[];
};

export function splitText(text: string): string[] {
  return text.split(/\n\s*\n/).flatMap(paragraph => {
    const result: string[] = [];
    let remaining = paragraph.trim();
    while (remaining.length > 2200) {
      let cut = remaining.lastIndexOf('. ', 2200);
      if (cut < 600) cut = remaining.lastIndexOf('。', 2200) + 1;
      if (cut < 600) cut = 2000;
      result.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) result.push(remaining);
    return result;
  }).filter(Boolean);
}

export function fromText(text: string, title: string): Paper {
  const blocks = splitText(text);
  const physicalPages: PaperPage[] = [];
  let batch: string[] = [];
  let size = 0;

  function flush() {
    const number = physicalPages.length + 1;
    physicalPages.push({
      number,
      label: `文本片段 ${number}`,
      scanned: false,
      blocks: batch.map((text, index) => ({
        id: `p${number}-b${index + 1}`,
        page: number,
        text,
      })),
    });
    batch = [];
    size = 0;
  }

  for (const block of blocks) {
    if (size + block.length > 6000 && batch.length) flush();
    batch.push(block);
    size += block.length;
  }
  if (batch.length) flush();
  return {
    title: title.trim() || '未命名论文',
    kind: 'text',
    physicalPages,
    pages: groupBySections(physicalPages),
  };
}

function sectionHeading(text: string): string | null {
  const title = text.trim();
  // A heading must occupy the complete block. The first line of a paragraph
  // can look like a heading even when the rest of the block is ordinary text.
  if (!title || title.includes('\n') || title.length > 115) return null;
  if (/^(abstract|introduction|background|related work|method(?:ology)?|experiments?|results?|discussion|conclusions?|references|appendix(?: [A-Z])?|acknowledg(?:e)?ments?|摘要|引言|绪论|相关工作|方法|实验|结果|讨论|结论|参考文献|附录|致谢)$/i.test(title)) {
    return title;
  }
  if (
    /^(?:[1-9]\d?(?:\.[1-9]\d?){0,3}|[IVX]{1,5})[.、]?\s+[^\d].{2,100}$/i.test(title)
    && !/[.!?。！？]$/.test(title)
    && title.split(/\s+/).length <= 13
  ) {
    return title;
  }
  return null;
}

export function groupBySections(physicalPages: PaperPage[]): PaperPage[] {
  const sections: PaperPage[] = [];
  const newSection = (label = '标题与作者'): PaperPage => ({
    number: sections.length + 1,
    label,
    blocks: [],
    scanned: false,
    sourcePages: [],
  });
  let current = newSection();
  const flush = () => {
    if (!current.blocks.length && !current.sourcePages?.length) return;
    current.number = sections.length + 1;
    sections.push(current);
  };

  for (const physical of physicalPages) {
    if (physical.scanned || !physical.blocks.length) {
      // Keep pages requiring OCR visible and incomplete, including pages with
      // a few extracted labels. They must not disappear into a translated section.
      flush();
      sections.push({
        number: sections.length + 1,
        label: `第 ${physical.number} 页 · 待识别`,
        blocks: [...physical.blocks],
        scanned: true,
        sourcePages: [physical.number],
      });
      current = newSection(`第 ${physical.number + 1} 页`);
      continue;
    }

    for (const block of physical.blocks) {
      const title = sectionHeading(block.text);
      if (title && current.blocks.length) {
        flush();
        current = newSection(title);
      } else if (title) {
        current.label = title;
      }
      if (!current.sourcePages?.includes(block.page)) {
        current.sourcePages?.push(block.page);
      }
      current.blocks.push(block);
    }
    if (!current.sourcePages?.includes(physical.number)) {
      current.sourcePages?.push(physical.number);
    }
  }
  flush();
  return sections;
}

/** Restore original pages for older reading states that only stored sections. */
function physicalPagesOf(paper: Paper): PaperPage[] {
  if (paper.physicalPages) return paper.physicalPages;
  const originals = new Map<number, PaperPage>();
  const pageFor = (number: number) => {
    let page = originals.get(number);
    if (!page) {
      page = { number, label: `第 ${number} 页`, blocks: [], scanned: false };
      originals.set(number, page);
    }
    return page;
  };

  for (const section of paper.pages) {
    for (const number of section.sourcePages || []) {
      const page = pageFor(number);
      if (section.scanned) page.scanned = true;
    }
    for (const block of section.blocks) {
      const page = pageFor(block.page);
      if (!page.blocks.some(existing => existing.id === block.id)) {
        page.blocks.push(block);
      }
    }
  }
  return [...originals.values()].sort((a, b) => a.number - b.number).map(page => ({
    ...page,
    scanned: page.scanned || !page.blocks.length || (
      paper.kind === 'pdf'
      && page.blocks.reduce((length, block) => length + block.text.trim().length, 0) < 30
    ),
  }));
}

export function unrecognizedPages(paper: Paper): number[] {
  if (paper.kind !== 'pdf') return [];
  return physicalPagesOf(paper)
    .filter(page => page.scanned || !page.blocks.length)
    .map(page => page.number);
}

export function replacePhysicalPageOCR(
  paper: Paper,
  physicalPage: number,
  transcript: string[],
): Paper {
  if (paper.kind !== 'pdf') throw new Error('只有 PDF 可以识别原页文字。');
  const originals = physicalPagesOf(paper);
  if (!originals.some(page => page.number === physicalPage)) {
    throw new Error('找不到要识别的 PDF 原页。');
  }
  const text = transcript.map(line => line.trim()).filter(Boolean).join('\n\n');
  const paragraphs = splitText(text);
  if (!paragraphs.length) throw new Error('未识别出文字，请核对原页后重试。');

  const physicalPages = originals.map(page => page.number !== physicalPage ? page : {
    ...page,
    scanned: false,
    blocks: paragraphs.map((text, index) => ({
      id: `p${physicalPage}-ocr${index + 1}`,
      page: physicalPage,
      text,
    })),
  });
  return { ...paper, physicalPages, pages: groupBySections(physicalPages) };
}

type Item = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

export function extractBlocks(
  items: Item[],
  page: number,
  width: number,
  height = width * 1.4,
): Block[] {
  // Preserve the PDF's own item order. Most scholarly PDFs encode column order already.
  const groups: {
    text: string;
    y: number;
    x: number;
    height: number;
    right: number;
    bottom: number;
    top: number;
  }[] = [];
  let current: typeof groups[number] | null = null;
  let lastX = 0;
  let lastWidth = 0;

  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const rowHeight = Math.max(item.height || Math.abs(item.transform[3]), 1);
    const same = current
      && Math.abs(y - current.y) < Math.max(2, rowHeight * .3)
      && x >= lastX - 3
      && x - (lastX + lastWidth) < Math.max(40, width * .08);
    if (same && current) {
      const gap = x - (lastX + lastWidth);
      current.text += (gap > rowHeight * .12 && !current.text.endsWith(' ') ? ' ' : '') + item.str;
      current.right = Math.max(current.right, x + item.width);
      current.bottom = Math.min(current.bottom, y);
      current.top = Math.max(current.top, y + rowHeight);
    } else {
      if (current) groups.push(current);
      current = {
        text: item.str,
        y,
        x,
        height: rowHeight,
        right: x + item.width,
        bottom: y,
        top: y + rowHeight,
      };
    }
    lastX = x;
    lastWidth = item.width;
  }
  if (current) groups.push(current);

  const paragraphs: { text: string; rows: typeof groups }[] = [];
  let value = '';
  let rows: typeof groups = [];
  let previous: typeof groups[number] | undefined;
  for (const row of groups) {
    const gap = previous ? previous.y - row.y : 0;
    const boundary = !!previous && (
      gap < -2
      || gap > Math.max(4, previous.height * 1.45)
      || Math.abs(row.x - previous.x) > width * .25
      || row.height > previous.height * 1.3
      || previous.height > row.height * 1.3
      || value.length > 1700
    );
    if (boundary && value) {
      paragraphs.push({ text: value, rows });
      value = '';
      rows = [];
    }
    value += (value ? '\n' : '') + row.text;
    rows.push(row);
    previous = row;
  }
  if (value) paragraphs.push({ text: value, rows });

  // Keep front matter and fragmented formula labels together without dropping text.
  const compact: typeof paragraphs = [];
  let short = '';
  let shortRows: typeof groups = [];
  const flush = () => {
    if (!short) return;
    compact.push({ text: short, rows: shortRows });
    short = '';
    shortRows = [];
  };
  for (const paragraph of paragraphs) {
    if (sectionHeading(paragraph.text) || paragraph.text.length > 150) {
      flush();
      compact.push(paragraph);
    } else {
      if (short.length + paragraph.text.length > 550) flush();
      short += (short ? '\n' : '') + paragraph.text;
      shortRows.push(...paragraph.rows);
    }
  }
  flush();

  return compact.flatMap(({ text, rows }) => splitText(text).map(part => {
    const lines = part.split('\n').map(line => line.trim()).filter(Boolean);
    const mathLines = lines.filter(line => /[=√∑∫∂∇≤≥≈∞]|(?:softmax|log|exp|sin|cos)\s*\(/i.test(line));
    const fragmented = mathLines.length > 0
      && (lines.length >= 3 || /[√∑∫]/.test(part))
      && lines.some(line => line.length <= 3);
    if (!fragmented || !rows.length) return { text: part, page };

    const left = Math.min(...rows.map(row => row.x));
    const right = Math.max(...rows.map(row => row.right));
    const bottom = Math.min(...rows.map(row => row.bottom));
    const top = Math.max(...rows.map(row => row.top));
    const pad = 8;
    return {
      text: part,
      page,
      formulaCrop: {
        x: Math.max(0, (left - pad) / width),
        y: Math.max(0, (height - top - pad) / height),
        w: Math.min(1, (right - left + pad * 2) / width),
        h: Math.min(1, (top - bottom + pad * 2) / height),
      },
    };
  })).map((block, index) => ({ ...block, id: `p${page}-b${index + 1}` }));
}
