const db = require('./db');
const live = require('./live');

const ACTIVE = ['PENDING', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];
const SELECT = `SELECT o.*, c.name AS client_name, d.name AS driver_name
  FROM orders o JOIN users c ON c.id = o.client_id LEFT JOIN users d ON d.id = o.driver_id`;

const shape = (o) => o && ({
  id: o.id, status: o.status, priority: !!o.priority, item: o.item,
  clientId: o.client_id, clientName: o.client_name, driverId: o.driver_id, driverName: o.driver_name || null,
  pickup: { name: o.pickup_name, lat: o.pickup_lat, lng: o.pickup_lng },
  dropoff: { name: o.drop_name, lat: o.drop_lat, lng: o.drop_lng },
  package: { length: o.l, width: o.w, height: o.h, weightKg: o.kg },
  distanceKm: o.distance_km,
  fees: { base: o.base, distance: o.dist_fee, weightSurcharge: o.weight_fee, priority: o.priority_fee, vat: o.vat, total: o.total },
  payment: { method: o.payment_method, status: o.payment_status },
  rank: o.rank, estPickup: o.est_pickup, estDelivery: o.est_delivery, createdAt: o.created_at, updatedAt: o.updated_at,
});
const getOrder = (id) => db.prepare(`${SELECT} WHERE o.id = ?`).get(id);
const list = (where = '1=1', params = []) =>
  db.prepare(`${SELECT} WHERE ${where} ORDER BY o.priority DESC, o.rank ASC, o.created_at DESC`).all(...params).map(shape);

function logEvent(orderId, status, note, lat, lng) {
  db.prepare('INSERT INTO order_events(order_id,status,note,lat,lng) VALUES (?,?,?,?,?)').run(orderId, status, note || null, lat ?? null, lng ?? null);
  db.prepare("UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(orderId);
  live.publish(orderId, 'status', { orderId, status, note: note || null, at: new Date().toISOString() });
}
function setStatus(orderId, status, note, lat, lng) {
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
  logEvent(orderId, status, note, lat, lng);
}
function canView(user, o) {
  return user.role === 'admin' || o.client_id === user.id || o.driver_id === user.id;
}
module.exports = { ACTIVE, shape, getOrder, list, logEvent, setStatus, canView };
