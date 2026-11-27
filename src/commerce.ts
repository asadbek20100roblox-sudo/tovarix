export function saleTotal(lines: { price: number; quantity: number }[], discount: number) {
  const subtotal = lines.reduce((sum, { price, quantity }) => {
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error('Invalid sale line');
    }
    return sum + price * quantity;
  }, 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(discount) || discount < 0 || discount > subtotal) {
    throw new Error('Invalid sale amount');
  }
  return subtotal - discount;
}

export function internalBarcode() {
  return 'TVX' + crypto.randomUUID().replaceAll('-', '').toUpperCase();
}
