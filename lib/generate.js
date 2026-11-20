'use strict';

const { stripHtml, truncate, mdLabel, mdUrl } = require('./text');

function productUrl(origin, handle) {
  return `${origin}/products/${mdUrl(encodeURIComponent(handle))}`;
}

function collectionUrl(origin, handle) {
  return `${origin}/collections/${mdUrl(encodeURIComponent(handle))}`;
}

/** "19.00 USD", "from 19.00 USD" or "" when no variant has a numeric price. */
function formatPrice(product, currency) {
  const prices = (product.variants || []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
  if (prices.length === 0) return '';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const suffix = currency ? ' ' + currency : '';
  return (min === max ? '' : 'from ') + min.toFixed(2) + suffix;
}

function entry(label, url, details) {
  return `- [${mdLabel(label)}](${url})` + (details ? `: ${details}` : '');
}

function productDetails(p, store, opts) {
  const meta = [opts.prices ? formatPrice(p, store.currency) : '', p.vendor, p.product_type]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ');
  const desc = truncate(stripHtml(p.body_html), opts.descriptionLength);
  return [meta, desc].filter(Boolean).join(' — ');
}

const DEFAULTS = { prices: true, collectionLimit: 25, descriptionLength: 160, fullDescriptionLength: 1500, now: () => new Date() };

/**
 * Build llms.txt following the llmstxt.org layout: an H1, a blockquote summary,
 * then H2 sections that each hold a list of `- [label](url): notes` links.
 */
function buildLlmsTxt(store, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const lines = [`# ${store.name}`, ''];
  if (store.description) lines.push(`> ${store.description}`, '');

  // Real stores often expose hundreds of collections, many empty or campaign-only.
  // Drop the empty ones, list the fullest first, and cap the list.
  const collections = store.collections
    .filter((c) => c.handle && c.title && c.products_count !== 0)
    .sort((a, b) => (b.products_count || 0) - (a.products_count || 0))
    .slice(0, opts.collectionLimit);
  if (collections.length > 0) {
    lines.push('## Collections', '');
    for (const c of collections) {
      const desc = truncate(stripHtml(c.body_html), opts.descriptionLength);
      lines.push(entry(c.title, collectionUrl(store.origin, c.handle), desc));
    }
    lines.push('');
  }

  const products = store.products.filter((p) => p.handle && p.title);
  if (products.length > 0) {
    lines.push('## Products', '');
    for (const p of products) {
      lines.push(entry(p.title, productUrl(store.origin, p.handle), productDetails(p, store, opts)));
    }
    lines.push('');
  }

  if (store.policies.length > 0) {
    lines.push('## Policies', '');
    for (const pol of store.policies) lines.push(entry(pol.label, pol.url, ''));
    lines.push('');
  }

  lines.push('## Optional', '');
  lines.push(entry('Sitemap', `${store.origin}/sitemap.xml`, 'every public page, product and collection URL'), '');
  return lines.join('\n');
}

/** The long form: the same store with the full plain-text description and variants of each product. */
function buildLlmsFull(store, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const out = [`# ${store.name}`, ''];
  if (store.description) out.push(`> ${store.description}`, '');
  out.push(
    `Snapshot generated ${opts.now().toISOString().slice(0, 10)}. Prices and availability change; the store pages are the source of truth.`,
    ''
  );

  for (const p of store.products.filter((x) => x.handle && x.title)) {
    out.push(`## ${mdLabel(p.title)}`, '', productUrl(store.origin, p.handle), '');
    const price = opts.prices ? formatPrice(p, store.currency) : '';
    const facts = [p.vendor && `Brand: ${p.vendor}`, p.product_type && `Type: ${p.product_type}`, price && `Price: ${price}`].filter(Boolean);
    if (facts.length) out.push(facts.join(' · '), '');
    const desc = truncate(stripHtml(p.body_html), opts.fullDescriptionLength);
    if (desc) out.push(desc, '');
    const variants = (p.variants || []).filter((v) => v.title && v.title !== 'Default Title').slice(0, 10);
    if (variants.length) {
      out.push('Variants:');
      for (const v of variants) {
        const n = Number(v.price);
        const vPrice = opts.prices && Number.isFinite(n) ? ` — ${n.toFixed(2)}${store.currency ? ' ' + store.currency : ''}` : '';
        out.push(`- ${v.title}${vPrice}${v.available === false ? ' (sold out)' : ''}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}

/**
 * Wrap the text in a Shopify page template (templates/page.llms.liquid) that renders it
 * without the theme layout. The body sits inside raw/endraw so characters such as {{ in
 * descriptions are never interpreted as Liquid.
 */
function buildLiquidTemplate(text) {
  const safe = text.replace(/\{%-?\s*(end)?raw\s*-?%\}/gi, '');
  return `{% layout none %}{% raw %}${safe}{% endraw %}\n`;
}

module.exports = { buildLlmsTxt, buildLlmsFull, buildLiquidTemplate, formatPrice, productUrl };
