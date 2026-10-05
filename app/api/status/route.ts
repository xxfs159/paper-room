import { env } from 'cloudflare:workers';
import { hasSharedAI, type AssistEnvironment } from '@/lib/assist';

export async function GET() {
  const environment = env as unknown as AssistEnvironment;
  return Response.json(
    { configured: hasSharedAI(environment), provider: 'OpenAI' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
