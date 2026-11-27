import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { LogOut, Moon, Sun } from 'lucide-react';
import { Brand } from './AppNavigation';
import { SupportDesk } from './SupportDesk';
import { ManualSubscriptions } from './ManualSubscriptions';
import { languageNames } from './labels';
import type { Language } from './labels';
import { connectSupabase } from './supabase';
import './style.css';

const copy = {
  uz: ['Administrator kirishi','Parol','Kirish','TOTP sozlash','Autentifikator kodi','Tasdiqlash','Kirish yopiq','Chiqish','Tungi mavzu'],
  ru: ['Вход администратора','Пароль','Войти','Настроить TOTP','Код приложения-аутентификатора','Подтвердить','Доступ закрыт','Выйти','Тёмная тема'],
  en: ['Administrator sign-in','Password','Sign in','Set up TOTP','Authenticator code','Verify','Access closed','Sign out','Dark theme'],
} as const;

function Control({ client }: { client: SupabaseClient | null }) {
  const [lang, setLang] = useState<Language>('uz');
  const [dark, setDark] = useState(false);
  const [session, setSession] = useState<Session | null>();
  const [state, setState] = useState<'closed' | 'pending' | 'mfa' | 'ready'>('pending');
  const [factor, setFactor] = useState<{ id: string; qrCode?: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const t = copy[lang];
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    setState('pending');
    void (async () => {
      const { data: allowed, error } = await client.rpc('control_eligible');
      if (!active) return;
      if (error || allowed !== true) { setState('closed'); return; }
      const { data: assurance } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!active) return;
      if (assurance?.currentLevel === 'aal2') { setState('ready'); return; }
      const { data: factors } = await client.auth.mfa.listFactors();
      if (!active) return;
      const existing = factors?.totp.find(item => item.status === 'verified');
      if (existing) setFactor({ id: existing.id });
      setState('mfa');
    })().catch(() => { if (active) setState('closed'); });
    return () => { active = false; };
  }, [client, session]);

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try { const { error } = await action(); if (error) setStatus(error.message); }
    catch { setStatus(t[6]); }
    finally { setBusy(false); }
  }
  function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void run(() => client!.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) }));
  }
  return <main className={'workspace ' + (dark ? 'dark' : 'light')}>
    <header className="brand-strip control-brand-strip"><Brand /><div className="controls">
      <select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Language)}>
        {Object.entries(languageNames).map(([code,name]) => <option key={code} value={code}>{name}</option>)}
      </select><button className="icon-button" aria-label={t[8]} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
      {session && <button className="icon-button" aria-label={t[7]} onClick={() => void run(() => client!.auth.signOut({ scope:'local' }))}><LogOut size={17} /></button>}
    </div></header>
    <div className="page-heading"><h1>TOVARIX CONTROL</h1></div>
    {(!client || (session && state === 'closed')) && <p role="status">{t[6]}</p>}
    {client && session === null && <section className="auth-card">
      <h2>{t[0]}</h2><form onSubmit={signIn}>
        <input name="email" type="email" placeholder="Email" aria-label="Email" autoComplete="email" required />
        <input name="password" type="password" placeholder={t[1]} aria-label={t[1]} autoComplete="current-password" required />
        <button disabled={busy}>{t[2]}</button>
      </form>
    </section>}
    {client && session && state === 'mfa' && <section className="auth-card">
      {!factor && <button disabled={busy} onClick={() => void run(async () => {
        const result = await client.auth.mfa.enroll({ factorType:'totp', friendlyName:'TOVARIX CONTROL' });
        if (result.data) setFactor({ id:result.data.id, qrCode:result.data.totp.qr_code });
        return result;
      })}>{t[3]}</button>}
      {factor?.qrCode && <img src={factor.qrCode} alt={t[3]} width={180} height={180} />}
      {factor && <form onSubmit={e => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get('code')).trim();
        void run(async () => {
          const response = await client.auth.mfa.challengeAndVerify({ factorId:factor.id, code });
          if (!response.error) setFactor(null);
          return response;
        });
      }}><input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" aria-label={t[4]} required />
        <button disabled={busy}>{t[5]}</button>
      </form>}
    </section>}
    {status && <p role="alert">{status}</p>}
    {client && session && state === 'ready' && <SupportDesk client={client} lang={lang} />}
    {client && session && state === 'ready' && <ManualSubscriptions key={session.user.id} client={client} lang={lang} />}
  </main>;
}

const root = createRoot(document.getElementById('root')!);
void connectSupabase('tovarix-control-auth').then(client => root.render(<Control client={client} />))
  .catch(() => root.render(<Control client={null} />));
