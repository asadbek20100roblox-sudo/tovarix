import { Workbook } from 'exceljs';

type ProductRow = { name: string; barcode: string; price: number; cost: number };
const columns = [
  { header: 'name', key: 'name', width: 32 }, { header: 'barcode', key: 'barcode', width: 36 },
  { header: 'price', key: 'price', width: 16 }, { header: 'cost', key: 'cost', width: 16 },
];

export async function exportCatalog(products: (Omit<ProductRow, 'cost'> & { cost: number | null })[]) {
  const book = new Workbook();
  const sheet = book.addWorksheet('Catalog');
  sheet.columns = columns;
  sheet.addRows(products.map(({ name, barcode, price, cost }) => ({ name, barcode, price, cost })));
  const bytes = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'tovarix-catalog.xlsx';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readCatalog(file: File): Promise<ProductRow[]> {
  if (file.size > 1000000) throw new Error('Maximum workbook size: 1 MB');
  const book = new Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount > 501 || columns.some((col, i) => sheet.getCell(1, i + 1).value !== col.key)) {
    throw new Error('Expected name, barcode, price, cost columns and at most 500 products');
  }
  const products: ProductRow[] = [];
  const barcodes = new Set<string>();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const [name, barcode, price, cost] = [1, 2, 3, 4].map(i => row.getCell(i).value);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200 || typeof barcode !== 'string'
      || !barcode.trim() || barcode.trim().length > 128 || barcodes.has(barcode.trim())
      || typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0 || price > 1e12
      || typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 0 || cost > 1e12) {
      throw new Error('Invalid or duplicate product at row ' + index);
    }
    barcodes.add(barcode.trim());
    products.push({ name: name.trim(), barcode: barcode.trim(), price, cost });
  });
  if (!products.length) throw new Error('No products found');
  return products;
}
