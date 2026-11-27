import { useRef } from 'react';
import { Bell, Boxes, ChartNoAxesCombined, ChevronRight, CircleHelp, ClipboardList, CreditCard, House, Menu, Package, Plus, ReceiptText, Settings, Sparkles, Store, Truck, Users, Wallet, X } from 'lucide-react';
import type { Language } from './labels';

const icons = [House, ReceiptText, Package, Boxes, Store, Settings, Users, Truck, Users, Sparkles, ClipboardList, ChartNoAxesCombined, Wallet, CircleHelp, CreditCard, Wallet];
const primary = [0, 1, 3, 11];
const navigationCopy = {
  uz: ['Menyu', 'Bildirishnomalar', 'Tez qo‘shish', 'Yopish', 'Onlayn', 'Oflayn', 'Hisobotlar', 'Hisob', 'Bildirishnomalar yo‘q'],
  ru: ['Меню', 'Уведомления', 'Быстрое добавление', 'Закрыть', 'Онлайн', 'Офлайн', 'Отчёты', 'Аккаунт', 'Уведомлений нет'],
  en: ['Menu', 'Notifications', 'Quick add', 'Close', 'Online', 'Offline', 'Reports', 'Account', 'No notifications'],
};

export function Brand() {
  return <span className="wordmark"><span className="brand-mark"><Store size={19} strokeWidth={2.15} /></span><span>TOVARIX<small>PIXELFORGE UZ</small></span></span>;
}

export function AppNavigation({ pages, tab, go, lang, profile, role, online, alerts, showStatus = true }: {
  pages: string[]; tab: number; go: (tab: number) => void; lang: Language;
  profile?: string; role?: string; online: boolean; alerts: string[]; showStatus?: boolean;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const notifications = useRef<HTMLDialogElement>(null);
  const t = navigationCopy[lang];
  const active = primary.indexOf(tab);
  function route(id: number) {
    drawer.current?.close();
    go(id);
  }
  return <>
    <header className="app-bar">
      <div className="app-bar-start">
        <button type="button" className="icon-button menu-button" aria-label={t[0]} onClick={() => drawer.current?.showModal()}><Menu size={21} /></button>
        <span className="app-section-name">{pages[tab]}</span>
      </div>
      <div className="app-bar-actions">
        {showStatus && <span className={'network-pill ' + (online ? 'is-online' : 'is-offline')}><span />{t[online ? 4 : 5]}</span>}
        <button type="button" className="icon-button bell-button" aria-label={t[1]} onClick={() => notifications.current?.showModal()}>
          <Bell size={19} />{alerts.length > 0 && <i />}
        </button>
        <button type="button" className="icon-button quick-add" aria-label={t[2]} onClick={() => route(2)}><Plus size={20} /></button>
        {profile && <span className="profile-chip"><span className="avatar">{profile.slice(0, 1).toUpperCase()}</span>
          <span><strong title={profile}>{profile}</strong><small>{role || t[7]}</small></span></span>}
      </div>
    </header>
    <dialog ref={drawer} className="menu-drawer" aria-label={t[0]} onClick={e => { if (e.target === e.currentTarget) drawer.current?.close(); }}>
      <div className="drawer-content">
        <div className="drawer-brand"><Brand /><button className="icon-button" aria-label={t[3]} onClick={() => drawer.current?.close()}><X size={22} /></button></div>
        {profile && <div className="drawer-profile"><span className="avatar">{profile[0].toUpperCase()}</span><div><strong>{profile}</strong><small>{role || t[7]}</small></div></div>}
        <nav aria-label={t[0]} className="drawer-links">{pages.map((label, id) => {
          const Icon = icons[id] ?? ClipboardList;
          return <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => route(id)}><Icon size={19} />{label}<ChevronRight className="drawer-chevron" size={15} /></button>;
        })}</nav>
      </div>
    </dialog>
    <dialog className="notice-dialog" ref={notifications} aria-label={t[1]}>
      <div className="notice-title"><h2>{t[1]}</h2><button className="icon-button" aria-label={t[3]} onClick={() => notifications.current?.close()}><X size={20} /></button></div>
      {alerts.length ? <ul>{alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul> : <p>{t[8]}</p>}
    </dialog>
    <nav className="bottom-navigation" aria-label="TOVARIX">
      <span className="nav-selection" style={{ transform: 'translateX(' + Math.max(active, 0) * 100 + '%)', opacity: active >= 0 ? 1 : 0 }} />
      {primary.map(id => {
        const Icon = icons[id];
        return <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => route(id)}>
          <Icon size={20} /><span>{id === 11 ? t[6] : pages[id]}</span>
        </button>;
      })}
      <button type="button" onClick={() => drawer.current?.showModal()}><Menu size={20} /><span>{t[0]}</span></button>
    </nav>
  </>;
}
