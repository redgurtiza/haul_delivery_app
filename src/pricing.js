// All amounts in PHP. Editable at runtime by admins via /api/admin/settings.
const DEFAULTS = {
  base: 60, perKm: 18, freeKg: 3, perKg: 12, volDivisor: 5000, vat: 0.12,
  priorityRate: 0.15,          // priority delivery adds 15% of the subtotal
  roadFactor: 1.3,             // straight-line km -> approximate road km
  speedKmh: 22, handlingMinutes: 8, pickupMinutes: 30, priorityPickupMinutes: 15, priorityTimeFactor: 0.8,
};
const r2 = (n) => Math.round(n * 100) / 100;

function distanceKm(a, b, cfg) {
  const R = Math.PI / 180;
  const d = Math.sin(((b.lat - a.lat) * R) / 2) ** 2 +
    Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(((b.lng - a.lng) * R) / 2) ** 2;
  return r2(12742 * Math.asin(Math.sqrt(d)) * cfg.roadFactor);
}

function quote({ pickup, dropoff, length, width, height, weightKg, priority }, cfg) {
  const km = distanceKm(pickup, dropoff, cfg);
  const volumetricKg = (length * width * height) / cfg.volDivisor;
  const billableKg = Math.max(weightKg, volumetricKg);       // bigger of actual vs. volumetric
  const base = cfg.base, distance = km * cfg.perKm;
  const weightSurcharge = Math.max(0, billableKg - cfg.freeKg) * cfg.perKg;
  const subtotal = base + distance + weightSurcharge;
  const priorityFee = priority ? subtotal * cfg.priorityRate : 0;
  const vat = (subtotal + priorityFee) * cfg.vat;
  return {
    distanceKm: km, billableKg: r2(billableKg), base: r2(base), distance: r2(distance),
    weightSurcharge: r2(weightSurcharge), priority: !!priority, priorityFee: r2(priorityFee),
    vat: r2(vat), total: r2(subtotal + priorityFee + vat),
  };
}

function etas(km, priority, cfg, from = Date.now()) {
  const pickup = from + (priority ? cfg.priorityPickupMinutes : cfg.pickupMinutes) * 60000;
  const travelMin = (km / cfg.speedKmh) * 60 + cfg.handlingMinutes;
  const delivery = pickup + travelMin * (priority ? cfg.priorityTimeFactor : 1) * 60000;
  return { estPickup: new Date(pickup).toISOString(), estDelivery: new Date(delivery).toISOString() };
}
module.exports = { DEFAULTS, quote, etas, distanceKm };
