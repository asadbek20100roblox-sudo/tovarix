import { useEffect, useState } from 'react';
import { Barcode, ChevronRight, CircleAlert, CreditCard, Download, Moon, Package, Plus, ReceiptText, Search, ShoppingCart, Sun, Wallet } from 'lucide-react';
import { AppNavigation, Brand } from './AppNavigation';
import { Dashboard, dashboardCopy } from './Dashboard';
import { labels, languageNames } from './labels';
import type { Language } from './labels';
import { saleTotal } from './commerce';
import { plans } from './plans';

const productsSeed = [
  { id: '1', names: ['Sut, 1 l', 'Молоко, 1 л', 'Milk, 1 L'], code: '4780011200013', price: 14500, cost: 11000, stock: 42, tone: 'blue' },
  { id: '2', names: ['Bug‘doy noni', 'Пшеничный хлеб', 'Wheat bread'], code: '4780011200020', price: 6000, cost: 3700, stock: 28, tone: 'amber' },
  { id: '3', names: ['Qora choy, 100 g', 'Чёрный чай, 100 г', 'Black tea, 100 g'], code: '4780011200037', price: 24000, cost: 17500, stock: 3, tone: 'violet' },
  { id: '4', names: ['Mineral suv, 1,5 l', 'Минеральная вода, 1,5 л', 'Mineral water, 1.5 L'], code: '4780011200044', price: 8500, cost: 4800, stock: 64, tone: 'blue' },
  { id: '5', names: ['Shakar, 1 kg', 'Сахар, 1 кг', 'Sugar, 1 kg'], code: '4780011200051', price: 16000, cost: 12600, stock: 2, tone: 'green' },
  { id: '6', names: ['Kofe, 95 g', 'Кофе, 95 г', 'Coffee, 95 g'], code: '4780011200068', price: 54000, cost: 39000, stock: 18, tone: 'amber' },
];
type Product = typeof productsSeed[number];
type Sale = { id: string; date: string; total: number; cost: number };
type DemoState = { products: Product[]; sales: Sale[] };
const storageKey = 'tovarix-demo-v030';
const staff = [
  { name: 'Aziza Karimova', initials: 'AK', role: 0, sales: 24, total: 3465000, tone: 'blue' },
  { name: 'Jasur Rahimov', initials: 'JR', role: 1, sales: 19, total: 2784000, tone: 'green' },
  { name: 'Madina Aliyeva', initials: 'MA', role: 2, sales: 0, total: 0, tone: 'violet' },
];
const copy = {
  uz: ['Demo rejimi', 'Namuna ma’lumotlar', 'Markaziy filial', 'Katalog', 'Sozlamalar', 'Xodimlar', 'Hisobotlar', 'Sotuvlar', 'Qidirish yoki shtrix-kodni kiriting', 'Mahsulotlar', 'Savat bo‘sh', 'To‘lov turi', 'Naqd', 'Karta', 'Mahalliy demo savdosini saqlash', 'Demo savdosi saqlandi', 'Qoldiq', 'Xodimlar ro‘yxati', 'Faol', 'Boshqaruvchi', 'Kassir', 'Omborchi', 'Vakolatlar', 'Hisob boshqaruvi', 'Serverga ulanish kerak', 'Mavzu', 'HTML faylni yuklab olish', 'Tovar nomi', 'Shtrix-kod', 'Narx', 'Qoldiq soni', 'Mahsulot qo‘shish', 'Jami', 'Cheklar', 'TOVARIX hisobiga kirish', 'To‘langan', 'Narx yoki kodni tekshiring'],
  ru: ['Деморежим', 'Учебные данные', 'Центральный филиал', 'Каталог', 'Настройки', 'Сотрудники', 'Отчёты', 'Продажи', 'Поиск или ввод штрихкода', 'Товары', 'Корзина пуста', 'Способ оплаты', 'Наличные', 'Карта', 'Сохранить локальную демопродажу', 'Демопродажа сохранена', 'Остаток', 'Список сотрудников', 'Активен', 'Управляющий', 'Кассир', 'Кладовщик', 'Права доступа', 'Управление аккаунтом', 'Требуется подключение к серверу', 'Тема', 'Скачать HTML', 'Название товара', 'Штрихкод', 'Цена', 'Остаток', 'Добавить товар', 'Всего', 'Чеки', 'Войти в TOVARIX', 'Оплачено', 'Проверьте цену или штрихкод'],
  en: ['Demo mode', 'Sample data', 'Central branch', 'Catalog', 'Settings', 'Employees', 'Reports', 'Sales', 'Search or enter a barcode', 'Products', 'Your cart is empty', 'Payment method', 'Cash', 'Card', 'Save local demo sale', 'Demo sale saved', 'Stock', 'Employee directory', 'Active', 'Manager', 'Cashier', 'Warehouse', 'Permissions', 'Manage account', 'Server connection required', 'Theme', 'Download HTML', 'Product name', 'Barcode', 'Price', 'Opening stock', 'Add product', 'Total', 'Receipts', 'Sign in to TOVARIX', 'Paid', 'Check the price or barcode'],
} as const;

function initialDemo(): DemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (Array.isArray(saved?.products) && Array.isArray(saved?.sales)) return saved;
  } catch { /* Storage may be unavailable in a file-only WebView. */ }
  const totals = [1275000, 2135000, 1710000, 2470000, 2185000, 2965000, 3465000];
  const sales = totals.flatMap((total, day) => Array.from({ length: day === 6 ? 24 : 5 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + day - 6);
    date.setHours(9 + (i % 3), i % 60, 0, 0);
    const n = day === 6 ? 24 : 5;
    const share = i === n - 1 ? total - Math.floor(total / n) * (n - 1) : Math.floor(total / n);
    return { id: 'sample-' + day + '-' + i, date: date.toISOString(), total: share, cost: Math.round(share * .71) };
  }));
  return { products: productsSeed, sales };
}

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function DemoWorkspace({ standalone = false }: { standalone?: boolean }) {
  const [state, setState] = useState(initialDemo);
  const [tab, go] = useState(0);
  const [period, setPeriod] = useState(1);
  const [lang, setLang] = useState<Language>(() => {
    const value = readPreference('tovarix.language');
    return value === 'en' || value === 'ru' ? value : 'uz';
  });
  const [dark, setDark] = useState(() => readPreference('tovarix.theme') === 'dark');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'cash' | 'card'>('cash');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const t = copy[lang];
  const l = labels[lang];
  const d = dashboardCopy[lang];
  const loc = lang === 'uz' ? 0 : lang === 'ru' ? 1 : 2;
  const money = (value: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(value) + (lang === 'uz' ? ' so‘m' : ' UZS');
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('tovarix.language', lang);
      localStorage.setItem('tovarix.theme', dark ? 'dark' : 'light');
    } catch { /* Session remains usable without persistence. */ }
  }, [lang, dark]);

  function save(value: DemoState) {
    setState(value);
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Session remains usable. */ }
  }
  const pages = [l[0], l[1], t[3], l[3], l[4], t[4], lang === 'uz' ? 'Mijozlar' : lang === 'ru' ? 'Клиенты' : 'Customers',
    lang === 'uz' ? 'Yetkazib beruvchilar' : lang === 'ru' ? 'Поставщики' : 'Suppliers', t[5], 'TOVARIX AI',
    lang === 'uz' ? 'Xaridlar' : lang === 'ru' ? 'Закупки' : 'Purchases', t[6], lang === 'uz' ? 'Xarajatlar' : lang === 'ru' ? 'Расходы' : 'Expenses',
    lang === 'uz' ? 'Yordam' : lang === 'ru' ? 'Поддержка' : 'Support', t[7]];

  const critical = state.products.filter(p => p.stock <= 5).map(p => ({ id: p.id, name: p.names[loc], quantity: p.stock }));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - period + 1);
  const sales = state.sales.filter(s => new Date(s.date) >= start);
  const days = Array.from({ length: period === 1 ? 7 : period }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (period === 1 ? 7 : period) + 1 + index);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    return { date, value: state.sales.filter(s => new Date(s.date) >= date && new Date(s.date) < end).reduce((sum, sale) => sum + sale.total, 0) };
  });
  const picked = state.products.filter(p => cart[p.id] > 0);
  let total: number | null;
  try { total = saleTotal(picked.map(p => ({ price: p.price, quantity: cart[p.id] })), 0); } catch { total = null; }
  const visible = state.products.filter(p => (p.names[loc] + ' ' + p.code).toLowerCase().includes(query.trim().toLowerCase()));
  const change = (page: number) => { go(page); setQuery(''); setError(''); setStatus(''); window.scrollTo(0, 0); };
  const add = (p: Product) => setCart(old => ({ ...old, [p.id]: Math.min(p.stock, (old[p.id] || 0) + 1) }));

  function submitSale() {
    if (total === null || !picked.length || picked.some(p => cart[p.id] > p.stock)) return;
    save({ products: state.products.map(p => ({ ...p, stock: p.stock - (cart[p.id] || 0) })), sales: [...state.sales, {
      id: 'demo-' + Date.now() + '-' + (state.sales.length + 1), date: new Date().toISOString(), total,
      cost: picked.reduce((sum, p) => sum + p.cost * cart[p.id], 0),
    }] });
    setCart({});
    setStatus(t[15]);
  }

  return <main className={'workspace demo-workspace ' + (dark ? 'dark' : 'light')}>
    <div className="brand-strip"><Brand /><div className="controls">
      <select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Language)}>
        {Object.entries(languageNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <button type="button" className="icon-button" aria-label={t[25]} aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
    </div></div>
    <AppNavigation pages={pages} tab={tab} go={change} lang={lang} online={false} profile="Aziza" role={t[19]} alerts={critical.map(p => p.name + ' · ' + p.quantity)} />
    <div className="demo-banner"><CircleAlert size={16} /><strong>{t[0]}</strong><span>{t[1]}</span></div>
    {status && <p className="success-note" role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {(tab === 0 || tab === 11) && <Dashboard lang={lang} days={period} setDays={setPeriod} storeName={t[2]} money={money} go={change} data={{
      revenue: sales.reduce((sum, s) => sum + s.total, 0),
      profit: sales.reduce((sum, s) => sum + s.total - s.cost, 0), count: sales.length,
      inventoryValue: state.products.reduce((sum, p) => sum + p.cost * p.stock, 0),
      expenses: 185000, openingCash: 650000, critical, days,
      recent: [...sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4).map(s => ({ ...s, title: d[17] })),
    }} />}
    {(tab === 1 || tab === 2 || tab === 3) && <div className="page-enter">
      <div className="page-heading"><div><p className="section-caption">{t[2]}</p><h1>{pages[tab]}</h1></div><span className="status-chip neutral">{state.products.length} {t[9].toLowerCase()}</span></div>
      {tab === 2 && <details><summary>{t[31]}</summary><form onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const name = String(data.get('name')).trim();
        const code = String(data.get('barcode')).trim();
        const price = Number(data.get('price'));
        const stock = Number(data.get('stock'));
        if (!name || !code || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0 || state.products.some(p => p.code === code)) { setError(t[36]); return; }
        save({ ...state, products: [...state.products, { id: 'local-' + Date.now(), names: [name, name, name], code, price, stock, cost: 0, tone: 'blue' }] });
        form.reset();
        setError('');
      }}>
        {[['name', t[27]], ['barcode', t[28]], ['price', t[29]], ['stock', t[30]]].map(([key, label]) =>
          <input key={key} name={key} required placeholder={label} aria-label={label} type={key === 'price' || key === 'stock' ? 'number' : 'text'} min={0} />)}
        <button className="primary-button">{t[31]}</button>
      </form></details>}
      <form className="search-field" onSubmit={e => {
        e.preventDefault();
        const result = state.products.find(p => p.code === query.trim());
        if (tab === 1 && result) { add(result); setQuery(''); }
      }}><Search size={19} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t[8]} aria-label={t[8]} /><Barcode size={21} /></form>
      <div className={tab === 1 ? 'pos' : ''}>
        <div className="catalog-list">{visible.map(p => <article className="product-row" key={p.id}>
          <span className={'product-icon ' + p.tone}><Package size={21} /></span>
          <div className="product-name"><strong>{p.names[loc]}</strong><small>{p.code}</small></div>
          <div className="product-number"><strong>{money(p.price)}</strong><small className={p.stock <= 5 ? 'warning-text' : ''}>{t[16]} · {p.stock}</small></div>
          {tab === 1 && <button aria-label={'+' + p.names[loc]} className="icon-button add-product" disabled={(cart[p.id] || 0) >= p.stock} onClick={() => add(p)}><Plus size={17} /></button>}
        </article>)}</div>
        {tab === 1 && <section className="cart-panel"><div className="panel-heading"><div><span className="panel-icon blue"><ShoppingCart size={17} /></span><h2>{l[14]}</h2></div><span className="status-chip neutral">{picked.length}</span></div>
          {picked.length === 0 && <p className="empty-state">{t[10]}</p>}
          {picked.map(p => <div className="cart-line" key={p.id}><strong>{p.names[loc]}</strong><input aria-label={p.names[loc]} type="number" min="0" max={p.stock}
            value={cart[p.id]} onChange={e => setCart(old => ({ ...old, [p.id]: Math.max(0, Math.min(p.stock, Math.trunc(Number(e.target.value) || 0))) }))} /></div>)}
          <span className="section-caption">{t[11]}</span><div className="payment-choice">
            <button aria-pressed={payment === 'cash'} onClick={() => setPayment('cash')}><Wallet size={16} />{t[12]}</button>
            <button aria-pressed={payment === 'card'} onClick={() => setPayment('card')}><CreditCard size={16} />{t[13]}</button>
          </div>
          <div className="cart-total"><span>{t[32]}</span><strong>{total === null ? '—' : money(total)}</strong></div>
          <button className="primary-button block" disabled={!picked.length || total === null} onClick={submitSale}>{t[14]}</button>
        </section>}
      </div>
    </div>}
    {tab === 8 && <div className="page-enter"><div className="page-heading"><div><p className="section-caption">{t[2]}</p><h1>{t[17]}</h1></div></div>
      <div className="staff-grid">{staff.map(person => <article className="staff-card" key={person.name}>
        <div className="staff-identity"><span className={'staff-avatar ' + person.tone}>{person.initials}</span><div><strong>{person.name}</strong><small>{t[19 + person.role]}</small></div><span className="status-chip positive">{t[18]}</span></div>
        <div className="staff-metrics"><div><small>{t[7]}</small><strong>{person.sales}</strong></div><div><small>{d[1]}</small><strong>{money(person.total)}</strong></div></div>
        <details><summary>{t[22]}<ChevronRight size={16} /></summary><p>{person.role === 2 ? l[3] : l[1]}</p></details>
        <details><summary>{t[23]}<ChevronRight size={16} /></summary><p>{t[24]}</p></details>
      </article>)}</div>
    </div>}
    {tab === 5 && <div className="page-enter"><h1>{t[4]}</h1>
      {!standalone && <a className="download-link" href="/downloads/TOVARIX.html" download><Download size={17} />{t[26]}</a>}
      <div className="grid">{plans.map(plan => <article key={plan.id}><strong>{plan.id}</strong><span>{money(plan.monthly)}</span></article>)}</div>
    </div>}
    {tab === 14 && <div className="page-enter"><h1>{t[7]}</h1>{[...state.sales].reverse().slice(0, 24).map(s => <article className="activity-row" key={s.id}><span className="panel-icon green"><ReceiptText size={17} /></span><div><strong>{t[33]}</strong><small>{new Date(s.date).toLocaleString(lang)}</small></div><strong>{money(s.total)}</strong></article>)}</div>}
    {[4, 6, 7, 9, 10, 12, 13].includes(tab) && <div className="page-enter"><h1>{pages[tab]}</h1><p className="empty-state">{t[24]}</p></div>}
  </main>;
}
