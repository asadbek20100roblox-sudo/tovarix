import assert from 'node:assert/strict';
import test from 'node:test';
import { saleTotal, internalBarcode } from '../src/commerce.ts';
import { plans } from '../src/plans.ts';

test('integral UZS totals and discounts', () => {
  assert.equal(saleTotal([{ price: 1500, quantity: 2 }, { price: 2200, quantity: 1 }], 200), 5000);
  assert.throws(() => saleTotal([{ price: 1500, quantity: 1 }], 1501));
  assert.throws(() => saleTotal([{ price: 1500, quantity: 0 }], 0));
  assert.throws(() => saleTotal([{ price: Number.MAX_SAFE_INTEGER, quantity: 2 }], 0));
});

test('internal codes are unique and Code 128-compatible', () => {
  const codes = Array.from({ length: 100 }, internalBarcode);
  assert.equal(new Set(codes).size, 100);
  assert.match(codes[0], /^TVX[A-F0-9]{32}$/);
});

test('published tariffs match the approved values', () => {
  assert.deepEqual(plans.map(p => [p.id, p.monthly, p.yearly, p.employees]), [
    ['FREE', 0, 0, 0], ['START', 39000, 449000, 0], ['STANDARD', 119000, 1299000, 3],
    ['PLUS', 249000, 2599000, 10], ['PRO', 599000, 5999000, 50], ['PREMIUM', 1219000, 10999000, null],
  ]);
});

test('weighted lines round individually to whole UZS, half up', () => {
  assert.equal(saleTotal([{ price: 5, quantity: 0.5 }, { price: 5, quantity: 0.5 }], 0), 6);
  assert.throws(() => saleTotal([{ price: 5, quantity: 0.0005 }], 0));
});
