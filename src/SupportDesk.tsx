import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language } from './labels';

type Ticket = { id: string; subject: string; message: string; resolution?: string; closed_at?: string };
type Admin = {
  businesses: number; subscriptions: number; payments: number; ai_requests: number;
  tickets: Ticket[]; audit: { id: number; action: string; created_at: string }[];
};
const copy = {
  uz: ['Mavzu', 'Xabar', 'Yuborish', 'Yakunlash', 'Javob', 'Bizneslar', 'Obunalar', 'To‘lovlar', 'Bugungi AI so‘rovlari', 'Amallar jurnali', 'Ochiq', 'Yopiq'],
  ru: ['Тема', 'Сообщение', 'Отправить', 'Закрыть', 'Ответ', 'Предприятия', 'Подписки', 'Платежи', 'Запросы AI сегодня', 'Журнал действий', 'Открыто', 'Закрыто'],
  en: ['Subject', 'Message', 'Submit', 'Resolve', 'Response', 'Businesses', 'Subscriptions', 'Payments', 'AI requests today', 'Audit log', 'Open', 'Closed'],
} as const;

export function SupportDesk({ client, lang, business }: { client: SupabaseClient; lang: Language; business?: string }) {
  const t = copy[lang];
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, reload] = useState(0);

  useEffect(() => {
    let active = true;
    if (business) {
      void client.from('support_tickets').select('id,subject,message,resolution,closed_at')
        .eq('business_id', business).order('created_at', { ascending: false }).limit(50).then(result => {
          if (active) { setTickets(result.data ?? []); setError(result.error?.message ?? ''); }
        });
    } else {
      void client.rpc('platform_overview').then(result => {
        if (active) { setAdmin(result.data); setError(result.error?.message ?? ''); }
      });
    }
    return () => { active = false; };
  }, [client, business, revision]);

  async function submit(e: FormEvent<HTMLFormElement>, ticket?: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      const result = business
        ? await client.from('support_tickets').insert({ business_id: business, subject: data.get('subject'), message: data.get('message') })
        : await client.rpc('resolve_ticket', { p_ticket: ticket, p_resolution: data.get('message') });
      if (result.error) throw result.error;
      form.reset();
      reload(n => n + 1);
    } catch (problem) {
      setError(problem && typeof problem === 'object' && 'message' in problem ? String(problem.message) : String(problem));
    } finally { setBusy(false); }
  }

  return <>
    {error && <p role="alert">{error}</p>}
    {business && <>
      <form onSubmit={e => void submit(e)}>
        <input name="subject" required maxLength={120} aria-label={t[0]} placeholder={t[0]} />
        <textarea name="message" required maxLength={4000} aria-label={t[1]} placeholder={t[1]} />
        <button disabled={busy}>{t[2]}</button>
      </form>
      {tickets.map(ticket => <article key={ticket.id}><b>{ticket.subject}</b><small>{t[ticket.closed_at ? 11 : 10]}</small>
        <p>{ticket.message}</p>{ticket.resolution && <p>{t[4]} · {ticket.resolution}</p>}</article>)}
    </>}
    {admin && <>
      <div className="grid">{[admin.businesses, admin.subscriptions, admin.payments, admin.ai_requests].map((value, i) =>
        <article key={i}><span>{t[5 + i]}</span><strong>{value}</strong></article>)}</div>
      {admin.tickets.map(ticket => <article key={ticket.id}><b>{ticket.subject}</b><p>{ticket.message}</p>
        <form onSubmit={e => void submit(e, ticket.id)}>
          <textarea name="message" required maxLength={4000} aria-label={t[4]} /><button disabled={busy}>{t[3]}</button>
        </form>
      </article>)}
      <h2>{t[9]}</h2>
      {admin.audit.map(entry => <article key={entry.id}>{entry.action} · {new Date(entry.created_at).toLocaleString(lang)}</article>)}
    </>}
  </>;
}
