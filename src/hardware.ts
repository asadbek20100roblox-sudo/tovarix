import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, ChecksumException, DecodeHintType, FormatException, NotFoundException } from '@zxing/library';

export async function openScanner(video: HTMLVideoElement, onCode: (code: string) => void, onError: (error: unknown) => void) {
  const formats = [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
  ];
  const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, formats]]));
  const controls = await reader.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false }, video,
    (result, error, active) => {
      if (result) { active.stop(); onCode(result.getText()); }
      else if (error && !(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
        active.stop(); onError(error);
      }
    },
  );
  return () => controls.stop();
}

export interface StoreHardware {
  printReceipt(document: { text: string; widthMm: 58 | 80 }): Promise<void>;
  weigh?(): Promise<{ value: number; unit: 'kg' }>;
  openDrawer?(): Promise<void>;
}

export interface FiscalProvider {
  issueReceipt(saleId: string, requestId: string): Promise<{
    officialId: string; provider: string; verificationUrl?: string;
  }>;
}
