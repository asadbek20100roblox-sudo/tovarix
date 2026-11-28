import { useState } from 'react';
import { Star } from 'lucide-react';
import type { Language } from './labels';
import { groups, icons, languageIndex, settingsTab } from './navigation';
import type { Access, Group } from './navigation';

const copy = {
  uz:['Vositalarni qidirish','Saralangan','Saralanganlarga qo‘shish','Saralanganlardan olib tashlash','Vosita topilmadi','START yoki yuqori tarif','Tariflar','Barcha toifalar'],
  ru:['Поиск инструментов','Избранное','Добавить в избранное','Убрать из избранного','Инструменты не найдены','Тариф START или выше','Тарифы','Все категории'],
  en:['Search tools','Favorites','Add to favorites','Remove from favorites','No tools found','START plan or higher','Plans','All categories'],
} as const;

export function FeatureHub({pages,lang,account,group,access,open,showAll,canUpgrade}:{
  pages:string[]; lang:Language; account?:string; group?:Group; access:(id:number)=>Access;
  open:(id:number)=>void; showAll:()=>void; canUpgrade:boolean;
}) {
  const t=copy[lang];
  const [search,setSearch]=useState('');
  const [favorites,setFavorites]=useState<number[]>(()=>{
    if(!account)return [];
    try {
      const saved:unknown=JSON.parse(localStorage.getItem('tovarix.tools.'+account)??'[]');
      return Array.isArray(saved)?saved.filter(id=>Number.isInteger(id)):[];
    } catch {return [];}
  });
  const title=(id:number)=>id===settingsTab?t[6]:pages[id];
  const visible=(id:number)=>Boolean(pages[id])&&access(id)!=='hidden';
  function toggle(id:number) {
    const next=favorites.includes(id)?favorites.filter(value=>value!==id):[...favorites,id];
    setFavorites(next);
    if(account)try{localStorage.setItem('tovarix.tools.'+account,JSON.stringify(next));}catch{/* Optional storage. */}
  }
  function card(id:number) {
    const Icon=icons[id];
    const favorite=favorites.includes(id);
    const locked=access(id)==='plan';
    return <article className="feature-card" key={id}>
      <button className="feature-launch" type="button" onClick={()=>open(id)}>
        <Icon size={20} aria-hidden="true"/><strong>{title(id)}</strong>
        {locked&&<small>{t[5]}</small>}
      </button>
      {locked&&canUpgrade&&<button type="button" className="feature-plans" onClick={()=>open(settingsTab)}>{t[6]}</button>}
      <button className="icon-button feature-star" type="button" aria-pressed={favorite}
        aria-label={(favorite?t[3]:t[2])+' · '+title(id)} onClick={()=>toggle(id)}>
        <Star size={17} fill={favorite?'currentColor':'none'} aria-hidden="true"/>
      </button>
    </article>;
  }
  const query=search.trim().toLocaleLowerCase(lang);
  const sections=(group?[group]:groups).map(item=>({item,ids:item.tabs.filter(id=>visible(id)&&
    (!query||title(id).toLocaleLowerCase(lang).includes(query)||item.labels[languageIndex[lang]].toLocaleLowerCase(lang).includes(query)))}))
    .filter(section=>section.ids.length);
  const pinned=favorites.filter(visible);
  return <>
    <div className="controls feature-search">
      <input type="search" aria-label={t[0]} placeholder={t[0]} value={search} onChange={e=>setSearch(e.target.value)}/>
      {group&&<button type="button" onClick={()=>{setSearch('');showAll();}}>{t[7]}</button>}
    </div>
    {!query&&!group&&pinned.length>0&&<div><h3>{t[1]}</h3><div className="feature-grid">{pinned.map(card)}</div></div>}
    {sections.map(({item,ids})=><div key={item.id}><h3>{item.labels[languageIndex[lang]]}</h3><div className="feature-grid">{ids.map(card)}</div></div>)}
    {sections.length===0&&<p role="status">{t[4]}</p>}
  </>;
}
