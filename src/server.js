const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const osu = require('node-os-utils');
const { exec } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Global error handlers to capture crashes during runtime and help debugging
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at:', p, 'reason:', reason && reason.stack ? reason.stack : reason);
});

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const DB_PATH = path.resolve(__dirname, 'db.json');

function readConfig(){
  try{return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));}catch(e){
    return { features: ['monitoring'], pm2: { enabled:false, manage:false }, maxActivity:7 };
  }
}

function writeConfig(cfg){
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function readDB(){
  try{return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));}catch(e){
    return { users:[], features:[], activity:[], monitoredProcesses:[], alerts:[], tokens:{} };
  }
}

function writeDB(db){
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// serve UI
app.use('/', express.static(ROOT));

// simple token-based auth
function genToken(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function authMiddleware(req, res, next){
  const token = req.headers['x-auth-token'] || req.query.token;
  if(!token) return res.status(401).json({ ok:false, error:'missing token' });
  const db = readDB();
  if(db.tokens && db.tokens[token]){ req.user = db.tokens[token]; return next(); }
  return res.status(401).json({ ok:false, error:'invalid token' });
}

// manage in-file activity (cap will be applied on read)
function pushActivity(msg){
  const db = readDB();
  db.activity = db.activity || [];
  db.activity.push({ ts: Date.now(), msg });
  // cap to 500
  if(db.activity.length > 500) db.activity = db.activity.slice(-500);
  writeDB(db);
}

// audit log helper (admin actions)
function pushAudit(action, actor, details){
  const db = readDB();
  db.audit = db.audit || [];
  db.audit.push({ ts: Date.now(), action, actor: actor || 'system', details: details || '' });
  // cap audit to 1000
  if(db.audit.length > 1000) db.audit = db.audit.slice(-1000);
  writeDB(db);
  try{ io && io.emit && io.emit('audit', db.audit[db.audit.length-1]); }catch(e){}
}

// socket.io pushes
io.on('connection', (socket) => {
  try{
    console.log('[INFO] socket connected', socket.id);
    // try to validate token passed in handshake (socket.io v3+ supports auth payload)
    const token = (socket.handshake && (socket.handshake.auth && socket.handshake.auth.token)) || (socket.handshake.query && socket.handshake.query.token);
    const db = readDB();
    if(!token || !db.tokens || !db.tokens[token]){
      socket.emit('error', { ok:false, error:'unauthenticated socket' });
      console.log('unauthenticated socket', socket.id);
    } else {
      socket.user = db.tokens[token];
      socket.emit('hello', { server: 'ServerPanel', ts: Date.now(), user: socket.user });
    }

    // keep connection simple: metrics/activity and hello only
    socket.on('disconnect', (reason) => {
      console.log('[INFO] socket disconnected', socket.id, reason);
    });
  }catch(err){
    console.error('Error in socket connection handler', err && err.stack ? err.stack : err);
  }
});

// Express global error handler
app.use((err, req, res, next) => {
  console.error('Express error', err && err.stack ? err.stack : err);
  try{ res.status(500).json({ ok:false, error: 'server error' }); }catch(e){}
});


// signals
process.on('SIGTERM', ()=> { console.log('SIGTERM received, shutting down'); process.exit(0); });
process.on('SIGINT', ()=> { console.log('SIGINT received, shutting down'); process.exit(0); });

process.on('exit', (code) => {
  console.log('Process exiting with code', code);
});

// endpoints
app.get('/api/config', (req, res) => { res.json(readConfig()); });

function safeJoin(base, target) {
  const targetPath = path.join(base, target);
  if(!targetPath.startsWith(base)) throw new Error('Invalid path');
  return targetPath;
}

const config = readConfig();

let BASE_DIR;

if (config.startFolder) {
    if (path.isAbsolute(config.startFolder)) {
        BASE_DIR = config.startFolder;
    } else {
        BASE_DIR = path.resolve(process.cwd(), config.startFolder);
    }
} else {
    BASE_DIR = process.cwd();
}

// Prüfen, ob das Verzeichnis existiert
if (fs.existsSync(BASE_DIR)) {
    console.log('✅ BASE_DIR exists');
} else {
    console.error('❌ BASE_DIR does not exist');
}

app.get('/api/files', (req, res) => {
    const relPath = req.query.path || '';
    const absPath = path.resolve(BASE_DIR, relPath);

    if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: 'Folder not found' });
    }

    const entries = fs.readdirSync(absPath, { withFileTypes: true });

    const files = entries.map(entry => {
        const fullPath = path.join(absPath, entry.name);
        return {
            name: entry.name,
            isDir: entry.isDirectory(),   // wichtig für die UI
            size: entry.isDirectory() ? 0 : fs.statSync(fullPath).size
        };
    });

    // Folders first, alphabetically
    files.sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1);

    res.json({ path: relPath, files });
});

app.post('/api/files/create', (req, res) => {
  let { path: relPath = '', name, type = 'file' } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Missing name' });

  try {
    // Make sure relPath is relative
    if (path.isAbsolute(relPath)) relPath = path.relative(BASE_DIR, relPath);

    const fullPath = path.resolve(BASE_DIR, relPath, name);

    if (fs.existsSync(fullPath)) return res.status(400).json({ ok: false, error: `${type} already exists` });

    if (type === 'folder') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.writeFileSync(fullPath, '', 'utf8');
    }

    pushActivity(`Created ${type}: ${path.relative(BASE_DIR, fullPath)}`);
    res.json({ ok: true, path: path.relative(BASE_DIR, fullPath), type });
  } catch (e) {
    console.error('Create error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/files/delete', (req, res) => {
    const { path: relPath } = req.body;
    if (!relPath) return res.status(400).json({ ok:false, error:'Missing path' });

    try {
        const absPath = path.resolve(BASE_DIR, relPath); // <-- important
        if (fs.existsSync(absPath)) {
            const stat = fs.statSync(absPath);
            if (stat.isDirectory()) fs.rmdirSync(absPath, { recursive: true });
            else fs.unlinkSync(absPath);
            pushActivity(`Deleted: ${relPath}`);
            res.json({ ok: true });
        } else {
            res.status(400).json({ ok: false, error: 'File/folder not found' });
        }
    } catch(e) {
        res.status(500).json({ ok:false, error: e.message });
    }
});


app.post('/api/files/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) return res.status(400).json({ ok:false, error:'Missing paths' });

  try {
    // Only resolve relative to BASE_DIR once
    const absOld = path.resolve(BASE_DIR, oldPath);
    const absNew = path.resolve(BASE_DIR, newPath);

    if (!fs.existsSync(absOld)) {
      return res.status(404).json({ ok:false, error: 'Original file does not exist' });
    }

    fs.renameSync(absOld, absNew);
    pushActivity(`Renamed: ${oldPath} → ${newPath}`);
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});


app.get('/api/files/read', (req, res) => {
    let filePath = req.query.path;
    if(!filePath) return res.status(400).json({ error: 'Missing path' });

    filePath = filePath.replace(/\//g, path.sep); // normalize slashes to platform

    const absPath = path.resolve(BASE_DIR, filePath);

    fs.readFile(absPath, 'utf8', (err, data) => {
        if(err) return res.status(500).json({ error: err.message });
        res.send(data);
    });
});

// Write file content
app.post('/api/files/write', async (req, res) => {
  const { path, content } = req.body;
  if (!path || content === undefined) return res.status(400).json({ ok:false, error: 'Missing path or content' });

  const fsPath = decodeURIComponent(path); // decode if it was URI-encoded
  try {
    fs.writeFileSync(fsPath, content, 'utf8');
    return res.json({ ok:true });
  } catch (err) {
    console.error('File write error', err);
    return res.status(500).json({ ok:false, error: err.message });
  }
});

// Save file
app.post('/api/files/save', (req, res) => {
  const filePath = path.join(BASE_DIR, req.body.path);
  fs.writeFile(filePath, req.body.content, 'utf8', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

app.get('/api/files/download', (req, res) => {
    const relPath = req.query.path;
    const absPath = path.resolve(BASE_DIR, relPath);

    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot download a folder' }); // Ordner nicht downloadbar
    }

    res.download(absPath);
});

const multer = require('multer');
const upload = multer({ dest: path.join(BASE_DIR, 'temp') }); // temp folder for uploads

app.post('/api/files/upload', upload.single('file'), (req, res) => {
    const folder = req.body.path ? path.resolve(BASE_DIR, req.body.path) : BASE_DIR;
    const file = req.file;
    if (!file) return res.status(400).json({ ok:false, error:'No file uploaded' });

    try {
        const dest = path.join(folder, file.originalname);
        fs.renameSync(file.path, dest);
        pushActivity(`Uploaded: ${path.join(req.body.path || '', file.originalname)}`);
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ ok:false, error:e.message });
    }
});

app.post('/api/config', (req, res) => {
  const cfg = readConfig();
  const incoming = req.body;
  const merged = Object.assign({}, cfg, incoming);
  writeConfig(merged);
  pushActivity('Config updated');
  try{ pushAudit('config.updated', req.user && req.user.username ? req.user.username : 'unknown', JSON.stringify(incoming)); }catch(e){}
  io.emit('config', merged);
  res.json({ ok:true, config: merged });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const db = readDB();
  // find user; support plain or bcrypt-hashed passwords
  const user = (db.users||[]).find(u=>u.username===username && (u.password===password || (u.password && bcrypt.compareSync(password, u.password))));
  if(!user) return res.status(401).json({ ok:false, error:'invalid' });
  const token = genToken();
  db.tokens = db.tokens || {};
  db.tokens[token] = { username:user.username, role:user.role, displayName:user.displayName };
  writeDB(db);
  pushActivity(`User ${user.username} logged in`);
  res.json({ ok:true, token, user: db.tokens[token] });
});

app.get('/api/metrics', async (req, res) => {
  try{
    const cpu = await osu.cpu.usage();
    const memInfo = await osu.mem.info();
    // attempt multiple methods to collect disk info
    let diskInfo = null;
    try{
      // prefer node-os-utils if available
      if(osu.drive && typeof osu.drive.info === 'function'){
        diskInfo = await osu.drive.info();
      }
    }catch(e){ diskInfo = null; }
    // fallback: on Windows use wmic, on *nix use df
    if(!diskInfo){
      try{
        if(process.platform === 'win32'){
          // WMIC output parsing
          const out = await new Promise((resolve, reject) => exec('wmic logicaldisk get caption,size,freespace /format:csv', (err, stdout, stderr) => { if(err) return reject(err); resolve(stdout); }));
          // parse CSV-like output
          const lines = out.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
          // lines like Node,Caption,FreeSpace,Size
          const rows = lines.slice(1).map(l=> l.split(',')).filter(arr => arr.length>=4);
          let total = 0, free = 0;
          rows.forEach(r=>{ const size = parseInt(r[3],10) || 0; const f = parseInt(r[2],10) || 0; total += size; free += f; });
          if(total > 0){ diskInfo = { totalBytes: total, freeBytes: free } }
        } else {
          // unix: use df -k for root
          const out = await new Promise((resolve, reject) => exec('df -k --output=size,avail -x tmpfs -x devtmpfs /', (err, stdout) => { if(err) return reject(err); resolve(stdout); }));
          // parse; first line header, second line numbers (blocks)
          const parts = out.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
          if(parts.length >= 2){ const nums = parts[1].split(/\s+/); const sizeK = parseInt(nums[0],10) || 0; const availK = parseInt(nums[1],10) || 0; const total = sizeK * 1024; const free = availK * 1024; diskInfo = { totalBytes: total, freeBytes: free }; }
        }
      }catch(e){ diskInfo = null; }
    }
    const uptime = osu.os.uptime();
    const out = { cpu: Math.round(cpu) + '%', memory: Math.round(memInfo.usedMemPercentage) + '%', uptime };
    if(diskInfo){
      // normalize disk info to bytes and percentages
      const totalBytes = diskInfo.totalBytes || diskInfo.totalGb && Math.round(diskInfo.totalGb * 1024 * 1024 * 1024) || null;
      const freeBytes = diskInfo.freeBytes || diskInfo.freeGb && Math.round(diskInfo.freeGb * 1024 * 1024 * 1024) || null;
      if(totalBytes != null && freeBytes != null){
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const usedPct = Math.round((usedBytes / totalBytes) * 100);
        const freePct = Math.round((freeBytes / totalBytes) * 100);
        out.disk = { totalGb: +(totalBytes / (1024*1024*1024)).toFixed(2), usedGb: +(usedBytes / (1024*1024*1024)).toFixed(2), freeGb: +(freeBytes / (1024*1024*1024)).toFixed(2), usedPct, freePct };
      }
    }
    // push via socket
    io.emit('metrics', out);
    res.json(out);
  }catch(e){
    // fallback: provide basic uptime and zeros
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const formattedUptime = `${hours}h ${minutes}min`;
    res.json({ cpu: '0%', memory: '0%', uptime: formattedUptime });
  }
});

// enhanced audit retrieval with filtering, pagination and export
app.get('/api/audit', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  let list = (db.audit || []).slice().reverse(); // newest first
  const { actor, action, from, to, limit, offset, export: doExport } = req.query;
  if(actor) list = list.filter(a => (a.actor||'').toLowerCase().includes(String(actor).toLowerCase()));
  if(action) list = list.filter(a => (a.action||'').toLowerCase().includes(String(action).toLowerCase()));
  if(from){ const f = new Date(from).getTime(); if(!isNaN(f)) list = list.filter(a => (a.ts||0) >= f); }
  if(to){ const t = new Date(to).getTime(); if(!isNaN(t)) list = list.filter(a => (a.ts||0) <= t + 24*3600*1000 -1); }
  const total = list.length;
  const lim = Math.min(1000, parseInt(limit,10) || 200);
  const off = parseInt(offset,10) || 0;
  const page = list.slice(off, off + lim);
  // export support via query param ?export=csv
  if(doExport === 'csv' || req.path.endsWith('/export')){
    // return CSV
    const rows = page.map(a => ({ ts: new Date(a.ts).toISOString(), actor: a.actor, action: a.action, details: a.details }));
    const header = 'ts,actor,action,details\n';
    const csv = header + rows.map(r => `${r.ts.replace(/,/g,' ')} , ${String(r.actor).replace(/\n/g,' ')} , ${String(r.action).replace(/\n/g,' ')} , ${String(r.details).replace(/\n/g,' ')}`).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="audit-export.csv"');
    return res.send(csv);
  }
  res.json({ ok:true, total, count: page.length, offset: off, limit: lim, audit: page });
});

// convenience export endpoint
app.get('/api/audit/export', authMiddleware, adminOnly, (req, res) => {
  // delegate to /api/audit with export=csv
  req.query.export = 'csv';
  return app._router.handle(req, res);
});

// provide commands list for console UI
app.get('/api/commands', authMiddleware, (req, res)=>{
  const db = readDB();
  res.json({ ok:true, commands: db.commands || [] });
});

app.get('/api/activity', (req, res) => {
  const cfg = readConfig();
  const db = readDB();
  const max = cfg.maxActivity || 7;
  const out = (db.activity||[]).slice(-max).map(a=>({ ts: a.ts, msg: a.msg }));
  res.json(out.reverse());
});

app.post('/api/activity', authMiddleware, (req, res) => {
  const msg = req.body.msg || 'Manual event';
  pushActivity(msg);
  io.emit('activity', { ts: Date.now(), msg });
  res.json({ ok:true });
});

app.post('/api/features', authMiddleware, (req, res) => {
  const chosen = req.body.features;
  if(Array.isArray(chosen)){
    const db = readDB(); db.features = chosen; writeDB(db);
    pushActivity('Features updated: ' + chosen.join(', '));
    io.emit('features', chosen);
    return res.json({ ok:true, features: chosen });
  }
  return res.status(400).json({ ok:false, error:'features should be an array' });
});

function pm2Available(){
  const cfg = readConfig();
  return cfg.pm2 && cfg.pm2.enabled;
}

app.get('/api/processes', authMiddleware, (req, res) => {
  if(!pm2Available()) return res.status(400).json({ ok:false, error:'pm2 not enabled in config' });
  exec('pm2 jlist', (err, stdout) => {
    if(err) return res.status(500).json({ ok:false, error: 'pm2 list failed', details: err.message });
    try{
      const parsed = JSON.parse(stdout);
      // map and add nice formatting for CPU (comma decimal) and memory (in GB)
      const procs = parsed.map(p => {
        const cpuRaw = p && p.monit && p.monit.cpu != null ? Number(p.monit.cpu) : null;
        const cpu = cpuRaw != null ? cpuRaw.toFixed(1).replace('.', ',') + '%' : 'n/a';
        const memBytes = p && p.monit && p.monit.memory != null ? Number(p.monit.memory) : null;
        const memGb = memBytes != null ? (memBytes / (1024 * 1024 * 1024)) : null;
        // show 2 decimals unless it's a whole number
        const mem = memGb != null ? (Number.isInteger(memGb) ? memGb.toFixed(0) + ' GB' : memGb.toFixed(2) + ' GB') : 'n/a';
        return {
          name: p.name,
          ID: p.pm_id,
          pm_id: p.pm_id,
          pid: p.pid,
          CPU: cpu,
          CPU_raw: cpuRaw,
          Mem: mem,
          Mem_bytes: memBytes,
          monit: p.monit,
          pm2_env: p.pm2_env
        };
      });
      res.json({ ok:true, processes: procs });
    }catch(e){ return res.status(500).json({ ok:false, error:'parsing pm2 output failed' }); }
  });
});

app.post('/api/processes/:action', authMiddleware, (req, res) => {
  if(!pm2Available()) return res.status(400).json({ ok:false, error:'pm2 not enabled in config' });
  const { action } = req.params;
  const id = req.body.id;
  if(!id) return res.status(400).json({ ok:false, error:'missing id' });
  const allowed = ['start','stop','restart','delete'];
  if(!allowed.includes(action)) return res.status(400).json({ ok:false, error:'invalid action' });
  exec(`pm2 ${action} ${id}`, (err, stdout, stderr) => {
    if(err) return res.status(500).json({ ok:false, error: stderr || err.message });
    pushActivity(`pm2 ${action} ${id}`);
    io.emit('activity', { ts: Date.now(), msg: `pm2 ${action} ${id}` });
    return res.json({ ok:true, out: stdout });
  });
});

// users
app.get('/api/users', authMiddleware, (req, res) => { const db = readDB(); res.json({ ok:true, users: db.users }); });

function adminOnly(req, res, next){ if(!req.user || req.user.role !== 'admin') return res.status(403).json({ ok:false, error:'admin required' }); return next(); }

// create user (admin only)
app.post('/api/users', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  const u = req.body || {};
  if(!u.username || !u.password) return res.status(400).json({ ok:false, error:'username and password required' });
  // hash password
  const hashed = bcrypt.hashSync(u.password, 10);
  const user = { username: u.username, password: hashed, role: u.role || 'user', displayName: u.displayName || u.username };
  db.users = db.users || [];
  db.users.push(user);
  writeDB(db);
  pushActivity('User created: ' + user.username);
  try{ pushAudit('user.created', req.user && req.user.username ? req.user.username : 'unknown', user.username); }catch(e){}
  res.json({ ok:true });
});

// update user (admin only)
app.put('/api/users/:username', authMiddleware, adminOnly, (req, res) => {
  const uname = req.params.username;
  const db = readDB();
  const idx = (db.users||[]).findIndex(u => u.username === uname);
  if(idx === -1) return res.status(404).json({ ok:false, error:'not found' });
  const incoming = req.body || {};
  if(incoming.password){ db.users[idx].password = bcrypt.hashSync(incoming.password, 10); }
  if(incoming.role) db.users[idx].role = incoming.role;
  if(incoming.displayName) db.users[idx].displayName = incoming.displayName;
  writeDB(db);
  pushActivity('User updated: ' + uname);
  try{ pushAudit('user.updated', req.user && req.user.username ? req.user.username : 'unknown', uname); }catch(e){}
  res.json({ ok:true });
});

// delete user (admin only)
app.delete('/api/users/:username', authMiddleware, adminOnly, (req, res) => {
  const uname = req.params.username;
  const db = readDB();
  const before = (db.users || []).length;
  db.users = (db.users || []).filter(u => u.username !== uname);
  writeDB(db);
  if(db.users.length === before) return res.status(404).json({ ok:false, error:'not found' });
  pushActivity('User deleted: ' + uname);
  try{ pushAudit('user.deleted', req.user && req.user.username ? req.user.username : 'unknown', uname); }catch(e){}
  res.json({ ok:true });
});

// whoami - return token user info
app.get('/api/whoami', authMiddleware, (req, res) => {
  res.json({ ok:true, user: req.user });
});

// notifications endpoint - content varies by role / auth
app.get('/api/notifications', async (req, res) => {
  const db = readDB();
  // try to detect user from header token
  const token = req.headers['x-auth-token'] || req.query.token;
  const user = token && db.tokens && db.tokens[token] ? db.tokens[token] : null;
  // basic metrics snapshot
  let metricsSnapshot = { cpu: 'n/a', memory: 'n/a', uptime: 0 };
  try{ const cpu = await osu.cpu.usage(); const mem = await osu.mem.info(); const up = osu.os.uptime(); metricsSnapshot = { cpu: Math.round(cpu)+'%', memory: Math.round(mem.usedMemPercentage)+'%', uptime: up }; }catch(e){}

  if(user && user.role === 'admin'){
  const recentActivity = (db.activity||[]).slice(-10).reverse();
  const alerts = db.alerts || [];
  return res.json({ ok:true, role:'admin', metrics: metricsSnapshot, activity: recentActivity, alerts });
  }

  if(user && user.role === 'user'){
    // normal users see a metrics-focused summary
    return res.json({ ok:true, role:'user', metrics: metricsSnapshot });
  }

  // unauthenticated: provide minimal public summary (recent public activity + metrics)
  const publicActivity = (db.activity||[]).slice(-5).map(a=>({ ts: a.ts, msg: a.msg })).reverse();
  return res.json({ ok:true, role:'public', metrics: metricsSnapshot, activity: publicActivity });
});

// audit retrieval for admins
app.get('/api/audit', authMiddleware, adminOnly, (req, res) => {
  const db = readDB();
  res.json({ ok:true, audit: db.audit || [] });
});

// backups feature removed

// monitored processes: get and update
app.get('/api/monitoredProcesses', authMiddleware, (req, res) => {
  const db = readDB();
  res.json({ ok:true, monitored: db.monitoredProcesses || [] });
});

app.post('/api/monitoredProcesses', authMiddleware, (req, res) => {
  const list = Array.isArray(req.body.list) ? req.body.list : [];
  const db = readDB();
  db.monitoredProcesses = list;
  writeDB(db);
  pushActivity('Monitored processes updated');
  io.emit('monitored', list);
  res.json({ ok:true, monitored: list });
});

server.listen(port, () => { console.log(`ServerPanel running on http://localhost:${port}`); });

// On startup: migrate plaintext passwords to bcrypt hashes (non-destructive check)
(() => {
  try{
    const db = readDB();
    let changed = false;
    if(Array.isArray(db.users)){
      db.users = db.users.map(u => {
        if(u && u.password && u.password.length && !u.password.startsWith('$2')){
          // treat as plaintext and hash it
          const hashed = bcrypt.hashSync(u.password, 10);
          changed = true;
          return Object.assign({}, u, { password: hashed });
        }
        return u;
      });
    }
    if(changed) writeDB(db);
  }catch(e){ console.log('password migration check failed', e && e.message); }
})();
