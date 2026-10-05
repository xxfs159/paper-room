import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUpstreamSignal, getAssistInstructions, getAssistOutputSchema, hasSharedAI,
  parseAssistInput, parseAssistResult, resolveAssistKey,
  type AssistAction,
} from '../lib/assist.ts';

const blocks = [
  { id: 'p1-b1', text: 'The proposed method may improve accuracy under this assumption.', page: 1 },
  { id: 'p1-b2', text: 'Experiments do not establish causality.\nFurther work is required.', page: 1 },
];
const input = (action: AssistAction) => parseAssistInput({ action, blocks, title: 'Test paper' });

test('input rejects duplicate IDs, excessive context, and OCR without an image', () => {
  assert.throws(() => parseAssistInput({ action: 'ask', blocks: [blocks[0], blocks[0]], title: '' }), /编号重复/);
  assert.throws(() => parseAssistInput({
    action: 'translate', title: '',
    blocks: Array.from({ length: 5 }, (_, index) => ({ id: String(index), text: 'x'.repeat(11000), page: 1 })),
  }), /50000/);
  assert.throws(() => parseAssistInput({ action: 'ocr', blocks: [], title: '' }), /原始页面图像/);
  assert.throws(() => parseAssistInput({ action: 'summarize', blocks: [], title: '' }), /需要原文段落/);
});

test('translation must cover all source IDs exactly once, with nonempty text', () => {
  const data = input('translate');
  const valid = { translations: blocks.map(item => ({ id: item.id, text: '译文' })), glossary: [], warnings: [] };
  assert.equal(parseAssistResult(valid, data).translations.length, 2);
  for (const translations of [
    valid.translations.slice(0, 1),
    [valid.translations[0], valid.translations[0]],
    [valid.translations[0], { id: 'invented', text: '译文' }],
    [valid.translations[0], { id: blocks[1].id, text: '  ' }],
  ]) {
    assert.throws(() => parseAssistResult({ ...valid, translations }, data), /译文段落校验/);
  }
});

test('fabricated citations are removed without discarding a grounded answer', () => {
  const result = parseAssistResult({
    answer: '实验并未建立因果关系。', warnings: [],
    citations: [
      { id: blocks[1].id, quote: 'Experiments do not establish causality. Further work' },
      { id: blocks[0].id, quote: 'This proves the method is always superior.' },
      { id: 'invented', quote: 'The proposed method' },
      { id: blocks[0].id, quote: '  ' },
    ],
  }, input('ask'));
  assert.deepEqual(result.citations, [{ id: blocks[1].id, quote: 'Experiments do not establish causality. Further work' }]);
  assert.equal(result.answer, '实验并未建立因果关系。');
  assert.equal(result.warnings.length, 1);
});

test('summary has exactly three nonempty items and its own output contract', () => {
  const value = { summary: ['问题：提高准确率。', '方法：条件性方法。', '结论：未建立因果关系。'], citations: [], warnings: [] };
  const result = parseAssistResult(value, input('summarize'));
  assert.deepEqual(result.summary, value.summary);
  assert.equal(result.answer, '');
  for (const summary of [value.summary.slice(0, 2), [...value.summary, '额外条目'], ['', '方法', '结论']]) {
    assert.throws(() => parseAssistResult({ ...value, summary }, input('summarize')));
  }
  assert.deepEqual(getAssistOutputSchema('summarize').required, ['summary', 'citations', 'warnings']);
  assert.ok(!getAssistInstructions('summarize').includes('任务 explain'));
});

test('highlights require at most five distinct grounded source paragraphs', () => {
  const valid = { highlights: [{ id: blocks[0].id, quote: 'may improve accuracy' }], warnings: [] };
  assert.deepEqual(parseAssistResult(valid, input('highlight')).highlights, valid.highlights);
  assert.deepEqual(parseAssistResult({ highlights: [], warnings: [] }, input('highlight')).highlights, []);
  for (const highlights of [
    Array(6).fill(valid.highlights[0]),
    [valid.highlights[0], valid.highlights[0]],
    [{ id: blocks[0].id, quote: 'always improves accuracy' }],
    [{ id: 'invented', quote: 'may improve accuracy' }],
  ]) {
    assert.throws(() => parseAssistResult({ ...valid, highlights }, input('highlight')));
  }
  assert.deepEqual(getAssistOutputSchema('highlight').required, ['highlights', 'warnings']);
});

test('empty OCR and empty answers never produce successful results', () => {
  const ocr = parseAssistInput({ action: 'ocr', blocks: [], title: '', images: [{ page: 1, data: 'data:image/jpeg;base64,AAAA' }] });
  assert.throws(() => parseAssistResult({ transcript: ['', '  '], warnings: [] }, ocr), /未识别到可读文字/);
  assert.throws(() => parseAssistResult({ answer: '  ', citations: [], warnings: [] }, input('explain')));
});

test('shared key stays unavailable unless a rate limiter is configured', async () => {
  const environment = { OPENAI_API_KEY: 'mock-environment-key' };
  assert.equal(hasSharedAI(environment), false);
  const result = await resolveAssistKey(environment, 'openai', '', 'user-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
  assert.equal(hasSharedAI({ AI_RATE_LIMITER: { limit: async () => ({ success: true }) } }), false);
});

test('shared requests consume the authenticated user allowance and fail closed', async () => {
  const keys: string[] = [];
  const environment = {
    OPENAI_API_KEY: 'mock-environment-key',
    AI_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: key === 'allowed-user' }; } },
  };
  assert.equal(hasSharedAI(environment), true);
  assert.equal((await resolveAssistKey(environment, 'openai', '', 'allowed-user')).ok, true);
  const denied = await resolveAssistKey(environment, 'openai', '', 'limited-user');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 429);
  assert.deepEqual(keys, ['allowed-user', 'limited-user']);
  const failed = await resolveAssistKey({
    ...environment, AI_RATE_LIMITER: { limit: async () => { throw new Error('Binding unavailable'); } },
  }, 'openai', '', 'user-1');
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.status, 503);
});

test('personal credentials do not consume shared quota or fall back on invalid format', async () => {
  let attempts = 0;
  const environment = {
    OPENAI_API_KEY: 'mock-environment-key',
    AI_RATE_LIMITER: { limit: async () => { attempts++; return { success: false }; } },
  };
  assert.equal((await resolveAssistKey(environment, 'openai', 'sk-' + 'x'.repeat(24), 'user-1')).ok, true);
  const invalid = await resolveAssistKey(environment, 'openai', 'invalid', 'user-1');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 400);
  assert.equal(attempts, 0);
  assert.equal((await resolveAssistKey(environment, 'deepseek', '', 'user-1')).ok, false);
});

test('upstream work follows client cancellation and retains the timeout', async () => {
  const controller = new AbortController();
  const signal = createUpstreamSignal(controller.signal);
  const reason = new DOMException('Client stopped reading', 'AbortError');
  controller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
  assert.equal(createUpstreamSignal(controller.signal).aborted, true);

  const timeoutSignal = createUpstreamSignal(new AbortController().signal, 5);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(timeoutSignal.aborted, true);
  assert.equal(timeoutSignal.reason.name, 'TimeoutError');
});
