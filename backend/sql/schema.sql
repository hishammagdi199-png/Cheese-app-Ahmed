-- ============================================================
-- دفتر حساب الجبنة — الجداول الكاملة والعلاقات بينها
-- نفّذ الملف ده كامل في: Neon → مشروعك → SQL Editor → Run
-- ============================================================

-- جدول الأصناف (المنتجات) والأسعار
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- جدول العملاء
CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- جدول الفواتير (كل فاتورة تخص عميل واحد)
CREATE TABLE IF NOT EXISTS invoices (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date        TIMESTAMP NOT NULL DEFAULT NOW(),
  total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  raw_text    TEXT,                      -- النص الأصلي لو جاية من واتساب
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- جدول أصناف كل فاتورة (سطر لكل صنف داخل الفاتورة)
CREATE TABLE IF NOT EXISTS invoice_items (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id    TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,   -- اسم الصنف وقت البيع (يفضل ثابت حتى لو الصنف اتغيّر اسمه بعدين)
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- جدول الدفعات (كل دفعة تخص عميل واحد)
CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date        TIMESTAMP NOT NULL DEFAULT NOW(),
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  note        TEXT
);

-- فهارس لتسريع البحث بالعميل / بالفاتورة
CREATE INDEX IF NOT EXISTS idx_invoices_client_id      ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id       ON payments(client_id);

-- ============================================================
-- شرح العلاقات (Relationships)
-- ============================================================
-- clients (1) ---< invoices (كثير)        عميل واحد له فواتير كتير
-- invoices (1) ---< invoice_items (كثير)  فاتورة واحدة فيها أصناف كتير
-- products (1) ---< invoice_items (كثير)  الصنف الواحد ممكن يتباع في فواتير كتير
-- clients (1) ---< payments (كثير)        عميل واحد له دفعات كتير
--
-- ON DELETE CASCADE: لو مسحت عميل، هتتمسح فواتيره ودفعاته أوتوماتيك.
-- ON DELETE SET NULL: لو مسحت صنف، الفواتير القديمة اللي بيعته فيها تفضل زي
-- ما هي (لأن اسم وسعر الصنف وقت البيع محفوظين في invoice_items بالفعل).
-- ============================================================
