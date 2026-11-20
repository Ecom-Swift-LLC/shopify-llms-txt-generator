'use strict';

const { decodeEntities } = require('./text');

/** Accept "my-store.myshopify.com", "shop.example.com" or a full URL; return the origin. */
function normalizeOrigin(input) {
  if (!input || typeof input !== 'string') throw new Error('A store domain or URL is required.');
  const withScheme = /^https?:\/\//i.test(input) ? input : 'https://' + input;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error(`"${input}" is not a valid store domain or URL.`);
  }
  return u.origin;
}

async function request(url, { fetchImpl, timeoutMs }) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': 'shopify-llms-txt-generator (+https://github.com/Ecom-Swift-LLC/shopify-llms-txt-generator)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.redirected && /\/password(\/|$|\?)/.test(res.url)) {
    throw new Error('The store redirects to /password. It is password-protected, so there is nothing public to read.');
  }
  return res;
}

async function getJson(url, ctx) {
  const res = await request(url, ctx);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${url} did not return JSON (the store may have disabled it or serves a custom page).`);
  }
}

function metaContent(html, attr, name) {
  const re = new RegExp(`<meta[^>]*\\b${attr}=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return '';
  const content = tag[0].match(/\bcontent=("([^"]*)"|'([^']*)')/i);
  return content ? decodeEntities(content[2] ?? content[3] ?? '').trim() : '';
}

/** Read the store name and description from the home page. */
function parseHome(html) {
  const siteName = metaContent(html, 'property', 'og:site_name');
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];
  const description = metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description');
  return {
    name: siteName || decodeEntities(title).replace(/\s+/g, ' ').trim(),
    description: description.replace(/\s+/g, ' '),
  };
}

const POLICIES = [
  ['refund-policy', 'Refund policy'],
  ['shipping-policy', 'Shipping policy'],
  ['privacy-policy', 'Privacy policy'],
  ['terms-of-service', 'Terms of service'],
  ['contact-information', 'Contact information'],
];

/**
 * Read the public parts of a store. Everything except the product list is best-effort:
 * a failure is recorded in `warnings` instead of aborting the run.
 */
async function loadStore(input, options = {}) {
  const ctx = { fetchImpl: options.fetchImpl || fetch, timeoutMs: options.timeoutMs || 15000 };
  const limit = Math.max(1, options.limit || 100);
  const origin = normalizeOrigin(input);
  const warnings = [];

  const pageSize = Math.min(limit, 250);
  const products = [];
  for (let page = 1; page <= 40 && products.length < limit; page++) {
    const data = await getJson(`${origin}/products.json?limit=${pageSize}&page=${page}`, ctx);
    const batch = Array.isArray(data.products) ? data.products : [];
    products.push(...batch);
    if (batch.length < pageSize) break;
  }
  if (products.length === 0) warnings.push('products.json returned no products.');

  let collections = [];
  try {
    const data = await getJson(`${origin}/collections.json?limit=250`, ctx);
    collections = Array.isArray(data.collections) ? data.collections : [];
  } catch (err) {
    warnings.push(`Collections skipped: ${err.message}`);
  }

  let currency = '';
  try {
    const cart = await getJson(`${origin}/cart.js`, ctx);
    currency = typeof cart.currency === 'string' ? cart.currency : '';
  } catch {
    warnings.push('Currency not detected (/cart.js unavailable); prices are listed without a currency code.');
  }

  let home = { name: '', description: '' };
  try {
    const res = await request(origin + '/', ctx);
    if (res.ok) home = parseHome(await res.text());
  } catch (err) {
    warnings.push(`Home page skipped: ${err.message}`);
  }

  const policies = [];
  for (const [slug, label] of POLICIES) {
    try {
      const res = await request(`${origin}/policies/${slug}`, ctx);
      if (res.ok && !/\/password/.test(res.url)) policies.push({ label, url: `${origin}/policies/${slug}` });
    } catch {
      /* a missing policy page is normal */
    }
  }

  return {
    origin,
    name: options.name || home.name || new URL(origin).hostname,
    description: options.description || home.description,
    currency,
    products: products.slice(0, limit),
    collections,
    policies,
    warnings,
  };
}

module.exports = { loadStore, normalizeOrigin, parseHome, POLICIES };
