// backend/router.js
// موجّه طلبات REST واحد — نفسه بيستخدمه السيرفر المحلي (server.js)
// ودالة Vercel (api/[...path].js)، عشان نفس السلوك بالظبط في المكانين.

const db = require('./db');

async function route(method, segments, body, pin) {
  const APP_PIN = process.env.APP_PIN;
  if (APP_PIN && pin !== APP_PIN) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  try {
    // GET /api/state
    if (method === 'GET' && segments[0] === 'state' && segments.length === 1) {
      const state = await db.getFullState();
      return { status: 200, body: { data: state } };
    }

    // POST /api/reset
    if (method === 'POST' && segments[0] === 'reset' && segments.length === 1) {
      await db.resetAll();
      const state = await db.getFullState();
      return { status: 200, body: { data: state } };
    }

    // PRODUCTS
    if (segments[0] === 'products') {
      if (method === 'POST' && segments.length === 1) {
        const product = await db.createProduct(body || {});
        return { status: 200, body: { product } };
      }
      if (method === 'PUT' && segments.length === 2) {
        const product = await db.updateProduct(segments[1], body || {});
        return { status: 200, body: { product } };
      }
      if (method === 'DELETE' && segments.length === 2) {
        await db.deleteProduct(segments[1]);
        return { status: 200, body: { ok: true } };
      }
    }

    // CLIENTS
    if (segments[0] === 'clients') {
      if (method === 'POST' && segments.length === 1) {
        const cclient = await db.createClient(body || {});
        return { status: 200, body: { client: cclient } };
      }
      if (method === 'PUT' && segments.length === 2) {
        const cclient = await db.updateClient(segments[1], body || {});
        return { status: 200, body: { client: cclient } };
      }
      if (method === 'DELETE' && segments.length === 2) {
        await db.deleteClient(segments[1]);
        return { status: 200, body: { ok: true } };
      }
      if (method === 'POST' && segments.length === 3 && segments[2] === 'invoices') {
        const invoice = await db.createInvoice(segments[1], body || {});
        return { status: 200, body: { invoice } };
      }
      if (method === 'POST' && segments.length === 3 && segments[2] === 'payments') {
        const payment = await db.createPayment(segments[1], body || {});
        return { status: 200, body: { payment } };
      }
    }

    // INVOICES
    if (segments[0] === 'invoices' && method === 'DELETE' && segments.length === 2) {
      await db.deleteInvoice(segments[1]);
      return { status: 200, body: { ok: true } };
    }

    // PAYMENTS
    if (segments[0] === 'payments' && method === 'DELETE' && segments.length === 2) {
      await db.deletePayment(segments[1]);
      return { status: 200, body: { ok: true } };
    }

    return { status: 404, body: { error: 'not found' } };
  } catch (e) {
    return { status: 500, body: { error: 'server error', message: String(e.message || e) } };
  }
}

module.exports = { route };
