import { createClient } from 'npm:@supabase/supabase-js@2';

// Only a trusted relay may normalize verified PSP captures into this contract.
Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const secret = Deno.env.get('TOVARIX_PAYMENT_RELAY_SECRET');
  const provider = Deno.env.get('TOVARIX_PAYMENT_PROVIDER');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || secret.length < 32 || !provider || !url || !serviceKey) return new Response(null, { status: 503 });

  const timestamp = request.headers.get('x-tovarix-timestamp') ?? '';
  const signature = request.headers.get('x-tovarix-signature') ?? '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    || !/^[0-9a-f]{64}$/i.test(signature)) return new Response(null, { status: 401 });

  const raw = await request.text();
  if (raw.length > 16000) return new Response(null, { status: 413 });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => Number.parseInt(byte, 16));
  if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(timestamp + '.' + raw))) return new Response(null, { status: 401 });
  try {
    const event = JSON.parse(raw);
    if (event?.type !== 'payment.captured' || event.provider !== provider || event.currency !== 'UZS'
      || !Number.isSafeInteger(event.amount) || event.amount <= 0 || typeof event.id !== 'string'
      || event.id.length < 1 || event.id.length > 128 || typeof event.order !== 'string'
      || event.order.length < 1 || event.order.length > 128) return new Response(null, { status: 400 });
    const client = createClient(url, serviceKey);
    const { error } = await client.rpc('capture_payment', {
      p_provider: provider, p_event: event.id, p_order: event.order, p_amount: event.amount, p_currency: event.currency,
    });
    if (error) return new Response(null, { status: error.code === 'P0001' ? 409 : 502 });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
});
