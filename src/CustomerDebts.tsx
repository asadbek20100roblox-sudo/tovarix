import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowDownLeft, BadgeCheck, ChevronRight, CircleAlert, Plus, Search, Wallet, X } from 'lucide-react';
import type { Language } from './labels';

export const debtTitle = { uz:'Qarz daftari', ru:'Долговая книга', en:'Customer debts' };
const copy = {
  uz: ['Jami qarz','Qarzdorlar soni','Mijozni qidirish','Barchasi','Muddati o‘tgan','Bugun','Faol','To‘langan','Qarz qo‘shish','Mijoz','To‘lov muddati','Summa','Izoh','Saqlash','Yopish','To‘lovni qayd etish','To‘liq to‘lash','Operatsiyalar','Qarz yozuvlari yo‘q','Yuklanmoqda','Ma’lumotlarni yuklab bo‘lmadi','Operatsiya bajarilmadi','Qarz','To‘lov','Oldingi','Keyingi','Bugun to‘laydi','kun kechikdi','kun qoldi'],
  ru: ['Общий долг','Кол-во должников','Поиск клиента','Все','Просроченные','Сегодня','Активные','Оплачено','Добавить долг','Клиент','Срок оплаты','Сумма','Комментарий','Сохранить','Закрыть','Записать погашение','Полное погашение','История операций','Записей о долгах пока нет','Загрузка','Не удалось загрузить данные','Операция не выполнена','Начисление','Погашение','Назад','Далее','Срок оплаты сегодня','дн. просрочки','дн. осталось'],
  en: ['Total debt','Customers with debt','Search customers','All','Overdue','Today','Active','Paid','Add debt','Customer','Due date','Amount','Note','Save','Close','Record repayment','Pay full balance','Activity history','No debt records yet','Loading','Could not load data','Operation failed','Opening balance','Repayment','Previous','Next','Due today','days overdue','days left'],
} as const;

const ledgerCopy = {
  uz:['Mijozlar qarzi','Yetkazib beruvchilar qarzi','Muddati o‘tgan','Bugun to‘lanishi kerak','Qaytarilgan','Boshlang‘ich qarz','To‘langan','Qolgan qarz','Ism yoki telefon','Summa bo‘yicha','Yangi qarzlar','Muddat bo‘yicha','Qisman to‘langan','Muddatni o‘zgartirish','Eslatmani nusxalash','CSV (joriy sahifa)','Eslatma nusxalandi','Smart Qarz · avval muddati o‘tgan qarzlarni ko‘rib chiqing.','Davr boshlanishi','Davr oxiri'],
  ru:['Долги покупателей','Долги поставщикам','Просрочено','К оплате сегодня','Погашено за период','Исходный долг','Погашено','Остаток','Имя или телефон','По сумме','Новые долги','По сроку','Частично погашено','Изменить срок','Скопировать напоминание','CSV текущей страницы','Напоминание скопировано','Smart Qarz · проверьте просроченные долги в первую очередь.','Начало периода','Конец периода'],
  en:['Customer debt','Supplier debt','Overdue','Due today','Repaid in period','Original debt','Repaid','Balance','Name or phone','By balance','Newest first','By due date','Partially paid','Change due date','Copy reminder','CSV (current page)','Reminder copied','Smart Qarz · review overdue balances first.','Period start','Period end'],
} as const;
const day = (offset: number) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*86400000));

type Debt = { id: string; name: string; phone: string | null; due_on: string; days: number; balance: number; opened:number; repaid:number; created_at:string; cancelled_at:string|null; sale_id:string|null; samples:number|null; late:number|null };
type Overview = { total: string; count: number; overdue:string; due_today:string; repaid:string; smart:boolean; rows: Debt[] };
type Entry = { request_id: string; kind: string; amount: number|null; created_at: string; note: string; payment_method:string|null };
const statuses = ['all','overdue','today','active','paid','partial','cancelled'] as const;

export function CustomerDebts({ client, business, lang }: { client: SupabaseClient; business: string; lang: Language }) {
  const t = copy[lang];
  const l = ledgerCopy[lang];
  const payment = {
    uz:['Naqd','Karta','O‘tkazma','To‘lov turi','Bekor qilingan','Qarzni bekor qilish','Sabab'],
    ru:['Наличные','Карта','Перевод','Способ платежа','Отменён','Отменить долг','Причина'],
    en:['Cash','Card','Transfer','Payment method','Cancelled','Cancel debt','Reason'],
  }[lang];
  const [kind,setKind]=useState<'customer'|'supplier'>('customer');
  const [sort,setSort]=useState('due');
  const [from,setFrom]=useState(()=>day(-29));
  const [until,setUntil]=useState(()=>day(0));
  const [notice,setNotice]=useState('');
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
      void client.rpc('debt_book',{p_business:business,p_kind:kind,p_search:search,p_status:status,p_sort:sort,p_offset:page*20,p_from:from,p_until:until}).then(result => {
        if (!live) return;
        if (result.error) setError(t[20]);
        else setOverview(result.data);
      });
    },180);
    return () => { live=false; clearTimeout(timer); };
  },[client,business,kind,search,status,sort,page,from,until,revision,t]);

  useEffect(() => {
    let live=true;
    if (panel === 'new') {
      void client.from('contacts').select('id,name').eq('business_id',business).eq('kind',kind).order('name').then(result => {
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
  },[client,business,kind,panel,historyPage,t]);

  function show(value: Debt | 'new') {
    setPanel(value);
    setNotice('');
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
    const method=String(form.get('method')??'');
    const encoded=JSON.stringify([payload,method]);
    if (intent.current?.payload!==encoded) intent.current={key:crypto.randomUUID(),payload:encoded};
    writing.current=true;
    setBusy(true);
    setPanelError('');
    try {
      const result=panel==='new'
        ? await client.rpc('write_debt',{...payload,p_request:intent.current.key})
        : await client.rpc('record_debt_payment',{p_business:business,p_request:intent.current.key,p_debt:panel.id,
          p_amount:payload.p_amount,p_note:payload.p_note,p_method:method});
      if (result.error) { setPanelError(t[21]); return; }
      intent.current=null;
      dialog.current?.close();
      refresh(n=>n+1);
    } catch { setPanelError(t[21]); }
    finally { writing.current=false; setBusy(false); }
  }
  async function reschedule(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!panel||panel==='new'||writing.current)return;
    const due=String(new FormData(event.currentTarget).get('due'));
    writing.current=true;setBusy(true);
    try {
      const result=await client.rpc('reschedule_debt',{p_business:business,p_debt:panel.id,p_previous:panel.due_on,p_due:due});
      if(result.error) throw result.error;
      dialog.current?.close();refresh(n=>n+1);
    } catch {setPanelError(t[21]);}
    finally {writing.current=false;setBusy(false);}
  }
  function download() {
    const escape=(value:unknown)=>{
      const raw=String(value??'');
      return '"'+(/^[\s]*[=+@-]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';
    };
    const headers=[l[8],t[10],l[5],l[6],l[7]];
    const rows=(overview?.rows??[]).slice(0,20).map(d=>[d.name,d.due_on,d.opened,d.repaid,d.balance]);
    const blob=new Blob(['\ufeff'+[headers,...rows].map(row=>row.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='tovarix-qarz-'+kind+'.csv';link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="debt-screen page-enter" aria-label={debtTitle[lang]}>
    <h2>{debtTitle[lang]}</h2>
    <div className="controls">{(['customer','supplier'] as const).map((item,i)=><button type="button" key={item} aria-pressed={kind===item} onClick={()=>{setKind(item);setPage(0);setOverview(null);}}>{l[i]}</button>)}</div>
    <div className="debt-hero"><Wallet size={22}/><span>{kind==='customer'?t[0]:l[1]}</span>
      <strong>{overview ? money(BigInt(overview.total)) : '—'}</strong>
      <small>{t[1]} · {overview?.count ?? '—'}</small>
    </div>
    <div className="debt-summary">{(['overdue','due_today','repaid'] as const).map((key,i)=><article key={key}>
      <small>{l[i+2]}</small><strong>{overview ? money(BigInt(overview[key])) : '—'}</strong>
    </article>)}</div>
    {overview?.smart && kind==='customer' && <p className="section-caption">{l[17]}</p>}
    <div className="controls debt-options">
      <input type="date" aria-label={l[18]} value={from} onChange={e=>{setFrom(e.target.value);setPage(0);}}/>
      <input type="date" aria-label={l[19]} value={until} onChange={e=>{setUntil(e.target.value);setPage(0);}}/>
      <select aria-label={l[11]} value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}>
        <option value="due">{l[11]}</option><option value="balance">{l[9]}</option><option value="newest">{l[10]}</option>
      </select>
      <button type="button" disabled={!overview?.rows.length} onClick={download}>{l[15]}</button>
    </div>
    <label className="search-field"><Search size={18}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder={l[8]} aria-label={l[8]}/></label>
    <div className="controls debt-filter">{statuses.map((item,i)=><button key={item} aria-pressed={status===item} onClick={()=>{setStatus(item);setPage(0);}}>{item==='cancelled'?payment[4]:item==='partial'?l[12]:t[3+i]}</button>)}</div>
    {error ? <p role="alert">{error}</p> : !overview ? <div className="loading-skeleton" role="status" aria-label={t[19]}/> : !overview.rows.length && <p className="empty-state">{t[18]}</p>}
    <div className="debt-list">{overview?.rows.slice(0,20).map((debt,i)=><button className="debt-person" key={debt.id} onClick={()=>show(debt)}>
      <span className={'avatar '+['blue','violet','green','amber'][i%4]}>{debt.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}</span>
      <span className="debt-identity"><strong>{debt.name}</strong><small>{debt.due_on}</small></span>
      <span className={'debt-value '+(debt.balance>0&&debt.days<0?'debt-overdue':'')}><strong>{money(debt.balance)}</strong>
        <small>{debt.cancelled_at?payment[4]:!debt.balance?t[7]:debt.days===0?t[26]:debt.days<0?Math.abs(debt.days)+' '+t[27]:debt.days+' '+t[28]}</small>
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
        <p>{panel.phone || '—'} · {new Date(panel.created_at).toLocaleDateString(lang,{timeZone:'Asia/Tashkent'})} → {panel.due_on}</p>
        <div className="debt-summary">{[panel.opened,panel.repaid,panel.balance].map((value,i)=><article key={i}><small>{l[5+i]}</small><strong>{money(value)}</strong></article>)}</div>
        {!panel.cancelled_at&&<form className="controls" onSubmit={e=>void reschedule(e)}>
          <input name="due" type="date" defaultValue={panel.due_on} aria-label={l[13]} required/>
          <button disabled={busy}>{l[13]}</button>
        </form>}
        {kind==='customer'&&panel.balance>0&&<button type="button" onClick={()=>void navigator.clipboard.writeText(
          panel.name+' · '+l[7]+': '+money(panel.balance)+' · '+t[10]+': '+panel.due_on
        ).then(()=>setNotice(l[16])).catch(()=>setPanelError(t[21]))}>{l[14]}</button>}
        {overview?.smart&&kind==='customer'&&panel.balance>=3&&<p className="section-caption">
          {({uz:'Taklif: to‘lovni uch qismga bo‘lib kelishing, birinchi to‘lov',ru:'Предложение: согласуйте три платежа. Первый взнос',en:'Suggested schedule: agree on three instalments. First payment'})[lang]} · {money(Math.ceil(panel.balance/3))}
        </p>}
        {overview?.smart&&panel.samples!==null&&panel.late!==null&&<p className="section-caption">
          {panel.late*2>=panel.samples
            ? ({uz:'Kechikish xavfi: yuqoriroq',ru:'Риск просрочки: повышенный',en:'Late payment risk: elevated'})[lang]
            : ({uz:'Kechikish xavfi: pastroq',ru:'Риск просрочки: ниже',en:'Late payment risk: lower'})[lang]}
          {' · '}{panel.late}/{panel.samples}{' '}
          {({uz:'qarz dastlabki muddatdan kech yopilgan (365 kun). Bu kafolat emas.',
            ru:'долгов закрыто позже исходного срока за 365 дней. Это ориентир.',
            en:'debts closed after their original due date in 365 days. This is an estimate.'})[lang]}
        </p>}
        {notice&&<p role="status">{notice}</p>}
        <h3>{t[17]}</h3><ul className="debt-history">{history.slice(0,20).map(entry=><li key={entry.request_id}>
          {entry.kind==='repayment'?<BadgeCheck size={17}/>:<ArrowDownLeft size={17}/>}
          <span>{entry.kind==='cancelled'?payment[4]:entry.kind==='rescheduled'?l[13]:t[entry.kind==='repayment'?23:22]} <small>{new Date(entry.created_at).toLocaleString(lang,{timeZone:'Asia/Tashkent'})} {entry.note} {entry.payment_method&&payment[['cash','card','transfer'].indexOf(entry.payment_method)]}</small></span>
          {entry.amount!==null&&<strong>{money(entry.amount)}</strong>}
        </li>)}</ul>
        {(historyPage>0 || history.length>20) && <div className="controls">
          <button disabled={!historyPage} onClick={()=>setHistoryPage(historyPage-1)}>{t[24]}</button>
          <button disabled={history.length<=20} onClick={()=>setHistoryPage(historyPage+1)}>{t[25]}</button></div>}
      </>}
      {panel==='new'&&kind==='supplier'&&<details>
        <summary>{({uz:'Yetkazib beruvchi qo‘shish',ru:'Добавить поставщика',en:'Add supplier'})[lang]}</summary>
        <form onSubmit={event=>{
          event.preventDefault();
          if(writing.current)return;
          const form=event.currentTarget;
          const name=String(new FormData(form).get('name')).trim();
          writing.current=true;setBusy(true);
          void Promise.resolve(client.rpc('create_debt_supplier',{p_business:business,p_name:name}))
            .then(result=>{
              if(result.error)setPanelError(t[21]);
              else{setContacts(old=>[...old,{id:result.data,name}]);form.reset();}
            },()=>setPanelError(t[21])).finally(()=>{writing.current=false;setBusy(false);});
        }}>
          <input name="name" maxLength={120} required aria-label={l[1]}/>
          <button disabled={busy}>{t[13]}</button>
        </form>
      </details>}
      {panel && (panel==='new'||panel.balance>0) && <form className="debt-form" onSubmit={event=>void save(event)}>
        {panel==='new'&&<><label>{kind==='customer'?t[9]:l[1]}<select name="customer" required><option value="">—</option>{contacts.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
          <label>{t[10]}<input name="due" type="date" required/></label></>}
        <label>{t[11]}<input type="number" required min="1" max={panel==='new'?1000000000000:panel.balance} step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        {panel!=='new'&&<button type="button" onClick={()=>setAmount(String(panel.balance))}>{t[16]}</button>}
        {panel!=='new'&&<label>{payment[3]}<select name="method" required>
          {['cash','card','transfer'].map((method,i)=><option value={method} key={method}>{payment[i]}</option>)}
        </select></label>}
        <label>{t[12]}<input name="note" maxLength={300}/></label>
        <button className="primary-button" disabled={busy}>{panel==='new'?t[13]:t[15]}</button>
      </form>}
      {panel&&panel!=='new'&&panel.balance>0&&!panel.repaid&&!panel.cancelled_at&&!panel.sale_id&&<details>
        <summary>{payment[5]}</summary>
        <form onSubmit={event=>{
          event.preventDefault();
          if(writing.current)return;
          const reason=String(new FormData(event.currentTarget).get('reason'));
          if(!window.confirm(payment[5]+'?'))return;
          writing.current=true;setBusy(true);
          void Promise.resolve(client.rpc('cancel_manual_debt',{p_business:business,p_debt:panel.id,p_reason:reason}))
            .then(result=>{if(result.error)setPanelError(t[21]);else{dialog.current?.close();refresh(n=>n+1);}},
              ()=>setPanelError(t[21])).finally(()=>{writing.current=false;setBusy(false);});
        }}><label>{payment[6]}<input name="reason" minLength={4} maxLength={300} required/></label>
          <button disabled={busy}>{payment[5]}</button>
        </form>
      </details>}
      {panelError&&<p role="alert"><CircleAlert size={16}/> {panelError}</p>}
    </dialog>
  </section>;
}
