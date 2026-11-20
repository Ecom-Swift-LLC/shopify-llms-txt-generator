# shopify-llms-txt-generator

A zero-dependency Node.js CLI that reads a Shopify store's **public** storefront data and writes an [`llms.txt`](https://llmstxt.org) for it — plus a Shopify page template to publish it, and a linter to check any `llms.txt` you already have.

> Built free by [Ecom Swift LLC](https://www.ecomswiftllc.com/free-tools?utm_source=github&utm_medium=repo&utm_campaign=shopify-llms-txt-generator). Want to know how your store looks to search and AI assistants? [Run a free store audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-llms-txt-generator).

## What `llms.txt` is, and what it is not

`llms.txt` is a community proposal: a short Markdown file at the root of a site that gives a language model a clean, curated list of the pages that matter, instead of making it dig through navigation and scripts. The layout is an H1 with the site name, a one-line `>` summary, and `##` sections of `- [label](url): notes` links.

Be realistic about it. **No major AI provider has committed to reading `llms.txt`**, and Shopify does not generate one for you. Think of it as a cheap, harmless file that costs little to publish and may help tools that do look for it — not as a ranking lever. Your product structured data, your `robots.txt` and your sitemap matter far more for AI shopping surfaces (see [shopify-ai-shopping-readiness](https://github.com/Ecom-Swift-LLC/shopify-ai-shopping-readiness)).

## Example

```
$ lltx generate acme-goods.example --out out --full --liquid
Acme Goods: 7 product(s), 2 collection(s), 2 polic(ies).
Wrote llms.txt, llms-full.txt, page.llms.liquid to /home/you/out
```

`out/llms.txt`:

```markdown
# Acme Goods

> Durable canvas and linen bags, made in small batches.

## Collections

- [Totes](https://acme-goods.example/collections/totes): Everyday carry bags.

## Products

- [Canvas Tote 1](https://acme-goods.example/products/canvas-tote-1): from 24.00 USD, Acme Goods, Bags — Heavy 12 oz canvas. Fits a 15" laptop. Machine washable. Made in Portugal.
- [Canvas Tote 2](https://acme-goods.example/products/canvas-tote-2): 24.00 USD, Acme Goods, Bags — Tote number 2.

## Policies

- [Refund policy](https://acme-goods.example/policies/refund-policy)
- [Privacy policy](https://acme-goods.example/policies/privacy-policy)

## Optional

- [Sitemap](https://acme-goods.example/sitemap.xml): every public page, product and collection URL
```

(The example store is the local mock in `samples/mock-store.js`; the URLs above are rewritten to a placeholder domain.)

> Not sure what else is holding back how AI assistants and search engines see your store? Our [free audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-llms-txt-generator) covers structured data, speed, SEO and AI visibility in one report.

## Install

```bash
git clone https://github.com/Ecom-Swift-LLC/shopify-llms-txt-generator.git
cd shopify-llms-txt-generator
npm link   # or run: node bin/lltx.js ...
```

Node.js 18+. No `npm install` needed.

## Usage

```bash
lltx generate my-store.myshopify.com                 # writes ./out/llms.txt
lltx generate shop.example.com --limit 200 --full    # also writes llms-full.txt
lltx generate shop.example.com --liquid              # also writes page.llms.liquid
lltx generate shop.example.com --stdout --no-prices  # print, without prices
lltx lint out/llms.txt                               # check a file
lltx lint https://shop.example.com/llms.txt          # check a live URL
```

| Option | Meaning |
| --- | --- |
| `--out <dir>` | Output folder (default `./out`) |
| `--limit <n>` | Max products listed (default 100) |
| `--collections <n>` | Max collections listed, fullest first, empty ones skipped (default 25, `0` for none) |
| `--full` | Also write `llms-full.txt`: full plain-text descriptions and variants |
| `--liquid` | Also write `page.llms.liquid` (see below) |
| `--no-prices` | Leave prices out |
| `--name`, `--description` | Override the store name or summary read from the home page |
| `--stdout` | Print `llms.txt` instead of writing files |

## Publishing it on Shopify

Shopify cannot serve an arbitrary file at `/llms.txt`, so the usual route is a page plus a redirect:

1. Run `lltx generate <store> --liquid`, then copy `out/page.llms.liquid` into your theme as `templates/page.llms.liquid`. It starts with `{% layout none %}` so the theme header and footer are not wrapped around the text, and the text sits inside `{% raw %}` so nothing in a product description is read as Liquid.
2. In **Online Store → Pages**, add a page with the handle `llms-txt` and choose the `page.llms` template.
3. In **Online Store → Navigation → URL redirects**, redirect `/llms.txt` to `/pages/llms-txt`.
4. Check it: `curl -sIL https://your-store.com/llms.txt`, then `lltx lint https://your-store.com/llms.txt`.

Know the limits of this route: Shopify serves the page as `text/html`, not `text/plain`, and the file is a **snapshot**. Re-run the generator and paste the new template whenever your catalogue changes meaningfully (a weekly or monthly scheduled job is plenty). If you need a true `text/plain` file, host it on a CDN or a subdomain you control.

## What the generator reads

All from public storefront endpoints, no API key and no app install:

- `/products.json` (paginated) — title, handle, vendor, type, description, variant prices and availability
- `/collections.json` — title, handle, description, product count
- `/cart.js` — the store currency
- the home page — store name (`og:site_name` or `<title>`) and meta description
- `/policies/*` — a link is listed only if the page exists

## What the linter checks

| Rule | Severity |
| --- | --- |
| first line is an H1; exactly one H1 | error |
| every link is an absolute `http(s)` URL | error |
| `https` rather than `http`; duplicate URLs | warning |
| a `>` summary after the title; no empty sections; list items shaped `- [label](url): notes`; no empty labels | warning |
| file larger than 100 KB (put long text in `llms-full.txt`) | warning |

Exit code `1` when there are errors, so it works in CI.

## What it does NOT do

- It does not make AI assistants cite or rank you. See the note at the top.
- It cannot see anything behind a password page, in a draft, or unpublished from the Online Store channel.
- It does not read metafields, reviews or inventory counts — only what `/products.json` exposes. Availability is a point-in-time snapshot.
- `/products.json` and `/collections.json` can be disabled or restricted by a theme, app or proxy; the tool tells you and stops (for products) or skips (for collections).
- Collection lists often include campaign or internal collections. Read the output once and edit it, or use `--collections` to trim it.
- It does not check that every listed URL still resolves; run [shopify-link-checker](https://github.com/Ecom-Swift-LLC/shopify-link-checker) for that.
- It reads one store at a time and never writes to a store.

## As a library

```js
const { loadStore } = require('./lib/source');
const { buildLlmsTxt } = require('./lib/generate');
const { lintLlmsTxt } = require('./lib/lint');

const store = await loadStore('shop.example.com', { limit: 50 });
const text = buildLlmsTxt(store, { prices: false });
console.log(lintLlmsTxt(text)); // { findings, errors, warnings }
```

## Tests

```bash
npm test   # node --test, 25 tests, run against a local mock storefront (no network needed)
```

## Related Shopify tools

- [shopify-ai-shopping-readiness](https://github.com/Ecom-Swift-LLC/shopify-ai-shopping-readiness) — audit product schema and AI-crawler access in `robots.txt`
- [shopify-structured-data-validator](https://github.com/Ecom-Swift-LLC/shopify-structured-data-validator) — validate the JSON-LD on your pages
- [shopify-robots-txt-auditor](https://github.com/Ecom-Swift-LLC/shopify-robots-txt-auditor) — check `robots.txt` rules
- [shopify-sitemap-auditor](https://github.com/Ecom-Swift-LLC/shopify-sitemap-auditor) — audit the sitemap this file points to
- [shopify-link-checker](https://github.com/Ecom-Swift-LLC/shopify-link-checker) — find broken links on a page
- [shopify-audit-mcp](https://github.com/Ecom-Swift-LLC/shopify-audit-mcp) — connect an AI assistant to our store audit

## Want this handled for you?

We build and maintain Shopify stores at [Ecom Swift LLC](https://www.ecomswiftllc.com?utm_source=github&utm_medium=repo&utm_campaign=shopify-llms-txt-generator) — SEO, speed, structured data and conversion work. Start with a [free store audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-llms-txt-generator), or browse our [free tools](https://www.ecomswiftllc.com/free-tools?utm_source=github&utm_medium=repo&utm_campaign=shopify-llms-txt-generator).

## License

MIT © Ecom Swift LLC
