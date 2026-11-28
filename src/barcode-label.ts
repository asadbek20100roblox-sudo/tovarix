import { code128 } from 'bwip-js/browser';

export function renderBarcode(canvas: HTMLCanvasElement, barcode: string) {
  code128(canvas, { bcid: 'code128', text: barcode, scale: 2, height: 12, includetext: true });
}
