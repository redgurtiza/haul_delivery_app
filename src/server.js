const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./db');
const { ensureAdmin } = require('./seed');
const { HttpError } = require('./util');

ensureAdmin();
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
app.use(express.json({ limit: '100kb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));   // serves the web app (client / driver / admin)
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/client'));
app.use('/api/driver', require('./routes/driver'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (String(err.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Already exists or invalid reference' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Haul API listening on :${port}`));
