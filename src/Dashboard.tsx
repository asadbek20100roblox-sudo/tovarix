import { Activity, ArrowDownLeft, ArrowUpRight, Boxes, CircleAlert, Clock3, Landmark, ReceiptText, Wallet } from 'lucide-react';
import type { Language } from './labels';

export const dashboardCopy = {
  uz: ['Savdo ko‘rsatkichlari', 'Tushum', 'Yalpi foyda', 'Savdolar', 'Ombor qiymati', 'Savdo dinamikasi', 'So‘nggi operatsiyalar', 'Bugun', '7 kun', '30 kun', 'Kritik qoldiq', 'Kassa smenasi', 'Ochiq', 'Yopiq', 'Kassadagi boshlang‘ich naqd', 'Xarajatlar', 'Hali operatsiyalar yo‘q', 'Sotuv', 'Filial', 'Davr', 'Sotuvlar ro‘yxati', 'Omborni ochish', 'Tanlangan davr', 'Joriy qoldiq', 'Qaytarilgan'],
  ru: ['Показатели магазина', 'Выручка', 'Валовая прибыль', 'Продажи', 'Стоимость запасов', 'Динамика продаж', 'Последние операции', 'Сегодня', '7 дней', '30 дней', 'Критические остатки', 'Кассовая смена', 'Открыта', 'Закрыта', 'Наличные при открытии', 'Расходы', 'Операций пока нет', 'Продажа', 'Филиал', 'Период', 'Список продаж', 'Открыть склад', 'За выбранный период', 'Текущие остатки', 'Возврат'],
  en: ['Store overview', 'Revenue', 'Gross profit', 'Sales', 'Inventory value', 'Sales activity', 'Recent activity', 'Today', '7 days', '30 days', 'Critical stock', 'Register shift', 'Open', 'Closed', 'Opening cash', 'Expenses', 'No activity yet', 'Sale', 'Branch', 'Period', 'View sales', 'Open inventory', 'Selected period', 'Current inventory', 'Returned'],
} as const;

export type DashboardData = {
  revenue: number; profit: number | null; count: number; inventoryValue: number | null;
  expenses: number | null;
  openingCash: number | null;
  currentCash?: number | null;
  critical: { id: string; name: string; quantity: number }[];
  days: { date: Date; value: number }[];
  recent: { id: string; date: string; total: number; title: string; returned?: boolean }[];
};

export function Dashboard({ data, lang, days, setDays, storeName, money, go, limited = false }: {
  data: DashboardData; lang: Language; days: number; setDays: (days: number) => void; storeName: string;
  money: (value: number) => string; go: (page: number) => void; limited?: boolean;
}) {
  const t = dashboardCopy[lang];
  const scale = Math.max(1, ...data.days.map(day => day.value));
  const metrics = [
    { icon: Wallet, label: t[1], value: money(data.revenue), tone: 'blue', note: t[22] },
    { icon: ArrowUpRight, label: t[2], value: data.profit === null ? '—' : money(data.profit), tone: 'green', note: t[22] },
    { icon: ReceiptText, label: t[3], value: new Intl.NumberFormat(lang).format(data.count), tone: 'violet', note: t[22] },
    { icon: ReceiptText, label: ({uz:'O‘rtacha chek',ru:'Средний чек',en:'Average receipt'})[lang],
      value: data.count ? money(Math.round(data.revenue / data.count)) : '—', tone: 'blue', note: t[22] },
    { icon: Boxes, label: t[4], value: data.inventoryValue === null ? '—' : money(data.inventoryValue), tone: 'amber', note: t[23] },
  ];
  return <div className="dashboard page-enter">
    <div className="page-heading"><div><p className="section-caption"><span className="small-dot" />{storeName}</p><h1>{t[0]}</h1></div>
      <label className="period-filter"><Clock3 size={16} /><select aria-label={t[19]} value={days} onChange={e => setDays(Number(e.target.value))}>
        <option value={1}>{t[7]}</option><option value={7}>{t[8]}</option><option value={30}>{t[9]}</option>
      </select></label>
    </div>
    {limited && <small className="data-note">{lang === 'ru' ? 'По последним 250 доступным продажам филиала' : lang === 'uz' ? 'Filialning oxirgi 250 ta mavjud savdosi' : 'Based on the latest 250 visible sales for this branch'}</small>}
    <div className="metrics-grid">{metrics.map(({ icon: Icon, label, value, tone, note }) => <article className="metric-card" key={label}>
      <span className={'metric-icon ' + tone}><Icon size={19} /></span><span className="metric-label">{label}</span>
      <strong>{value}</strong><small>{note}</small>
    </article>)}</div>
    <div className="dashboard-columns">
      <section className="dash-panel sales-chart">
        <div className="panel-heading"><div><span className="panel-icon blue"><Activity size={17} /></span><h2>{t[5]}</h2></div><span className="chart-key"><i />{t[1]}</span></div>
        <div className="bar-plot" aria-label={t[5]}>{data.days.map((point, index) => <div className="bar-column" key={point.date.toISOString()}>
          <div className="bar-track"><span className={index === data.days.length - 1 ? 'last' : ''} tabIndex={0}
            aria-label={point.date.toLocaleDateString(lang) + ' · ' + money(point.value)}
            style={{ height: Math.max(3, point.value / scale * 100) + '%' }}><span className="bar-tooltip">{money(point.value)}</span></span></div>
          <small>{point.date.toLocaleDateString(lang, data.days.length > 8 ? { day: 'numeric' } : { weekday: 'short' })}</small>
        </div>)}</div>
      </section>
      <section className="dash-panel shift-card">
        <div className="panel-heading"><div><span className="panel-icon blue"><Landmark size={17} /></span><h2>{t[11]}</h2></div></div>
        <span className={'status-chip ' + (data.openingCash === null ? 'neutral' : 'positive')}><i />{data.openingCash === null ? t[13] : t[12]}</span>
        {data.openingCash !== null && <div className="shift-line"><span>{t[14]}</span><strong>{money(data.openingCash)}</strong></div>}
        {data.currentCash != null && <div className="shift-line"><span>{lang === 'ru' ? 'Расчётные наличные' : lang === 'uz' ? 'Hisoblangan naqd pul' : 'Expected cash'}</span><strong>{money(data.currentCash)}</strong></div>}
        {data.expenses !== null && <div className="shift-line"><span>{t[15]}</span><strong>{money(data.expenses)}</strong></div>}
      </section>
      <section className="dash-panel">
        <div className="panel-heading"><div><span className="panel-icon blue"><ReceiptText size={17} /></span><h2>{t[6]}</h2></div>
          <button className="text-button" onClick={() => go(14)}>{t[20]}</button></div>
        {data.recent.length ? data.recent.map(sale => <div className="activity-row" key={sale.id}>
          <span className={'panel-icon ' + (sale.returned ? 'amber' : 'green')}><ArrowDownLeft size={17} /></span>
          <div><strong>{sale.title}</strong><small>{new Date(sale.date).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })}</small></div>
          <strong>{money(sale.total)}</strong>
        </div>) : <p className="empty-state">{t[16]}</p>}
      </section>
      <section className="dash-panel">
        <div className="panel-heading"><div><span className="panel-icon amber"><CircleAlert size={17} /></span><h2>{t[10]}</h2></div></div>
        {data.critical.slice(0, 4).map(product => <div className="stock-alert-row" key={product.id}><span>{product.name}</span><span className="status-chip warning">{product.quantity}</span></div>)}
        <button className="text-button" onClick={() => go(3)}>{t[21]}</button>
      </section>
    </div>
  </div>;
}
