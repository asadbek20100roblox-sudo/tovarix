import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';

const source = 'dist-single/TOVARIX.html';
const files = await readdir('dist-single');
const html = await readFile(source, 'utf8');
if (files.length !== 1 || /<(?:script|link|img)\b[^>]*\b(?:src|href)=["'](?!data:)/i.test(html)
  || !html.includes('<style') || !html.includes('<script')) {
  throw new Error('Standalone build must consist of one HTML file with embedded scripts and styles');
}
await mkdir('dist/downloads', { recursive: true });
await copyFile(source, 'dist/downloads/TOVARIX.html');
