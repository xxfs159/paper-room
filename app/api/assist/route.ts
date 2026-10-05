import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  AssistValidationError, createUpstreamSignal, getAssistInstructions, getAssistOutputSchema,
  parseAssistInput, parseAssistResult, resolveAssistKey,
  type AssistEnvironment, type AssistInput,
} from '@/lib/assist';

export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return fail('请求来源不匹配，请刷新后再试。', 403);
  if (Number(req.headers.get('content-length') || 0) > 11500000) return fail('这次选取的内容过多，请缩小范围。', 413);
  const user = await getChatGPTUser();
  if (!user) return fail('请登录此网站后再使用 AI。', 401);

  let raw: string;
  try { raw = await req.text(); } catch { return fail('无法读取请求。'); }
  if (raw.length > 11500000) return fail('这次选取的内容过多。', 413);
  let data: AssistInput;
  try { data = parseAssistInput(JSON.parse(raw)); } catch (error) {
    return fail(error instanceof AssistValidationError ? error.message : '请求格式不正确，请减少选段后重试。');
  }
  if (req.signal.aborted) return fail('请求已取消。', 499);
  const environment = env as unknown as AssistEnvironment;
  const provider = req.headers.get('X-AI-Provider') === 'deepseek' ? 'deepseek' : 'openai';
  const key = await resolveAssistKey(environment, provider, req.headers.get('X-AI-API-Key')?.trim() || '', user.userId);
  if (!key.ok) return fail(key.error, key.status);

  const content: Array<Record<string, unknown>> = [];
  for (const [index, image] of data.images.entries()) {
    content.push(
      { type: 'input_text', text: '图 ' + (index + 1) + '：论文原第 ' + image.page + ' 页。若用户专门上传或框选了截图，第一张图就是主要讲解目标。' },
      { type: 'input_image', image_url: image.data, detail: 'high' },
    );
  }
  content.push({ type: 'input_text', text: JSON.stringify({ ...data, images: data.images.map(image => ({ page: image.page })) }) });

  try {
    const endpoint = provider === 'deepseek' ? 'https://api.deepseek.com/responses' : 'https://api.openai.com/v1/responses';
    const model = provider === 'deepseek' ? 'deepseek-flash' : environment.OPENAI_MODEL || 'gpt-4.1';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key.apiKey, 'Content-Type': 'application/json' },
      signal: createUpstreamSignal(req.signal),
      body: JSON.stringify({
        model,
        ...(provider === 'openai' ? { store: false } : {}),
        instructions: getAssistInstructions(data.action),
        input: [{ role: 'user', content }],
        max_output_tokens: 14000,
        text: { format: { type: 'json_schema', name: 'paper_' + data.action, strict: true, schema: getAssistOutputSchema(data.action) } },
      }),
    });
    if (!res.ok) {
      await res.text();
      return fail(res.status === 401 ? '模型服务凭据无效，需要重新连接。' :
        res.status === 429 ? '模型服务额度不足或请求过快，请稍后重试。' : '模型服务暂时无法完成请求，请稍后重试。', 502);
    }
    const result = await res.json() as { status?: string; output?: Array<{ content?: Array<{ type: string; text?: string }> }> };
    if (result.status !== 'completed') return fail('回答未完整生成，请缩小选段后重试；已完成的译文仍保留。', 502);
    const text = result.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
    if (!text) return fail('模型没有返回可用内容，请调整选段后重试。', 502);
    return Response.json(parseAssistResult(JSON.parse(text), data), { headers });
  } catch (error) {
    if (req.signal.aborted) return fail('请求已取消。', 499);
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
      return fail('处理超时，请减少选段后重试。', 504);
    }
    return fail(error instanceof AssistValidationError ? error.message : '返回结果无法解析，请重试。原文不会受影响。', 502);
  }
}
