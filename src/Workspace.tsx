import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { labels, languageNames } from './labels';
import type { Language } from './labels';
import { internalBarcode, saleTotal } from './commerce';
import { importLegacySale, listSales, removeSale, saveSale } from './sale-queue';
import type { QueueEntry } from './sale-queue';
import { Barcode, CreditCard, LogOut, Moon, Package, Plus, RotateCw, Search, ShoppingCart, Sun, Wallet } from 'lucide-react';
import { CustomerDebts, debtTitle } from './CustomerDebts';
import { AccountAccess } from './AccountAccess';
import { AppNavigation, Brand } from './AppNavigation';
import { Dashboard, dashboardCopy } from './Dashboard';
import { HardwareDiagnostics } from './HardwareDiagnostics';
import { SupportDesk } from './SupportDesk';
import { plans } from './plans';

type Named = { id: string; name: string };
type Product = Named & { barcode: string; price: number; cost: number | null; attributes: Record<string, string> };
type Stock = { product_id: string; quantity: number };
type Item = { product_id: string; name: string; quantity: number; price: number; weighted?: boolean; partial_returnable?: boolean };
type Sale = { id: string; total: number; cost: number | null; created_at: string; items: Item[]; sale_returns?: { sale_id: string } | null; partial_returns?: { product_id: string; quantity: number; total: number }[] };
type Report = {
  totals: { sales: number; revenue: number; profit: number | null; cash: number; card: number };
  branches: { id: string; name: string; sales: number; revenue: number }[];
  operators: { operator_id: string; sales: number; revenue: number }[];
  popular: { id: string; name: string; units: number }[];
  slow: { id: string; name: string; units: number }[];
};
type Billing = {
  plan: string; paid_until: string | null; trial_until: string | null; trial_started_at: string | null;
  payments: { amount_uzs: number; captured_at: string; provider: string; plan: string }[];
};
type Expense = { id: string; amount: number; description: string };
type ShiftSummary = { expected_cash: number | null; closing_cash: number; cash_variance: number | null };
type Shift = { id: string; opening_cash: number; opened_at: string };
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
const permissions = ['sell','discount','inventory','catalog','stores','analytics','audit','staff','supplier','customer','ai','returns','cost','profit'];
type Purchase = { id: string; product_id: string; quantity: number; total_uzs: number | null; reference: string };
type Contact = Named & { phone: string | null };
type Staff = { user_id: string; role: string; permissions: string[]; store_scope: string[] | null; display_name: string | null; blocked_at: string | null };
const empty: Snapshot = { products: [], stock: [], sales: [] };
const explain = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message) : String(error);

function withoutFinancialData(data: Snapshot): Snapshot {
  return {
    stock: data.stock,
    products: data.products.map(product => ({ ...product, cost: null })),
    sales: data.sales.map(sale => ({
      id: sale.id, total: sale.total, created_at: sale.created_at, cost: null, sale_returns: sale.sale_returns,
      items: sale.items.map(item => ({
        product_id: item.product_id, name: item.name, quantity: item.quantity, price: item.price, weighted: item.weighted,
        partial_returnable: item.partial_returnable === true || 'unit_cost' in item,
      })),
      partial_returns: sale.partial_returns?.map(item => ({ product_id: item.product_id, quantity: item.quantity, total: item.total })),
    })),
  };
}

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

export function Workspace({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>();
  const [recovering, setRecovering] = useState(false);
  const [lang, setLang] = useState<Language>(() => {
    const value = localStorage.getItem('tovarix.language');
    return value === 'ru' || value === 'en' ? value : 'uz';
  });
  const [dark, setDark] = useState(() => localStorage.getItem('tovarix.theme') === 'dark');
  const [status, setStatus] = useState('');
  const t = labels[lang];
  useEffect(() => {
    if (session?.user.user_metadata.terms_revision === 'pilot-v0.4') {
      void client.rpc('complete_profile').then(result => { if (result.error) setStatus(result.error.message); });
    }
  }, [client, session?.user.id, session?.user.user_metadata.terms_revision]);
  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem('tovarix.language', lang);
    localStorage.setItem('tovarix.theme', dark ? 'dark' : 'light');
  }, [lang, dark]);

  return <main className={'workspace ' + (dark ? 'dark' : 'light')}>
    <header className="brand-strip"><Brand />
      <div className="controls">
        <select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Language)}>
          {Object.entries(languageNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button className="icon-button" aria-label={t[38]} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        {session && <button className="icon-button" aria-label={t[23]} onClick={async () => {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) setStatus(error.message);
          else {
            for (const key of Object.keys(localStorage)) {
              if (key.startsWith('tovarix.cache.' + session.user.id + '.')) localStorage.removeItem(key);
            }
          }
        }}><LogOut size={17} /></button>}
      </div>
    </header>
    {status && <p role="status">{status}</p>}
    {session === undefined && <div className="loading-skeleton" aria-busy="true" /> }
    {(session === null || recovering) && <AccountAccess client={client} lang={lang} recovery={recovering} finishRecovery={() => setRecovering(false)} />}
    {session && !recovering && new URLSearchParams(location.search).get('mode') === 'platform' && <SupportDesk key={session.user.id} client={client} lang={lang} />}
    {session && !recovering && new URLSearchParams(location.search).get('mode') !== 'platform' && <BusinessPicker key={session.user.id} client={client} user={session.user.id} profile={typeof session.user.user_metadata.full_name === 'string' && session.user.user_metadata.full_name.trim() || session.user.email || session.user.id} lang={lang} />}
  </main>;
}

function BusinessPicker({ client, user, lang, profile }: { client: SupabaseClient; user: string; lang: Language; profile: string }) {
  const [businesses, setBusinesses] = useState<(Named & { owner_id?: string })[]>(() => load('tovarix.cache.' + user + '.businesses', []));
  const [business, setBusiness] = useState(() => businesses[0]?.id ?? '');
  const [stores, setStores] = useState<Named[]>(() => load('tovarix.cache.' + user + '.stores.' + business, []));
  const [store, setStore] = useState(() => stores[0]?.id ?? '');
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const [membership, setMembership] = useState<{ business: string; role: string; name: string | null } | null>(null);
  useEffect(() => {
    if (!business) return;
    let active = true;
    void client.from('members').select('role,display_name').eq('business_id', business).eq('user_id', user).maybeSingle()
      .then(result => { if (active) setMembership(result.data ? { business, role: result.data.role, name: result.data.display_name } : null); });
    return () => { active = false; };
  }, [business, client, user]);
  const t = labels[lang];

  useEffect(() => {
    let active = true;
    void client.from('businesses').select('id,name,owner_id').order('name').then(result => {
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
    const { error } = await client.rpc('open_business_v04', {
      p_name: data.get('name'), p_store: data.get('store'), p_type: data.get('businessType'),
      p_address: data.get('businessAddress'), p_unit: data.get('unit'), p_register: data.get('register'),
    });
    setError(error?.message ?? '');
    if (!error) { form.reset(); refresh(n => n + 1); }
  }

  const businessTypes = ['supermarket','grocery','electronics','apparel','wholesale','construction','auto','cosmetics','pharmacy','other'];
  const orgCopy = {
    uz: ['Manzil','Biznes turi','O‘lchov birligi','Kassa nomi','Supermarket','Oziq-ovqat do‘koni','Elektronika','Kiyim va poyabzal','Ulgurji savdo','Qurilish mollari','Avto ehtiyot qismlar','Kosmetika','Dorixona','Boshqa','Dona','kg','l','m'],
    ru: ['Адрес','Тип бизнеса','Единица измерения','Название кассы','Супермаркет','Продуктовый магазин','Электроника','Одежда и обувь','Оптовая торговля','Стройматериалы','Автозапчасти','Косметика','Аптека','Другой','Штука','кг','л','м'],
    en: ['Address','Business type','Unit of measure','Register name','Supermarket','Grocery','Electronics','Clothing and footwear','Wholesale','Construction supplies','Auto parts','Cosmetics','Pharmacy','Other','Piece','kg','L','m'],
  }[lang];
  const owner = businesses.some(item => item.id === business && item.owner_id === user);
  const roleKey = owner ? 'owner' : membership?.business === business ? membership.role : null;
  const roles = {
    uz: { owner: 'Egasi', admin: 'Administrator', accountant: 'Hisobchi', cashier: 'Kassir', manager: 'Boshqaruvchi', warehouse: 'Omborchi' },
    ru: { owner: 'Владелец', admin: 'Администратор', accountant: 'Бухгалтер', cashier: 'Кассир', manager: 'Управляющий', warehouse: 'Кладовщик' },
    en: { owner: 'Owner', admin: 'Administrator', accountant: 'Accountant', cashier: 'Cashier', manager: 'Manager', warehouse: 'Warehouse' },
  }[lang];
  const role = roleKey ? roles[roleKey as keyof typeof roles] : undefined;

  return <>
    {error && <p role="alert">{error}</p>}
    <div className="controls branch-filters">
      <label>{t[6]} <select value={business} onChange={e => {
        setStore(''); setStores([]); setBusiness(e.target.value);
      }}>
        {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select></label>
      <label>{t[7]} <select value={store} onChange={e => setStore(e.target.value)}>
        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <button className="icon-button" aria-label={t[42]} onClick={() => refresh(n => n + 1)}><RotateCw size={17} /></button>
    </div>
    {business && store && <Operations key={business + store} {...{ client, user, business, store, stores, lang, refresh, profile: membership?.business === business && membership.name || profile, role, owner }} />}
    <details><summary>{t[27]}</summary><form onSubmit={e => void create(e)}>
      <input name="name" aria-label={t[6]} placeholder={t[6]} required maxLength={200} />
      <input name="store" aria-label={t[7]} placeholder={t[7]} required maxLength={200} />
      <input name="businessAddress" maxLength={250} aria-label={orgCopy[0]} placeholder={orgCopy[0]} />
      <select name="businessType" aria-label={orgCopy[1]} defaultValue="other">
        {businessTypes.map((type,index) => <option key={type} value={type}>{orgCopy[4 + index]}</option>)}
      </select>
      <select name="unit" aria-label={orgCopy[2]} defaultValue="piece">
        {['piece','kg','l','m'].map((unit,index) => <option key={unit} value={unit}>{orgCopy[14 + index]}</option>)}
      </select>
      <input name="register" maxLength={100} aria-label={orgCopy[3]} placeholder={orgCopy[3]} />
      <button>{t[27]}</button>
    </form></details>
  </>;
}

function Operations({ client, user, business, store, stores, lang, refresh, profile, role, owner }: {
  client: SupabaseClient; user: string; business: string; store: string; stores: Named[];
  profile: string; role?: string; owner: boolean;
  lang: Language; refresh: (update: (n: number) => number) => void;
}) {
  const scope = [user, business, store].join('.');
  const legacyCacheKey = 'tovarix.cache.' + scope;
  const cacheKey = legacyCacheKey + '.v041';
  const [finance, setFinance] = useState({ cost: false, profit: false });
  useEffect(() => {
    try {
      const legacy = load<Snapshot | null>(legacyCacheKey, null);
      if (legacy && !localStorage.getItem(cacheKey)) localStorage.setItem(cacheKey, JSON.stringify(withoutFinancialData(legacy)));
      localStorage.removeItem(legacyCacheKey);
    } catch { /* Optional storage. */ }
  }, [legacyCacheKey, cacheKey]);
  const outboxKey = 'tovarix.outbox.' + scope;
  const [snapshot, setSnapshot] = useState(() => {
    try { return withoutFinancialData(load(cacheKey, load(legacyCacheKey, empty))); }
    catch { return empty; }
  });
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState(1);
  const [cashOverview, setCashOverview] = useState<{ expenses: number; cash: number | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [revision, reload] = useState(0);
  const [shift, setShift] = useState<Shift | null>(null);
  const [query, setQuery] = useState('');
  const [catalogPage, setCatalogPage] = useState(0);
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
  const [purchaseRows, setPurchaseRows] = useState(1);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [promoDiscount, setPromoDiscount] = useState<number | null>(null);
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
  const [aiQuota, setAiQuota] = useState<{ enabled: boolean; remaining: number } | null>(null);
  const [aiHistory, setAiHistory] = useState<{ id: string; question: string; answer: string }[]>([]);
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
      reload(n => n + 1);
    } catch (err) { setError(explain(err)); }
    finally { setAsking(false); }
  }
  const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(lang, { style: 'currency', currency: 'UZS', maximumFractionDigits: 0 }).format(value);

  useEffect(() => {
    let active = true;
    void Promise.all([
      client.from('catalog_access').select('id,name,barcode,price,cost,attributes').eq('business_id', business).order('name'),
      client.from('stock').select('product_id,quantity').eq('business_id', business).eq('store_id', store),
      client.from('sales_access').select('id,total,cost,created_at,items,sale_returns(sale_id),partial_returns(product_id,quantity,total)').eq('business_id', business).eq('store_id', store).order('created_at', { ascending: false }).limit(250),
      client.rpc('financial_access', { p_business: business }),
      client.from('shifts').select('id,opening_cash,opened_at').eq('business_id', business).eq('store_id', store).eq('operator_id', user).is('closed_at', null).maybeSingle(),
    ]).then(([products, stock, sales, access, shifts]) => {
      if (!active) return;
      const issue = products.error ?? stock.error ?? sales.error ?? access.error ?? shifts.error;
      if (issue) { setError(issue.message); return; }
      setShift(shifts.data);
      setFinance(access.data ?? { cost: false, profit: false });
      const records: Sale[] = (sales.data ?? []).map(row => {
        const returns = row.sale_returns;
        return { ...row, sale_returns: Array.isArray(returns) ? returns[0] ?? null : returns };
      });
      const data = { products: products.data ?? [], stock: stock.data ?? [], sales: records };
      setSnapshot(data);
      try { localStorage.setItem(cacheKey, JSON.stringify(withoutFinancialData(data))); }
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
      void client.from('purchase_access').select('id,product_id,quantity,total_uzs,reference').eq('business_id', business)
        .eq('store_id', store).order('created_at', { ascending: false }).limit(250)
        .then(result => { if (active) { setPurchases(result.data ?? []); if (result.error) setError(result.error.message); } });
    }
    if (tab === 12) {
      void client.from('expenses').select('id,amount,description').eq('business_id', business).eq('store_id', store)
        .order('created_at', { ascending: false }).limit(50).then(result => { if (active) setExpenses(result.data ?? []); });
    }
    if (tab === 1) {
      void client.from('shifts').select('expected_cash,closing_cash,cash_variance')
        .eq('business_id', business).eq('store_id', store).eq('operator_id', user)
        .not('closed_at', 'is', null).order('closed_at', { ascending: false }).limit(1).maybeSingle()
        .then(result => { if (active) setShiftSummary(result.data); });
    }
    if (tab === 5) {
      void client.rpc('billing_overview', { p_business: business }).then(result => {
        if (active) setBilling(result.data);
      });
    }
    if (tab === 11 || tab === 12 || (tab === 8 && owner)) {
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
    if (tab === 9) {
      void client.rpc('ai_remaining', { p_business: business }).then(result => { if (active) setAiQuota(result.data); });
      void client.from('ai_history').select('id,question,answer').eq('business_id', business).eq('user_id', user)
        .order('created_at', { ascending: false }).limit(20).then(result => { if (active) setAiHistory(result.data ?? []); });
    }
    if (tab === 8) {
      void client.from('members').select('user_id,role,permissions,store_scope,display_name,blocked_at').eq('business_id', business)
        .then(result => { if (active) { setStaff(result.data ?? []); if (result.error) setError(result.error.message); } });
    }
    return () => { active = false; };
  }, [tab, business, store, client, revision, user, owner]);

  async function makeLabel(product: Product) {
    try {
      const { renderBarcode } = await import('./barcode-label');
      const canvas = document.createElement('canvas');
      renderBarcode(canvas, product.barcode);
      setReceipt(null);
      setLabel({ ...product, image: canvas.toDataURL('image/png') });
    } catch (err) { setError(explain(err)); }
  }

  useEffect(() => {
    if (tab !== 0 || !owner) return;
    let active = true;
    setCashOverview(null);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    start.setDate(start.getDate() - period + 1);
    void client.rpc('dashboard_cash', { p_business: business, p_store: store, p_from: start.toISOString(), p_until: end.toISOString() })
      .then(result => { if (active && !result.error) setCashOverview(result.data); });
    return () => { active = false; };
  }, [tab, owner, period, business, store, client, revision]);

  const inventory = new Map(snapshot.stock.map(item => [item.product_id, Number(item.quantity)]));
  const quantity = (id: string) => inventory.get(id) ?? 0;
  const matchingProducts = snapshot.products.filter(p => (p.name + ' ' + p.barcode).toLowerCase().includes(query.toLowerCase()));
  const lastCatalogPage = Math.max(0, Math.ceil(matchingProducts.length / 30) - 1);
  const shownCatalogPage = Math.min(catalogPage, lastCatalogPage);
  const selected = snapshot.products.filter(p => cart[p.id] > 0);
  const lines = selected.map(p => ({ product_id: p.id, quantity: cart[p.id], expected_price: p.price, operator_id: user }));
  let total: number | null = null;
  try { total = saleTotal(selected.map(p => ({ price: p.price, quantity: cart[p.id] })), discount); }
  catch { /* Invalid amounts cannot be submitted. */ }
  const sales = snapshot.sales.filter(s => !s.sale_returns).map(s => ({
    ...s,
    total: s.total - (s.partial_returns ?? []).reduce((sum, returned) => sum + returned.total, 0),
  }));
  const branchName = stores.find(item => item.id === store)?.name ?? t[7];
  const critical = snapshot.products.filter(p => quantity(p.id) <= 5).map(p => ({ id: p.id, name: p.name, quantity: quantity(p.id) }));
  const periodStart = new Date();
  periodStart.setHours(0, 0, 0, 0);
  periodStart.setDate(periodStart.getDate() - period + 1);
  const periodSales = sales.filter(s => new Date(s.created_at) >= periodStart);
  const daily = Array.from({ length: period === 1 ? 7 : period }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + index - (period === 1 ? 7 : period) + 1);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    return { date: day, value: sales.filter(s => new Date(s.created_at) >= day && new Date(s.created_at) < end).reduce((sum, s) => sum + s.total, 0) };
  });

  const isWeighted = (p: Product) => p.attributes?.unit?.trim().toLowerCase() === 'kg';
  function add(id: string) {
    const product = snapshot.products.find(p => p.id === id);
    if (!product) return;
    const limit = isWeighted(product) ? quantity(id) : Math.floor(quantity(id));
    setCart(old => ({ ...old, [id]: Math.min(limit, Math.round(((old[id] || 0) + 1) * 1000) / 1000) }));
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

  const synchronize = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const transmit = async () => {
        const raw = localStorage.getItem(outboxKey);
        if (raw) {
          await importLegacySale(scope, raw);
          localStorage.removeItem(outboxKey);
        }
        const entries = await listSales(scope);
        setQueue(entries);
        setQueueReady(true);
        if (!navigator.onLine) return;
        for (const entry of entries.filter(sale => sale.status === 'pending')) {
          const { data: session } = await client.auth.getSession();
          if (session.session?.user.id !== user) break;
          const { data, error } = await client.rpc('checkout', entry.request);
          if (error) {
            if (!['P0001', '42501', '22P02', '22003'].includes(error.code)) break;
            await saveSale({ ...entry, status: 'conflict', reason: error.message });
            continue;
          }
          await saveSale({ ...entry, status: 'confirmed' });
          reload(n => n + 1);
          const row = await client.from('sales_access').select('id,total,created_at,items').eq('id', data).single();
          if (row.data) { setLabel(null); setReceipt({ ...row.data, cost: null }); }
        }
        const all = await listSales(scope);
        const old = all.filter(entry => entry.status === 'confirmed').slice(0, -50);
        for (const entry of old) await removeSale(entry);
        setQueue(all.filter(entry => !old.includes(entry)));
      };
      if (navigator.locks) await navigator.locks.request(outboxKey, transmit);
      else await transmit();
    } catch (error) { setError(explain(error)); }
    finally { sending.current = false; setBusy(false); }
  }, [client, outboxKey, scope, user]);

  useEffect(() => {
    const connected = () => { setOnline(true); void synchronize(); };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    void synchronize();
    const timer = window.setInterval(() => void synchronize(), 15000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, [synchronize]);

  const operationsText = {
    uz: ['Sanash', 'Haqiqiy qoldiq', 'Filiallarga kirish', 'Barcha filiallar'],
    ru: ['Инвентаризация', 'Фактический остаток', 'Доступ к филиалам', 'Все филиалы'],
    en: ['Stocktake', 'Counted quantity', 'Branch access', 'All branches'],
  }[lang];
  const cashText = {
    uz: ['Kutilgan naqd pul', 'Tafovut', 'Xarajatlar', 'Summa', 'Tavsif'],
    ru: ['Ожидаемые наличные', 'Расхождение', 'Расходы', 'Сумма', 'Описание'],
    en: ['Expected cash', 'Variance', 'Expenses', 'Amount', 'Description'],
  }[lang];
  const pending = queue.filter(entry => entry.status === 'pending');
  const history = queue.filter(entry => entry.status !== 'pending').slice(-50).reverse();
  const queueText = {
    uz: ['Sinxronlash tarixi', 'Tasdiqlandi', 'Tekshirish kerak', 'Tarmoqda', 'Tarmoq yo‘q'],
    ru: ['История синхронизации', 'Подтверждено', 'Требуется проверка', 'В сети', 'Нет связи'],
    en: ['Synchronization history', 'Confirmed', 'Needs review', 'Online', 'Offline'],
  }[lang];

  async function submit() {
    if (busy || !queueReady || !lines.length || total === null || !Number.isSafeInteger(card) || card < 0 || card > total) return;
    setBusy(true);
    setError('');
    try {
      await saveSale({ scope, created: Date.now(), status: 'pending', request: {
        p_business: business, p_store: store, p_request: crypto.randomUUID(), p_lines: lines,
        p_cash: total - card, p_card: card, p_discount: discount, p_expected: total,
      } });
      setCart({}); setDiscount(0); setCard(0); setReceipt(null);
      setQueue(await listSales(scope));
      await synchronize();
    } catch (error) { setError(explain(error)); }
    finally { setBusy(false); }
  }

  const d = dashboardCopy[lang];
  const pages = [...t.slice(0, 6), ...x.slice(0, 3), 'TOVARIX AI', ...management.slice(0, 4), t[28], debtTitle[lang]];
  function change(page: number) {
    setTab(page); setQuery(''); setCatalogPage(0); setScanning(false); setError(''); setContacts([]);
    window.scrollTo(0, 0);
  }
  return <>
    <AppNavigation {...{ pages, tab, lang, profile, role, online }} go={change}
      alerts={critical.map(p => p.name + ' · ' + p.quantity).slice(0, 20)} />
    {tab !== 0 && <div className="page-heading page-enter"><div><p className="section-caption">{branchName}</p><h1>{pages[tab]}</h1></div></div>}
    {error && <p role="alert">{error}</p>}
    {pending.length > 0 && <p role="status">{t[19]} ({pending.length}) <button disabled={busy || !online} onClick={() => void synchronize()}>{t[20]}</button></p>}
    {history.length > 0 && <details><summary>{queueText[0]}</summary>
      {history.map(entry => <article key={entry.request.p_request}>
        <strong>{queueText[entry.status === 'confirmed' ? 1 : 2]}</strong>
        <small>{entry.request.p_request} · {money(entry.request.p_expected)}</small>
        {entry.reason && <span>{entry.reason}</span>}
      </article>)}
    </details>}
    {tab === 0 && <Dashboard lang={lang} days={period} setDays={setPeriod} storeName={branchName} money={money} go={change}
      limited={true} data={{
        revenue: periodSales.reduce((sum, s) => sum + s.total, 0),
        profit: finance.profit && periodSales.every(s => s.cost !== null) ? periodSales.reduce((sum, s) => sum + s.total - (s.cost ?? 0), 0) : null,
        count: periodSales.length,
        inventoryValue: finance.cost && snapshot.products.every(p => p.cost !== null) ? snapshot.products.reduce((sum, p) => sum + Number(p.cost) * quantity(p.id), 0) : null,
        openingCash: shift ? Number(shift.opening_cash) : null, expenses: cashOverview?.expenses ?? null, currentCash: cashOverview?.cash, critical, days: daily,
        recent: snapshot.sales.slice(0, 4).map(s => ({ id: s.id, date: s.created_at, total: s.total, title: s.sale_returns ? d[24] : d[17], returned: !!s.sale_returns })),
      }} />}
    {tab === 14 && <div className="page-enter">
      {snapshot.sales.map(s => <article key={s.id}><span>{new Date(s.created_at).toLocaleString(lang)} · {money(s.total)}
        {s.sale_returns && ' · ' + lifecycle[4]}</span>
        <button onClick={() => { setLabel(null); setReceipt(s); }}>{t[21]}</button>
        {!s.sale_returns && s.items.some(item => item.partial_returnable === true) && <details>
          <summary>{lang === 'ru' ? 'Частичный возврат' : lang === 'uz' ? 'Qisman qaytarish' : 'Partial return'}</summary>
          {s.items.filter(item => item.partial_returnable === true).map(item => {
            const returned = (s.partial_returns ?? []).filter(r => r.product_id === item.product_id).reduce((sum, r) => sum + Number(r.quantity), 0);
            const maximum = Math.round((item.quantity - returned) * 1000) / 1000;
            const requestKey = item.product_id + ':' + maximum;
            return maximum > 0 && <form key={requestKey} onSubmit={e => {
              const form = e.currentTarget;
              if (form.dataset.sending === 'yes') { e.preventDefault(); return; }
              form.dataset.sending = 'yes';
              const id = form.dataset.request ?? crypto.randomUUID();
              form.dataset.request = id;
              void mutate(e, async data => {
                try {
                  return await client.rpc('partial_return', {
                    p_business: business, p_sale: s.id, p_request: id, p_product: item.product_id,
                    p_quantity: Number(data.get('quantity')), p_reason: data.get('reason'),
                  });
                } finally { delete form.dataset.sending; }
              });
            }}>
              <b>{item.name}</b>
              <input name="quantity" type="number" min={item.weighted ? '0.001' : '1'} step={item.weighted ? '0.001' : '1'}
                max={maximum} required aria-label={x[5]} />
              <input name="reason" required maxLength={500} aria-label={t[33]} />
              <button>{t[12]}</button>
            </form>;
          })}
        </details>}
        {!s.sale_returns && !s.partial_returns?.length && <details><summary>{lifecycle[3]}</summary>
          <form onSubmit={e => void mutate(e, data => client.rpc('return_sale', {
            p_business: business, p_sale: s.id, p_reason: data.get('reason'),
          }))}>
            <input name="reason" required maxLength={500} placeholder={t[33]} aria-label={t[33]} /><button>{lifecycle[3]}</button>
          </form>
        </details>}
      </article>)}
    </div>}
    {(tab === 1 || tab === 2 || tab === 3) && <>
      {tab === 1 && <form onSubmit={e => void mutate(e, data => client.rpc('change_shift', {
        p_business: business, p_store: store, p_cash: Number(data.get('cash')), p_close: !!shift,
      }))}>
        <input name="cash" type="number" min="0" required placeholder={lifecycle[2]} aria-label={lifecycle[2]} />
        <button disabled={pending.length > 0}>{shift ? lifecycle[1] : lifecycle[0]}</button>
      </form>}
      {tab === 1 && shiftSummary?.expected_cash != null && <article>
        <span>{cashText[0]} · {money(shiftSummary.expected_cash)}</span>
        <span>{lifecycle[2]} · {money(shiftSummary.closing_cash)}</span>
        <span>{cashText[1]} · {money(shiftSummary.cash_variance ?? 0)}</span>
      </article>}
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
      <div className="search-field"><Search size={18} /><input placeholder={t[8] + ' / ' + t[9]} aria-label={t[8] + ' / ' + t[9]} value={query}
        onChange={e => { setQuery(e.target.value); setCatalogPage(0); }} onKeyDown={e => {
          if (e.key !== 'Enter' || tab !== 1) return;
          const found = snapshot.products.find(p => p.barcode === query.trim());
          if (found) { add(found.id); setQuery(''); }
        }} />
        {tab === 1 && <button onClick={() => setScanning(!scanning)} aria-pressed={scanning}><Barcode size={19} />{t[31]}</button>}
      </div>
      {scanning && <video ref={video} autoPlay muted playsInline />}
      <div className={tab === 1 ? 'pos' : ''}><div>
        {matchingProducts.slice(shownCatalogPage * 30, (shownCatalogPage + 1) * 30).map(p => <article className={tab === 1 ? 'product-row' : 'inventory-card'} key={p.id}>
          <span className="product-icon blue"><Package size={20} /></span>
          <div className="product-name"><b>{p.name}</b>{tab === 2 && <small>{attributeKeys.map((key, i) => p.attributes?.[key] ? attributeNames[lang][i] + ': ' + p.attributes[key] : '').filter(Boolean).join(' · ')}</small>}<small>{p.barcode} · {t[13]} {quantity(p.id)}{tab === 3 && quantity(p.id) <= 5 && ' · ' + lifecycle[5]}</small></div><strong>{money(p.price)}</strong>
          {tab === 1 && <button className="icon-button add-product" aria-label={'+' + p.name} disabled={(cart[p.id] || 0) >= (isWeighted(p) ? quantity(p.id) : Math.floor(quantity(p.id)))} onClick={() => add(p.id)}><Plus size={17} /></button>}
          {tab === 2 && <button onClick={() => void makeLabel(p)}>{t[41]}</button>}
          {tab === 3 && <form onSubmit={e => void mutate(e, data => client.rpc('adjust_stock', {
            p_business: business, p_store: store, p_product: p.id, p_delta: Number(data.get('delta')), p_reason: data.get('reason'),
          }))}>
            <input name="delta" type="number" step="0.001" required placeholder={t[32]} aria-label={t[32]} />
            <input name="reason" maxLength={500} required placeholder={t[33]} aria-label={t[33]} />
            <button>{t[12]}</button>
          </form>}
          {tab === 3 && <details><summary>{operationsText[0]}</summary>
            <form key={quantity(p.id)} onSubmit={e => void mutate(e, data => client.rpc('count_stock', {
              p_business: business, p_store: store, p_product: p.id, p_expected: quantity(p.id),
              p_count: Number(data.get('count')), p_reason: data.get('reason'),
            }))}>
              <input name="count" type="number" min="0" step="0.001" required aria-label={operationsText[1]} />
              <input name="reason" maxLength={400} required aria-label={t[33]} />
              <button>{t[12]}</button>
            </form>
          </details>}
          {tab === 3 && stores.some(s => s.id !== store) && <form onSubmit={e => void mutate(e, data => client.rpc('transfer_stock', {
            p_business: business, p_from: store, p_to: data.get('to'), p_product: p.id, p_quantity: Number(data.get('quantity')),
          }))}>
            <select name="to" aria-label={x[4]}>{stores.filter(s => s.id !== store).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input name="quantity" type="number" step="0.001" min="0.001" required placeholder={x[5]} aria-label={x[5]} />
            <button>{x[4]}</button>
          </form>}
        </article>)}
        {lastCatalogPage > 0 && <div className="controls">
          <button disabled={!shownCatalogPage} onClick={() => setCatalogPage(shownCatalogPage - 1)} aria-label={({uz:'Oldingi sahifa',ru:'Предыдущая страница',en:'Previous page'})[lang]}>‹</button>
          <span aria-live="polite">{shownCatalogPage + 1} / {lastCatalogPage + 1}</span>
          <button disabled={shownCatalogPage === lastCatalogPage} onClick={() => setCatalogPage(shownCatalogPage + 1)} aria-label={({uz:'Keyingi sahifa',ru:'Следующая страница',en:'Next page'})[lang]}>›</button>
        </div>}
      </div>
      {tab === 1 && <section className="cart-panel"><div className="panel-heading"><div><span className="panel-icon blue"><ShoppingCart size={17} /></span><h2>{t[14]}</h2></div></div>
        {selected.map(p => <div className="cart-line" key={p.id}><span>{p.name}</span>
          <input aria-label={p.name + ' · ' + x[5]} type="number" min="0" max={quantity(p.id)} step={isWeighted(p) ? '0.001' : '1'}
            value={cart[p.id]} onChange={e => {
              const requested = Number(e.target.value);
              const value = isWeighted(p) ? Math.round(requested * 1000) / 1000 : Math.trunc(requested);
              setCart(old => ({ ...old, [p.id]: Math.max(0, Math.min(isWeighted(p) ? quantity(p.id) : Math.floor(quantity(p.id)), value)) }));
            }} /></div>)}
        <div className="payment-choice">
          <button type="button" aria-pressed={card === 0} onClick={() => setCard(0)}><Wallet size={16} />{t[16]}</button>
          <button type="button" aria-pressed={total !== null && total > 0 && card === total}
            disabled={!total} onClick={() => setCard(total ?? 0)}><CreditCard size={16} />{lang === 'ru' ? 'Карта' : lang === 'uz' ? 'Karta' : 'Card'}</button>
        </div>
        <label>{t[15]} <input type="number" min="0" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></label>
        <label>{t[17]} <input type="number" min="0" value={card} onChange={e => setCard(Number(e.target.value))} /></label>
        {total !== null && card <= total && <p>{t[16]} · {money(total - card)}</p>}
        {total !== null && <h2>{money(total)}</h2>}
        <button disabled={busy || !queueReady || !lines.length || total === null || !Number.isSafeInteger(card) || card < 0 || card > total}
          className="primary-button block" onClick={() => void submit()}>{t[18]}</button>
      </section>}</div>
    </>}
    {tab === 4 && <form onSubmit={e => void mutate(e, async data => {
      const result = await client.from('stores').insert({ business_id: business, name: String(data.get('name')).trim() });
      if (!result.error) refresh(n => n + 1);
      return result;
    })}>
      <input name="name" required maxLength={200} placeholder={t[7]} aria-label={t[7]} /><button>{t[12]}</button>
    </form>}
    {tab === 5 && <>
      <HardwareDiagnostics lang={lang} />
      <div className="grid">{plans.map(p => <article key={p.id} className={billing?.plan === p.id ? 'current-plan' : ''}>
        <b>{p.id}</b><span>{money(p.monthly)} / {lang === 'ru' ? 'месяц' : lang === 'uz' ? 'oy' : 'month'}</span>
        <small>{money(p.yearly)} / {lang === 'ru' ? 'год' : lang === 'uz' ? 'yil' : 'year'}</small>
        <small>{x[2]} · {p.employees ?? '∞'}</small>
        <small>{t[2]} · {p.products?.toLocaleString(lang) ?? '∞'}</small>
        <small>{t[4]} · {p.branches ?? '∞'}</small>
        <small>AI · {p.aiPerDay}{({uz:' / kun',ru:' / день',en:' / day'})[lang]}</small>
      </article>)}</div>
      {billing && <section>
        <h2>{billing.plan}</h2>
        {billing.paid_until && <p>{new Date(billing.paid_until).toLocaleDateString(lang)}</p>}
        {billing.trial_started_at && billing.trial_until && <p>
          {new Date(billing.trial_started_at).toLocaleDateString(lang)} → {new Date(billing.trial_until).toLocaleDateString(lang)}
          {' · '}{Math.max(0,Math.ceil((new Date(billing.trial_until).getTime()-Date.now())/86400000))}
          {' '}{lang === 'ru' ? 'дней trial осталось' : lang === 'uz' ? 'sinov kuni qoldi' : 'trial days remaining'}
        </p>}
        <form onSubmit={e => void mutate(e, async data => {
          const result = await client.rpc('redeem_promo', { p_business: business, p_code: data.get('code') });
          if (!result.error) setPromoDiscount(result.data);
          return result;
        })}>
          <input name="code" required maxLength={40} aria-label={lang === 'ru' ? 'Промокод' : 'Promo kod'} />
          <button>{t[12]}</button>
        </form>
        {promoDiscount !== null && <p role="status">{t[15]} {promoDiscount}%</p>}
        <h3>{lang === 'ru' ? 'История платежей' : lang === 'uz' ? 'To‘lovlar tarixi' : 'Payment history'}</h3>
        {billing.payments.map((payment,i) => <p key={payment.captured_at + i}>
          {new Date(payment.captured_at).toLocaleString(lang)} · {payment.plan} · {payment.provider} · {money(payment.amount_uzs)}
        </p>)}
      </section>}
    </>}
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
        <select name="role" aria-label={x[7]}>{Object.entries({
          uz: { cashier: 'Kassir', manager: 'Boshqaruvchi', warehouse: 'Omborchi', admin: 'Administrator', accountant: 'Hisobchi' },
          ru: { cashier: 'Кассир', manager: 'Управляющий', warehouse: 'Кладовщик', admin: 'Администратор', accountant: 'Бухгалтер' },
          en: { cashier: 'Cashier', manager: 'Manager', warehouse: 'Warehouse', admin: 'Administrator', accountant: 'Accountant' },
        }[lang]).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select>
        <fieldset><legend>{x[7]}</legend>{permissions.map(permission => <label key={permission} className="permission">
          <input type="checkbox" name="permissions" value={permission} />{permission}
        </label>)}</fieldset>
        <button>{t[12]}</button><button value="remove">{x[8]}</button>
      </form>
      {staff.map(member => <article className="staff-card" key={member.user_id}>
        <div className="staff-identity"><span className="staff-avatar blue">{(member.display_name?.split(/\s+/).slice(0, 2).map(part => part[0]).join('') || member.user_id.slice(0, 2)).toUpperCase()}</span>
          <div><strong>{member.display_name || member.user_id.slice(0, 8)}</strong><small>{member.role}</small></div></div>
        <small title={member.user_id}>{member.user_id}</small>
        {owner && report && <div className="staff-metrics">
          <div><small>{t[28]}</small><strong>{report.operators.find(item => item.operator_id === member.user_id)?.sales ?? 0}</strong></div>
          <div><small>{t[29]}</small><strong>{money(report.operators.find(item => item.operator_id === member.user_id)?.revenue ?? 0)}</strong></div>
        </div>}
        <details><summary>{x[7]}</summary><p>{member.permissions.join(', ')}</p></details>
        {owner && <form onSubmit={e => void mutate(e, () => client.rpc('suspend_staff', {
          p_business: business, p_user: member.user_id, p_blocked: !member.blocked_at,
        }))}>
          <button>{member.blocked_at ? ({uz:'Blokdan chiqarish',ru:'Разблокировать',en:'Unblock'})[lang]
            : ({uz:'Bloklash',ru:'Заблокировать',en:'Block'})[lang]}</button>
        </form>}
        {owner && <details><summary>{lang === 'ru' ? 'Управление аккаунтом' : lang === 'uz' ? 'Hisob boshqaruvi' : 'Manage account'}</summary>
          <form onSubmit={e => void mutate(e, data => client.rpc('set_staff_display_name', {
            p_business: business, p_user: member.user_id, p_name: data.get('displayName'),
          }))}>
            <input name="displayName" defaultValue={member.display_name ?? ''} maxLength={100} aria-label={t[8]} />
            <button>{t[12]}</button>
          </form>
        </details>}
        <details><summary>{operationsText[2]}</summary>
          <form key={JSON.stringify(member.store_scope)} onSubmit={e => void mutate(e, data => client.rpc('set_store_scope', {
            p_business: business, p_user: member.user_id, p_stores: data.has('all') ? null : data.getAll('branches'),
          }))}>
            <label className="permission"><input type="checkbox" name="all" defaultChecked={member.store_scope === null} />{operationsText[3]}</label>
            {stores.map(branch => <label className="permission" key={branch.id}>
              <input type="checkbox" name="branches" value={branch.id} defaultChecked={member.store_scope?.includes(branch.id)} />{branch.name}
            </label>)}
            <button>{t[12]}</button>
          </form>
        </details></article>)}
    </>}
    {tab === 9 && <>
      {aiQuota && <p className="section-caption">{aiQuota.enabled
        ? ({uz:'Bugungi qolgan so‘rovlar',ru:'Запросов осталось сегодня',en:'Requests remaining today'})[lang] + ' · ' + aiQuota.remaining
        : ({uz:'AI hozircha o‘chiq',ru:'AI пока отключён',en:'AI is currently disabled'})[lang]}</p>}

      <form onSubmit={e => void ask(e)}>
        <input name="question" required maxLength={2000} aria-label="TOVARIX AI"
          placeholder={lang === 'ru' ? 'Спросить о продажах' : lang === 'en' ? 'Ask about sales' : 'Savdolar haqida savol'} />
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp"
          aria-label={lang === 'ru' ? 'Фото товара' : lang === 'en' ? 'Product photo' : 'Mahsulot surati'} />
        <button disabled={asking || aiQuota?.enabled === false || aiQuota?.remaining === 0}>{lang === 'ru' ? 'Спросить' : lang === 'en' ? 'Ask' : 'So‘rash'}</button>
      </form>
      {answer && !aiHistory.some(turn => turn.answer === answer) && <article className="ai-answer">{answer}</article>}
      {aiHistory.map(turn => <article key={turn.id} className="ai-answer"><strong>{turn.question}</strong><div>{turn.answer}</div></article>)}
    </>}
    {tab === 10 && <>
      <form onSubmit={e => void mutate(e, async data => {
        const rows = data.getAll('product').map((product_id, i) => ({
          product_id, quantity: Number(data.getAll('quantity')[i]), total: Number(data.getAll('total')[i]),
        }));
        const result = await client.rpc('receive_purchase_batch', {
          p_business: business, p_store: store, p_supplier: data.get('supplier') || null,
          p_reference: data.get('reference'), p_lines: rows,
        });
        if (!result.error) setPurchaseRows(1);
        return result;
      })}>
        <select name="supplier" aria-label={x[1]}><option value="">{management[6]}</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input name="reference" maxLength={120} required placeholder={management[4]} aria-label={management[4]} />
        {Array.from({ length: purchaseRows }, (_, i) => <fieldset className="controls" key={i}>
          <select name="product" aria-label={t[2] + ' ' + (i + 1)} required><option value="">{t[2]}</option>
            {snapshot.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input name="quantity" type="number" step="0.001" min="0.001" required placeholder={x[5]} aria-label={x[5] + ' ' + (i + 1)} />
          <input name="total" type="number" min="0" required placeholder={management[5]} aria-label={management[5] + ' ' + (i + 1)} />
        </fieldset>)}
        <button type="button" disabled={purchaseRows === 100} onClick={() => setPurchaseRows(n => n + 1)}>+ {t[2]}</button>
        {purchaseRows > 1 && <button type="button" onClick={() => setPurchaseRows(n => n - 1)}>− {t[2]}</button>}
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
        <article>{management[8]}<strong>{report.totals.revenue && report.totals.profit !== null ? new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(report.totals.profit / report.totals.revenue) : '—'}</strong></article>
        <article>{t[16]}<strong>{money(report.totals.cash)}</strong></article>
        <article>{t[17]}<strong>{money(report.totals.card)}</strong></article>
      </div>
      {report.totals.revenue > 0 && <div role="img" className="tender-chart" aria-label={t[16] + ': ' + money(report.totals.cash) + ', ' + t[17] + ': ' + money(report.totals.card)}
        style={{ backgroundImage: 'conic-gradient(#508cf7 0 ' + 100 * report.totals.cash / report.totals.revenue + '%, #28b594 0)' }} />}
    </>}
    {tab === 12 && <section><h2>{cashText[2]}</h2>
      <form onSubmit={e => void mutate(e, data => client.rpc('record_expense', {
        p_business: business, p_store: store, p_amount: Number(data.get('amount')), p_description: data.get('description'),
      }))}>
        <input name="amount" type="number" min="1" required aria-label={cashText[3]} placeholder={cashText[3]} />
        <input name="description" maxLength={300} required aria-label={cashText[4]} placeholder={cashText[4]} />
        <button>{t[12]}</button>
      </form>
      {expenses.map(expense => <article key={expense.id}>{expense.description} · {money(expense.amount)}</article>)}
    </section>}
    {tab === 15 && <CustomerDebts {...{ client, business, lang }} />}
    {tab === 13 && <SupportDesk {...{ client, lang, business }} />}
    {label && <section className="label-print">
      <b>{label.name}</b><p>{money(label.price)}</p>
      <img src={label.image} alt={label.barcode} style={{ maxWidth: '100%' }} />
      <div className="controls no-print"><button onClick={() => window.print()}>{t[22]}</button>
        <button onClick={() => setLabel(null)}>×</button></div>
    </section>}
    {receipt && <section className="receipt" style={{ width: width + 'mm' }}>
      <h2>{t[21]}</h2>{receipt.sale_returns && <p>{lifecycle[4]}</p>}<small>{receipt.id}</small><small>{new Date(receipt.created_at).toLocaleString(lang)}</small>
      {receipt.items.map(i => <p key={i.product_id}>{i.name} × {i.quantity} · {money(saleTotal([i], 0))}</p>)}
      <strong>{money(receipt.total)}</strong>
      <div className="controls no-print"><select aria-label="mm" value={width} onChange={e => setWidth(Number(e.target.value))}>
        <option value={58}>58 mm</option><option value={80}>80 mm</option>
      </select><button onClick={() => window.print()}>{t[22]}</button><button onClick={() => setReceipt(null)}>×</button></div>
    </section>}
  </>;
}
