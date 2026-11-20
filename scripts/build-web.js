#!/usr/bin/env node
/**
 * Build frontend statis (web/index.html) untuk di-hosting di Vercel.
 * Menggabungkan src/Index.html + Styles + Template + App, lalu mengganti
 * google.script.run dengan fetch() ke endpoint doPost Apps Script.
 *
 * Pemakaian: GAS_URL=https://script.google.com/macros/s/XXX/exec node scripts/build-web.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'web');
const GAS_URL = process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbx45EcCwwrQ_h5WHycl2cYJz1hMmZYeWO-Spuzfl3Vi3GzR8QbILgVbuX_zOqs3V7NQ-g/exec';

const read = (n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');

const shim = `<script>
window.GAS_URL = ${JSON.stringify(GAS_URL)};
window.APP_URL = location.origin + location.pathname;
window.google = { script: {
  url: { getLocation: function (cb) { var p = {}; new URLSearchParams(location.search).forEach(function (v, k) { p[k] = v; }); cb({ parameter: p }); } },
  get run() {
    var ok = function () {}, fail = function () {};
    var o = {
      withSuccessHandler: function (f) { ok = f; return o; },
      withFailureHandler: function (f) { fail = f; return o; },
      api: function (req) {
        fetch(window.GAS_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req) })
          .then(function (r) { return r.text(); })
          .then(function (t) {
            try { ok(JSON.parse(t)); }
            catch (e) { fail(new Error('Server belum siap. Pemilik aplikasi perlu menjalankan fungsi "setup" di Apps Script untuk memberi izin.')); }
          })
          .catch(function () { fail(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.')); });
      }
    };
    return o;
  }
} };
</script>`;

let html = read('Index').replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (m, n) => read(n));
html = html.replace('<base target="_top">', '').replace('<head>', '<head>\n  <title>Karir &amp; Rekrutmen</title>\n  ' + shim);
if (/<\?/.test(html)) throw new Error('Masih ada scriptlet Apps Script yang belum diproses.');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('web/index.html dibuat (' + html.length + ' byte) → backend: ' + GAS_URL);
