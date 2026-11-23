const crypto = require('crypto');
const router = require('express').Router();
const db = require('../db');
const live = require('../live');
const { auth, userFromToken } = require('../auth');
const { quote, etas } = require('../pricing');
const O = require('../orders');
const { HttpError, bad, num, str, point } = require('../util');

const PAY_METHODS = ['GCash', 'Card', 'Bank Transfer', 'COD'];

function parseShipment(b) {
  const p = b.package || {};
  return {
    pickup: point(b.pickup, 'pickup'), dropoff: point(b.dropoff, 'dropoff'),
    length: num(p.length, 'length', { min: 1, max: 300 }), width: num(p.width, 'width', { min: 1, max: 300 }),
    height: num(p.height, 'height', { min: 1, max: 300 }), weightKg: num(p.weightKg, 'weightKg', { min: 0.1, max: 1000 }),
    priority: !!b.priority,
  };
}
const mine = (req, id) => {
  const o = O.getOrder(id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (!O.canView(req.user, o)) throw new HttpError(403, 'Forbidden');
  return o;
};

// Price preview (used by the payment page, including the priority toggle)
router.post('/quote', auth('client', 'admin'), (req, res) => res.json(quote(parseShipment(req.body || {}), db.getSettings())));

// Create order -> AWAITING_PAYMENT
router.post('/orders', auth('client'), (req, res) => {
  const s = parseShipment(req.body || {}), item = str(req.body.item, 'item', 120), cfg = db.getSettings();
  if (s.pickup.lat === s.dropoff.lat && s.pickup.lng === s.dropoff.lng) throw bad('Pickup and drop-off must differ');
  const q = quote(s, cfg);
  let id;
  do { id = 'HX-' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (db.prepare('SELECT 1 FROM orders WHERE id=?').get(id));
  const rank = db.prepare('SELECT COALESCE(MAX(rank),0)+1 AS r FROM orders').get().r;
  db.prepare(`INSERT INTO orders(id,client_id,item,pickup_name,pickup_lat,pickup_lng,drop_name,drop_lat,drop_lng,l,w,h,kg,distance_km,
      base,dist_fee,weight_fee,priority,priority_fee,vat,total,rank) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, item, s.pickup.name, s.pickup.lat, s.pickup.lng, s.dropoff.name, s.dropoff.lat, s.dropoff.lng,
      s.length, s.width, s.height, s.weightKg, q.distanceKm, q.base, q.distance, q.weightSurcharge, s.priority ? 1 : 0, q.priorityFee, q.vat, q.total, rank);
  O.logEvent(id, 'AWAITING_PAYMENT', 'Order created');
  res.status(201).json({ order: O.shape(O.getOrder(id)) });
});

router.get('/orders', auth('client'), (req, res) => res.json({ orders: O.list('o.client_id = ?', [req.user.id]) }));
router.get('/orders/:id', auth(), (req, res) => res.json({ order: O.shape(mine(req, req.params.id)) }));

// Pay -> returns the "token": order ID + pickup/delivery estimates.
// Replace chargeStub() with PayMongo/Xendit (create payment intent, confirm via webhook) before going live.
const chargeStub = (method, amount) => ({ ok: true, ref: `${method.replace(/\s/g, '')}-${crypto.randomBytes(4).toString('hex')}`, amount });
router.post('/orders/:id/pay', auth('client'), (req, res) => {
  const o = mine(req, req.params.id), method = (req.body || {}).method;
  if (!PAY_METHODS.includes(method)) throw bad(`method must be one of ${PAY_METHODS.join(', ')}`);
  if (o.status !== 'AWAITING_PAYMENT') throw new HttpError(409, 'Order is not awaiting payment');
  const charge = chargeStub(method, o.total);
  if (!charge.ok) throw new HttpError(402, 'Payment failed');
  const t = etas(o.distance_km, o.priority, db.getSettings());
  db.prepare('UPDATE orders SET payment_method=?, payment_status=?, payment_ref=?, est_pickup=?, est_delivery=? WHERE id=?')
    .run(method, method === 'COD' ? 'COD' : 'PAID', charge.ref, t.estPickup, t.estDelivery, o.id);
  O.setStatus(o.id, 'PENDING', 'Payment confirmed');
  res.json({ token: { orderId: o.id, estPickup: t.estPickup, estDelivery: t.estDelivery, total: o.total, priority: !!o.priority }, order: O.shape(O.getOrder(o.id)) });
});

router.post('/orders/:id/cancel', auth('client'), (req, res) => {
  const o = mine(req, req.params.id);
  if (!['AWAITING_PAYMENT', 'PENDING', 'ASSIGNED'].includes(o.status)) throw new HttpError(409, 'Order can no longer be cancelled');
  O.setStatus(o.id, 'CANCELLED', 'Cancelled by client');
  res.json({ order: O.shape(O.getOrder(o.id)) });
});

// Tracking snapshot: status timeline + assigned driver's last known position
router.get('/orders/:id/track', auth(), (req, res) => {
  const o = mine(req, req.params.id);
  const driver = o.driver_id ? db.prepare(`SELECT u.name, u.phone, d.vehicle, d.plate, d.lat, d.lng, d.located_at FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.user_id=?`).get(o.driver_id) : null;
  const events = db.prepare('SELECT status, note, at FROM order_events WHERE order_id=? ORDER BY id').all(o.id);
  res.json({ order: O.shape(o), driver, events });
});

// Live stream (EventSource can't send headers, so the JWT is accepted as ?token=)
router.get('/orders/:id/stream', (req, res, next) => {
  try {
    const user = userFromToken(String(req.query.token || ''));
    const o = O.getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'Order not found');
    if (!O.canView(user, o)) throw new HttpError(403, 'Forbidden');
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(': connected\n\n');
    live.subscribe(o.id, res);
    const beat = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => clearInterval(beat));
  } catch (e) { next(e); }
});
module.exports = router;
