const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { auth } = require('../auth');
const { DEFAULTS } = require('../pricing');
const O = require('../orders');
const { HttpError, bad, num, str, email, password } = require('../util');

router.use(auth('admin'));
const ph = (a) => a.map(() => '?').join(',');

router.get('/stats', (req, res) => {
  const by = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const rev = db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE payment_status IN ('PAID','COD') AND status != 'CANCELLED'").get().t;
  const today = db.prepare("SELECT COUNT(*) n FROM orders WHERE date(created_at) = date('now')").get().n;
  res.json({ byStatus: by, revenue: rev, ordersToday: today,
    activeDrivers: db.prepare("SELECT COUNT(*) n FROM drivers WHERE availability='available'").get().n });
});

// Dispatch queue: priority first, then manual rank. ?scope=all returns every order.
router.get('/orders', (req, res) => {
  const { status, scope } = req.query;
  if (status) return res.json({ orders: O.list('o.status = ?', [String(status)]) });
  if (scope === 'all') return res.json({ orders: O.list() });
  res.json({ orders: O.list(`o.status IN (${ph(O.ACTIVE)})`, O.ACTIVE) });
});

router.post('/orders/:id/assign', (req, res) => {
  const o = O.getOrder(req.params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (!['PENDING', 'ASSIGNED'].includes(o.status)) throw new HttpError(409, 'Only pending or assigned orders can be (re)assigned');
  const d = db.prepare("SELECT id FROM users WHERE id=? AND role='driver' AND active=1").get(num(req.body.driverId, 'driverId'));
  if (!d) throw new HttpError(404, 'Driver not found');
  db.prepare('UPDATE orders SET driver_id=? WHERE id=?').run(d.id, o.id);
  O.setStatus(o.id, 'ASSIGNED', 'Driver assigned');
  res.json({ order: O.shape(O.getOrder(o.id)) });
});

// Reorder within the same priority tier
router.post('/orders/:id/move', (req, res) => {
  const dir = (req.body || {}).direction === 'up' ? -1 : (req.body || {}).direction === 'down' ? 1 : 0;
  if (!dir) throw bad("direction must be 'up' or 'down'");
  const o = O.getOrder(req.params.id);
  if (!o) throw new HttpError(404, 'Order not found');
  const tier = db.prepare(`SELECT id, rank FROM orders WHERE priority=? AND status IN (${ph(O.ACTIVE)}) ORDER BY rank`).all(o.priority, ...O.ACTIVE);
  const i = tier.findIndex((x) => x.id === o.id), j = i + dir;
  if (i < 0 || j < 0 || j >= tier.length) return res.json({ moved: false });
  db.transaction(() => {
    const up = db.prepare('UPDATE orders SET rank=? WHERE id=?');
    up.run(tier[j].rank, tier[i].id); up.run(tier[i].rank, tier[j].id);
  })();
  res.json({ moved: true });
});

router.patch('/orders/:id/status', (req, res) => {
  const o = O.getOrder(req.params.id), s = (req.body || {}).status;
  if (!o) throw new HttpError(404, 'Order not found');
  if (!['PENDING', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(s)) throw bad('invalid status');
  O.setStatus(o.id, s, 'Updated by admin');
  res.json({ order: O.shape(O.getOrder(o.id)) });
});

router.get('/clients', (req, res) => res.json({ clients: db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.address, u.active, u.created_at,
    COUNT(o.id) AS totalOrders,
    COALESCE(SUM(o.status IN (${ph(O.ACTIVE)})),0) AS ongoingOrders
  FROM users u LEFT JOIN orders o ON o.client_id = u.id WHERE u.role='client' GROUP BY u.id ORDER BY u.name`).all(...O.ACTIVE) }));
router.get('/clients/:id', (req, res) => {
  const c = db.prepare("SELECT id, name, email, phone, address, active, created_at FROM users WHERE id=? AND role='client'").get(req.params.id);
  if (!c) throw new HttpError(404, 'Client not found');
  res.json({ client: c, orders: O.list('o.client_id = ?', [c.id]) });
});

router.get('/drivers', (req, res) => res.json({ drivers: db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.active, d.vehicle, d.plate, d.availability, d.lat, d.lng, d.located_at,
    (SELECT COUNT(*) FROM orders o WHERE o.driver_id=u.id AND o.status IN (${ph(O.ACTIVE)})) AS activeJobs
  FROM users u JOIN drivers d ON d.user_id=u.id WHERE u.role='driver' ORDER BY u.name`).all(...O.ACTIVE) }));
router.post('/drivers', (req, res) => {
  const b = req.body || {};
  const id = db.transaction(() => {
    const i = db.prepare('INSERT INTO users(role,name,email,phone,password_hash) VALUES (?,?,?,?,?)')
      .run('driver', str(b.name, 'name'), email(b.email), str(b.phone, 'phone', 30), bcrypt.hashSync(password(b.password), 10)).lastInsertRowid;
    db.prepare('INSERT INTO drivers(user_id,vehicle,plate) VALUES (?,?,?)').run(i, str(b.vehicle, 'vehicle', 60), str(b.plate, 'plate', 20));
    return i;
  })();
  res.status(201).json({ id });
});
router.patch('/users/:id/active', (req, res) => {
  if (Number(req.params.id) === req.user.id) throw bad('You cannot disable yourself');
  db.prepare('UPDATE users SET active=? WHERE id=?').run((req.body || {}).active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.get('/settings', (req, res) => res.json({ pricing: db.getSettings() }));
router.put('/settings', (req, res) => {
  const cfg = db.getSettings(), inc = (req.body || {}).pricing || {};
  for (const k of Object.keys(inc)) {
    if (!(k in DEFAULTS)) throw bad(`unknown setting ${k}`);
    cfg[k] = num(inc[k], k, { min: 0 });
  }
  if (cfg.priorityRate < 0.10 || cfg.priorityRate > 0.15) throw bad('priorityRate must stay between 0.10 and 0.15');
  db.saveSettings(cfg);
  res.json({ pricing: cfg });
});
module.exports = router;
