const bcrypt = require('bcryptjs');
const db = require('./db');

function ensureAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) return;
  const e = process.env.ADMIN_EMAIL || 'admin@haul.local', p = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db.prepare("INSERT INTO users(role,name,email,password_hash) VALUES ('admin','Administrator',?,?)").run(e, bcrypt.hashSync(p, 10));
  console.log(`Created admin ${e}`);
}
function demo() {
  const add = (role, name, email, phone, address) => db.prepare('INSERT OR IGNORE INTO users(role,name,email,phone,address,password_hash) VALUES (?,?,?,?,?,?)')
    .run(role, name, email, phone, address, bcrypt.hashSync('Password123!', 10));
  add('client', 'Maria Santos', 'maria@example.com', '0917 555 0101', '12 Leonard Wood Rd, Baguio');
  add('client', 'Kapi Café Co.', 'kapi@example.com', '0918 555 0142', '45 Session Rd, Baguio');
  add('driver', 'Rico Dizon', 'rico@haul.local', '0919 555 0111', null);
  const d = db.prepare("SELECT id FROM users WHERE email='rico@haul.local'").get();
  db.prepare("INSERT OR IGNORE INTO drivers(user_id,vehicle,plate,availability) VALUES (?, 'Van', 'ABC 1234', 'available')").run(d.id);
  console.log('Demo users ready (password: Password123!): maria@example.com, kapi@example.com, rico@haul.local');
}
module.exports = { ensureAdmin };
if (require.main === module) { ensureAdmin(); demo(); }
