import { Capacitor } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import { DemoWorkspace } from './DemoWorkspace';
import { LegacyApp } from './LegacyApp';
import { Workspace } from './Workspace';
import { connectSupabase } from './supabase';
import './style.css';

const root = createRoot(document.getElementById('root')!);
const mode = new URLSearchParams(location.search).get('mode');
void (mode === 'demo' || mode === 'local' ? Promise.resolve(null) : connectSupabase()).then(supabase => {
  let hasLegacyData = false;
  try { hasLegacyData = localStorage.getItem('tovarix-v1') !== null; } catch { /* Storage is optional for the demo. */ }
  root.render(supabase ? <Workspace client={supabase} />
    : mode === 'local' || (mode !== 'demo' && hasLegacyData) ? <LegacyApp /> : <DemoWorkspace />);

}).catch(error => {
  console.error('TOVARIX configuration error', error);
  root.render(<main><h1>TOVARIX</h1><p role="alert">Sozlashda xatolik / Configuration error</p></main>);
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()
  && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA installation failed', error));
}
