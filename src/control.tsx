import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Eye, EyeOff, LogOut, Moon, Sun } from 'lucide-react';
import { AccountAccess } from './AccountAccess';
import { Brand } from './AppNavigation';
import { ControlConsole } from './ControlConsole';
import { languageNames } from './labels';
import type { Language } from './labels';
import { connectSupabase } from './supabase';
import './style.css';

const copy = {
  uz: ['Administrator kirishi','Parol','Kirish','TOTP sozlash','Autentifikator kodi','Tasdiqlash','Kirish yopiq','Chiqish','Tungi mavzu'],
  ru: ['Вход администратора','Пароль','Войти','Настроить TOTP','Код приложения-аутентификатора','Подтвердить','Доступ закрыт','Выйти','Тёмная тема'],
  en: ['Administrator sign-in','Password','Sign in','Set up TOTP','Authenticator code','Verify','Access closed','Sign out','Dark theme'],
} as const;

const accessCopy = {
  uz: ['Login yoki email','Parolni ko‘rsatish','Parolni yashirish','Kirishni tiklash','Agar manzil mos kelsa, tiklash xati yuboriladi.','Kirish muvaffaqiyatsiz. Ma’lumotlarni tekshiring yoki keyinroq urinib ko‘ring.'],
  ru: ['Логин или email','Показать пароль','Скрыть пароль','Восстановить доступ','Если адрес подходит, будет отправлено письмо для восстановления.','Вход не выполнен. Проверьте данные или попробуйте позже.'],
  en: ['Username or email','Show password','Hide password','Recover access','If the address is eligible, a recovery email will be sent.','Sign-in failed. Check your details or try again later.'],
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
  const a = accessCopy[lang];
  const [showPassword, setShowPassword] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [resetSession, setResetSession] = useState(false);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, value) => {
      if (event === 'PASSWORD_RECOVERY') setResetSession(true);
      if (event === 'SIGNED_OUT') { setResetSession(false); setFactor(null); setState('pending'); }
      setSession(value);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    if (!client || !session || resetSession) return;
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
  }, [client, resetSession, session]);

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
    const login = String(data.get('login')).trim();
    const password = String(data.get('password'));
    void run(async () => {
      if (login.includes('@')) {
        const response = await client!.auth.signInWithPassword({ email: login, password });
        return { error: response.error ? { message: a[5] } : null };
      }
      const response = await client!.functions.invoke('control-login', { body: { login, password } });
      if (response.error || !response.data?.access_token || !response.data?.refresh_token) return { error: { message: a[5] } };
      const established = await client!.auth.setSession(response.data);
      return { error: established.error ? { message: a[5] } : null };
    });
  }
  return <main className={'workspace ' + (dark ? 'dark' : 'light')}>
    <header className="brand-strip control-brand-strip"><Brand /><div className="controls">
      <select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Language)}>
        {Object.entries(languageNames).map(([code,name]) => <option key={code} value={code}>{name}</option>)}
      </select><button className="icon-button" aria-label={t[8]} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
      {session && <button className="icon-button" aria-label={t[7]} onClick={() => void run(() => client!.auth.signOut({ scope:'global' }))}><LogOut size={17} /></button>}
    </div></header>
    <div className="page-heading"><h1>TOVARIX CONTROL</h1></div>
    {(!client || (session && state === 'closed')) && <p role="status">{t[6]}</p>}
    {client && session === null && <section className="auth-card">
      <h2>{t[0]}</h2>
      {recovering ? <form onSubmit={event => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get('email')).trim();
        void run(async () => {
          const redirectTo = new URL(location.pathname,location.origin).href;
          await client.auth.resetPasswordForEmail(email,{redirectTo});
          setStatus(a[4]);
          return { error: null };
        });
      }}><input name="email" type="email" aria-label="Email" autoComplete="email" required />
        <button disabled={busy}>{a[3]}</button>
      </form> : <form onSubmit={signIn}>
        <input name="login" placeholder={a[0]} aria-label={a[0]} autoComplete="username" required />
        <div className="controls"><input name="password" type={showPassword ? 'text' : 'password'} placeholder={t[1]}
          aria-label={t[1]} autoComplete="current-password" maxLength={1024} required />
          <button className="icon-button" type="button" aria-label={a[showPassword ? 2 : 1]} onClick={() => setShowPassword(value => !value)}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <button disabled={busy} aria-busy={busy}>{t[2]}</button>
      </form>}
      <button type="button" onClick={() => { setRecovering(value => !value); setStatus(''); }}>{recovering ? t[2] : a[3]}</button>
    </section>}
    {client && session && resetSession && <AccountAccess client={client} lang={lang} recovery
      finishRecovery={() => void run(async () => client.auth.signOut({ scope: 'global' }))}/>}
    {client && session && !resetSession && state === 'mfa' && <section className="auth-card">
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
    {client && session && !resetSession && state === 'ready' && <ControlConsole key={session.user.id} client={client} lang={lang}/>}
  </main>;
}

const root = createRoot(document.getElementById('root')!);
void connectSupabase('tovarix-control-auth').then(client => root.render(<Control client={client} />))
  .catch(() => root.render(<Control client={null} />));
