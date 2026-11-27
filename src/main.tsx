import { createRoot } from 'react-dom/client';
import { LegacyApp } from './LegacyApp';
import { Workspace } from './Workspace';
import { supabase } from './supabase';
import './style.css';

createRoot(document.getElementById('root')!).render(
  supabase ? <Workspace client={supabase} /> : <LegacyApp />,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && !location.origin.includes('capacitor') && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA installation failed', error));
}
