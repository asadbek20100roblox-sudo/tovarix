import { createClient } from 'npm:@supabase/supabase-js@2';
import { GeminiProvider, resolveGeminiModel } from './provider.ts';

async function readBoundedBody(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return chunks.join('') + decoder.decode();
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); return null; }
      chunks.push(decoder.decode(value, { stream:true }));
    }
  } finally { reader.releaseLock(); }
}

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
  const configuredModel = Deno.env.get('GEMINI_MODEL');
  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceKey) return json({ error: 'Integration unavailable' }, 503);

  try {
    const input = await readBoundedBody(request,2_000_000);
    if (input === null) return json({ error: 'Request too large' }, 413);
    const { business, question, image } = JSON.parse(input);
    if (typeof business !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(business)
        || typeof question !== 'string' || !question.trim() || question.length > 2000
        || (image != null && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)
          || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)))) {
      return json({ error: 'Invalid input' }, 400);
    }

    const client = createClient(url, publicKey, { global: { headers: { Authorization: authorization } } });
    const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !identity.user) return json({ error: 'Authentication required' }, 401);
    if (!key) return json({ error: 'AI provider not configured' }, 503);
    const { data, error } = await client.rpc('ai_context', { p_business: business });
    if (error) {
      const status = error.code === '42501' ? 403 : /quota exceeded/.test(error.message) ? 429 : error.message === 'AI disabled' ? 503 : 502;
      return json({ error: status === 403 ? 'Access denied' : status === 429 ? 'Quota exceeded' : status === 503 ? 'AI unavailable' : 'Context unavailable' }, status);
    }
    const model = await resolveGeminiModel(key, configuredModel);
    const provider = new GeminiProvider(key, model);
    const history = await client.from('ai_history').select('question,answer').eq('business_id', business)
      .eq('user_id', identity.user.id).order('created_at', { ascending: false }).limit(4);
    if (history.error) return json({ error: 'History unavailable' }, 502);
    const previous = (history.data ?? []).reverse().map(turn => ({ question: turn.question, answer: turn.answer.slice(0, 1500) }));
    const result = await provider.analyze(data, question, image ?? undefined, previous);
    const server = createClient(url, serviceKey);
    const logged = await server.rpc('record_ai', {
      p_business: business, p_user: identity.user.id, p_question: question, p_answer: result.answer,
      p_model: model, p_input: result.inputTokens, p_output: result.outputTokens,
    });
    if (logged.error) return json({ error: 'AI history could not be saved' }, 502);
    return json({ answer: result.answer, model }, 200);
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'Invalid input' : 'AI unavailable' }, error instanceof SyntaxError ? 400 : 502);
  }
});
