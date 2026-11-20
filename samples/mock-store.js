'use strict';

// A tiny local stand-in for a Shopify storefront, used by the tests and by the README demo
// (`node samples/mock-store.js` serves it on a free local port and prints the URL). It answers the same
// public endpoints the generator reads: /products.json, /collections.json, /cart.js,
// the home page and /policies/*.

const http = require('node:http');

const products = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  title: i === 2 ? 'Linen [Natural] Tote' : `Canvas Tote ${i + 1}`,
  handle: i === 2 ? 'linen-natural-tote' : `canvas-tote-${i + 1}`,
  vendor: 'Acme Goods',
  product_type: 'Bags',
  body_html:
    i === 0
      ? '<p>Heavy 12&nbsp;oz canvas. Fits a 15&quot; laptop.</p><script>alert(1)</script><p>Machine washable. Made in Portugal.</p>'
      : `<p>Tote number ${i + 1}.</p>`,
  variants: [
    { title: i === 0 ? 'Natural' : 'Default Title', price: '24.00', available: true },
    ...(i === 0 ? [{ title: 'Black', price: '28.00', available: false }] : []),
  ],
}));

const collections = [
  { title: 'Totes', handle: 'totes', body_html: '<p>Everyday carry bags.</p>', products_count: 7 },
  { title: 'Sale (last chance)', handle: 'sale', body_html: '', products_count: 0 },
];

const HOME = `<!doctype html><html><head>
<title>Acme Goods &ndash; Everyday bags</title>
<meta name="description" content="Durable canvas and linen bags, made in small batches.">
<meta property="og:site_name" content="Acme Goods">
</head><body>Home</body></html>`;

function createMockStore({ password = false, cartJson = true, collectionsJson = true, port = 0 } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push(req.url);
    const json = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (password && url.pathname !== '/password') {
      res.writeHead(302, { location: '/password' });
      return res.end();
    }
    if (url.pathname === '/password') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html>Enter using password</html>');
    }
    if (url.pathname === '/products.json') {
      const limit = Number(url.searchParams.get('limit') || 30);
      const page = Number(url.searchParams.get('page') || 1);
      return json({ products: products.slice((page - 1) * limit, page * limit) });
    }
    if (url.pathname === '/collections.json') return collectionsJson ? json({ collections }) : json({}, 404);
    if (url.pathname === '/cart.js') return cartJson ? json({ currency: 'USD', items: [] }) : json({}, 404);
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(HOME);
    }
    if (url.pathname === '/policies/refund-policy' || url.pathname === '/policies/privacy-policy') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html>Policy</html>');
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('Not found');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { createMockStore, products, collections };

if (require.main === module) {
  createMockStore().then((s) => console.log(`Mock store on ${s.origin}  (Ctrl+C to stop)`));
}
