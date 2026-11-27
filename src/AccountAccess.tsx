import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Brand } from './AppNavigation';
import { labels } from './labels';
import type { Language } from './labels';

const copy = {
  uz: ['Ism', 'Familiya', 'Otasining ismi (ixtiyoriy)', 'Aloqa telefoni (tasdiqlanmagan)', 'Parolni takrorlang', 'Parolni tiklash', 'Tiklash havolasini so‘rash', 'Yangi parolni saqlash', 'Parollar mos emas', 'Agar hisob mavjud bo‘lsa, tiklash xati yuborish uchun so‘rov qabul qilindi.', 'Hisobga kirish', 'Sinov shartlari', 'Faqat test ma’lumotlari. Telefon aloqa uchun. Sinovda haqiqiy to‘lovlar amalga oshirilmaydi.', 'Sinov shartlarini qabul qilaman', 'Parol yangilandi'],
  ru: ['Имя', 'Фамилия', 'Отчество (необязательно)', 'Контактный телефон (не подтверждён)', 'Повторите пароль', 'Восстановить пароль', 'Запросить ссылку', 'Сохранить новый пароль', 'Пароли не совпадают', 'Если аккаунт существует, запрос на отправку письма принят.', 'Вернуться ко входу', 'Условия пилота', 'Используйте только тестовые данные. Телефон служит для связи. В пилоте реальные платежи не проводятся.', 'Принимаю условия пилота', 'Пароль обновлён'],
  en: ['First name', 'Last name', 'Middle name (optional)', 'Contact phone (unverified)', 'Repeat password', 'Reset password', 'Request reset link', 'Save new password', 'Passwords do not match', 'If the account exists, the email request has been accepted.', 'Back to sign in', 'Pilot terms', 'Use synthetic data only. The phone number is for contact. The pilot does not process real payments.', 'I accept the pilot terms', 'Password updated'],
} as const;

export function AccountAccess({ client, lang, recovery, finishRecovery }: {
  client: SupabaseClient; lang: Language; recovery: boolean; finishRecovery: () => void;
}) {
  const [mode, setMode] = useState<'sign-in' | 'register' | 'reset'>('sign-in');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const t = copy[lang];
  const l = labels[lang];
  const registering = !recovery && mode === 'register';
  const resetting = !recovery && mode === 'reset';
  const callback = import.meta.env.VITE_TOVARIX_AUTH_REDIRECT_URL || window.location.origin + '/';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if ((registering || recovery) && password !== data.get('confirmation')) {
      setStatus(t[8]);
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      if (recovery) {
        const { error } = await client.auth.updateUser({ password });
        if (error) setStatus(error.message);
        else { setStatus(t[14]); finishRecovery(); }
      } else if (resetting) {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: callback });
        setStatus(error?.message ?? t[9]);
      } else if (registering) {
        const { error, data: result } = await client.auth.signUp({ email, password, options: {
          emailRedirectTo: callback,
          data: {
            given_name: String(data.get('given_name')).trim(), family_name: String(data.get('family_name')).trim(),
            middle_name: String(data.get('middle_name')).trim(), contact_phone: String(data.get('contact_phone')).trim(),
            language: lang, terms_revision: 'pilot-v0.4',
          },
        } });
        if (error) setStatus(error.message);
        else if (!result.session) setStatus(l[37]);
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) setStatus(error.message);
      }
    } finally { setBusy(false); }
  }

  const title = recovery ? t[7] : registering ? l[25] : resetting ? t[5] : l[24];
  return <section className="auth-card page-enter">
    <div className="auth-title"><Brand /><h1>{title}</h1></div>
    <form key={title} onSubmit={e => void submit(e)}>
      {registering && <>
        {['given_name','family_name','middle_name'].map((name,i) => <input key={name} name={name} aria-label={t[i]} placeholder={t[i]} maxLength={80} required={i<2} />)}
        <input type="tel" name="contact_phone" aria-label={t[3]} placeholder={t[3]} pattern="\+[1-9][0-9]{7,14}" required maxLength={16} />
      </>}
      {!recovery && <input name="email" type="email" placeholder="Email" aria-label="Email" autoComplete="email" required />}
      {!resetting && <input name="password" type="password" placeholder={l[26]} aria-label={l[26]} autoComplete={registering || recovery ? 'new-password' : 'current-password'} minLength={8} required />}
      {(registering || recovery) && <input name="confirmation" type="password" placeholder={t[4]} aria-label={t[4]} autoComplete="new-password" minLength={8} required />}
      {registering && <>
        <details><summary>{t[11]}</summary><p>{t[12]}</p></details>
        <label className="permission"><input type="checkbox" required name="terms" />{t[13]}</label>
      </>}
      <button className="primary-button" disabled={busy}>{resetting ? t[6] : title}</button>
    </form>
    {status && <p role="status">{status}</p>}
    {!recovery && <div className="controls">
      {mode === 'sign-in' ? <>
        <button onClick={() => { setStatus(''); setMode('register'); }}>{l[25]}</button>
        <button onClick={() => { setStatus(''); setMode('reset'); }}>{t[5]}</button>
      </> : <button onClick={() => { setStatus(''); setMode('sign-in'); }}>{t[10]}</button>}
    </div>}
  </section>;
}
