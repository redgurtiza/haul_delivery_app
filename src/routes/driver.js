const router = require('express').Router();
const db = require('../db');
const live = require('../live');
const { auth } = require('../auth');
const O = require('../orders');
const { HttpError, bad, num } = require('../util');

router.use(auth('driver'));
const NEXT = { ASSIGNED: ['PICKED_UP'], PICKED_UP: ['IN_TRANSIT'], IN_TRANSIT: ['DELIVERED'] };

router.get('/me', (req, res) => res.json(db.prepare('SELECT availability, vehicle, plate FROM drivers WHERE user_id = ?').get(req.user.id)));
router.get('/jobs', (req, res) =>
  res.json({ jobs: O.list(`o.driver_id = ? AND o.status IN (${O.ACTIVE.map(() => '?').join(',')})`, [req.user.id, ...O.ACTIVE]) }));
router.get('/history', (req, res) => res.json({ orders: O.list("o.driver_id = ? AND o.status = 'DELIVERED'", [req.user.id]) }));

router.patch('/availability', (req, res) => {
  const a = (req.body || {}).availability;
  if (!['available', 'offline'].includes(a)) throw bad('availability must be available or offline');
  db.prepare('UPDATE drivers SET availability=? WHERE user_id=?').run(a, req.user.id);
  res.json({ availability: a });
});

// Called every few seconds by the driver app (navigator.geolocation.watchPosition)
router.post('/location', (req, res) => {
  const lat = num(req.body.lat, 'lat', { min: -90, max: 90 }), lng = num(req.body.lng, 'lng', { min: -180, max: 180 });
  const at = new Date().toISOString();
  db.prepare('UPDATE drivers SET lat=?, lng=?, located_at=? WHERE user_id=?').run(lat, lng, at, req.user.id);
  const rows = db.prepare("SELECT id FROM orders WHERE driver_id=? AND status IN ('PICKED_UP','IN_TRANSIT')").all(req.user.id);
  rows.forEach((o) => live.publish(o.id, 'location', { orderId: o.id, lat, lng, at }));
  res.json({ ok: true });
});

router.post('/orders/:id/status', (req, res) => {
  const o = O.getOrder(req.params.id), next = (req.body || {}).status;
  if (!o || o.driver_id !== req.user.id) throw new HttpError(404, 'Job not found');
  if (!(NEXT[o.status] || []).includes(next)) throw new HttpError(409, `Cannot move from ${o.status} to ${next}`);
  const b = req.body, lat = b.lat != null ? num(b.lat, 'lat') : null, lng = b.lng != null ? num(b.lng, 'lng') : null;
  O.setStatus(o.id, next, typeof b.note === 'string' ? b.note.slice(0, 300) : null, lat, lng);
  res.json({ order: O.shape(O.getOrder(o.id)) });
});
module.exports = router;
