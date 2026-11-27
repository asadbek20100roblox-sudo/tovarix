import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { labels, languageNames } from './labels';
import type { Language } from './labels';
import { internalBarcode, saleTotal } from './commerce';
import { plans } from './plans';

type Named = { id: string; name: string };
type Product = Named & { barcode: string; price: number; cost: number; attributes: Record<string, string> };
type Stock = { product_id: string; quantity: number };
type Item = { product_id: string; name: string; quantity: number; price: number };
type Sale = { id: string; total: number; cost: number; created_at: string; items: Item[]; sale_returns?: { sale_id: string } | null };
type Report = {
  totals: { sales: number; revenue: number; profit: number; cash: number; card: number };
  branches: { id: string; name: string; sales: number; revenue: number }[];
  operators: { operator_id: string; sales: number; revenue: number }[];
  popular: { id: string; name: string; units: number }[];
  slow: { id: string; name: string; units: number }[];
};
type Shift = { id: string; opening_cash: number; opened_at: string };
type Checkout = {
  p_business: string; p_store: string; p_request: string; p_lines: { product_id: string; quantity: number }[];
  p_cash: number; p_card: number; p_discount: number; p_expected: number;
};
type Snapshot = { products: Product[]; stock: Stock[]; sales: Sale[] };
const extra = {
  uz: ['Mijozlar', 'Yetkazib beruvchilar', 'Xodimlar', 'Telefon', 'Boshqa filialga o‘tkazish', 'Miqdor', 'Xodim UUID', 'Vakolatlar', 'Xodimni o‘chirish'],
  ru: ['Клиенты', 'Поставщики', 'Сотрудники', 'Телефон', 'Перемещение в филиал', 'Количество', 'UUID сотрудника', 'Права', 'Удалить сотрудника'],
  en: ['Customers', 'Suppliers', 'Staff', 'Phone', 'Transfer to location', 'Quantity', 'Employee UUID', 'Permissions', 'Remove employee'],
} as const;
const attributeNames = {
  uz: ['O‘lcham', 'Rang', 'Partiya', 'Yaroqlilik muddati', 'Seriya raqami', 'Kafolat', 'O‘lchov birligi'],
  ru: ['Размер', 'Цвет', 'Партия', 'Срок годности', 'Серийный номер', 'Гарантия', 'Единица измерения'],
  en: ['Size', 'Color', 'Batch', 'Expires', 'Serial number', 'Warranty', 'Unit of measure'],
} as const;
const attributeKeys = ['size','color','batch','expiry','serial','warranty','unit'];
const permissions = ['sell','discount','inventory','catalog','stores','analytics','audit','staff','supplier','customer','ai','returns'];
type Purchase = { id: string; product_id: string; quantity: number; total_uzs: number; reference: string };
type Contact = Named & { phone: string | null };
type Staff = { user_id: string; role: string; permissions: string[] };
const empty: Snapshot = { products: [], stock: [], sales: [] };
const explain = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message) : String(error);

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

export function Workspace({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>();
  const [lang, setLang] = useState<Language>(() => {
    const value = localStorage.getItem('tovarix.language');
    return value === 'ru' || value === 'en' ? value : 'uz';
  });
  const [dark, setDark] = useState(() => localStorage.getItem('tovarix.theme') !== 'light');
  const [status, setStatus] = useState('');
  const t = labels[lang];
  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem('tovarix.language', lang);
    localStorage.setItem('tovarix.theme', dark ? 'dark' : 'light');
  }, [lang, dark]);

  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const credentials = { email: String(data.get('email')), password: String(data.get('password')) };
    const signup = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'signup';
    setStatus('');
    const result = signup ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials);
    if (result.error) setStatus(result.error.message);
    else if (signup && !result.data.session) setStatus(t[37]);
  }

  return <main className={dark ? '' : 'light'}>
    <header><div><b>TOVARIX</b><small>BY PIXELFORGE UZ</small></div>
      <div className="controls">
        <select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Language)}>
          {Object.entries(languageNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button aria-label={t[38]} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</button>
        {session && <button onClick={async () => {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) setStatus(error.message);
          else {
            for (const key of Object.keys(localStorage)) {
              if (key.startsWith('tovarix.cache.' + session.user.id + '.')) localStorage.removeItem(key);
            }
          }
        }}>{t[23]}</button>}
      </div>
    </header>
    {status && <p role="status">{status}</p>}
    {session === null && <form onSubmit={e => void authenticate(e)}>
      <input name="email" type="email" placeholder="Email" aria-label="Email" autoComplete="email" required />
      <input name="password" type="password" placeholder={t[26]} aria-label={t[26]} autoComplete="current-password" minLength={8} required />
      <button>{t[24]}</button><button value="signup">{t[25]}</button>
    </form>}
    {session && <BusinessPicker key={session.user.id} client={client} user={session.user.id} lang={lang} />}
  </main>;
}

function BusinessPicker({ client, user, lang }: { client: SupabaseClient; user: string; lang: Language }) {
  const [businesses, setBusinesses] = useState<Named[]>(() => load('tovarix.cache.' + user + '.businesses', []));
  const [business, setBusiness] = useState(() => businesses[0]?.id ?? '');
  const [stores, setStores] = useState<Named[]>(() => load('tovarix.cache.' + user + '.stores.' + business, []));
  const [store, setStore] = useState(() => stores[0]?.id ?? '');
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const t = labels[lang];

  useEffect(() => {
    let active = true;
    void client.from('businesses').select('id,name').order('name').then(result => {
      if (!active) return;
      if (result.error) setError(result.error.message);
      else {
        setBusinesses(result.data);
        try { localStorage.setItem('tovarix.cache.' + user + '.businesses', JSON.stringify(result.data)); } catch { /* Storage quota. */ }
        setBusiness(old => result.data.some(b => b.id === old) ? old : result.data[0]?.id ?? '');
      }
    });
    return () => { active = false; };
  }, [client, revision, user]);

  useEffect(() => {
    if (!business) return;
    let active = true;
    void client.from('stores').select('id,name').eq('business_id', business).order('name').then(result => {
      if (!active) return;
      if (result.error) setError(result.error.message);
      else {
        setStores(result.data);
        try { localStorage.setItem('tovarix.cache.' + user + '.stores.' + business, JSON.stringify(result.data)); } catch { /* Storage quota. */ }
        setStore(old => result.data.some(s => s.id === old) ? old : result.data[0]?.id ?? '');
      }
    });
    return () => { active = false; };
  }, [business, client, revision, user]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const { error } = await client.rpc('open_business', { p_name: data.get('name'), p_store: data.get('store') });
    setError(error?.message ?? '');
    if (!error) { form.reset(); refresh(n => n + 1); }
  }

  return <>
    {error && <p role="alert">{error}</p>}
    <div className="controls">
      <label>{t[6]} <select value={business} onChange={e => {
        setStore(''); setStores([]); setBusiness(e.target.value);
      }}>
        {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select></label>
      <label>{t[7]} <select value={store} onChange={e => setStore(e.target.value)}>
        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <button onClick={() => refresh(n => n + 1)}>{t[42]}</button>
    </div>
    {business && store && <Operations key={business + store} {...{ client, user, business, store, stores, lang, refresh }} />}
    <details><summary>{t[27]}</summary><form onSubmit={e => void create(e)}>
      <input name="name" aria-label={t[6]} placeholder={t[6]} required maxLength={200} />
      <input name="store" aria-label={t[7]} placeholder={t[7]} required maxLength={200} />
      <button>{t[27]}</button>
    </form></details>
  </>;
}

function Operations({ client, user, business, store, stores, lang, refresh }: {
  client: SupabaseClient; user: string; business: string; store: string; stores: Named[];
  lang: Language; refresh: (update: (n: number) => number) => void;
}) {
  const scope = [user, business, store].join('.');
  const cacheKey = 'tovarix.cache.' + scope;
  const outboxKey = 'tovarix.outbox.' + scope;
  const [snapshot, setSnapshot] = useState(() => load(cacheKey, empty));
  const [pending, setPending] = useState<Checkout | null>(() => load(outboxKey, null));
  const [tab, setTab] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [revision, reload] = useState(0);
  const [shift, setShift] = useState<Shift | null>(null);
  const [query, setQuery] = useState('');
  const [barcode, setBarcode] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState(0);
  const [card, setCard] = useState(0);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [label, setLabel] = useState<(Product & { image: string }) | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [previousReport, setPreviousReport] = useState<Report | null>(null);
  const x = extra[lang];
  const lifecycle = {
    uz: ['Smenani ochish','Smenani yopish','Kassadagi naqd','To‘liq qaytarish','Qaytarilgan','Kam qoldiq','Excel yuklash','Excel saqlash'],
    ru: ['Открыть смену','Закрыть смену','Наличные в кассе','Полный возврат','Возвращён','Низкий остаток','Импорт Excel','Экспорт Excel'],
    en: ['Open shift','Close shift','Cash in drawer','Full return','Returned','Low stock','Import Excel','Export Excel'],
  }[lang];
  const [width, setWidth] = useState(80);
  const management = {
    uz: ['Xaridlar','Tahlil','Moliya','Yordam','Hujjat raqami','Xarid summasi','Yetkazib beruvchisiz','Tovar bo‘yicha savdo','Marja','Oxirgi 7 kun','Oldingi 7 kun','Qo‘llab-quvvatlash uchun korxona egasiga yoki PixelForge UZ vakiliga murojaat qiling.'],
    ru: ['Закупки','Аналитика','Финансы','Поддержка','Номер документа','Сумма закупки','Без поставщика','Продажи по товарам','Маржа','Последние 7 дней','Предыдущие 7 дней','Для поддержки обратитесь к владельцу предприятия или представителю PixelForge UZ.'],
    en: ['Purchases','Analytics','Finance','Support','Document reference','Purchase amount','No supplier','Sales by product','Margin','Last 7 days','Previous 7 days','For support, contact the business owner or your PixelForge UZ representative.'],
  }[lang];
  const t = labels[lang];
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  async function ask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    setAsking(true);
    setError('');
    setAnswer('');
    try {
      const file = values.get('photo');
      let image: { mimeType: string; data: string } | undefined;
      if (file instanceof File && file.size > 0) {
        if (file.size > 1_400_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          throw new Error(lang === 'ru' ? 'Выберите JPEG, PNG или WebP до 1,4 МБ'
            : lang === 'en' ? 'Choose a JPEG, PNG, or WebP up to 1.4 MB' : '1,4 MB gacha JPEG, PNG yoki WebP tanlang');
        }
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        image = { mimeType: file.type, data: encoded };
      }
      const { data, error } = await client.functions.invoke('tovarix-ai', {
        body: { business, question: String(values.get('question')), image },
      });
      if (error) throw error;
      setAnswer(data.answer);
    } catch (err) { setError(explain(err)); }
    finally { setAsking(false); }
  }
  const money = (value: number) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'UZS', maximumFractionDigits: 0 }).format(value);

  useEffect(() => {
    let active = true;
    void Promise.all([
      client.from('products').select('id,name,barcode,price,cost,attributes').eq('business_id', business).order('name'),
      client.from('stock').select('product_id,quantity').eq('business_id', business).eq('store_id', store),
      client.from('sales').select('id,total,cost,created_at,items,sale_returns(sale_id)').eq('business_id', business).eq('store_id', store).order('created_at', { ascending: false }).limit(250),
      client.from('shifts').select('id,opening_cash,opened_at').eq('business_id', business).eq('store_id', store).eq('operator_id', user).is('closed_at', null).maybeSingle(),
    ]).then(([products, stock, sales, shifts]) => {
      if (!active) return;
      const issue = products.error ?? stock.error ?? sales.error ?? shifts.error;
      if (issue) { setError(issue.message); return; }
      setShift(shifts.data);
      const records: Sale[] = (sales.data ?? []).map(row => {
        const returns = row.sale_returns;
        return { ...row, sale_returns: Array.isArray(returns) ? returns[0] ?? null : returns };
      });
      const data = { products: products.data ?? [], stock: stock.data ?? [], sales: records };
      setSnapshot(data);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); }
      catch { /* Online data remains usable when browser storage is full. */ }
    });
    return () => { active = false; };
  }, [client, business, store, user, cacheKey, revision]);

  useEffect(() => {
    let active = true;
    if (tab === 6 || tab === 7 || tab === 10) {
      void client.from('contacts').select('id,name,phone').eq('business_id', business).eq('kind', tab === 6 ? 'customer' : 'supplier').order('name')
        .then(result => { if (active) { setContacts(result.data ?? []); if (result.error) setError(result.error.message); } });
    }
    if (tab === 10) {
      void client.from('purchases').select('id,product_id,quantity,total_uzs,reference').eq('business_id', business)
        .eq('store_id', store).order('created_at', { ascending: false }).limit(250)
        .then(result => { if (active) { setPurchases(result.data ?? []); if (result.error) setError(result.error.message); } });
    }
    if (tab === 11 || tab === 12) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const today = new Date(date + 'T12:00:00Z');
      const day = (offset: number) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
      void Promise.all([
        client.rpc('sales_report', { p_business: business, p_from: day(-6), p_until: day(1) }),
        client.rpc('sales_report', { p_business: business, p_from: day(-13), p_until: day(-6) }),
      ]).then(([current, previous]) => {
        if (!active) return;
        setReport(current.data);
        setPreviousReport(previous.data);
        const error = current.error ?? previous.error;
        if (error) setError(error.message);
      });
    }
    if (tab === 8) {
      void client.from('members').select('user_id,role,permissions').eq('business_id', business)
        .then(result => { if (active) { setStaff(result.data ?? []); if (result.error) setError(result.error.message); } });
    }
    return () => { active = false; };
  }, [tab, business, store, client, revision]);

  async function makeLabel(product: Product) {
    try {
      const { renderBarcode } = await import('./barcode-label');
      const canvas = document.createElement('canvas');
      renderBarcode(canvas, product.barcode);
      setReceipt(null);
      setLabel({ ...product, image: canvas.toDataURL('image/png') });
    } catch (err) { setError(explain(err)); }
  }

  const quantity = (id: string) => Number(snapshot.stock.find(s => s.product_id === id)?.quantity ?? 0);
  const selected = snapshot.products.filter(p => cart[p.id] > 0);
  const lines = selected.map(p => ({ product_id: p.id, quantity: cart[p.id] }));
  let total: number | null = null;
  try { total = saleTotal(selected.map(p => ({ price: p.price, quantity: cart[p.id] })), discount); }
  catch { /* Invalid amounts cannot be submitted. */ }
  const sales = snapshot.sales.filter(s => !s.sale_returns);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + index - 6);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    return { date: day, value: sales.filter(s => new Date(s.created_at) >= day && new Date(s.created_at) < end).reduce((sum, s) => sum + s.total, 0) };
  });
  const ceiling = Math.max(1, ...daily.map(d => d.value));

  function add(id: string) {
    setCart(old => ({ ...old, [id]: Math.min(Math.floor(quantity(id)), (old[id] || 0) + 1) }));
  }

  useEffect(() => {
    if (!scanning || !video.current) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    const element = video.current;
    void import('./hardware').then(({ openScanner }) => {
      if (cancelled) return () => {};
      return openScanner(element, code => {
      if (cancelled) return;
      setQuery(code);
      setScanning(false);
    }, err => { if (!cancelled) { setError(explain(err)); setScanning(false); } });
    }).then(cancel => {
      if (cancelled) cancel();
      else stop = cancel;
    }).catch(err => { if (!cancelled) { setError(explain(err)); setScanning(false); } });
    return () => { cancelled = true; stop?.(); };
  }, [scanning]);

  async function mutate(e: FormEvent<HTMLFormElement>, operation: (data: FormData) => PromiseLike<{ error: unknown }>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError('');
    try {
      const result = await operation(new FormData(form));
      if (result.error) throw result.error;
      form.reset();
      reload(n => n + 1);
    } catch (err) { setError(explain(err)); }
  }

  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (navigator.locks) await navigator.locks.request(outboxKey, transmit);
      else await transmit();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function transmit() {
    const saved = load<Checkout | null>(outboxKey, null);
    if (!saved && !pending && (!lines.length || total === null || !Number.isSafeInteger(card) || card < 0 || card > total)) return;
    const request = saved ?? pending ?? {
      p_business: business, p_store: store, p_request: crypto.randomUUID(), p_lines: lines,
      p_cash: total! - card, p_card: card, p_discount: discount, p_expected: total!,
    };
    setError('');
    try {
      localStorage.setItem(outboxKey, JSON.stringify(request));
      setPending(request);
      const result = await client.rpc('checkout', request);
      if (result.error) {
        if (['P0001', '42501', '22P02', '22003'].includes(result.error.code) && !result.error.message.includes('different payload')) {
          localStorage.removeItem(outboxKey);
          setPending(null);
        }
        throw result.error;
      }
      localStorage.removeItem(outboxKey);
      setPending(null); setCart({}); setDiscount(0); setCard(0);
      reload(n => n + 1);
      const row = await client.from('sales').select('id,total,cost,created_at,items,sale_returns(sale_id)').eq('id', result.data).single();
      if (row.data) { setLabel(null); setReceipt({ ...row.data, sale_returns: null }); }
      if (row.error) setError(row.error.message);
    } catch (err) { setError(explain(err)); }
  }

  return <>
    <nav aria-label="TOVARIX">{[...t.slice(0, 6), ...x.slice(0, 3), 'TOVARIX AI', ...management.slice(0, 4)].map((label, i) => <button key={i} className={tab === i ? 'active' : ''} onClick={() => {
      setTab(i); setQuery(''); setScanning(false); setError(''); setContacts([]);
    }}>{label}</button>)}</nav>
    <h1>{tab < 6 ? t[tab] : tab < 9 ? x[tab - 6] : tab === 9 ? 'TOVARIX AI' : management[tab - 10]}</h1>
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status">{t[19]} <button disabled={busy} onClick={() => void submit()}>{t[20]}</button></p>}
    {tab === 0 && <>
      <div className="grid">{[[t[28], sales.length], [t[29], money(sales.reduce((sum, s) => sum + s.total, 0))],
        [t[30], money(sales.reduce((sum, s) => sum + s.total - s.cost, 0))]].map(([label, value]) =>
        <article key={label}><small>{label} · ≤250</small><strong>{value}</strong></article>)}</div>
      <section className="chart" aria-label={t[29]}>{daily.map(({ date, value }) => <div key={date.toISOString()}>
        <small>{money(value)}</small><progress max={ceiling} value={value} aria-label={date.toLocaleDateString(lang)} />
        <small>{date.toLocaleDateString(lang, { weekday: 'short' })}</small>
      </div>)}</section>
      {snapshot.sales.map(s => <article key={s.id}><span>{new Date(s.created_at).toLocaleString(lang)} · {money(s.total)}
        {s.sale_returns && ' · ' + lifecycle[4]}</span>
        <button onClick={() => { setLabel(null); setReceipt(s); }}>{t[21]}</button>
        {!s.sale_returns && <details><summary>{lifecycle[3]}</summary>
          <form onSubmit={e => void mutate(e, data => client.rpc('return_sale', {
            p_business: business, p_sale: s.id, p_reason: data.get('reason'),
          }))}>
            <input name="reason" required maxLength={500} placeholder={t[33]} aria-label={t[33]} /><button>{lifecycle[3]}</button>
          </form>
        </details>}
      </article>)}
    </>}
    {(tab === 1 || tab === 2 || tab === 3) && <>
      {tab === 1 && <form onSubmit={e => void mutate(e, data => client.rpc('change_shift', {
        p_business: business, p_store: store, p_cash: Number(data.get('cash')), p_close: !!shift,
      }))}>
        <input name="cash" type="number" min="0" required placeholder={lifecycle[2]} aria-label={lifecycle[2]} />
        <button disabled={!!pending}>{shift ? lifecycle[1] : lifecycle[0]}</button>
      </form>}
      {tab === 2 && <div className="controls">
        <button onClick={async () => {
          try { await (await import('./spreadsheet')).exportCatalog(snapshot.products); }
          catch (err) { setError(explain(err)); }
        }}>{lifecycle[7]}</button>
        <form onSubmit={e => void mutate(e, async data => {
          const file = data.get('workbook');
          if (!(file instanceof File) || !file.size) throw new Error(lifecycle[6]);
          const products = await (await import('./spreadsheet')).readCatalog(file);
          return client.from('products').insert(products.map(p => ({ ...p, business_id: business })));
        })}>
          <input name="workbook" type="file" accept=".xlsx" required aria-label={lifecycle[6]} /><button>{lifecycle[6]}</button>
        </form>
      </div>}
      {tab === 2 && <form onSubmit={e => void mutate(e, data => client.from('products').insert({
        business_id: business, name: String(data.get('name')).trim(), barcode: barcode.trim(),
        price: Number(data.get('price')), cost: Number(data.get('cost')),
        attributes: Object.fromEntries(attributeKeys.map(key => [key, String(data.get(key) ?? '').trim()]).filter(([, value]) => value)),
      }).then(result => { if (!result.error) setBarcode(''); return result; }))}>
        <input name="name" required maxLength={200} placeholder={t[8]} aria-label={t[8]} />
        <input name="barcode" required maxLength={128} placeholder={t[9]} aria-label={t[9]} value={barcode} onChange={e => setBarcode(e.target.value)} />
        <button type="button" onClick={() => setBarcode(internalBarcode())}>{t[39]}</button>
        <input name="price" type="number" min="0" max="1000000000000" required placeholder={t[10]} aria-label={t[10]} />
        <input name="cost" type="number" min="0" max="1000000000000" required placeholder={t[11]} aria-label={t[11]} />
        <details><summary>{t[8]} · +</summary><div className="controls">{attributeKeys.map((key, i) =>
          <label key={key}>{attributeNames[lang][i]} <input name={key} maxLength={120} type={key === 'expiry' ? 'date' : 'text'} /></label>
        )}</div></details>
        <button>{t[12]}</button>
      </form>}
      <div className="controls"><input placeholder={t[8] + ' / ' + t[9]} aria-label={t[8] + ' / ' + t[9]} value={query}
        onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          if (e.key !== 'Enter' || tab !== 1 || pending) return;
          const found = snapshot.products.find(p => p.barcode === query.trim());
          if (found) { add(found.id); setQuery(''); }
        }} />
        {tab === 1 && <button onClick={() => setScanning(!scanning)} aria-pressed={scanning}>{t[31]}</button>}
      </div>
      {scanning && <video ref={video} autoPlay muted playsInline />}
      <div className={tab === 1 ? 'pos' : ''}><div>
        {snapshot.products.filter(p => (p.name + ' ' + p.barcode).toLowerCase().includes(query.toLowerCase())).map(p => <article key={p.id}>
          <b>{p.name}</b>{tab === 2 && <small>{attributeKeys.map((key, i) => p.attributes?.[key] ? attributeNames[lang][i] + ': ' + p.attributes[key] : '').filter(Boolean).join(' · ')}</small>}<small>{p.barcode} · {t[13]} {quantity(p.id)}{tab === 3 && quantity(p.id) <= 5 && ' · ' + lifecycle[5]}</small><span>{money(p.price)}</span>
          {tab === 1 && <button aria-label={'+' + p.name} disabled={!!pending || (cart[p.id] || 0) >= Math.floor(quantity(p.id))} onClick={() => add(p.id)}>+</button>}
          {tab === 2 && <button onClick={() => void makeLabel(p)}>{t[41]}</button>}
          {tab === 3 && <form onSubmit={e => void mutate(e, data => client.rpc('adjust_stock', {
            p_business: business, p_store: store, p_product: p.id, p_delta: Number(data.get('delta')), p_reason: data.get('reason'),
          }))}>
            <input name="delta" type="number" step="0.001" required placeholder={t[32]} aria-label={t[32]} />
            <input name="reason" maxLength={500} required placeholder={t[33]} aria-label={t[33]} />
            <button>{t[12]}</button>
          </form>}
          {tab === 3 && stores.some(s => s.id !== store) && <form onSubmit={e => void mutate(e, data => client.rpc('transfer_stock', {
            p_business: business, p_from: store, p_to: data.get('to'), p_product: p.id, p_quantity: Number(data.get('quantity')),
          }))}>
            <select name="to" aria-label={x[4]}>{stores.filter(s => s.id !== store).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input name="quantity" type="number" step="0.001" min="0.001" required placeholder={x[5]} aria-label={x[5]} />
            <button>{x[4]}</button>
          </form>}
        </article>)}
      </div>
      {tab === 1 && <section><h2>{t[14]}</h2>
        {selected.map(p => <div className="controls" key={p.id}>{p.name} × {cart[p.id]}
          <button disabled={!!pending} onClick={() => setCart(old => ({ ...old, [p.id]: Math.max(0, old[p.id] - 1) }))}>−</button></div>)}
        <label>{t[15]} <input type="number" min="0" value={discount} disabled={!!pending} onChange={e => setDiscount(Number(e.target.value))} /></label>
        <label>{t[17]} <input type="number" min="0" value={card} disabled={!!pending} onChange={e => setCard(Number(e.target.value))} /></label>
        {total !== null && card <= total && <p>{t[16]} · {money(total - card)}</p>}
        {total !== null && <h2>{money(total)}</h2>}
        <button disabled={busy || !!pending || !lines.length || total === null || !Number.isSafeInteger(card) || card < 0 || card > total}
          onClick={() => void submit()}>{t[18]}</button>
      </section>}</div>
    </>}
    {tab === 4 && <form onSubmit={e => void mutate(e, async data => {
      const result = await client.from('stores').insert({ business_id: business, name: String(data.get('name')).trim() });
      if (!result.error) refresh(n => n + 1);
      return result;
    })}>
      <input name="name" required maxLength={200} placeholder={t[7]} aria-label={t[7]} /><button>{t[12]}</button>
    </form>}
    {tab === 5 && <div className="grid">{plans.map(p => <article key={p.id}><b>{p.id}</b><span>{money(p.monthly)}</span>
      {p.yearly > 0 && <small>{money(p.yearly)} / {lang === 'ru' ? 'год' : lang === 'uz' ? 'yil' : 'year'}</small>}</article>)}</div>}
    {(tab === 6 || tab === 7) && <>
      <form onSubmit={e => void mutate(e, data => client.from('contacts').insert({
        business_id: business, kind: tab === 6 ? 'customer' : 'supplier',
        name: String(data.get('name')).trim(), phone: String(data.get('phone')).trim() || null,
      }))}>
        <input name="name" required maxLength={200} placeholder={t[8]} aria-label={t[8]} />
        <input name="phone" type="tel" maxLength={50} placeholder={x[3]} aria-label={x[3]} />
        <button>{t[12]}</button>
      </form>
      {contacts.map(c => <article key={c.id}><strong>{c.name}</strong>{c.phone && <small>{c.phone}</small>}</article>)}
    </>}
    {tab === 8 && <>
      <form onSubmit={e => {
        const remove = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'remove';
        void mutate(e, data => client.rpc('set_staff', {
          p_business: business, p_user: String(data.get('user')).trim(), p_role: remove ? null : data.get('role'),
          p_permissions: data.getAll('permissions'),
        }));
      }}>
        <input name="user" required placeholder={x[6]} aria-label={x[6]} />
        <select name="role" aria-label={x[7]}><option>cashier</option><option>manager</option><option>warehouse</option></select>
        <fieldset><legend>{x[7]}</legend>{permissions.map(permission => <label key={permission} className="permission">
          <input type="checkbox" name="permissions" value={permission} />{permission}
        </label>)}</fieldset>
        <button>{t[12]}</button><button value="remove">{x[8]}</button>
      </form>
      {staff.map(member => <article key={member.user_id}><strong>{member.user_id}</strong>
        <span>{member.role} · {member.permissions.join(', ')}</span></article>)}
    </>}
    {tab === 9 && <>
      <form onSubmit={e => void ask(e)}>
        <input name="question" required maxLength={2000} aria-label="TOVARIX AI"
          placeholder={lang === 'ru' ? 'Спросить о продажах' : lang === 'en' ? 'Ask about sales' : 'Savdolar haqida savol'} />
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp"
          aria-label={lang === 'ru' ? 'Фото товара' : lang === 'en' ? 'Product photo' : 'Mahsulot surati'} />
        <button disabled={asking}>{lang === 'ru' ? 'Спросить' : lang === 'en' ? 'Ask' : 'So‘rash'}</button>
      </form>
      {answer && <article className="ai-answer">{answer}</article>}
    </>}
    {tab === 10 && <>
      <form onSubmit={e => void mutate(e, data => client.rpc('receive_purchase', {
        p_business: business, p_store: store, p_product: data.get('product'), p_supplier: data.get('supplier') || null,
        p_quantity: Number(data.get('quantity')), p_total: Number(data.get('total')), p_reference: data.get('reference'),
      }))}>
        <select name="product" aria-label={t[2]} required><option value="">{t[2]}</option>{snapshot.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select name="supplier" aria-label={x[1]}><option value="">{management[6]}</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input name="quantity" type="number" step="0.001" min="0.001" required placeholder={x[5]} aria-label={x[5]} />
        <input name="total" type="number" min="0" required placeholder={management[5]} aria-label={management[5]} />
        <input name="reference" maxLength={120} required placeholder={management[4]} aria-label={management[4]} />
        <button>{t[12]}</button>
      </form>
      {purchases.map(p => <article key={p.id}><b>{p.reference}</b><span>{snapshot.products.find(x => x.id === p.product_id)?.name} × {p.quantity}</span><span>{money(p.total_uzs)}</span></article>)}
    </>}
    {tab === 11 && report && <>
      <div className="grid"><article>{management[9]}<strong>{money(report.totals.revenue)}</strong></article>
        <article>{management[10]}<strong>{previousReport ? money(previousReport.totals.revenue) : '—'}</strong></article></div>
      <div className="pos">
        {[report.popular, report.slow].map((list, index) => <section key={index}>
          <h2>{index === 0 ? (lang === 'ru' ? 'Популярные товары' : lang === 'en' ? 'Top products' : 'Ommabop mahsulotlar')
            : (lang === 'ru' ? 'Слабые товары' : lang === 'en' ? 'Slow products' : 'Sekin sotiladigan mahsulotlar')}</h2>
          {list.map(p => <article key={p.id}><b>{p.name}</b><span>{p.units}</span></article>)}
        </section>)}
      </div>
      <div className="pos">
        <section><h2>{t[4]}</h2>{report.branches.map(b => <article key={b.id}><b>{b.name}</b><span>{b.sales} · {money(b.revenue)}</span></article>)}</section>
        <section><h2>{x[2]}</h2>{report.operators.map(o => <article key={o.operator_id}><small>{o.operator_id}</small><span>{o.sales} · {money(o.revenue)}</span></article>)}</section>
      </div>
    </>}
    {tab === 12 && report && <>
      <h2>{management[9]}</h2>
      <div className="grid">
        <article>{t[29]}<strong>{money(report.totals.revenue)}</strong></article>
        <article>{t[30]}<strong>{money(report.totals.profit)}</strong></article>
        <article>{management[8]}<strong>{report.totals.revenue ? new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(report.totals.profit / report.totals.revenue) : '—'}</strong></article>
        <article>{t[16]}<strong>{money(report.totals.cash)}</strong></article>
        <article>{t[17]}<strong>{money(report.totals.card)}</strong></article>
      </div>
      {report.totals.revenue > 0 && <div role="img" className="tender-chart" aria-label={t[16] + ': ' + money(report.totals.cash) + ', ' + t[17] + ': ' + money(report.totals.card)}
        style={{ backgroundImage: 'conic-gradient(#508cf7 0 ' + 100 * report.totals.cash / report.totals.revenue + '%, #28b594 0)' }} />}
    </>}
    {tab === 13 && <p>{management[11]}</p>}
    {label && <section className="label-print">
      <b>{label.name}</b><p>{money(label.price)}</p>
      <img src={label.image} alt={label.barcode} style={{ maxWidth: '100%' }} />
      <div className="controls no-print"><button onClick={() => window.print()}>{t[22]}</button>
        <button onClick={() => setLabel(null)}>×</button></div>
    </section>}
    {receipt && <section className="receipt" style={{ width: width + 'mm' }}>
      <h2>{t[21]}</h2>{receipt.sale_returns && <p>{lifecycle[4]}</p>}<small>{receipt.id}</small><small>{new Date(receipt.created_at).toLocaleString(lang)}</small>
      {receipt.items.map(i => <p key={i.product_id}>{i.name} × {i.quantity} · {money(i.price * i.quantity)}</p>)}
      <strong>{money(receipt.total)}</strong>
      <div className="controls no-print"><select aria-label="mm" value={width} onChange={e => setWidth(Number(e.target.value))}>
        <option value={58}>58 mm</option><option value={80}>80 mm</option>
      </select><button onClick={() => window.print()}>{t[22]}</button><button onClick={() => setReceipt(null)}>×</button></div>
    </section>}
  </>;
}
