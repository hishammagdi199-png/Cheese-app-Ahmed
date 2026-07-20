// server.js — للتشغيل المحلي فقط (مش بيتنشر على Vercel)
// بيشغّل نفس منطق الـ API (backend/router.js) ونفس ملفات الفرونت إند،
// على نفس قاعدة البيانات الحقيقية اللي هتستخدمها بعد النشر.
require('dotenv').config();

const express = require('express');
const path = require('path');
const { route } = require('./backend/router');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// أي طلب على /api/... بيتبعت لنفس الموجّه المشترك
app.all(/^\/api\/(.*)$/, async(req, res) => {
    const pin = req.headers['x-app-pin'] || '';
    const segments = req.params[0].split('/').filter(Boolean);
    const r = await route(req.method, segments, req.body || {}, pin);
    res.status(r.status).json(r.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ دفتر حساب الجبنة شغال محليًا على: http://localhost:${PORT}\n`);
});