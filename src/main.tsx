import { Capacitor } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import { LegacyApp } from './LegacyApp';
import { Workspace } from './Workspace';
import { connectSupabase } from './supabase';
import './style.css';

const root = createRoot(document.getElementById('root')!);
const demo = new URLSearchParams(location.search).get('mode') === 'demo';
void (demo ? Promise.resolve(null) : connectSupabase()).then(supabase => {
  root.render(supabase ? <Workspace client={supabase} /> : <LegacyApp demo={demo} />);
}).catch(error => {
  console.error('TOVARIX configuration error', error);
  root.render(<main><h1>TOVARIX</h1><p role="alert">Sozlashda xatolik / Configuration error</p></main>);
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()
  && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA installation failed', error));
}
