// Harness lokal: menjalankan Code.gs dengan mock layanan Google Apps Script.
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

// ---------- Mock Spreadsheet ----------
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => {
      const ri = this.r - 1 + i;
      while (this.sh.data.length <= ri) this.sh.data.push([]);
      if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
      this.sh.data[ri][this.c - 1 + j] = v;
    }));
    return this;
  }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getLastRow() { let n = 0; this.data.forEach((r, i) => { if (r.some(v => v !== '' && v != null)) n = i + 1; }); return n; }
  getLastColumn() { return this.data.reduce((m, r) => { let n = 0; r.forEach((v, i) => { if (v !== '' && v != null) n = i + 1; }); return Math.max(m, n); }, 0); }
  getMaxRows() { return 1000; }
  getRange(r, c, nr, nc) { if (typeof r === 'string') return new Range(this, 1, 1, 1, 1); return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  setFrozenRows() {}
  deleteRow(i) { this.data.splice(i - 1, 1); }
}
const sheets = {};
const DB_FILE = path.join(__dirname, 'db.json');
if (fs.existsSync(DB_FILE)) Object.entries(JSON.parse(fs.readFileSync(DB_FILE))).forEach(([k, v]) => { sheets[k] = new Sheet(k); sheets[k].data = v; });
const persist = () => fs.writeFileSync(DB_FILE, JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.data]))));
const SS = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)) };

const cache = new Map();
const props = new Map();
const files = {};
const mails = [];
const folder = (name) => ({
  getName: () => name,
  getFoldersByName: (n) => { let done = false; return { hasNext: () => !done && !!files['dir:' + n], next: () => { done = true; return folder(n); } }; },
  createFolder: (n) => { files['dir:' + n] = true; return folder(n); },
  createFile: (blob) => { const id = 'f' + Object.keys(files).length; files[id] = blob; return { getUrl: () => 'https://drive.google.com/file/d/' + id + '/view', getId: () => id }; },
});

const ctx = {
  console,
  SpreadsheetApp: { openById: () => SS },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    base64Decode: s => [...Buffer.from(s, 'base64')],
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    formatDate: (d, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      return f.replace('yyyy', d.getFullYear()).replace('MMM', 'Nov').replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
        .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
    },
    sleep: () => {},
  },
  Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
  DriveApp: { getFolderById: () => folder('root'), getFileById: id => ({ setTrashed: () => { delete files[id]; } }) },
  MailApp: { sendEmail: o => { mails.push(o); console.log('[MAIL]', o.to, '|', o.subject); } },
  ScriptApp: { getService: () => ({ getUrl: () => 'http://localhost:8080/exec' }) },
  HtmlService: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8'), ctx);

const include = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
const shim = `<script>window.google={script:{url:{getLocation:cb=>{const p={};new URLSearchParams(location.search).forEach((v,k)=>p[k]=v);cb({parameter:p})}},get run(){let ok=()=>{},fail=()=>{};const o={withSuccessHandler(f){ok=f;return o},withFailureHandler(f){fail=f;return o},api(req){fetch('/rpc',{method:'POST',body:JSON.stringify(req)}).then(r=>r.json()).then(ok,fail)}};return o}}};</script>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      const r = JSON.parse(JSON.stringify(ctx.api(JSON.parse(body))));
      persist();
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
    });
    return;
  }
  if (req.url === '/vue.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(__dirname, 'node_modules/vue/dist/vue.global.prod.js'))); }
  if (req.url === '/_mails') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(mails)); }
  if (process.env.WEB) { // uji build Vercel (web/index.html)
    const w = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8')
      .replace('https://cdn.jsdelivr.net/npm/vue@3.4.38/dist/vue.global.prod.js', '/vue.js').replace(/<link[^>]+fonts[^>]+>/g, '');
    res.setHeader('Content-Type', 'text/html'); return res.end(w);
  }
  let html = include('Index').replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (m, n) => include(n));
  html = html.replace('https://cdn.jsdelivr.net/npm/vue@3.4.38/dist/vue.global.prod.js', '/vue.js').replace(/<link[^>]+fonts[^>]+>/g, '');
  html = html.replace('<head>', '<head>' + shim);
  res.setHeader('Content-Type', 'text/html'); res.end(html);
}).listen(8080, () => console.log('http://localhost:8080'));
