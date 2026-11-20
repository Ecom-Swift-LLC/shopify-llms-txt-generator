#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadStore } = require('../lib/source');
const { buildLlmsTxt, buildLlmsFull, buildLiquidTemplate } = require('../lib/generate');
const { lintLlmsTxt } = require('../lib/lint');

const HELP = `lltx - generate and lint llms.txt for a Shopify store

Usage:
  lltx generate <store> [options]   Read the public storefront and write llms.txt
  lltx lint <file|url>              Check an llms.txt against the llmstxt.org layout

generate options:
  --out <dir>          Output folder (default: ./out)
  --limit <n>          Max products to list (default: 100)
  --full               Also write llms-full.txt (full descriptions and variants)
  --liquid             Also write page.llms.liquid, a Shopify page template for llms.txt
  --collections <n>    Max collections to list, fullest first, empty ones skipped (default: 25)
  --no-prices          Leave prices out
  --name <text>        Override the store name
  --description <text> Override the one-line summary
  --stdout             Print llms.txt instead of writing files

<store> is a domain ("my-store.myshopify.com", "shop.example.com") or a full URL.
Exit codes: 0 ok, 1 lint errors found, 2 usage or network error.
`;

function parseArgs(argv) {
  const flags = new Set(['--full', '--liquid', '--no-prices', '--stdout', '--help', '-h']);
  const withValue = new Set(['--out', '--limit', '--collections', '--name', '--description']);
  const args = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) args.opts[a.replace(/^-+/, '')] = true;
    else if (withValue.has(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value.`);
      args.opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith('-')) throw new Error(`Unknown option ${a}.`);
    else args._.push(a);
  }
  return args;
}

async function generate(args, io) {
  const target = args._[1];
  if (!target) throw new Error('generate needs a store domain or URL.');
  const limit = args.opts.limit === undefined ? 100 : Number(args.opts.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive whole number.');

  const store = await loadStore(target, { limit, name: args.opts.name, description: args.opts.description });
  const collections = args.opts.collections === undefined ? 25 : Number(args.opts.collections);
  if (!Number.isInteger(collections) || collections < 0) throw new Error('--collections must be a whole number, 0 or more.');
  const gen = { prices: !args.opts['no-prices'], collectionLimit: collections };
  const txt = buildLlmsTxt(store, gen);

  for (const w of store.warnings) io.err(`note: ${w}`);
  if (args.opts.stdout) {
    io.out(txt);
    return 0;
  }

  const outDir = path.resolve(args.opts.out || 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const put = (name, content) => {
    fs.writeFileSync(path.join(outDir, name), content);
    written.push(name);
  };
  put('llms.txt', txt);
  if (args.opts.full) put('llms-full.txt', buildLlmsFull(store, gen));
  if (args.opts.liquid) put('page.llms.liquid', buildLiquidTemplate(txt));

  io.out(`${store.name}: ${store.products.length} product(s), ${store.collections.length} collection(s), ${store.policies.length} polic(ies).`);
  io.out(`Wrote ${written.join(', ')} to ${outDir}`);
  return 0;
}

async function lint(args, io) {
  const target = args._[1];
  if (!target) throw new Error('lint needs a file path or URL.');
  let text;
  if (/^https?:\/\//i.test(target)) {
    const res = await fetch(target, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${target} returned HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = fs.readFileSync(target, 'utf8');
  }
  const result = lintLlmsTxt(text);
  for (const f of result.findings) io.out(`${f.severity.toUpperCase().padEnd(7)} line ${f.line}  [${f.rule}] ${f.message}`);
  io.out(`${result.errors} error(s), ${result.warnings} warning(s).`);
  return result.errors > 0 ? 1 : 0;
}

async function main(argv, io = { out: console.log, err: console.error }) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.opts.help || args.opts.h || args._.length === 0) {
      io.out(HELP);
      return args._.length === 0 && !args.opts.help && !args.opts.h ? 2 : 0;
    }
    const cmd = args._[0];
    if (cmd === 'generate') return await generate(args, io);
    if (cmd === 'lint') return await lint(args, io);
    throw new Error(`Unknown command "${cmd}".`);
  } catch (err) {
    io.err(`error: ${err.message}`);
    return 2;
  }
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
