const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, auth, throttle } = require('../auth');
const { HttpError, str, email, password } = require('../util');

// Public sign-up creates CLIENT accounts only. Drivers/admins are created by an admin.
router.post('/register', (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO users(role,name,email,phone,address,password_hash) VALUES (?,?,?,?,?,?)')
    .run('client', str(b.name, 'name'), email(b.email), str(b.phone || '-', 'phone', 30), str(b.address, 'address', 250), bcrypt.hashSync(password(b.password), 10));
  const u = db.prepare('SELECT id, role, name, email FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign(u), user: u });
});

router.post('/login', (req, res) => {
  const e = email((req.body || {}).email);
  throttle(`${req.ip}|${e}`);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
  if (!u || !u.active || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) throw new HttpError(401, 'Wrong email or password');
  res.json({ token: sign(u), user: { id: u.id, role: u.role, name: u.name, email: u.email } });
});

router.get('/me', auth(), (req, res) => res.json({ user: db.prepare('SELECT id, role, name, email, phone, address FROM users WHERE id = ?').get(req.user.id) }));
module.exports = router;
