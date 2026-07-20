# دفتر حساب الجبنة — نسخة قاعدة بيانات حقيقية (Frontend + Backend + Postgres)

## اللي اتغيّر في النسخة دي
البيانات دلوقتي متخزنة في **5 جداول حقيقية مرتبطة ببعض** (مش سجل JSON واحد زي الأول):

- `products` — الأصناف والأسعار
- `clients` — العملاء
- `invoices` — فواتير كل عميل
- `invoice_items` — أصناف كل فاتورة
- `payments` — دفعات كل عميل

العلاقات بينهم:
```
clients (1) ──< invoices (كثير)
invoices (1) ──< invoice_items (كثير)
products (1) ──< invoice_items (كثير)
clients (1) ──< payments (كثير)
```
لو مسحت عميل، فواتيره ودفعاته بتتمسح معاه تلقائيًا. لو مسحت صنف، الفواتير القديمة بتفضل زي ما هي (لأن اسم وسعر الصنف وقت البيع محفوظين في `invoice_items` بالفعل).

الجداول دي بتتعمل **تلقائيًا** أول ما السيرفر يشتغل — مفيش خطوة يدوية لازمة. لو حابب تنفذها بنفسك برضه، الملف موجود في `backend/sql/schema.sql`.

## هيكل المشروع
```
cheese-app/
  frontend/            ← الواجهة (index.html, style.css, app.js)
  backend/db.js         ← كل الاستعلامات على الجداول (CRUD كامل)
  backend/router.js     ← موجّه REST مشترك (GET/POST/PUT/DELETE)
  backend/sql/schema.sql← نفس الجداول لو عايز تنفذها يدوي
  api/[...path].js      ← دالة Vercel وحيدة بتغطي كل مسارات /api/*
  server.js             ← سيرفر محلي للتجربة (Express) بيستخدم نفس router.js
  package.json
  .env.example
  vercel.json
```

## الخطوة 1: قاعدة بيانات Postgres مجانية (مرة واحدة)
1. روح [neon.tech](https://neon.tech) واعمل حساب مجاني (أو من Vercel: Storage → Create Database → Postgres).
2. اعمل مشروع جديد، وهياديك **Connection String** شكله:
   ```
   postgres://user:password@host/dbname?sslmode=require
   ```
3. احتفظ بيه — هنستخدم **نفس الرابط بالظبط** محليًا وعلى Vercel.

## الخطوة 2: التجربة المحلية
```bash
cd cheese-app
npm install
copy .env.example .env      # على PowerShell / Windows
# أو: cp .env.example .env  # على Mac/Linux
```
افتح `.env` وحط فيه الـ `DATABASE_URL` اللي جبته من Neon. `APP_PIN` اختياري.

```bash
npm run dev
```
افتح: **http://localhost:3000**

جرب تضيف صنف، عميل، فاتورة، دفعة — اقفل السيرفر وشغّله تاني، هتلاقي البيانات لسه موجودة. تقدر كمان تتأكد بنفسك من جوه Neon → SQL Editor:
```sql
SELECT * FROM clients;
SELECT * FROM invoices;
```

## الخطوة 3: النشر على Vercel
```bash
npm install -g vercel   # لو لسه مش متثبت
vercel login
vercel --prod
```
بعد النشر:
1. Vercel Dashboard → المشروع → **Settings → Environment Variables**
2. ضيف `DATABASE_URL` (نفس الرابط) و `APP_PIN` لو بتستخدمه
3. أعد النشر:
```bash
vercel --prod
```

بعد كده، أي تعديل من أي جهاز بيتسجل في نفس قاعدة البيانات فورًا.

## واجهة الـ API (REST كامل، مش JSON blob)
| المسار | الفعل |
|---|---|
| `GET /api/state` | تحميل كل البيانات (أصناف + عملاء + فواتيرهم + دفعاتهم) |
| `POST /api/products` | إضافة صنف |
| `PUT /api/products/:id` | تعديل صنف |
| `DELETE /api/products/:id` | حذف صنف |
| `POST /api/clients` | إضافة عميل |
| `PUT /api/clients/:id` | تعديل بيانات عميل |
| `DELETE /api/clients/:id` | حذف عميل (وفواتيره ودفعاته) |
| `POST /api/clients/:id/invoices` | إضافة فاتورة للعميل |
| `DELETE /api/invoices/:id` | حذف فاتورة |
| `POST /api/clients/:id/payments` | تسجيل دفعة |
| `DELETE /api/payments/:id` | حذف دفعة |
| `POST /api/reset` | مسح كل البيانات والرجوع للأصناف الافتراضية |

كل الطلبات دي بتتطلب هيدر `x-app-pin` لو حطيت `APP_PIN`.
