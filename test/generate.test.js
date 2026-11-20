'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripHtml, truncate, mdLabel } = require('../lib/text');
const { buildLlmsTxt, buildLlmsFull, buildLiquidTemplate, formatPrice } = require('../lib/generate');
const { lintLlmsTxt } = require('../lib/lint');
const { loadStore, normalizeOrigin, parseHome } = require('../lib/source');
const { createMockStore } = require('../samples/mock-store');

const fixed = { now: () => new Date('2026-11-20T12:00:00Z') };

test('stripHtml removes tags, scripts and decodes entities', () => {
  assert.equal(stripHtml('<p>12&nbsp;oz &amp; &quot;heavy&quot;</p><script>x()</script><p>Two</p>'), '12 oz & "heavy" Two');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml('&#8364;5 &#x41;'), '€5 A');
});

test('truncate prefers a sentence, then a word, and leaves short text alone', () => {
  assert.equal(truncate('Short.', 50), 'Short.');
  assert.equal(truncate('First sentence here. Second sentence runs on and on.', 30), 'First sentence here.');
  assert.equal(truncate('alpha beta gamma delta epsilon', 14), 'alpha beta…');
});

test('mdLabel escapes square brackets', () => {
  assert.equal(mdLabel('Linen [Natural] Tote'), 'Linen \\[Natural\\] Tote');
});

test('formatPrice shows a range as "from" and handles missing prices', () => {
  assert.equal(formatPrice({ variants: [{ price: '24.00' }, { price: '28.00' }] }, 'USD'), 'from 24.00 USD');
  assert.equal(formatPrice({ variants: [{ price: '24' }] }, ''), '24.00');
  assert.equal(formatPrice({ variants: [] }, 'USD'), '');
});

test('normalizeOrigin accepts bare domains and URLs, rejects junk', () => {
  assert.equal(normalizeOrigin('my-store.myshopify.com'), 'https://my-store.myshopify.com');
  assert.equal(normalizeOrigin('http://127.0.0.1:3000/anything'), 'http://127.0.0.1:3000');
  assert.throws(() => normalizeOrigin(''), /required/);
  assert.throws(() => normalizeOrigin('http://'), /not a valid/);
});

test('parseHome prefers og:site_name and reads the description', () => {
  const h = parseHome('<title>A &amp; B – Shop</title><meta name="description" content="Hello &amp; welcome"><meta property="og:site_name" content="A and B">');
  assert.deepEqual(h, { name: 'A and B', description: 'Hello & welcome' });
  assert.equal(parseHome('<title>Only Title</title>').name, 'Only Title');
});

test('loadStore + buildLlmsTxt against a local mock store produce a lint-clean file', async () => {
  const mock = await createMockStore();
  try {
    const store = await loadStore(mock.origin, { limit: 100 });
    assert.equal(store.name, 'Acme Goods');
    assert.equal(store.currency, 'USD');
    assert.equal(store.products.length, 7);
    assert.equal(store.collections.length, 2);
    assert.deepEqual(store.policies.map((p) => p.label), ['Refund policy', 'Privacy policy']);

    const txt = buildLlmsTxt(store, fixed);
    assert.match(txt, /^# Acme Goods\n\n> Durable canvas and linen bags/);
    assert.match(txt, /\[Linen \\\[Natural\\\] Tote\]\(http:\/\/127\.0\.0\.1:\d+\/products\/linen-natural-tote\)/);
    assert.match(txt, /from 24\.00 USD, Acme Goods, Bags — Heavy 12 oz canvas\. Fits a 15" laptop\./);
    assert.doesNotMatch(txt, /alert\(1\)/);
    assert.match(txt, /## Optional/);

    // http:// origin on localhost is a warning, never an error
    const result = lintLlmsTxt(txt);
    assert.equal(result.errors, 0);
  } finally {
    await mock.close();
  }
});

test('loadStore paginates and honours --limit', async () => {
  const mock = await createMockStore();
  try {
    const store = await loadStore(mock.origin, { limit: 3 });
    assert.equal(store.products.length, 3);
    const full = await loadStore(mock.origin, { limit: 250 });
    assert.equal(full.products.length, 7);
    assert.ok(mock.hits.some((h) => h.startsWith('/products.json?limit=3&page=1')));
  } finally {
    await mock.close();
  }
});

test('loadStore keeps going when collections and /cart.js are missing', async () => {
  const mock = await createMockStore({ cartJson: false, collectionsJson: false });
  try {
    const store = await loadStore(mock.origin, {});
    assert.equal(store.currency, '');
    assert.equal(store.collections.length, 0);
    assert.equal(store.warnings.length, 2);
    assert.doesNotMatch(buildLlmsTxt(store, fixed), /USD/);
    assert.doesNotMatch(buildLlmsTxt(store, fixed), /## Collections/);
  } finally {
    await mock.close();
  }
});

test('loadStore explains a password-protected store', async () => {
  const mock = await createMockStore({ password: true });
  try {
    await assert.rejects(loadStore(mock.origin, {}), /password-protected/);
  } finally {
    await mock.close();
  }
});

test('overrides and --no-prices are respected', async () => {
  const mock = await createMockStore();
  try {
    const store = await loadStore(mock.origin, { name: 'Custom', description: 'My summary' });
    const txt = buildLlmsTxt(store, { ...fixed, prices: false });
    assert.match(txt, /^# Custom\n\n> My summary/);
    assert.doesNotMatch(txt, /24\.00/);
  } finally {
    await mock.close();
  }
});

test('buildLlmsFull includes variants, sold-out flags and the snapshot date', async () => {
  const mock = await createMockStore();
  try {
    const store = await loadStore(mock.origin, {});
    const full = buildLlmsFull(store, fixed);
    assert.match(full, /Snapshot generated 2026-11-20\./);
    assert.match(full, /- Black — 28\.00 USD \(sold out\)/);
    assert.match(full, /Machine washable\. Made in Portugal\./);
  } finally {
    await mock.close();
  }
});

test('buildLiquidTemplate wraps text in layout none + raw and neutralises raw tags', () => {
  const out = buildLiquidTemplate('# T\n{{ product.title }} {% endraw %} injected');
  assert.ok(out.startsWith('{% layout none %}{% raw %}'));
  assert.ok(out.trimEnd().endsWith('{% endraw %}'));
  assert.equal((out.match(/endraw/g) || []).length, 1);
});

test('collections: empty ones are skipped, fullest first, capped by collectionLimit', () => {
  const store = {
    origin: 'https://s.example', name: 'S', description: '', currency: '', products: [], policies: [],
    collections: [
      { title: 'Empty', handle: 'empty', products_count: 0 },
      { title: 'Small', handle: 'small', products_count: 2 },
      { title: 'Big', handle: 'big', products_count: 40 },
      { title: 'Unknown count', handle: 'unk' },
    ],
  };
  const txt = buildLlmsTxt(store, fixed);
  assert.doesNotMatch(txt, /Empty/);
  assert.ok(txt.indexOf('[Big]') < txt.indexOf('[Small]'));
  const capped = buildLlmsTxt(store, { ...fixed, collectionLimit: 1 });
  assert.match(capped, /\[Big\]/);
  assert.doesNotMatch(capped, /Small/);
  assert.doesNotMatch(buildLlmsTxt(store, { ...fixed, collectionLimit: 0 }), /## Collections/);
});
