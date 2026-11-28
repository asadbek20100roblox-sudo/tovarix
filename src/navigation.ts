import { Boxes, ChartNoAxesCombined, CircleHelp, ClipboardList, Grid2X2, House, Package, ReceiptText, Settings, Sparkles, Store, Truck, Users, Wallet } from 'lucide-react';
import type { Language } from './labels';

export const groups = [
  { id:'home', icon:House, tabs:[0], labels:['Bosh sahifa','Главная','Overview'] },
  { id:'sales', icon:ReceiptText, tabs:[1,14], labels:['Savdo','Продажи','Sales'] },
  { id:'products', icon:Package, tabs:[2,3,10,7], labels:['Mahsulotlar','Товары','Products'] },
  { id:'finance', icon:Wallet, tabs:[15,12], labels:['Moliya','Финансы','Finance'] },
  { id:'analytics', icon:ChartNoAxesCombined, tabs:[11], labels:['Tahlil','Аналитика','Analytics'] },
  { id:'tools', icon:Grid2X2, tabs:[6,8,4,9,13,5], labels:['Barcha funksiyalar','Все функции','All tools'] },
] as const;
export const icons = [House,ReceiptText,Package,Boxes,Store,Settings,Users,Truck,Users,Sparkles,ClipboardList,ChartNoAxesCombined,Wallet,CircleHelp,ReceiptText,Wallet];
export const settingsTab = 5;
export const languageIndex = {uz:0,ru:1,en:2} satisfies Record<Language,number>;
export type Group = typeof groups[number];
export type Access = 'open'|'plan'|'hidden';

const requirements: Record<number,readonly string[]> = {
  1:['sell'], 6:['customer'], 7:['supplier'], 8:['staff'], 9:['ai'], 10:['inventory'],
  11:['analytics'], 12:['analytics'], 14:['sell','analytics'], 15:['customer'],
};
export function toolAccess(tab:number,owner:boolean,permissions:readonly string[],limitedToStores:boolean,purchases?:boolean):Access {
  if (!owner && (tab===9||tab===15)&&limitedToStores) return 'hidden';
  if (!owner && requirements[tab] && !requirements[tab].some(permission=>permissions.includes(permission))) return 'hidden';
  return tab===10 && purchases===false ? 'plan' : 'open';
}
