import { createClient } from '@supabase/supabase-js';

export async function connectSupabase(storageKey?: string) {
  const options = storageKey ? { auth: { storageKey } } : undefined;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) return createClient(url, key, options);

  try {
    const response = await fetch('/tovarix-config.json', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const config = await response.json();
    if (typeof config.url === 'string' && config.url && typeof config.publishableKey === 'string' && config.publishableKey) {
      return createClient(config.url, config.publishableKey, options);
    }
  } catch (error) {
    console.warn('TOVARIX configuration unavailable', error);
  }
  return null;
}
