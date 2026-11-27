import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowUp, Copy, FilePlus, History, Pencil, Plus, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Language } from './labels';

const copy = {
  uz: {
    intro: 'Biznesingizni birgalikda rivojlantiramiz.', new: 'Yangi chat', history: 'Suhbatlar tarixi', search: 'Suhbatlarni qidirish', legacy: 'Avvalgi xabarlar',
    questions: ['Bugungi savdolarni tahlil qil','Foydani hisobla','Qarzdorlarni ko‘rsat','Kam qolgan mahsulotlarni top','Xarid bo‘yicha tavsiya ber','Haftalik hisobot tayyorla'],
    input: 'Savolingizni yozing', attach: 'Rasm yoki PDF biriktirish', send: 'Yuborish', stop: 'To‘xtatish', wait: 'Javob tayyorlanmoqda',
    rename: 'Nomini o‘zgartirish', remove: 'Suhbatni o‘chirish', remaining: 'Bugun qolgan so‘rovlar', disabled: 'AI hozircha o‘chiq',
    failure: 'Amal bajarilmadi. Ulanish va ruxsatlaringizni tekshiring.', size: '1,4 MB gacha JPEG, PNG, WebP yoki PDF tanlang.',
    copy: 'Nusxalash', copied: 'Nusxalandi', retry: 'Qayta yuborish', sales: 'Kunlik tushum', profit: 'Yalpi foyda',
    proposal: 'Narx bo‘yicha taklif', confirm: 'Tasdiqlash', cancel: 'Bekor qilish', status: ['Kutilmoqda','Bajarildi','Bekor qilindi','Muddati o‘tdi'],
  },
  ru: {
    intro: 'Поможем вашему бизнесу расти.', new: 'Новый чат', history: 'История чатов', search: 'Поиск по чатам', legacy: 'Предыдущие сообщения',
    questions: ['Проанализируй сегодняшние продажи','Рассчитай прибыль','Покажи задолженности','Найди товары с низким остатком','Дай рекомендации по закупкам','Подготовь отчёт за неделю'],
    input: 'Напишите вопрос', attach: 'Прикрепить изображение или PDF', send: 'Отправить', stop: 'Остановить', wait: 'Готовится ответ',
    rename: 'Переименовать', remove: 'Удалить диалог', remaining: 'Запросов осталось сегодня', disabled: 'AI пока отключён',
    failure: 'Операция не выполнена. Проверьте подключение и права доступа.', size: 'Выберите JPEG, PNG, WebP или PDF размером до 1,4 МБ.',
    copy: 'Копировать', copied: 'Скопировано', retry: 'Повторить запрос', sales: 'Дневная выручка', profit: 'Валовая прибыль',
    proposal: 'Предложение изменить цену', confirm: 'Подтвердить', cancel: 'Отменить', status: ['На подтверждении','Выполнено','Отменено','Срок истёк'],
  },
  en: {
    intro: 'Let’s grow your business together.', new: 'New chat', history: 'Chat history', search: 'Search chats', legacy: 'Previous messages',
    questions: ['Analyze today’s sales','Calculate profit','Show outstanding debts','Find low-stock products','Recommend purchases','Prepare a weekly report'],
    input: 'Ask a question', attach: 'Attach an image or PDF', send: 'Send', stop: 'Stop', wait: 'Preparing a response',
    rename: 'Rename chat', remove: 'Delete chat', remaining: 'Requests remaining today', disabled: 'AI is currently disabled',
    failure: 'The operation failed. Check your connection and permissions.', size: 'Choose JPEG, PNG, WebP, or PDF up to 1.4 MB.',
    copy: 'Copy', copied: 'Copied', retry: 'Retry request', sales: 'Daily revenue', profit: 'Gross profit',
    proposal: 'Price change proposal', confirm: 'Confirm', cancel: 'Cancel', status: ['Pending','Applied','Cancelled','Expired'],
  },
};
const accepted = ['image/jpeg','image/png','image/webp','application/pdf'];
type Chat = { id: string; title: string };
type Turn = { id: string; question: string; answer: string };
type Point = { day: string; revenue: number; gross_profit: number | null };
type Proposal = { id: string; name: string; old_price: number; new_price: number; status: 'pending'|'applied'|'cancelled'|'expired' };
type AiEvent = { delta?: string; done?: { answer: string; id: string; chart: Point[] }; error?: string };

function attachment(file: File) {
  return new Promise<{ mimeType: string; data: string }>((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ mimeType: file.type, data: String(reader.result).split(',')[1] });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function AIChat({ client, business, user, lang }: { client: SupabaseClient; business: string; user: string; lang: Language }) {
  const t = copy[lang];
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [quota, setQuota] = useState<{ enabled: boolean; remaining: number }>();
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [file, setFile] = useState<File>();
  const [draft, setDraft] = useState<{ question: string; answer: string }>();
  const [chart, setChart] = useState<Point[]>([]);
  const [proposal, setProposal] = useState<Proposal>();
  const [selectedPoint, setPoint] = useState<Point>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const generation = useRef<AbortController | null>(null);
  const history = useRef<HTMLDialogElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const money = (value: number) => new Intl.NumberFormat(lang === 'uz' ? 'uz-UZ' : lang).format(value) + (lang === 'uz' ? ' so‘m' : ' UZS');

  const refresh = useCallback(async () => {
    const [list, remaining] = await Promise.all([
      client.rpc('ai_conversations',{ p_business: business, p_action: 'list' }),
      client.rpc('ai_remaining',{ p_business: business }),
    ]);
    if (list.error || remaining.error) throw list.error ?? remaining.error;
    setChats(list.data ?? []);
    setQuota(remaining.data);
  }, [business,client]);

  const load = useCallback(async (id: string | null, isLegacy: boolean) => {
    if (!id && !isLegacy) return [];
    const query = client.from('ai_history').select('id,question,answer').eq('business_id',business).eq('user_id',user);
    const response = await (id ? query.eq('conversation_id',id) : query.is('conversation_id',null))
      .order('created_at',{ ascending: false }).limit(100);
    if (response.error) throw response.error;
    return (response.data ?? []).reverse() as Turn[];
  }, [business, client, user]);

  const handleProposal = useCallback(async (id: string, operation: string) => {
    const result = await client.rpc('ai_price_action', { p_business: business, p_turn: id, p_action: operation });
    if (result.error && operation !== 'get') throw result.error;
    setProposal(result.data ?? undefined);
  }, [business,client]);

  useEffect(() => {
    void refresh().catch(() => setError(t.failure)).finally(() => setLoading(false));
    return () => generation.current?.abort();
  }, [refresh,t.failure]);
  useEffect(() => {
    const online = () => {
      void refresh().catch(() => setError(t.failure));
      void load(selected,legacy).then(setMessages).catch(() => setError(t.failure));
    };
    window.addEventListener('online',online);
    return () => window.removeEventListener('online',online);
  },[legacy,load,refresh,selected,t.failure]);

  function reset(id: string | null, isLegacy = false) {
    setSelected(id); setLegacy(isLegacy); setMessages([]); setChart([]); setPoint(undefined);
    setProposal(undefined); setError(''); setNotice(''); setDraft(undefined); setQuestion(''); setFile(undefined);
    if (attachmentInput.current) attachmentInput.current.value = '';
  }

  async function select(id: string | null, isLegacy = false) {
    if (busy || loading) return;
    reset(id,isLegacy);
    history.current?.close();
    setLoading(true);
    try {
      const turns = await load(id,isLegacy);
      setMessages(turns);
      if (id && turns.length) await handleProposal(turns.at(-1)!.id,'get');
    } catch { setError(t.failure); }
    finally { setLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || generation.current || !quota?.enabled || quota.remaining <= 0) return;
    const prompt = question.trim();
    const request = new AbortController();
    generation.current = request;
    setBusy(true); setError(''); setNotice(''); setChart([]); setPoint(undefined); setProposal(undefined);
    setDraft({ question: prompt, answer: '' });
    let id = selected;
    try {
      if (!id) {
        const created = await client.rpc('ai_conversations',{p_business: business,p_action: 'create',p_title: prompt.slice(0,100)});
        if (created.error) throw created.error;
        id = created.data.id as string;
        setSelected(id); setLegacy(false); setMessages([]);
      }
      const image = file ? await attachment(file) : undefined;
      request.signal.throwIfAborted();
      const response = await client.functions.invoke<Response>('tovarix-ai',{
        body: { business, question: prompt, image, conversation: id, language: lang, stream: true }, signal: request.signal,
      });
      if (response.error || !response.data?.body) throw response.error ?? new Error('Response unavailable');
      const reader = response.data.body.getReader();
      const cancelStream = () => { void reader.cancel().catch(() => undefined); };
      request.signal.addEventListener('abort',cancelStream,{once:true});
      const decoder = new TextDecoder();
      let pending = '';
      let answer = '';
      let final: AiEvent['done'];
      try {
        request.signal.throwIfAborted();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value,{stream:true});
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) if (line.startsWith('data: ')) {
            const item = JSON.parse(line.slice(6)) as AiEvent;
            if (item.error) throw new Error(item.error);
            if (item.done) final = item.done;
            if (item.delta) answer += item.delta;
          }
          setDraft({question:prompt,answer});
        }
      } finally {
        request.signal.removeEventListener('abort',cancelStream);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      request.signal.throwIfAborted();
      if (!final) throw new Error('Response interrupted');
      setMessages(old => [...old,{id:final.id,question:prompt,answer:final.answer}]);
      setChart(final.chart);
      setQuestion(''); setFile(undefined);
      if (attachmentInput.current) attachmentInput.current.value = '';
      await handleProposal(final.id,'get');
      tail.current?.scrollIntoView({ block: 'nearest' });
    } catch {
      if (!request.signal.aborted) setError(t.failure);
      if (id && !request.signal.aborted) await load(id,false).then(setMessages).catch(() => undefined);
    } finally {
      if (generation.current === request) generation.current = null;
      setDraft(undefined);
      setBusy(false);
      void refresh().catch(() => undefined);
    }
  }

  async function changeChat(action: 'rename'|'delete') {
    if (!selected || busy || loading) return;
    const current = chats.find(chat => chat.id === selected)?.title;
    const title = action === 'rename' ? window.prompt(t.rename,current)?.trim() : undefined;
    if (action === 'rename' && !title) return;
    if (action === 'delete' && !window.confirm(t.remove + '?')) return;
    const result = await client.rpc('ai_conversations',{p_business:business,p_action:action,p_id:selected,p_title:title});
    if (result.error) { setError(t.failure); return; }
    if (action === 'delete') reset(null);
    await refresh().catch(() => setError(t.failure));
  }

  const maximum = Math.max(1,...chart.map(point => point.revenue));
  const controlsDisabled = busy || loading;
  return <section className="ai-chat page-enter" aria-label="TOVARIX AI">
    <header className="ai-chat-header"><div className="ai-brand"><Sparkles aria-hidden /><div><h2>TOVARIX AI</h2><small>BY PIXELFORGE UZ</small></div></div>
      <div className="controls">
        <button type="button" className="icon-button" disabled={controlsDisabled} onClick={() => history.current?.showModal()} aria-label={t.history}><History size={19}/></button>
        <button type="button" className="icon-button" disabled={controlsDisabled} onClick={() => void select(null)} aria-label={t.new}><Plus size={20}/></button>
        {selected && <><button type="button" className="icon-button" disabled={controlsDisabled} onClick={() => void changeChat('rename')} aria-label={t.rename}><Pencil size={17}/></button>
        <button type="button" className="icon-button" disabled={controlsDisabled} onClick={() => void changeChat('delete')} aria-label={t.remove}><Trash2 size={17}/></button></>}
      </div>
      {quota && <small className="ai-quota">{quota.enabled ? t.remaining+' · '+quota.remaining : t.disabled}</small>}
    </header>
    <dialog className="debt-sheet" ref={history} aria-label={t.history}>
      <form method="dialog"><button aria-label={t.cancel}>×</button></form><h3>{t.history}</h3>
      <input aria-label={t.search} placeholder={t.search} value={search} onChange={event=>setSearch(event.target.value)}/>
      <button type="button" onClick={()=>void select(null,true)}>{t.legacy}</button>
      {chats.filter(chat=>chat.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(chat=>
        <button type="button" key={chat.id} aria-current={selected===chat.id ? 'true' : undefined} onClick={()=>void select(chat.id)}>{chat.title}</button>)}
    </dialog>
    {loading && <div className="loading-skeleton" role="status" aria-label={t.wait}/>}
    {!loading && !messages.length && !draft && <div className="ai-welcome">
      <h3>{t.intro}</h3><div className="ai-prompts">{t.questions.map(prompt =>
        <button type="button" disabled={busy} key={prompt} onClick={()=>setQuestion(prompt)}>{prompt}</button>)}</div>
    </div>}
    {messages.map(turn=><div className="ai-turn" key={turn.id}>
      <p className="ai-user-message">{turn.question}</p>
      <article className="ai-reply"><Markdown skipHtml disallowedElements={['img','a']} unwrapDisallowed remarkPlugins={[remarkGfm]}>{turn.answer}</Markdown>
        <div className="controls">
          <button type="button" className="icon-button" aria-label={t.copy} onClick={()=>void navigator.clipboard.writeText(turn.answer).then(()=>setNotice(t.copied)).catch(()=>setError(t.failure))}><Copy size={16}/></button>
          <button type="button" className="icon-button" disabled={busy} aria-label={t.retry} onClick={()=>setQuestion(turn.question)}><RotateCcw size={16}/></button>
        </div>
      </article>
    </div>)}
    {draft && <div className="ai-turn"><p className="ai-user-message">{draft.question}</p>
      <article className="ai-reply ai-draft" aria-busy="true">{draft.answer || <span className="ai-generating">{t.wait}</span>}</article></div>}
    {chart.length>0 && <details className="ai-reply" open>
      <summary>{t.sales}</summary>
      <div className="ai-chart">{chart.map(point=><button type="button" key={point.day} aria-label={point.day+' · '+money(point.revenue)}
        aria-pressed={selectedPoint?.day===point.day} onClick={()=>setPoint(point)}>
        <span style={{ height: Math.max(6,point.revenue/maximum*100)+'%' }}/>
      </button>)}</div>
      {selectedPoint && <p>{selectedPoint.day} · {money(selectedPoint.revenue)}
        {selectedPoint.gross_profit!==null && ' · '+t.profit+': '+money(selectedPoint.gross_profit)}</p>}
    </details>}
    {proposal && <article className="ai-proposal">
      <h3>{t.proposal}</h3><p>{proposal.name} · {money(proposal.old_price)} → {money(proposal.new_price)}</p>
      <p>{t.status[['pending','applied','cancelled','expired'].indexOf(proposal.status)]}</p>
      {proposal.status==='pending' && <div className="controls">{[['confirm',t.confirm],['cancel',t.cancel]].map(([operation,label])=>
        <button key={operation} type="button" disabled={busy} onClick={()=>void handleProposal(proposal.id,operation).catch(()=>setError(t.failure))}>{label}</button>
      )}</div>}
    </article>}
    <div ref={tail}/>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form className="ai-compose" onSubmit={event=>void submit(event)}>
      <textarea aria-label={t.input} placeholder={t.input} value={question} onChange={event=>setQuestion(event.target.value)} rows={2} maxLength={2000} disabled={busy}/>
      {file && <small>{file.name} <button type="button" aria-label={t.cancel} onClick={()=>{setFile(undefined);if(attachmentInput.current)attachmentInput.current.value='';}}>×</button></small>}
      <div className="controls">
        <label className="icon-button" title={t.attach}><FilePlus size={19} aria-hidden/>
          <input ref={attachmentInput} className="ai-file" type="file" accept={accepted.join(',')} aria-label={t.attach} disabled={busy}
            onChange={event=>{const next=event.target.files?.[0];if(next && (!accepted.includes(next.type)||next.size>1_400_000)){setError(t.size);setFile(undefined);event.target.value='';}
              else {setFile(next);setError('');}}}/>
        </label>
        {busy ? <button type="button" className="icon-button" aria-label={t.stop} onClick={()=>generation.current?.abort()}><Square size={18}/></button> :
          <button type="submit" className="icon-button primary-button" aria-label={t.send} disabled={!quota?.enabled||quota.remaining<=0||!question.trim()}><ArrowUp size={20}/></button>}
      </div>
    </form>
  </section>;
}
