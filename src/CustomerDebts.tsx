import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowDownLeft, BadgeCheck, ChevronRight, CircleAlert, Plus, Search, Wallet, X } from 'lucide-react';
import type { Language } from './labels';

export const debtTitle = { uz:'Qarzdorlar', ru:'Должники', en:'Customer debts' };
const copy = {
  uz: ['Jami qarz','Qarzdorlar soni','Mijozni qidirish','Barchasi','Muddati o‘tgan','Bugun','Faol','To‘langan','Qarz qo‘shish','Mijoz','To‘lov muddati','Summa','Izoh','Saqlash','Yopish','To‘lovni qayd etish','To‘liq to‘lash','Operatsiyalar','Qarz yozuvlari yo‘q','Yuklanmoqda','Ma’lumotlarni yuklab bo‘lmadi','Operatsiya bajarilmadi','Qarz','To‘lov','Oldingi','Keyingi','Bugun to‘laydi','kun kechikdi','kun qoldi'],
  ru: ['Общий долг','Кол-во должников','Поиск клиента','Все','Просроченные','Сегодня','Активные','Оплачено','Добавить долг','Клиент','Срок оплаты','Сумма','Комментарий','Сохранить','Закрыть','Записать погашение','Полное погашение','История операций','Записей о долгах пока нет','Загрузка','Не удалось загрузить данные','Операция не выполнена','Начисление','Погашение','Назад','Далее','Срок оплаты сегодня','дн. просрочки','дн. осталось'],
  en: ['Total debt','Customers with debt','Search customers','All','Overdue','Today','Active','Paid','Add debt','Customer','Due date','Amount','Note','Save','Close','Record repayment','Pay full balance','Activity history','No debt records yet','Loading','Could not load data','Operation failed','Opening balance','Repayment','Previous','Next','Due today','days overdue','days left'],
} as const;

type Debt = { id: string; name: string; phone: string | null; due_on: string; days: number; balance: number };
type Overview = { total: string; count: number; rows: Debt[] };
type Entry = { request_id: string; kind: string; amount: number; created_at: string; note: string };
const statuses = ['all','overdue','today','active','paid'] as const;

export function CustomerDebts({ client, business, lang }: { client: SupabaseClient; business: string; lang: Language }) {
  const t = copy[lang];
  const [status, setStatus] = useState<(typeof statuses)[number]>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [revision, refresh] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [panel, setPanel] = useState<Debt | 'new' | null>(null);
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [panelError, setPanelError] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const intent = useRef<{ key: string; payload: string }>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const money = (value: number | bigint) => new Intl.NumberFormat(lang).format(value) + (lang === 'uz' ? ' so‘m' : ' UZS');

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setError('');
      setOverview(null);
      void client.rpc('debt_overview',{p_business:business,p_search:search,p_status:status,p_offset:page*20}).then(result => {
        if (!live) return;
        if (result.error) setError(t[20]);
        else setOverview(result.data);
      });
    },180);
    return () => { live=false; clearTimeout(timer); };
  },[client,business,search,status,page,revision,t]);

  useEffect(() => {
    let live=true;
    if (panel === 'new') {
      void client.from('contacts').select('id,name').eq('business_id',business).eq('kind','customer').order('name').then(result => {
        if (live && !result.error) setContacts(result.data);
        if (live && result.error) setPanelError(t[20]);
      });
    } else if (panel) {
      void client.rpc('debt_history',{p_business:business,p_debt:panel.id,p_offset:historyPage*20}).then(result => {
        if (live && !result.error) setHistory(result.data);
        if (live && result.error) setPanelError(t[20]);
      });
    }
    return () => { live=false; };
  },[client,business,panel,historyPage,t]);

  function show(value: Debt | 'new') {
    setPanel(value);
    setHistory([]);
    setHistoryPage(0);
    setPanelError('');
    setAmount('');
    dialog.current?.showModal();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!panel || writing.current) return;
    const form=new FormData(event.currentTarget);
    const payload = {
      p_business:business,p_amount:Number(amount),p_note:String(form.get('note') ?? ''),
      p_customer:panel==='new'?String(form.get('customer') ?? ''):null,
      p_due:panel==='new'?String(form.get('due') ?? ''):null,
      p_debt:panel==='new'?null:panel.id,
    };
    const encoded=JSON.stringify(payload);
    if (intent.current?.payload!==encoded) intent.current={key:crypto.randomUUID(),payload:encoded};
    writing.current=true;
    setBusy(true);
    setPanelError('');
    try {
      const result=await client.rpc('write_debt',{...payload,p_request:intent.current.key});
      if (result.error) { setPanelError(t[21]); return; }
      intent.current=null;
      dialog.current?.close();
      refresh(n=>n+1);
    } catch { setPanelError(t[21]); }
    finally { writing.current=false; setBusy(false); }
  }
  return <section className="debt-screen page-enter" aria-label={debtTitle[lang]}>
    <div className="debt-hero"><Wallet size={22}/><span>{t[0]}</span>
      <strong>{overview ? money(BigInt(overview.total)) : '—'}</strong>
      <small>{t[1]} · {overview?.count ?? '—'}</small>
    </div>
    <label className="search-field"><Search size={18}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder={t[2]} aria-label={t[2]}/></label>
    <div className="controls debt-filter">{statuses.map((item,i)=><button key={item} aria-pressed={status===item} onClick={()=>{setStatus(item);setPage(0);}}>{t[3+i]}</button>)}</div>
    {error ? <p role="alert">{error}</p> : !overview ? <div className="loading-skeleton" role="status" aria-label={t[19]}/> : !overview.rows.length && <p className="empty-state">{t[18]}</p>}
    <div className="debt-list">{overview?.rows.slice(0,20).map((debt,i)=><button className="debt-person" key={debt.id} onClick={()=>show(debt)}>
      <span className={'avatar '+['blue','violet','green','amber'][i%4]}>{debt.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}</span>
      <span className="debt-identity"><strong>{debt.name}</strong><small>{debt.due_on}</small></span>
      <span className={'debt-value '+(debt.balance>0&&debt.days<0?'debt-overdue':'')}><strong>{money(debt.balance)}</strong>
        <small>{!debt.balance?t[7]:debt.days===0?t[26]:debt.days<0?Math.abs(debt.days)+' '+t[27]:debt.days+' '+t[28]}</small>
      </span><ChevronRight size={16}/>
    </button>)}</div>
    {(page>0 || (overview?.rows.length ?? 0)>20) && <div className="controls">
      <button disabled={!page} onClick={()=>setPage(page-1)}>{t[24]}</button>
      <button disabled={(overview?.rows.length??0)<=20} onClick={()=>setPage(page+1)}>{t[25]}</button></div>}
    <button className="debt-fab primary-button" aria-label={t[8]} onClick={()=>show('new')}><Plus size={24}/></button>
    <dialog ref={dialog} className="debt-sheet" onClose={()=>setPanel(null)} aria-label={panel==='new'?t[8]:panel?.name}>
      <div className="notice-title"><h2>{panel==='new'?t[8]:panel?.name}</h2>
        <button type="button" className="icon-button" aria-label={t[14]} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      {panel && panel !== 'new' && <>
        <p>{panel.phone || '—'} · {panel.due_on}</p><h3>{money(panel.balance)}</h3>
        <h3>{t[17]}</h3><ul className="debt-history">{history.slice(0,20).map(entry=><li key={entry.request_id}>
          {entry.kind==='repayment'?<BadgeCheck size={17}/>:<ArrowDownLeft size={17}/>}
          <span>{t[entry.kind==='repayment'?23:22]} <small>{new Date(entry.created_at).toLocaleString(lang,{timeZone:'Asia/Tashkent'})} {entry.note}</small></span>
          <strong>{money(entry.amount)}</strong>
        </li>)}</ul>
        {(historyPage>0 || history.length>20) && <div className="controls">
          <button disabled={!historyPage} onClick={()=>setHistoryPage(historyPage-1)}>{t[24]}</button>
          <button disabled={history.length<=20} onClick={()=>setHistoryPage(historyPage+1)}>{t[25]}</button></div>}
      </>}
      {panel && (panel==='new'||panel.balance>0) && <form className="debt-form" onSubmit={event=>void save(event)}>
        {panel==='new'&&<><label>{t[9]}<select name="customer" required><option value="">—</option>{contacts.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
          <label>{t[10]}<input name="due" type="date" required/></label></>}
        <label>{t[11]}<input type="number" required min="1" max={panel==='new'?1000000000000:panel.balance} step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        {panel!=='new'&&<button type="button" onClick={()=>setAmount(String(panel.balance))}>{t[16]}</button>}
        <label>{t[12]}<input name="note" maxLength={300}/></label>
        <button className="primary-button" disabled={busy}>{panel==='new'?t[13]:t[15]}</button>
      </form>}
      {panelError&&<p role="alert"><CircleAlert size={16}/> {panelError}</p>}
    </dialog>
  </section>;
}
