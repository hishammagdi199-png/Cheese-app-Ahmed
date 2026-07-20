// api/[...path].js
// دالة Vercel واحدة بتستقبل كل مسارات /api/* وتبعتها للموجّه المشترك.
const { route } = require('../backend/router');

module.exports = async (req, res) => {
  const pin = req.headers['x-app-pin'] || '';
  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const r = await route(req.method, segments, req.body || {}, pin);
  res.status(r.status).json(r.body);
};
