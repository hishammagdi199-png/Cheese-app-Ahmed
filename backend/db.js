// backend/db.js
// تعديل: دعم التشغيل المحلي (Local) والنشر السحابي (Vercel) في نفس الوقت
const { randomUUID } = require('crypto');

let pool;

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL مش موجود. راجع ملف .env محلياً أو إعدادات Vercel.');
        }

        // إذا كنا على Vercel نستخدم الـ Serverless Driver، وإذا كنا محلياً نستخدم pg العادي
        if (process.env.VERCEL) {
            const { Pool } = require('@neondatabase/serverless');
            pool = new Pool({
                connectionString: process.env.DATABASE_URL,
            });
        } else {
            const { Pool } = require('pg');
            pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                // محلياً بنحتاج نلغي الـ SSL لو بنجرب على DB محلية، أو نفعلها لو بنجرب على Neon من الجهاز
                ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
            });
        }
    }
    return pool;
}

// دالة للتأكد من الجداول
async function ensureSchema() {
    const p = getPool();
    await p.query(`
    CREATE TABLE IF NOT EXISTS products (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      price       NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      phone       TEXT,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id          TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      date        TIMESTAMP NOT NULL DEFAULT NOW(),
      total       NUMERIC(12,2) NOT NULL DEFAULT 0,
      raw_text    TEXT,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id            TEXT PRIMARY KEY,
      invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id    TEXT REFERENCES products(id) ON DELETE SET NULL,
      product_name  TEXT NOT NULL,
      quantity      NUMERIC(12,2) NOT NULL DEFAULT 1,
      unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payments (
      id          TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      date        TIMESTAMP NOT NULL DEFAULT NOW(),
      amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
      note        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_client_id      ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_payments_client_id       ON payments(client_id);
  `);
}

const numOr0 = (v) => (v === null || v === undefined || v === '' || isNaN(parseFloat(v)) ? 0 : parseFloat(v));
const mapProduct = (r) => ({ id: r.id, name: r.name, price: numOr0(r.price) });
const mapClientBase = (r) => ({ id: r.id, name: r.name, phone: r.phone || '' });

/* ---------------- products ---------------- */
async function listProducts() {
    await ensureSchema();
    const r = await getPool().query('SELECT * FROM products ORDER BY created_at ASC');
    return r.rows.map(mapProduct);
}
async function createProduct({ name, price }) {
    await ensureSchema();
    const id = randomUUID();
    const n = name && name.trim() ? name.trim() : 'صنف جديد';
    const r = await getPool().query(
        'INSERT INTO products (id, name, price) VALUES ($1,$2,$3) RETURNING *', [id, n, numOr0(price)]
    );
    return mapProduct(r.rows[0]);
}
async function updateProduct(id, fields) {
    await ensureSchema();
    const sets = [];
    const vals = [];
    let i = 1;
    if (fields.name !== undefined) { sets.push(`name=$${i++}`); vals.push(fields.name); }
    if (fields.price !== undefined) { sets.push(`price=$${i++}`); vals.push(numOr0(fields.price)); }
    if (!sets.length) {
        const r = await getPool().query('SELECT * FROM products WHERE id=$1', [id]);
        return r.rows[0] ? mapProduct(r.rows[0]) : null;
    }
    vals.push(id);
    const r = await getPool().query(`UPDATE products SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
    return r.rows[0] ? mapProduct(r.rows[0]) : null;
}
async function deleteProduct(id) {
    await ensureSchema();
    await getPool().query('DELETE FROM products WHERE id=$1', [id]);
}

/* ---------------- clients ---------------- */
async function createClient({ name, phone }) {
    await ensureSchema();
    const id = randomUUID();
    const n = (name || '').trim();
    const r = await getPool().query(
        'INSERT INTO clients (id, name, phone) VALUES ($1,$2,$3) RETURNING *', [id, n, phone || '']
    );
    return { ...mapClientBase(r.rows[0]), invoices: [], payments: [] };
}
async function updateClient(id, fields) {
    await ensureSchema();
    const sets = [];
    const vals = [];
    let i = 1;
    if (fields.name !== undefined) { sets.push(`name=$${i++}`); vals.push(fields.name); }
    if (fields.phone !== undefined) { sets.push(`phone=$${i++}`); vals.push(fields.phone); }
    if (!sets.length) {
        const r = await getPool().query('SELECT * FROM clients WHERE id=$1', [id]);
        return r.rows[0] ? mapClientBase(r.rows[0]) : null;
    }
    vals.push(id);
    const r = await getPool().query(`UPDATE clients SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
    return r.rows[0] ? mapClientBase(r.rows[0]) : null;
}
async function deleteClient(id) {
    await ensureSchema();
    await getPool().query('DELETE FROM clients WHERE id=$1', [id]);
}

/* ---------------- invoices ---------------- */
async function createInvoice(clientId, { items, rawText }) {
    await ensureSchema();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) throw new Error('لا يوجد أصناف للفاتورة');
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const invoiceId = randomUUID();
        const now = new Date();
        let total = 0;
        const itemRows = [];
        for (const it of list) {
            const pr = await client.query('SELECT * FROM products WHERE id=$1', [it.productId]);
            const product = pr.rows[0];
            const quantity = numOr0(it.quantity) || 1;
            const unitPrice = product ? numOr0(product.price) : 0;
            const subtotal = Math.round(quantity * unitPrice * 100) / 100;
            total += subtotal;
            itemRows.push({
                id: randomUUID(),
                productId: product ? product.id : null,
                productName: product ? product.name : (it.productName || ''),
                quantity,
                unitPrice,
                subtotal,
            });
        }
        total = Math.round(total * 100) / 100;
        await client.query(
            'INSERT INTO invoices (id, client_id, date, total, raw_text) VALUES ($1,$2,$3,$4,$5)', [invoiceId, clientId, now, total, rawText || null]
        );
        for (const it of itemRows) {
            await client.query(
                'INSERT INTO invoice_items (id, invoice_id, product_id, product_name, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5,$6,$7)', [it.id, invoiceId, it.productId, it.productName, it.quantity, it.unitPrice, it.subtotal]
            );
        }
        await client.query('COMMIT');
        return {
            id: invoiceId,
            date: now.toISOString(),
            total,
            rawText: rawText || '',
            items: itemRows.map((it) => ({
                productId: it.productId,
                productName: it.productName,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
            })),
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}
async function deleteInvoice(id) {
    await ensureSchema();
    await getPool().query('DELETE FROM invoices WHERE id=$1', [id]);
}

/* ---------------- payments ---------------- */
async function createPayment(clientId, { amount, note }) {
    await ensureSchema();
    const id = randomUUID();
    const amt = numOr0(amount);
    const now = new Date();
    await getPool().query(
        'INSERT INTO payments (id, client_id, date, amount, note) VALUES ($1,$2,$3,$4,$5)', [id, clientId, now, amt, note || '']
    );
    return { id, date: now.toISOString(), amount: amt, note: note || '' };
}
async function deletePayment(id) {
    await ensureSchema();
    await getPool().query('DELETE FROM payments WHERE id=$1', [id]);
}

/* ---------------- full state (for initial page load) ---------------- */
async function getFullState() {
    await ensureSchema();
    const p = getPool();
    const [productsR, clientsR, invoicesR, itemsR, paymentsR] = await Promise.all([
        p.query('SELECT * FROM products ORDER BY created_at ASC'),
        p.query('SELECT * FROM clients ORDER BY created_at ASC'),
        p.query('SELECT * FROM invoices ORDER BY date ASC'),
        p.query('SELECT * FROM invoice_items'),
        p.query('SELECT * FROM payments ORDER BY date ASC'),
    ]);
    const itemsByInvoice = {};
    for (const row of itemsR.rows) {
        (itemsByInvoice[row.invoice_id] ||= []).push({
            productId: row.product_id,
            productName: row.product_name,
            quantity: numOr0(row.quantity),
            unitPrice: numOr0(row.unit_price),
            subtotal: numOr0(row.subtotal),
        });
    }
    const invoicesByClient = {};
    for (const row of invoicesR.rows) {
        (invoicesByClient[row.client_id] ||= []).push({
            id: row.id,
            date: row.date.toISOString(),
            total: numOr0(row.total),
            rawText: row.raw_text || '',
            items: itemsByInvoice[row.id] || [],
        });
    }
    const paymentsByClient = {};
    for (const row of paymentsR.rows) {
        (paymentsByClient[row.client_id] ||= []).push({
            id: row.id,
            date: row.date.toISOString(),
            amount: numOr0(row.amount),
            note: row.note || '',
        });
    }
    const clients = clientsR.rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone || '',
        invoices: invoicesByClient[c.id] || [],
        payments: paymentsByClient[c.id] || [],
    }));
    const products = productsR.rows.map(mapProduct);
    return { products, clients };
}

/* ---------------- reset ---------------- */
async function resetAll() {
    await ensureSchema();
    const p = getPool();
    await p.query('TRUNCATE invoice_items, invoices, payments, clients, products CASCADE');
    const defaults = [
        { name: 'جبنة ثلاجة 8ك', price: 540 },
        { name: 'جبنة كيري 1ك', price: 50 },
        { name: 'قشطة 1ك', price: 80 },
    ];
    for (const d of defaults) await createProduct(d);
}

module.exports = {
    listProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    createClient,
    updateClient,
    deleteClient,
    createInvoice,
    deleteInvoice,
    createPayment,
    deletePayment,
    getFullState,
    resetAll,
};
