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
  const allowed = new Set(['https://tovarix-uz.vercel.app', 'https://tovarix-preview-hyikxbavp-pixel-forge-d3e8.vercel.app', 'https://localhost',
    ...(Deno.env.get('TOVARIX_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim())]);
  const headers = origin && allowed.has(origin) ? {
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
    const { business, question, image, conversation, language, stream } = JSON.parse(input);
    if (typeof business !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(business)
        || (conversation != null && (typeof conversation !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conversation)))
        || typeof question !== 'string' || !question.trim() || question.length > 2000
        || (image != null && (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(image.mimeType)
          || typeof image.data !== 'string' || image.data.length > 1_866_668 || image.data.length % 4 !== 0
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || (image.mimeType === 'application/pdf' && !atob(image.data.slice(0,8)).startsWith('%PDF-'))))) {
      return json({ error: 'Invalid input' }, 400);
    }

    const client = createClient(url, publicKey, { global: { headers: { Authorization: authorization } } });
    const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !identity.user) return json({ error: 'Authentication required' }, 401);
    if (!key) return json({ error: 'AI provider not configured' }, 503);
    if (conversation) {
      const chat = await client.rpc('ai_conversations', { p_business: business, p_action: 'get', p_id: conversation });
      if (chat.error || !chat.data) return json({ error: 'Access denied' }, 403);
    }
    const finance = await client.rpc('financial_access', { p_business: business });
    if (finance.error) return json({ error: 'Context unavailable' }, 502);
    const { data, error } = await client.rpc('ai_context', { p_business: business });
    if (error) {
      const status = error.code === '42501' ? 403 : /quota exceeded/.test(error.message) ? 429 : error.message === 'AI disabled' ? 503 : 502;
      return json({ error: status === 403 ? 'Access denied' : status === 429 ? 'Quota exceeded' : status === 503 ? 'AI unavailable' : 'Context unavailable' }, status);
    }
    const analytics = await client.rpc('ai_analytics_context', { p_business: business });
    if (analytics.error) return json({ error: 'Context unavailable' }, 502);
    const reports = analytics.data ?? {};
    const statistics = { inventory: data?.product_snapshot ?? [], reports,
      daily_sales: reports.daily_revenue ? undefined : data?.daily_sales };
    const model = await resolveGeminiModel(key, configuredModel);
    const provider = new GeminiProvider(key, model);
    const scopedHistory = client.from('ai_history').select('question,answer').eq('business_id', business)
      .eq('user_id', identity.user.id);
    const history = await (conversation ? scopedHistory.eq('conversation_id', conversation) : scopedHistory.is('conversation_id',null))
      .order('created_at', { ascending: false }).limit(4);
    if (history.error) return json({ error: 'History unavailable' }, 502);
    const previous = (history.data ?? []).reverse().map(turn => ({ question: turn.question, answer: turn.answer.slice(0, 1500) }));
    const server = createClient(url, serviceKey);
    const marker = '[[PRICE_PROPOSAL]]';
    const sales = Array.isArray(reports.daily_revenue) ? reports.daily_revenue : [];
    const profitScope = finance.data?.profit === true || (Array.isArray(data?.daily_sales) && data.daily_sales.some((row: { gross_profit_uzs?: unknown }) => row.gross_profit_uzs != null))
      || reports.today?.profit != null || reports.last_30_days?.profit != null;
    const user = identity.user.id;
    type Delta = (text: string) => void;
    async function run(signal: AbortSignal, onDelta?: Delta) {
      const result = await provider.analyze(statistics, question, image ?? undefined, previous, { signal, language, onDelta, reserve: async input => {
        const reserved = await server.rpc('reserve_ai_budget', { p_model: model, p_input: input, p_output: 1200 });
        return reserved.data === true;
      } });
      const [display, proposal] = result.answer.split(marker, 2);
      const answer = display.trim();
      if (!answer) throw new Error('Empty answer');
      const logged = await server.rpc('record_ai_turn', {
        p_business: business, p_user: user, p_chat: conversation ?? null, p_question: question, p_answer: answer,
        p_model: model, p_input: result.inputTokens, p_output: result.outputTokens, p_profit: profitScope,
      });
      if (logged.error) throw new Error('AI history could not be saved');
      if (proposal && conversation && !image) {
        try {
          const candidate = JSON.parse(proposal.trim());
          if (typeof candidate.name === 'string' && Number.isSafeInteger(candidate.price)) {
            await server.rpc('propose_ai_price', { p_turn: logged.data, p_name: candidate.name, p_price: candidate.price });
          }
        } catch { /* Invalid output cannot create a proposal. */ }
      }
      const chart = sales.map((row: { day: string; revenue: number }) =>
        ({ day: row.day, revenue: row.revenue, gross_profit: null }));
      return { answer, id: logged.data, model, chart };
    }
    if (stream !== true) return json(await run(request.signal), 200);

    const encoder = new TextEncoder();
    const cancel = new AbortController();
    const signal = AbortSignal.any([request.signal, cancel.signal]);
    const output = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          if (!signal.aborted) controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
        };
        try {
          let received = '';
          let sent = 0;
          const result = await run(signal, delta => {
            received += delta;
            const markerIndex = received.indexOf(marker);
            let end = received.length;
            if (markerIndex >= 0) end = markerIndex;
            else {
              // Hold only a suffix that could complete the control marker.
              for (let length = 1; length < marker.length; length++) {
                if (received.endsWith(marker.slice(0,length))) end = received.length-length;
              }
            }
            if (end > sent) { send({ delta: received.slice(sent,end) }); sent = end; }
          });
          send({ done: result });
        } catch {
          send({ error: 'AI unavailable' });
        } finally {
          if (!cancel.signal.aborted) controller.close();
        }
      },
      cancel() { cancel.abort(); },
    });
    return new Response(output, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'Invalid input' : 'AI unavailable' }, error instanceof SyntaxError ? 400 : 502);
  }
});
