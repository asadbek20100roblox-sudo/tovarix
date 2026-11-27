import { useEffect, useRef, useState } from 'react';
import type { Language } from './labels';

const copy = {
  uz: ['Uskunalar', 'Kamerani tekshirish', 'To‘xtatish', 'HID tekshiruvi', 'Kodni skanerlang va Enter tugmasini bosing', 'Test sahifasini chop etish'],
  ru: ['Оборудование', 'Проверить камеру', 'Остановить', 'Проверка HID', 'Отсканируйте код и нажмите Enter', 'Печать тестовой страницы'],
  en: ['Hardware', 'Test camera', 'Stop', 'HID test', 'Scan a code and press Enter', 'Print test page'],
} as const;

export function HardwareDiagnostics({ lang }: { lang: Language }) {
  const t = copy[lang];
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const element = video.current;
    if (!active || !element) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const failed = (problem: unknown) => {
      if (disposed) return;
      setError(String(problem));
      setActive(false);
    };
    void import('./hardware').then(async ({ openScanner }) => {
      if (disposed) return;
      const handle = await openScanner(element, value => {
        if (disposed) return;
        setCode(value);
        setActive(false);
      }, failed);
      if (disposed) handle();
      else stop = handle;
    }).catch(failed);
    return () => { disposed = true; stop?.(); };
  }, [active]);

  function printTest() {
    const page = window.open('', '_blank', 'popup');
    if (!page) return;
    page.opener = null;
    page.document.title = 'TOVARIX · ' + t[5];
    const title = page.document.createElement('h1');
    title.textContent = 'TOVARIX';
    page.document.body.append(title, t[5]);
    page.print();
  }

  return <details><summary>{t[0]}</summary>
    <div className="controls">
      <button onClick={() => { setError(''); setActive(!active); }} aria-pressed={active}>{t[active ? 2 : 1]}</button>
      <button onClick={printTest}>{t[5]}</button>
      <form onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        setCode(String(new FormData(form).get('hid')).trim());
        form.reset();
      }}>
        <input name="hid" aria-label={t[3]} placeholder={t[4]} required maxLength={1024} autoComplete="off" />
      </form>
    </div>
    {active && <video ref={video} muted playsInline />}
    {code && <output>{code}</output>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
