export function saleTotal(lines: { price: number; quantity: number }[], discount: number) {
  const subtotal = lines.reduce((sum, { price, quantity }) => {
    const milli = Math.round(quantity * 1000);
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(milli)
      || milli <= 0 || milli > 1_000_000_000 || milli / 1000 !== quantity) {
      throw new Error('Invalid sale line');
    }
    return sum + (BigInt(price) * BigInt(milli) + 500n) / 1000n;
  }, 0n);
  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(discount)
    || discount < 0 || BigInt(discount) > subtotal) {
    throw new Error('Invalid sale amount');
  }
  return Number(subtotal - BigInt(discount));
}

export function internalBarcode() {
  return 'TVX' + crypto.randomUUID().replaceAll('-', '').toUpperCase();
}
