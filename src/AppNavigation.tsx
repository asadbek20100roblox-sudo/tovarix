import { useRef, useState } from 'react';
import { Bell, Menu, Plus, Store, X } from 'lucide-react';
import type { Language } from './labels';
import { FeatureHub } from './FeatureHub';
import { groups, icons, languageIndex, settingsTab } from './navigation';
import type { Access, Group } from './navigation';

const navigationCopy = {
  uz: ['Menyu', 'Bildirishnomalar', 'Tez qo‘shish', 'Yopish', 'Onlayn', 'Oflayn', 'Hisobotlar', 'Hisob', 'Bildirishnomalar yo‘q'],
  ru: ['Меню', 'Уведомления', 'Быстрое добавление', 'Закрыть', 'Онлайн', 'Офлайн', 'Отчёты', 'Аккаунт', 'Уведомлений нет'],
  en: ['Menu', 'Notifications', 'Quick add', 'Close', 'Online', 'Offline', 'Reports', 'Account', 'No notifications'],
};

export function Brand() {
  return <span className="wordmark"><span className="brand-mark"><Store size={19} strokeWidth={2.15} /></span><span>TOVARIX<small>PIXELFORGE UZ</small></span></span>;
}

export function AppNavigation({ pages, tab, go, lang, profile, role, online, alerts, showStatus = true, desktop = false, account, access = () => 'open', canUpgrade = false }: {
  pages: string[]; tab: number; go: (tab: number) => void; lang: Language;
  profile?: string; role?: string; online: boolean; alerts: string[]; showStatus?: boolean; desktop?: boolean; account?: string; access?: (id:number)=>Access; canUpgrade?: boolean;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const notifications = useRef<HTMLDialogElement>(null);
  const t = navigationCopy[lang];
  const SettingsIcon=icons[settingsTab];
  const hub=useRef<HTMLDialogElement>(null);
  const [hubGroup,setHubGroup]=useState<Group>();
  const [hubSession,setHubSession]=useState(0);
  const active=tab===settingsTab?undefined:groups.find(group=>group.tabs.some(id=>id===tab));
  const label=(group:Group)=>group.labels[languageIndex[lang]];
  const hubTitle=label(hubGroup??groups[5]);
  const more={uz:'Yana',ru:'Ещё',en:'More'}[lang];
  function route(id:number) {
    if(access(id)==='hidden'||!pages[id])return;
    drawer.current?.close();
    hub.current?.close();
    go(id);
  }
  function showHub(group?:Group) {
    drawer.current?.close();
    setHubGroup(group);
    setHubSession(value=>value+1);
    hub.current?.showModal();
  }
  function mainItems() {
    return groups.map(group=>{
      const Icon=group.icon;
      return <button type="button" key={group.id} aria-current={active===group?'page':undefined}
        onClick={()=>group.id==='home'?route(0):showHub(group.id==='tools'?undefined:group)}>
        <Icon size={18}/>{label(group)}
      </button>;
    });
  }
  const shortcuts=[
    {group:groups[0],id:0,title:label(groups[0])},
    {group:groups[1],id:1,title:pages[1]},
    {group:groups[2],id:2,title:label(groups[2])},
    {group:groups[3],id:groups[3].tabs.find(id=>pages[id]&&access(id)==='open'),title:label(groups[3])},
  ];
  return <>
    <header className="app-bar">
      <div className="app-bar-start">
        <button type="button" className="icon-button menu-button" aria-label={t[0]} onClick={() => drawer.current?.showModal()}><Menu size={21} /></button>
        <span className="app-section-name">{active&&active.id!=='home'&&label(active)!==pages[tab]?label(active)+' / ':''}{pages[tab]}</span>
      </div>
      <div className="app-bar-actions">
        {showStatus && <span className={'network-pill ' + (online ? 'is-online' : 'is-offline')}><span />{t[online ? 4 : 5]}</span>}
        <button type="button" className="icon-button bell-button" aria-label={t[1]} onClick={() => notifications.current?.showModal()}>
          <Bell size={19} />{alerts.length > 0 && <i />}
        </button>
        {access(2)==='open'&&<button type="button" className="icon-button quick-add" aria-label={t[2]} onClick={() => route(2)}><Plus size={20} /></button>}
        {profile && <span className="profile-chip"><span className="avatar">{profile.slice(0, 1).toUpperCase()}</span>
          <span><strong title={profile}>{profile}</strong><small>{role || t[7]}</small></span></span>}
      </div>
    </header>
    <dialog ref={drawer} className="menu-drawer" aria-label={t[0]} onClick={e => { if (e.target === e.currentTarget) drawer.current?.close(); }}>
      <div className="drawer-content">
        <div className="drawer-brand"><Brand /><button className="icon-button" aria-label={t[3]} onClick={() => drawer.current?.close()}><X size={22} /></button></div>
        {profile && <div className="drawer-profile"><span className="avatar">{profile[0].toUpperCase()}</span><div><strong>{profile}</strong><small>{role || t[7]}</small></div></div>}
        <nav aria-label={t[0]} className="drawer-links">{mainItems()}
          <button type="button" className="navigation-settings" aria-current={tab===settingsTab?'page':undefined} onClick={()=>route(settingsTab)}>
            <SettingsIcon size={18}/>{pages[settingsTab]}
          </button>
        </nav>
      </div>
    </dialog>
    <dialog className="notice-dialog" ref={notifications} aria-label={t[1]}>
      <div className="notice-title"><h2>{t[1]}</h2><button className="icon-button" aria-label={t[3]} onClick={() => notifications.current?.close()}><X size={20} /></button></div>
      {alerts.length ? <ul>{alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul> : <p>{t[8]}</p>}
    </dialog>
    <dialog ref={hub} className="feature-hub" aria-labelledby="feature-hub-title">
      <header className="notice-title"><h2 id="feature-hub-title">{hubTitle}</h2>
        <button type="button" className="icon-button" aria-label={t[3]} onClick={()=>hub.current?.close()}><X size={20}/></button>
      </header>
      {hubSession>0&&<FeatureHub key={hubSession} {...{pages,lang,account,access,canUpgrade}} group={hubGroup} open={route} showAll={()=>setHubGroup(undefined)}/>}
    </dialog>
    {desktop&&<nav className="desktop-navigation" aria-label="TOVARIX">
      <Brand/>{mainItems()}
      <button type="button" className="navigation-settings" aria-current={tab===settingsTab?'page':undefined} onClick={()=>route(settingsTab)}>
        <SettingsIcon size={18}/>{pages[settingsTab]}
      </button>
    </nav>}
    <nav className="bottom-navigation" aria-label="TOVARIX">
      {shortcuts.map(({group,id,title})=>{
        const Icon=group.icon;
        return <button type="button" key={group.id} aria-current={active===group?'page':undefined}
          onClick={()=>id!==undefined&&access(id)==='open'?route(id):showHub(group)}>
          <Icon size={20}/><span>{title}</span>
        </button>;
      })}
      <button type="button" aria-current={!shortcuts.some(item=>item.group===active)?'page':undefined} onClick={()=>showHub()}>
        <Menu size={20}/><span>{more}</span>
      </button>
    </nav>
  </>;
}
