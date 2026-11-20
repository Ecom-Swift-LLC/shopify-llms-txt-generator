'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lintLlmsTxt } = require('../lib/lint');
const { main, parseArgs } = require('../bin/lltx');
const { createMockStore } = require('../samples/mock-store');

const rules = (text) => lintLlmsTxt(text).findings.map((f) => f.rule);

const GOOD = '# Shop\n\n> A shop.\n\n## Products\n\n- [Tote](https://shop.example/products/tote): canvas\n';

test('a well-formed file has no findings', () => {
  assert.deepEqual(lintLlmsTxt(GOOD).findings, []);
});

test('empty input and a missing H1 are errors', () => {
  assert.deepEqual(rules(''), ['empty-file']);
  assert.ok(rules('Just text\n\n> s\n\n## A\n\n- [x](https://a.b)').includes('title-first'));
});

test('second H1 is an error; code fences are ignored', () => {
  assert.ok(rules(GOOD + '\n# Another\n').includes('single-h1'));
  assert.equal(lintLlmsTxt(GOOD + '\n```\n# not a heading\n- [x](rel)\n```\n').errors, 0);
});

test('relative URLs are errors, http and duplicates are warnings', () => {
  const r = lintLlmsTxt('# S\n\n> s\n\n## A\n\n- [a](/products/a)\n- [b](http://x.y/b)\n- [c](https://x.y/c)\n- [d](https://x.y/c)\n');
  assert.deepEqual(r.findings.map((f) => f.rule), ['absolute-url', 'https', 'duplicate-url']);
  assert.equal(r.errors, 1);
  assert.equal(r.warnings, 2);
});

test('missing summary, empty section and malformed items warn', () => {
  const r = lintLlmsTxt('# S\n\n## Empty\n\n## Items\n\n- plain text item\n- [](https://a.b)\n');
  assert.deepEqual(r.findings.map((f) => f.rule).sort(), ['empty-label', 'empty-section', 'link-format', 'summary']);
});

test('an oversized file warns', () => {
  const big = GOOD + Array.from({ length: 2500 }, (_, i) => `- [P${i}](https://shop.example/products/p${i}): ${'x'.repeat(40)}`).join('\n');
  assert.ok(rules(big).includes('size'));
});

test('parseArgs handles flags, values and rejects unknown options', () => {
  const a = parseArgs(['generate', 'shop.com', '--out', 'o', '--full', '--limit', '5']);
  assert.deepEqual(a._, ['generate', 'shop.com']);
  assert.deepEqual(a.opts, { out: 'o', full: true, limit: '5' });
  assert.throws(() => parseArgs(['generate', '--bogus']), /Unknown option/);
  assert.throws(() => parseArgs(['generate', 'x', '--out']), /needs a value/);
});

function capture() {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

test('CLI generate writes llms.txt, llms-full.txt and page.llms.liquid', async () => {
  const mock = await createMockStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lltx-'));
  try {
    const c = capture();
    const code = await main(['generate', mock.origin, '--out', dir, '--full', '--liquid'], c.io);
    assert.equal(code, 0);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['llms-full.txt', 'llms.txt', 'page.llms.liquid']);
    assert.match(c.out.join('\n'), /Acme Goods: 7 product\(s\), 2 collection\(s\)/);
    // the generated file passes its own linter
    const lintOut = capture();
    assert.equal(await main(['lint', path.join(dir, 'llms.txt')], lintOut.io), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await mock.close();
  }
});

test('CLI generate --stdout prints and writes nothing', async () => {
  const mock = await createMockStore();
  try {
    const c = capture();
    assert.equal(await main(['generate', mock.origin, '--stdout', '--limit', '2'], c.io), 0);
    assert.match(c.out[0], /^# Acme Goods/);
    assert.equal((c.out[0].match(/\/products\//g) || []).length, 2);
  } finally {
    await mock.close();
  }
});

test('CLI lint returns 1 on errors, 0 when clean, 2 on usage problems', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lltx-'));
  try {
    const bad = path.join(dir, 'bad.txt');
    fs.writeFileSync(bad, '# S\n\n> s\n\n## A\n\n- [a](/relative)\n');
    assert.equal(await main(['lint', bad], capture().io), 1);
    const good = path.join(dir, 'good.txt');
    fs.writeFileSync(good, GOOD);
    assert.equal(await main(['lint', good], capture().io), 0);
    assert.equal(await main(['lint'], capture().io), 2);
    assert.equal(await main(['nope'], capture().io), 2);
    assert.equal(await main(['generate', 'x', '--limit', '0'], capture().io), 2);
    assert.equal(await main([], capture().io), 2);
    assert.equal(await main(['--help'], capture().io), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI lint can read a URL', async () => {
  const http = require('node:http');
  const srv = http.createServer((req, res) => res.end(GOOD));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    assert.equal(await main(['lint', `http://127.0.0.1:${srv.address().port}/llms.txt`], capture().io), 0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
