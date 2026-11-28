import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const allowed = new Set(['https://tovarix-control.vercel.app',
    ...(Deno.env.get('TOVARIX_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim())]);
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' });
  if (origin && !allowed.has(origin)) return new Response(null, { status: 403, headers });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const denied = () => Response.json({ error: 'Sign-in unavailable' }, { status: 401, headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) return denied();
    const buffer = new Uint8Array(2048);
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (size + chunk.value.length > buffer.length) { await reader.cancel(); return denied(); }
        buffer.set(chunk.value, size);
        size += chunk.value.length;
      }
    } finally { reader.releaseLock(); }
    const { login, password } = JSON.parse(new TextDecoder().decode(buffer.subarray(0,size)));
    const alias = typeof login === 'string' ? login.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{4,24}$/.test(alias) || typeof password !== 'string' || !password || password.length > 1024) return denied();
    const url = Deno.env.get('SUPABASE_URL');
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !publicKey || !serviceKey) return denied();
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const service = createClient(url, serviceKey, options);
    const { data: email } = await service.rpc('control_login_target', { p_alias: alias });
    if (typeof email !== 'string') return denied();
    const client = createClient(url, publicKey, options);
    const { data } = await client.auth.signInWithPassword({ email, password });
    if (!data.session || !data.user) return denied();
    const audit = await service.rpc('control_password_verified', { p_alias: alias, p_uid: data.user.id });
    if (audit.data !== true) {
      await client.auth.signOut({ scope: 'local' });
      return denied();
    }
    return Response.json({
      access_token: data.session.access_token, refresh_token: data.session.refresh_token,
    }, { headers });
  } catch {
    return denied();
  }
});
