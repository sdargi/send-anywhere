const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 5000;
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const UPLOAD_DIR = path.join(APP_DIR, 'uploads');
const DB_FILE = path.join(APP_DIR, 'files.db');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    original_name TEXT,
    disk_name TEXT,
    size INTEGER,
    mime TEXT,
    created_at INTEGER,
    expires_at INTEGER,
    downloads INTEGER DEFAULT 0,
    max_downloads INTEGER DEFAULT 0
  )`);
});

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function nowMs() { return Date.now(); }
function deleteFileRecord(row) {
  const filePath = path.join(UPLOAD_DIR, row.disk_name);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  db.run('DELETE FROM files WHERE id = ?', [row.id]);
}
function cleanupExpired() {
  const t = nowMs();
  db.all('SELECT * FROM files WHERE expires_at IS NOT NULL AND expires_at <= ?', [t], (err, rows) => {
    if (rows && rows.length) {
      rows.forEach(deleteFileRecord);
      console.log(`Cleanup: removed ${rows.length} expired file(s).`);
    }
  });
}
setInterval(cleanupExpired, 10 * 60 * 1000);

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || (1024 * 1024 * 1024).toString(), 10);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const expiresMinutes = parseInt(req.body.expiresMinutes || '1440', 10);
  const maxDownloads = parseInt(req.body.maxDownloads || '0', 10);
  const code = generateCode();
  const id = uuidv4();

  const createdAt = nowMs();
  const expiresAt = expiresMinutes > 0 ? createdAt + expiresMinutes * 60 * 1000 : null;

  db.run(`INSERT INTO files (id, code, original_name, disk_name, size, mime, created_at, expires_at, max_downloads)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, code, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype, createdAt, expiresAt, maxDownloads],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({
        code,
        originalName: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype,
        expiresAt,
        maxDownloads
      });
    });
});

app.get('/api/file/:code', (req, res) => {
  const code = req.params.code;
  db.get('SELECT code, original_name, size, mime, created_at, expires_at, downloads, max_downloads FROM files WHERE code = ?', [code], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Not found' });
    const t = nowMs();
    if (row.expires_at && row.expires_at <= t) return res.status(410).json({ error: 'Expired' });
    if (row.max_downloads && row.downloads >= row.max_downloads) return res.status(410).json({ error: 'Download limit reached' });
    res.json(row);
  });
});

app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  db.get('SELECT * FROM files WHERE code = ?', [code], (err, row) => {
    if (err || !row) return res.status(404).send('Not found');
    const t = nowMs();
    if (row.expires_at && row.expires_at <= t) {
      deleteFileRecord(row);
      return res.status(410).send('Link expired');
    }
    if (row.max_downloads && row.downloads >= row.max_downloads) {
      return res.status(410).send('Download limit reached');
    }
    const filePath = path.join(UPLOAD_DIR, row.disk_name);
    if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
    db.run('UPDATE files SET downloads = downloads + 1 WHERE id = ?', [row.id]);
    res.download(filePath, row.original_name);
  });
});

app.delete('/api/file/:code', (req, res) => {
  const code = req.params.code;
  db.get('SELECT * FROM files WHERE code = ?', [code], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Not found' });
    deleteFileRecord(row);
    res.json({ ok: true });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Uploads dir: ${UPLOAD_DIR}`);
  console.log(`DB path: ${DB_FILE}`);
});
