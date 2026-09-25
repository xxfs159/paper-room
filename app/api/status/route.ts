import {env} from 'cloudflare:workers';
export async function GET(){const e=env as unknown as Record<string,string>;return Response.json({configured:Boolean(e.OPENAI_API_KEY),provider:'OpenAI'},{headers:{'Cache-Control':'no-store'}});}
