import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AIControl } from './AIControl';
import { ManualSubscriptions } from './ManualSubscriptions';
import { SupportDesk } from './SupportDesk';
import type { Language } from './labels';
import { plans } from './plans';

const sections=['dashboard','users','businesses','subscriptions','payments','finance','promos','ai','support','notifications','flags','security','settings'] as const;
type Section=typeof sections[number];
type RecordRow=Record<string,string|number|boolean|null> & {uses?: {business:string;request:string|null}[]};
const copy={
  uz: [['Bosh sahifa','Foydalanuvchilar','Korxonalar','Obunalar','To‘lov arizalari','Moliya','Promokodlar','AI boshqaruvi','Yordam','Bildirishnomalar','Funksiya holati','Xavfsizlik','Sozlamalar'],
    ['Qidirish','Oldingi','Keyingi','Ma’lumot yo‘q','Yuklanmoqda','Amal bajarilmadi','Sabab','Bloklash','Blokdan chiqarish','Seanslarni bekor qilish','Tarifni berish / tugash sanasi','Obunani bekor qilish','Sinovni yakunlash','Sarlavha','Matn','E’lon qilish','Arxivlash','Yangilanish','Texnik xizmat','Obuna','Filiallar','Xodimlar','Mahsulotlar','E’lon arxivlangan','Ro‘yxatdan o‘tish','AI'],
    ['Foydalanuvchilar','Korxonalar','7 kunda kirganlar','7 kunda ro‘yxatdan o‘tganlar','Oldingi 7 kun','Sinovdagi obunalar','Faol pullik obunalar','FREE','Tasdiqlangan tushum (UZS)','Bugungi AI so‘rovlari','Ochiq murojaatlar']],
  ru: [['Обзор','Пользователи','Предприятия','Подписки','Заявки на оплату','Финансы','Промокоды','Управление AI','Поддержка','Уведомления','Функции','Безопасность','Настройки'],
    ['Поиск','Назад','Далее','Нет данных','Загрузка','Операция не выполнена','Причина','Заблокировать','Разблокировать','Отозвать сессии','Назначить тариф и дату окончания','Отменить подписку','Завершить пробный период','Заголовок','Текст','Опубликовать','Архивировать','Обновление','Обслуживание','Подписка','Филиалы','Сотрудники','Товары','Объявление в архиве','Регистрация','AI'],
    ['Пользователи','Предприятия','Вошли за 7 дней','Регистрации за 7 дней','Предыдущие 7 дней','Пробные подписки','Активные платные подписки','FREE','Подтверждённые поступления (UZS)','Запросы AI сегодня','Открытые обращения']],
  en: [['Dashboard','Users','Businesses','Subscriptions','Payment Requests','Finance','Promo Codes','AI Control','Support','Notifications','Feature Flags','Security','Settings'],
    ['Search','Previous','Next','No records','Loading','Operation failed','Reason','Suspend','Restore','Revoke sessions','Grant plan and end date','Cancel subscription','End trial','Title','Message','Publish','Archive','Update','Maintenance','Subscription','Branches','Employees','Products','Announcement archived','Registration','AI'],
    ['Users','Businesses','Signed in within 7 days','Registrations in 7 days','Previous 7 days','In trial','Active paid subscriptions','FREE','Confirmed receipts (UZS)','AI requests today','Open tickets']],
} as const;
const promoCopy={
  uz:['Kod','Tarif','Chegirma (%)','Tugash sanasi','Yaratish','Faollashtirish','O‘chirish','Foydalanish tarixi'],
  ru:['Код','Тариф','Скидка (%)','Срок действия','Создать','Активировать','Деактивировать','История использования'],
  en:['Code','Plan','Discount (%)','Expiration date','Issue','Enable','Disable','Redemption history'],
} as const;
const metricKeys=['users','businesses','signed_in_7d','new_7d','previous_new_7d','trial','paid','free','confirmed_revenue','ai_requests','open_tickets'];

export function ControlConsole({client,lang}:{client:SupabaseClient;lang:Language}) {
  const [nav,t,metrics]=copy[lang];
  const promo=promoCopy[lang];
  const [section,setSection]=useState<Section>('dashboard');
  const [offset,setOffset]=useState(0);
  const [search,setSearch]=useState('');
  const [result,setResult]=useState<unknown>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(false);
  const hasRpc=section!=='payments'&&section!=='settings'&&section!=='support'&&section!=='ai';

  useEffect(()=>{
    if(!hasRpc) return;
    let active=true;
    const timeout=window.setTimeout(()=>{
      const request=section==='promos'?client.rpc('control_promos',{p_offset:offset}):client.rpc('control_platform',{p_area:section,p_search:search,p_offset:offset});
      void request.then(response=>{
        if(!active) return;
        setError(Boolean(response.error));
        setResult(response.data);
      });
    },search?150:0);
    return ()=>{active=false;window.clearTimeout(timeout);};
  },[client,hasRpc,offset,search,section]);
  async function change(command:string,payload:Record<string,unknown>) {
    if(busy) return;
    setBusy(true);setError(false);
    try {
      const response=await client.rpc('control_platform',{p_area:section,p_search:search,p_offset:offset,p_command:command,p_payload:payload});
      if(response.error) setError(true);else setResult(response.data);
    } catch {setError(true);}
    finally{setBusy(false);}
  }
  async function changePromo(action:string,code:string,plan?:string,discount?:number,expires?:string) {
    if(busy) return;
    setBusy(true);setError(false);
    try {
      const response=await client.rpc('control_promos',{p_action:action,p_code:code,p_plan:plan,
        p_discount:discount,p_expires:expires,p_offset:offset});
      if(response.error) setError(true);else setResult(response.data);
    } catch {setError(true);}
    finally{setBusy(false);}
  }
  function go(next:Section) {setSection(next);setOffset(0);setSearch('');setResult(undefined);setError(false);}
  const records=Array.isArray(result)?result as RecordRow[]:[];
  const object=(result??{}) as Record<string,number|string|Record<string,number>>;
  const amounts=object.plan_distribution as Record<string,number>|undefined;
  const selected=sections.indexOf(section);
  return <div className="control-console">
    <nav className="control-sections" aria-label="CONTROL">{sections.map((next,i)=><button key={next} aria-current={next===section?'page':undefined}
      disabled={busy} onClick={()=>go(next)}>{nav[i]}</button>)}</nav>
    <section aria-busy={busy}>
      <h2>{nav[selected]}</h2>
      {error&&<p role="alert">{t[5]}</p>}
      {hasRpc&&result===undefined&&!error&&<div className="loading-skeleton" role="status" aria-label={t[4]}/>}
      {(section==='payments'||section==='settings')&&<ManualSubscriptions client={client} lang={lang}/>}
      {section==='support'&&<SupportDesk client={client} lang={lang}/>}
      {section==='ai'&&<AIControl client={client} lang={lang}/>}
      {section==='dashboard'&&result!=null&&<>
        <div className="grid">{metricKeys.map((key,i)=><article key={key}><span>{metrics[i]}</span><strong>{String(object[key]??'—')}</strong></article>)}</div>
        {amounts&&<div className="control-plan-chart">{Object.entries(amounts).map(([plan,count])=><label key={plan}>{plan}
          <meter min={0} max={Math.max(1,...Object.values(amounts))} value={count}/><span>{count}</span></label>)}</div>}
      </>}
      {section==='flags'&&result!=null&&<dl>
        <dt>{t[24]}</dt><dd>{object.registration_open?'ON':'OFF'}</dd><dt>{t[25]}</dt><dd>{object.ai?'ON':'OFF'}</dd>
      </dl>}
      {['users','businesses','subscriptions'].includes(section)&&
        <input type="search" aria-label={t[0]} placeholder={t[0]} value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/>}
      {section==='notifications'&&<form onSubmit={e=>{
        e.preventDefault();const values=new FormData(e.currentTarget);
        void change('publish',{title:values.get('title'),message:values.get('message'),kind:values.get('kind')});
      }}>
        <label>{t[13]}<input name="title" maxLength={120} required/></label>
        <label>{t[14]}<textarea name="message" maxLength={2000} required/></label>
        <select name="kind" aria-label={nav[selected]}>{['update','maintenance','subscription'].map((kind,i)=><option key={kind} value={kind}>{t[17+i]}</option>)}</select>
        <button disabled={busy}>{t[15]}</button>
      </form>}
      {section==='promos'&&<form onSubmit={event=>{
        event.preventDefault();
        const fields=new FormData(event.currentTarget);
        void changePromo('issue',String(fields.get('code')),String(fields.get('plan')),
          Number(fields.get('discount')),String(fields.get('expires'))+'T23:59:00+05:00');
      }}>
        <label>{promo[0]}<input name="code" required minLength={6} maxLength={40} pattern="[A-Za-z0-9]{6,40}"/></label>
        <label>{promo[1]}<select name="plan">{plans.filter(plan=>plan.id!=='FREE').map(plan=><option key={plan.id}>{plan.id}</option>)}</select></label>
        <label>{promo[2]}<input type="number" name="discount" min="1" max="99" required/></label>
        <label>{promo[3]}<input type="date" name="expires" required/></label>
        <button disabled={busy}>{promo[4]}</button>
      </form>}
      {Array.isArray(result)&&!records.length&&<p>{t[3]}</p>}
      {records.slice(0,25).map(row=><article key={String(row.id??row.code)} className="control-record">
        {section==='users'&&<>
          <strong>{[row.given_name,row.family_name].filter(Boolean).join(' ')||row.email}</strong>
          <small>{row.email} · {row.id} · {row.banned?t[7]:row.email_confirmed_at?'✓':'—'}</small>
          <form onSubmit={e=>{
            e.preventDefault();
            const action=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
            if(action&&window.confirm(row.email+'?')) void change(action,{id:row.id,reason:new FormData(e.currentTarget).get('reason')});
          }}>
            <label>{t[6]}<input name="reason" minLength={4} maxLength={300} required/></label>
            <button disabled={busy} value={row.banned?'restore':'suspend'}>{t[row.banned?8:7]}</button>
            <button disabled={busy} value="revoke-sessions">{t[9]}</button>
          </form>
        </>}
        {(section==='businesses'||section==='subscriptions')&&<>
          <strong>{row.name} · {row.effective_plan}</strong>
          <small>{row.business_type} · {row.id}</small>
          <small>{t[20]} {row.branches} · {t[21]} {row.employees} · {t[22]} {row.products}</small>
          {row.paid_until&&<time>{new Date(String(row.paid_until)).toLocaleDateString(lang)}</time>}
          {section==='subscriptions'&&<form onSubmit={e=>{
            e.preventDefault();const values=new FormData(e.currentTarget);
            const action=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')??'grant-plan';
            const until=String(values.get('until')||'');
            if(window.confirm(row.name+'?'))void change(action,{id:row.id,reason:values.get('reason'),plan:values.get('plan'),until:until?until+'T23:59:00+05:00':null});
          }}>
            <label>{t[6]}<input name="reason" minLength={4} maxLength={300} required/></label>
            <select name="plan" aria-label={nav[selected]}>{plans.filter(plan=>plan.id!=='FREE').map(plan=><option key={plan.id}>{plan.id}</option>)}</select>
            <input name="until" type="date" aria-label={t[10]}/>
            <button disabled={busy} value="grant-plan">{t[10]}</button><button disabled={busy} value="cancel-plan">{t[11]}</button>
            <button disabled={busy} value="end-trial">{t[12]}</button>
          </form>}
        </>}
        {section==='finance'&&<><strong>{row.amount_uzs} UZS · {row.plan}</strong><small>{row.business_id} · {row.created_at}</small></>}
        {section==='promos'&&<>
          <strong>{row.code} · {row.discount_percent}% · {row.plan||'—'}</strong><small>{row.use_count}/3 · {row.expires_at}</small>
          <button disabled={busy} onClick={()=>void changePromo(row.enabled?'disable':'enable',String(row.code))}>{promo[row.enabled?6:5]}</button>
          {row.uses?.length?<details><summary>{promo[7]}</summary><ul>{row.uses.map(item=><li key={item.request??item.business}>{item.business} · {item.request??'—'}</li>)}</ul></details>:null}
        </>}
        {section==='security'&&<><strong>{row.action}</strong><small>{row.actor} · {row.created_at}</small>{row.detail&&<code>{JSON.stringify(row.detail)}</code>}</>}
        {section==='notifications'&&<><strong>{row.title}</strong><p>{row.message}</p>
          {row.archived_at?<small>{t[23]}</small>:<button disabled={busy} onClick={()=>{if(window.confirm(String(row.title)+'?'))void change('archive',{id:row.id});}}>{t[16]}</button>}
        </>}
      </article>)}
      {(offset>0||records.length>25)&&<div className="controls">
        <button disabled={offset===0||busy} onClick={()=>setOffset(offset-25)}>{t[1]}</button>
        <button disabled={records.length<26||busy} onClick={()=>setOffset(offset+25)}>{t[2]}</button>
      </div>}
    </section>
  </div>;
}
