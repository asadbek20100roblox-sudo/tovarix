import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language } from './labels';
import { plans } from './plans';

const states = ['PENDING','CONTACTED','AWAITING_PAYMENT','PAYMENT_VERIFIED','ACTIVATED','REJECTED','CANCELLED'] as const;
type Status = typeof states[number];
type RequestRow = { id: string; business_id: string; plan: string; months: number; amount_uzs: number; status: Status };
type Response = { handle: string; created: string | null; rows: RequestRow[] };
type Operation = { p_action: string; p_id?: string; p_plan?: string; p_months?: number; p_detail?: string };
const wording = {
  uz: {
    title: 'Obuna arizalari', create: 'Ariza yuborish', plan: 'Tarif', cycle: 'Muddat', month: 'Oy', year: 'Yil',
    intro: 'Obunani faollashtirish uchun Telegram orqali biz bilan bog‘laning. Murojaatingizga 3 soat ichida javob berishga harakat qilamiz.',
    telegram: 'Telegram orqali bog‘lanish', handle: 'Telegram foydalanuvchi nomi', save: 'Saqlash', ref: 'To‘lov hujjati raqami',
    empty: 'Arizalar yo‘q', error: 'Amal bajarilmadi. Ruxsatlaringizni tekshiring yoki qayta urinib ko‘ring.', loading: 'Yuklanmoqda…',
    labels: ['Kutilmoqda','Bog‘lanildi','To‘lov kutilmoqda','To‘lov tekshirildi','Faollashtirildi','Rad etildi','Bekor qilindi'],
    actions: ['','Bog‘lanishni qayd etish','To‘lovni kutish','To‘lovni tasdiqlash','Obunani faollashtirish','Rad etish','Bekor qilish'],
  },
  ru: {
    title: 'Заявки на подписку', create: 'Создать заявку', plan: 'Тариф', cycle: 'Период', month: 'Месяц', year: 'Год',
    intro: 'Для активации подписки свяжитесь с нами в Telegram. Постараемся ответить в течение трёх часов.',
    telegram: 'Связаться в Telegram', handle: 'Имя пользователя Telegram', save: 'Сохранить', ref: 'Номер платёжного документа',
    empty: 'Заявок пока нет', error: 'Операция не выполнена. Проверьте права доступа или повторите попытку.', loading: 'Загрузка…',
    labels: ['Новая','Связались','Ожидает оплаты','Оплата проверена','Активирована','Отклонена','Отменена'],
    actions: ['','Отметить контакт','Ожидать оплату','Подтвердить оплату','Активировать подписку','Отклонить','Отменить'],
  },
  en: {
    title: 'Subscription requests', create: 'Submit request', plan: 'Plan', cycle: 'Billing period', month: 'Month', year: 'Year',
    intro: 'Contact us on Telegram to activate your subscription. We aim to reply within three hours.',
    telegram: 'Contact us on Telegram', handle: 'Telegram username', save: 'Save', ref: 'Payment document reference',
    empty: 'No requests yet', error: 'The operation failed. Check your permissions or try again.', loading: 'Loading…',
    labels: ['Pending','Contacted','Awaiting payment','Payment verified','Activated','Rejected','Cancelled'],
    actions: ['','Record contact','Await payment','Verify payment','Activate subscription','Reject','Cancel'],
  },
};

export function ManualSubscriptions({ client, lang, business }: { client: SupabaseClient; lang: Language; business?: string }) {
  const t = wording[lang];
  const [view, setView] = useState<Response>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ plan: string; months: number; code: string; key: string }>(null);
  useEffect(() => {
    let active = true;
    void client.rpc('manage_manual_subscription', { p_business: business ?? null }).then(result => {
      if (!active) return;
      if (result.error) setError(true);
      else setView(result.data as Response);
    });
    return () => { active = false; };
  }, [business, client]);

  async function call(operation: Operation) {
    setBusy(true);
    setError(false);
    try {
      const result = await client.rpc('manage_manual_subscription', { p_business: business ?? null, ...operation });
      if (result.error) throw result.error;
      setView(result.data as Response);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const plan = String(fields.get('plan'));
    const months = Number(fields.get('months'));
    const code = String(fields.get('promo') ?? '').trim().toUpperCase();
    if (pending.current?.plan !== plan || pending.current.months !== months || pending.current.code !== code) {
      pending.current = { plan, months, code, key: crypto.randomUUID() };
    }
    void call({ p_action: 'create', p_plan: plan, p_months: months, p_id: pending.current.key, p_detail: code || undefined }).then(ok => {
      if (ok) pending.current = null;
    });
  }

  return <section aria-busy={busy} className="page-enter">
    <h2>{t.title}</h2>
    {error && <p role="alert">{t.error}</p>}
    {!view && !error && <p role="status">{t.loading}</p>}
    {view && business && <>
      <form onSubmit={create}>
        <label>{t.plan}<select name="plan">{plans.filter(plan => plan.id !== 'FREE').map(plan => <option key={plan.id}>{plan.id}</option>)}</select></label>
        <label>{t.cycle}<select name="months"><option value={1}>{t.month}</option><option value={12}>{t.year}</option></select></label>
        <label>{({uz:'Promokod (ixtiyoriy)',ru:'Промокод (необязательно)',en:'Promo code (optional)'})[lang]}
          <input name="promo" maxLength={40} autoComplete="off"/>
        </label>
        <button disabled={busy}>{t.create}</button>
      </form>
      <p>{t.intro}</p>
      {view.rows.length > 0 && <a href={`https://t.me/${view.handle}`} target="_blank" rel="noopener noreferrer">{t.telegram}</a>}
    </>}
    {view && !business && <form key={view.handle} onSubmit={event => {
      event.preventDefault();
      void call({ p_action: 'telegram', p_detail: String(new FormData(event.currentTarget).get('handle')).trim() });
    }}>
      <label>{t.handle}<input name="handle" defaultValue={view.handle} pattern="[A-Za-z0-9_]{5,32}" required /></label>
      <button disabled={busy}>{t.save}</button>
    </form>}
    {view?.rows.length === 0 && <p>{t.empty}</p>}
    {view?.rows.map(row => {
      const index = states.indexOf(row.status);
      const next = states[index + 1];
      return <article key={row.id}><strong>{row.plan} · {row.months === 1 ? t.month : t.year}</strong>
        <p>{row.amount_uzs.toLocaleString(lang === 'uz' ? 'uz-UZ' : lang)} UZS · {t.labels[index]}</p>
        {!business && <small>{row.business_id} / {row.id}</small>}
        {!business && index < 4 && <form onSubmit={event => {
          event.preventDefault();
          const detail = new FormData(event.currentTarget).get('reference');
          void call({ p_action: next, p_id: row.id, ...(detail ? { p_detail: String(detail) } : {}) });
        }}>
          {next === 'PAYMENT_VERIFIED' && <label>{t.ref}<input name="reference" required minLength={4} maxLength={120} /></label>}
          <button disabled={busy}>{t.actions[index + 1]}</button>
        </form>}
        {index < 3 && <button disabled={busy} onClick={() => void call({ p_action: business ? 'CANCELLED' : 'REJECTED', p_id: row.id })}>
          {t.actions[business ? 6 : 5]}
        </button>}
      </article>;
    })}
  </section>;
}
