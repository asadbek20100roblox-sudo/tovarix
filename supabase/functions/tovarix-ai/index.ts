import { createClient } from 'npm:@supabase/supabase-js@2';
import { GeminiProvider } from './provider.ts';

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const allowed = (Deno.env.get('TOVARIX_ALLOWED_ORIGINS') ?? '').split(',').map(origin => origin.trim());
  const headers = origin && allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  } : undefined;
  const json = (data: unknown, status: number) => Response.json(data, { status, headers });
  if (origin && !headers) return json({ error: 'Origin denied' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

  const key = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL');
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!key || !model || !url || !publicKey) return json({ error: 'Integration unavailable' }, 503);

  try {
    const input = await request.text();
    if (input.length > 2_000_000) return json({ error: 'Request too large' }, 413);
    const { business, question, image } = JSON.parse(input);
    if (typeof business !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(business)
        || typeof question !== 'string' || !question.trim() || question.length > 2000
        || (image != null && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)
          || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)))) {
      return json({ error: 'Invalid input' }, 400);
    }

    const client = createClient(url, publicKey, { global: { headers: { Authorization: authorization } } });
    const { data, error } = await client.rpc('ai_context', { p_business: business });
    if (error) return json({ error: error.code === '42501' ? 'Access denied' : error.message === 'AI quota exceeded' ? 'Quota exceeded' : 'Context unavailable' },
      error.code === '42501' ? 403 : error.message === 'AI quota exceeded' ? 429 : 502);
    const provider = new GeminiProvider(key, model);
    return json({ answer: await provider.analyze(data, question, image ?? undefined) }, 200);
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'Invalid input' : 'AI unavailable' }, error instanceof SyntaxError ? 400 : 502);
  }
});
