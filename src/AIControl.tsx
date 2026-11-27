import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language } from './labels';

const copy = {
  uz: ['AI boshqaruvi','Global AI yoqilgan','Global AI o‘chiq','Yoqish','O‘chirish','Favqulodda to‘xtatish','Kunlik so‘rov chegarasi','Kunlik byudjet (USD)','Saqlash','Sinov korxonasi UUID','Sinov so‘rovlari','Sinovni yoqish','Sinovni bekor qilish','Bugungi so‘rovlar','Tokenlar (kirish / chiqish)','Ajratilgan / taxminiy xarajat','Amal bajarilmadi.'],
  ru: ['Управление AI','Глобальный AI включён','Глобальный AI выключен','Включить','Выключить','Аварийная остановка','Дневной лимит запросов','Дневной бюджет (USD)','Сохранить','UUID тестового предприятия','Запросы для пилота','Разрешить пилот','Остановить пилот','Запросы сегодня','Токены (вход / выход)','Резерв / оценка затрат','Операция не выполнена.'],
  en: ['AI control','Global AI enabled','Global AI disabled','Enable','Disable','Emergency stop','Daily request limit','Daily budget (USD)','Save','Test business UUID','Pilot requests','Allow pilot','Remove pilot','Requests today','Tokens (input / output)','Reserved / estimated cost','Operation failed.'],
} as const;

type Overview = { enabled: boolean; request_cap: number; budget: number; requests: number; input_tokens: number; output_tokens: number; reserved: number; estimated: number };

export function AIControl({ client,lang }: { client: SupabaseClient; lang: Language }) {
  const t = copy[lang];
  const [data,setData] = useState<Overview>();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(false);
  useEffect(() => {
    let active = true;
    void client.rpc('control_ai').then(result => { if (active && !result.error) setData(result.data); });
    return () => { active=false; };
  },[client]);
  async function apply(action: string, amount?: number, business?: string) {
    if (busy) return;
    setError(false); setBusy(true);
    try {
      const result = await client.rpc('control_ai',{p_action:action,p_amount:amount,p_business:business});
      if (result.error) setError(true);
      else setData(result.data);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  if (!data) return null;
  return <section className="page-enter" aria-busy={busy}>
    <h2>{t[0]}</h2>
    <p>{data.enabled?t[1]:t[2]}</p>
    <p>{t[13]}: {data.requests}</p>
    <p>{t[14]}: {data.input_tokens} / {data.output_tokens}</p>
    <p>{t[15]}: ${(data.reserved/1e6).toFixed(4)} / ${(data.estimated/1e6).toFixed(4)}</p>
    <div className="controls">
      <button disabled={busy} onClick={()=>{if(data.enabled||window.confirm(t[3]+'?'))void apply(data.enabled?'disable':'enable');}}>{data.enabled?t[4]:t[3]}</button>
      <button disabled={busy} onClick={()=>{if(window.confirm(t[5]+'?'))void apply('stop');}}>{t[5]}</button>
    </div>
    <form key={'requests'+data.request_cap} onSubmit={event=>{event.preventDefault();void apply('requests',Number(new FormData(event.currentTarget).get('amount')));}}>
      <label>{t[6]}<input name="amount" type="number" min="0" max="1000000" defaultValue={data.request_cap} required/></label>
      <button disabled={busy}>{t[8]}</button>
    </form>
    <form key={'budget'+data.budget} onSubmit={event=>{event.preventDefault();void apply('budget',Math.round(Number(new FormData(event.currentTarget).get('amount'))*1e6));}}>
      <label>{t[7]}<input name="amount" type="number" min="0" max="100" step="0.000001" defaultValue={data.budget/1e6} required/></label>
      <button disabled={busy}>{t[8]}</button>
    </form>
    <form onSubmit={event=>{
      event.preventDefault();
      const values=new FormData(event.currentTarget);
      const action=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'pilot';
      void apply(action,Number(values.get('amount')),String(values.get('business')).trim());
    }}>
      <label>{t[9]}<input name="business" required pattern="[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"/></label>
      <label>{t[10]}<input name="amount" type="number" min="1" max="3" defaultValue="1" required/></label>
      <button disabled={busy} value="pilot">{t[11]}</button>
      <button disabled={busy} value="remove-pilot">{t[12]}</button>
    </form>
    {error&&<p role="alert">{t[16]}</p>}
  </section>;
}
