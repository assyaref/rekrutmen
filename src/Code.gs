/**
 * ============================================================
 *  APLIKASI REKRUTMEN - Backend Google Apps Script
 *  Database : Google Spreadsheet
 *  File CV  : Google Drive
 * ============================================================
 */
const SPREADSHEET_ID = '1mMQxGKMR0idaMDdMWx4H9v41Y1VITUYeydi1j65m-dI';
const DRIVE_FOLDER_ID = '1YkZb0yuUhwkswuy6hj983VuatNvWcPfx';
const SESSION_SECONDS = 21600; // 6 jam (maksimum CacheService)
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'odt', 'rtf', 'txt'];

const SCHEMA = {
  Settings: ['key', 'value'],
  Users: ['id', 'name', 'email', 'password', 'role', 'active', 'created_at', 'updated_at'],
  Jobs: ['id', 'title', 'department', 'location', 'type', 'salary', 'quota', 'deadline', 'status', 'description', 'requirements', 'created_at', 'updated_at'],
  Stages: ['id', 'name', 'color', 'order', 'is_final'],
  FormFields: ['id', 'label', 'key', 'type', 'options', 'placeholder', 'required', 'order', 'active'],
  Candidates: ['id', 'job_id', 'name', 'email', 'phone', 'stage_id', 'rating', 'answers', 'cv_url', 'cv_file_id', 'cv_name', 'source', 'notes', 'created_at', 'updated_at'],
  Interviews: ['id', 'candidate_id', 'title', 'datetime', 'duration', 'interviewer', 'location', 'status', 'score', 'feedback', 'created_at', 'updated_at'],
  Master: ['id', 'type', 'value', 'order'],
  EmailTemplates: ['id', 'name', 'trigger', 'subject', 'body', 'active'],
  Activity: ['id', 'candidate_id', 'user', 'action', 'detail', 'created_at'],
};

// Tabel yang boleh ditulis lewat API generik & role yang diizinkan
const WRITE_ROLES = {
  Jobs: ['admin', 'recruiter'],
  Candidates: ['admin', 'recruiter'],
  Interviews: ['admin', 'recruiter'],
  Stages: ['admin'],
  FormFields: ['admin'],
  Master: ['admin'],
  EmailTemplates: ['admin'],
  Users: ['admin'],
};
const PRIVATE_SETTING_KEYS = ['admin_notify_email'];

/* ======================= WEB APP ======================= */
function doGet(e) {
  ensureSetup_();
  const s = getSettings_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(s.company_name ? 'Karir · ' + s.company_name : 'Rekrutmen')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Endpoint HTTP untuk frontend yang di-hosting di luar Apps Script (mis. Vercel).
 * Frontend mengirim POST dengan Content-Type text/plain (tanpa preflight CORS)
 * berisi JSON {action, data, token}; respons berupa JSON hasil api().
 */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { req = {}; }
  return ContentService.createTextOutput(JSON.stringify(api(req)))
    .setMimeType(ContentService.MimeType.JSON);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Satu pintu untuk semua panggilan dari frontend. */
function api(req) {
  try {
    req = req || {};
    const action = req.action;
    const data = req.data || {};
    ensureSetup_();
    if (PUBLIC_ACTIONS[action]) return { ok: true, data: PUBLIC_ACTIONS[action](data) };
    const user = getSessionUser_(req.token);
    if (!user) return { ok: false, auth: true, error: 'Sesi berakhir, silakan login kembali.' };
    const fn = PRIVATE_ACTIONS[action];
    if (!fn) throw new Error('Aksi tidak dikenal: ' + action);
    return { ok: true, data: fn(data, user) };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/* ======================= PUBLIC ======================= */
const PUBLIC_ACTIONS = {
  publicData: function () {
    const settings = getSettings_();
    PRIVATE_SETTING_KEYS.forEach(function (k) { delete settings[k]; });
    const today = todayStr_();
    const jobs = readAll_('Jobs').filter(function (j) {
      return j.status === 'Open' && (!j.deadline || String(j.deadline).slice(0, 10) >= today);
    }).map(function (j) { return j; });
    return {
      settings: settings,
      jobs: jobs,
      fields: sortByOrder_(readAll_('FormFields').filter(function (f) { return isTrue_(f.active); })),
      masters: sortByOrder_(readAll_('Master')),
      appUrl: appUrl_(),
    };
  },

  apply: function (d) {
    if (d.website) return { id: 'ok' }; // honeypot anti-bot
    const job = findById_('Jobs', d.job_id);
    if (!job || job.status !== 'Open') throw new Error('Lowongan tidak tersedia.');
    const name = String(d.name || '').trim();
    const email = String(d.email || '').trim().toLowerCase();
    if (!name) throw new Error('Nama wajib diisi.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email tidak valid.');
    const settings = getSettings_();
    const answers = d.answers || {};
    readAll_('FormFields').filter(function (f) { return isTrue_(f.active) && isTrue_(f.required); })
      .forEach(function (f) {
        const v = answers[f.key];
        if (v === undefined || v === null || String(v).trim() === '' || (Array.isArray(v) && !v.length)) {
          throw new Error('"' + f.label + '" wajib diisi.');
        }
      });
    if (isTrue_(settings.cv_required) && !(d.file && d.file.data)) throw new Error('CV wajib diunggah.');
    const dup = readAll_('Candidates').some(function (c) {
      return String(c.email).toLowerCase() === email && c.job_id === job.id;
    });
    if (dup) throw new Error('Anda sudah melamar posisi ini dengan email tersebut.');

    const file = d.file && d.file.data ? saveFile_(d.file, job.title, name) : {};
    const firstStage = sortByOrder_(readAll_('Stages'))[0] || {};
    const cand = upsert_('Candidates', {
      job_id: job.id, name: name, email: email, phone: String(d.phone || '').trim(),
      stage_id: firstStage.id || '', rating: '', answers: JSON.stringify(answers),
      cv_url: file.cv_url || '', cv_file_id: file.cv_file_id || '', cv_name: file.cv_name || '',
      source: d.source || 'Website Karir', notes: '',
    });
    logActivity_(cand.id, 'Pelamar', 'Melamar', job.title);
    sendTemplate_('apply', cand);
    if (settings.admin_notify_email) {
      try {
        MailApp.sendEmail({
          to: settings.admin_notify_email,
          subject: '[Lamaran Baru] ' + name + ' - ' + job.title,
          htmlBody: 'Lamaran baru masuk.<br><b>Nama:</b> ' + esc_(name) + '<br><b>Email:</b> ' + esc_(email) +
            '<br><b>Posisi:</b> ' + esc_(job.title) + (file.cv_url ? '<br><a href="' + file.cv_url + '">Lihat CV</a>' : ''),
          name: settings.email_from_name || settings.company_name || 'Rekrutmen',
        });
      } catch (e) { /* abaikan kegagalan email */ }
    }
    return { id: cand.id };
  },

  login: function (d) {
    const email = String(d.email || '').trim().toLowerCase();
    const user = readAll_('Users').filter(function (u) { return String(u.email).toLowerCase() === email; })[0];
    if (!user || !isTrue_(user.active) || !checkPassword_(String(d.password || ''), user.password)) {
      Utilities.sleep(600);
      throw new Error('Email atau password salah.');
    }
    const token = Utilities.getUuid() + Utilities.getUuid();
    const safe = publicUser_(user);
    CacheService.getScriptCache().put('sess_' + token, JSON.stringify(safe), SESSION_SECONDS);
    return { token: token, user: safe };
  },
};

/* ======================= PRIVATE ======================= */
const PRIVATE_ACTIONS = {
  me: function (d, user) { return user; },

  logout: function (d, user) {
    CacheService.getScriptCache().remove('sess_' + user._token);
    return true;
  },

  bootstrap: function (d, user) {
    const out = {
      user: user,
      settings: getSettings_(),
      jobs: readAll_('Jobs'),
      stages: sortByOrder_(readAll_('Stages')),
      fields: sortByOrder_(readAll_('FormFields')),
      masters: sortByOrder_(readAll_('Master')),
      templates: readAll_('EmailTemplates'),
      candidates: readAll_('Candidates'),
      interviews: readAll_('Interviews'),
      users: readAll_('Users').map(publicUser_),
      appUrl: appUrl_(),
      folderUrl: 'https://drive.google.com/drive/folders/' + DRIVE_FOLDER_ID,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit',
    };
    if (user.role !== 'admin') out.users = out.users.map(function (u) { return { id: u.id, name: u.name, role: u.role }; });
    return out;
  },

  list: function (d) {
    if (!SCHEMA[d.table] || d.table === 'Users' || d.table === 'Settings') throw new Error('Tabel tidak valid.');
    return readAll_(d.table);
  },

  save: function (d, user) {
    const table = d.table;
    requireRole_(user, WRITE_ROLES[table]);
    const rec = sanitizeRecord_(table, d.record || {});
    let before = rec.id ? findById_(table, rec.id) : null;

    if (table === 'Users') {
      rec.email = String(rec.email || '').trim().toLowerCase();
      if (!rec.email) throw new Error('Email wajib diisi.');
      const clash = readAll_('Users').some(function (u) { return u.email.toLowerCase() === rec.email && u.id !== rec.id; });
      if (clash) throw new Error('Email sudah dipakai pengguna lain.');
      if (rec.password) rec.password = makePassword_(rec.password);
      else if (before) delete rec.password;
      else throw new Error('Password wajib diisi untuk pengguna baru.');
      if (before && before.id === user.id && (rec.role !== 'admin' || !isTrue_(rec.active))) {
        throw new Error('Anda tidak dapat menurunkan role / menonaktifkan akun sendiri.');
      }
    }
    if (table === 'FormFields') {
      rec.key = String(rec.key || rec.label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (!rec.key) throw new Error('Key wajib diisi.');
      if (['name', 'email', 'phone'].indexOf(rec.key) >= 0) throw new Error('Key "' + rec.key + '" sudah dipakai field bawaan.');
      const dupKey = readAll_('FormFields').some(function (f) { return f.key === rec.key && f.id !== rec.id; });
      if (dupKey) throw new Error('Key sudah dipakai field lain.');
    }
    if (table === 'Candidates' && !before) {
      if (!rec.stage_id) rec.stage_id = (sortByOrder_(readAll_('Stages'))[0] || {}).id || '';
      if (!rec.source) rec.source = 'Input Manual';
    }

    const saved = upsert_(table, rec);

    if (table === 'Candidates') {
      if (!before) logActivity_(saved.id, user.name, 'Kandidat ditambahkan', saved.source || '');
      else if (before.stage_id !== saved.stage_id) onStageChange_(saved, before.stage_id, user);
    }
    if (table === 'Interviews') {
      logActivity_(saved.candidate_id, user.name, before ? 'Interview diperbarui' : 'Interview dijadwalkan',
        (saved.title || '') + ' ' + (saved.datetime || '').replace('T', ' ') + ' (' + (saved.status || '') + ')');
    }
    return table === 'Users' ? publicUser_(saved) : saved;
  },

  remove: function (d, user) {
    const table = d.table;
    requireRole_(user, WRITE_ROLES[table]);
    if (table === 'Users' && d.id === user.id) throw new Error('Tidak bisa menghapus akun sendiri.');
    if (table === 'Stages' && readAll_('Candidates').some(function (c) { return c.stage_id === d.id; })) {
      throw new Error('Tahapan masih berisi kandidat. Pindahkan kandidat terlebih dahulu.');
    }
    if (table === 'Jobs' && readAll_('Candidates').some(function (c) { return c.job_id === d.id; })) {
      throw new Error('Lowongan masih memiliki kandidat. Ubah status menjadi "Closed" atau hapus kandidatnya dulu.');
    }
    if (table === 'Candidates') {
      const c = findById_('Candidates', d.id);
      if (c && c.cv_file_id) { try { DriveApp.getFileById(c.cv_file_id).setTrashed(true); } catch (e) {} }
      readAll_('Interviews').filter(function (i) { return i.candidate_id === d.id; })
        .forEach(function (i) { remove_('Interviews', i.id); });
    }
    remove_(table, d.id);
    return true;
  },

  reorder: function (d, user) {
    requireRole_(user, WRITE_ROLES[d.table]);
    if (['Stages', 'FormFields', 'Master'].indexOf(d.table) < 0) throw new Error('Tabel tidak bisa diurutkan.');
    (d.ids || []).forEach(function (id, i) { upsert_(d.table, { id: id, order: String(i + 1) }); });
    return true;
  },

  saveSettings: function (d, user) {
    requireRole_(user, ['admin']);
    const s = d.settings || {};
      delete READ_CACHE_.Settings;
    withLock_(function () {
      const sh = getSheet_('Settings');
      const last = sh.getLastRow();
      const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
      const idx = {};
      rows.forEach(function (r, i) { idx[String(r[0])] = i; });
      Object.keys(s).forEach(function (k) {
        if (!k) return;
        const v = toCell_(s[k]);
        if (idx[k] !== undefined) rows[idx[k]][1] = v;
        else { idx[k] = rows.length; rows.push([k, v]); }
      });
      if (rows.length) sh.getRange(2, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
    });
    return getSettings_();
  },

  uploadCV: function (d, user) {
    requireRole_(user, ['admin', 'recruiter']);
    const c = findById_('Candidates', d.candidate_id);
    if (!c) throw new Error('Kandidat tidak ditemukan.');
    const job = findById_('Jobs', c.job_id) || {};
    const f = saveFile_(d.file, job.title, c.name);
    if (c.cv_file_id) { try { DriveApp.getFileById(c.cv_file_id).setTrashed(true); } catch (e) {} }
    const saved = upsert_('Candidates', { id: c.id, cv_url: f.cv_url, cv_file_id: f.cv_file_id, cv_name: f.cv_name });
    logActivity_(c.id, user.name, 'CV diunggah', f.cv_name);
    return saved;
  },

  activity: function (d) {
    return readAll_('Activity').filter(function (a) { return a.candidate_id === d.candidate_id; })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  },

  sendEmail: function (d, user) {
    requireRole_(user, ['admin', 'recruiter']);
    const c = findById_('Candidates', d.candidate_id);
    if (!c) throw new Error('Kandidat tidak ditemukan.');
    const vars = tplVars_(c);
    const subject = renderTpl_(d.subject, vars);
    const body = renderTpl_(d.body, vars);
    if (!subject || !body) throw new Error('Subjek dan isi email wajib diisi.');
    const s = getSettings_();
    MailApp.sendEmail({
      to: c.email, subject: subject, htmlBody: body.replace(/\n/g, '<br>'),
      name: s.email_from_name || s.company_name || 'Rekrutmen', replyTo: user.email,
    });
    logActivity_(c.id, user.name, 'Email dikirim', subject);
    return true;
  },

  changePassword: function (d, user) {
    const u = findById_('Users', user.id);
    if (!u || !checkPassword_(String(d.old || ''), u.password)) throw new Error('Password lama salah.');
    if (String(d.new || '').length < 6) throw new Error('Password baru minimal 6 karakter.');
    upsert_('Users', { id: u.id, password: makePassword_(d.new) });
    return true;
  },

  updateProfile: function (d, user) {
    const name = String(d.name || '').trim();
    if (!name) throw new Error('Nama wajib diisi.');
    const saved = publicUser_(upsert_('Users', { id: user.id, name: name }));
    CacheService.getScriptCache().put('sess_' + user._token, JSON.stringify(saved), SESSION_SECONDS);
    return saved;
  },
};

/* ======================= STAGE / EMAIL ======================= */
function onStageChange_(cand, oldStageId, user) {
  const stages = readAll_('Stages');
  const from = stages.filter(function (s) { return s.id === oldStageId; })[0] || {};
  const to = stages.filter(function (s) { return s.id === cand.stage_id; })[0] || {};
  logActivity_(cand.id, user.name, 'Pindah tahap', (from.name || '-') + ' → ' + (to.name || '-'));
  sendTemplate_('stage:' + cand.stage_id, cand);
}

function tplVars_(cand) {
  const s = getSettings_();
  const job = findById_('Jobs', cand.job_id) || {};
  const stage = findById_('Stages', cand.stage_id) || {};
  return {
    name: cand.name, email: cand.email, phone: cand.phone, job: job.title || '',
    department: job.department || '', location: job.location || '', stage: stage.name || '',
    company: s.company_name || '', date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy'),
  };
}

function renderTpl_(str, vars) {
  return String(str || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) { return vars[k] != null ? vars[k] : ''; });
}

function sendTemplate_(trigger, cand) {
  const s = getSettings_();
  if (!isTrue_(s.email_notifications) || !cand.email) return;
  const tpls = readAll_('EmailTemplates').filter(function (t) { return isTrue_(t.active) && t.trigger === trigger; });
  if (!tpls.length) return;
  const vars = tplVars_(cand);
  tpls.forEach(function (t) {
    try {
      MailApp.sendEmail({
        to: cand.email, subject: renderTpl_(t.subject, vars),
        htmlBody: renderTpl_(t.body, vars).replace(/\n/g, '<br>'),
        name: s.email_from_name || s.company_name || 'Rekrutmen',
      });
      logActivity_(cand.id, 'Sistem', 'Email otomatis', t.name);
    } catch (e) {
      logActivity_(cand.id, 'Sistem', 'Email gagal', t.name + ': ' + e.message);
    }
  });
}

/* ======================= FILE ======================= */
function saveFile_(file, jobTitle, candName) {
  if (!file || !file.data) throw new Error('File kosong.');
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  if (ALLOWED_EXT.indexOf(ext) < 0) throw new Error('Format file tidak didukung (' + ALLOWED_EXT.join(', ') + ').');
  const bytes = Utilities.base64Decode(file.data);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Ukuran file maksimal 10 MB.');
  const safe = String(candName || 'kandidat').replace(/[^\w\- ]+/g, '').trim() || 'kandidat';
  const fname = safe + ' - CV - ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '.' + ext;
  const root = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const folderName = String(jobTitle || 'Umum').replace(/[\/\\]/g, '-');
  const it = root.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : root.createFolder(folderName);
  const f = folder.createFile(Utilities.newBlob(bytes, file.mime || 'application/octet-stream', fname));
  return { cv_url: f.getUrl(), cv_file_id: f.getId(), cv_name: fname };
}

/* ======================= AUTH ======================= */
function hash_(pw, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pw, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function makePassword_(pw) {
  if (String(pw).length < 6) throw new Error('Password minimal 6 karakter.');
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return salt + '$' + hash_(String(pw), salt);
}
function checkPassword_(pw, stored) {
  const parts = String(stored || '').split('$');
  return parts.length === 2 && hash_(pw, parts[0]) === parts[1];
}
function getSessionUser_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  const u = JSON.parse(raw);
  u._token = token;
  return u;
}
function publicUser_(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, created_at: u.created_at };
}
function requireRole_(user, roles) {
  if (!roles || roles.indexOf(user.role) < 0) throw new Error('Anda tidak memiliki akses untuk aksi ini.');
}

/* ======================= DATA LAYER ======================= */
let SS_CACHE_ = null;
const SHEET_CACHE_ = {};

function ss_() { return SS_CACHE_ || (SS_CACHE_ = SpreadsheetApp.openById(SPREADSHEET_ID)); }

function getSheet_(name) {
  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];
  let sh = ss_().getSheetByName(name);
  if (!sh) sh = ss_().insertSheet(name);
  const want = SCHEMA[name] || [];
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  const isEmpty = head.every(function (h) { return !h; });
  if (isEmpty) {
    sh.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold').setBackground('#eef2ff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), want.length).setNumberFormat('@');
  } else {
    const missing = want.filter(function (h) { return head.indexOf(h) < 0; });
    if (missing.length) {
      const start = head.filter(String).length + 1;
      sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#eef2ff');
      sh.getRange(1, start, sh.getMaxRows(), missing.length).setNumberFormat('@');
    }
  }
  SHEET_CACHE_[name] = sh;
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function rowToObj_(h, r) {
  const o = {};
  h.forEach(function (k, i) {
    if (!k) return;
    let v = r[i];
    if (v instanceof Date) v = v.toISOString();
    else if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
    o[k] = v == null ? '' : v;
  });
  return o;
}

const READ_CACHE_ = {};
function readAll_(name) {
  if (!READ_CACHE_[name]) {
    const sh = getSheet_(name);
    const last = sh.getLastRow();
    let rows = [];
    if (last >= 2) {
      const vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
      const h = vals.shift().map(String);
      rows = vals.filter(function (r) { return r[0] !== '' && r[0] != null; })
        .map(function (r) { return rowToObj_(h, r); });
    }
    READ_CACHE_[name] = rows;
  }
  // kembalikan salinan agar cache tidak termodifikasi
  return READ_CACHE_[name].map(function (r) { return Object.assign({}, r); });
}

function findById_(name, id) {
  if (!id) return null;
  return readAll_(name).filter(function (r) { return String(r.id) === String(id); })[0] || null;
}

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (/^[=]/.test(v)) v = "'" + v; // cegah formula injection
  return v;
}

function newId_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function upsert_(name, rec) {
  delete READ_CACHE_[name];
  return withLock_(function () {
    const sh = getSheet_(name);
    const h = headers_(sh);
    const last = sh.getLastRow();
    const now = new Date().toISOString();
    let rowIdx = -1, existing = null;
    if (rec.id && last >= 2) {
      const ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(rec.id)) { rowIdx = i + 2; break; }
      }
      if (rowIdx > 0) existing = rowToObj_(h, sh.getRange(rowIdx, 1, 1, h.length).getValues()[0]);
    }
    const out = Object.assign({}, existing || {}, rec);
    if (!out.id) out.id = newId_();
    if (h.indexOf('created_at') >= 0 && !out.created_at) out.created_at = now;
    if (h.indexOf('updated_at') >= 0) out.updated_at = now;
    const row = h.map(function (k) { return k ? toCell_(out[k]) : ''; });
    if (rowIdx > 0) {
      sh.getRange(rowIdx, 1, 1, h.length).setValues([row]);
    } else {
      sh.getRange(last + 1, 1, 1, h.length).setNumberFormat('@').setValues([row]);
    }
    return rowToObj_(h, row.map(function (c) { return String(c).replace(/^'(?==)/, ''); }));
  });
}

function remove_(name, id) {
  delete READ_CACHE_[name];
  return withLock_(function () {
    const sh = getSheet_(name);
    const last = sh.getLastRow();
    if (last < 2) return false;
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return true; }
    }
    return false;
  });
}

function sanitizeRecord_(table, rec) {
  const allowed = SCHEMA[table];
  const out = {};
  Object.keys(rec).forEach(function (k) {
    if (allowed.indexOf(k) >= 0 && k !== 'created_at' && k !== 'updated_at') out[k] = rec[k];
  });
  return out;
}

function logActivity_(candId, user, action, detail) {
  try { upsert_('Activity', { candidate_id: candId, user: user, action: action, detail: detail || '' }); } catch (e) {}
}

function getSettings_() {
  const o = {};
  readAll_('Settings').forEach(function (r) { o[r.key] = r.value; });
  return o;
}

/* ======================= UTIL ======================= */
function isTrue_(v) { return v === true || String(v).toLowerCase() === 'true' || v === '1'; }
function sortByOrder_(arr) { return arr.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); }); }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function appUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

/* ======================= SETUP & SEED ======================= */
function ensureSetup_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_DONE') === '3') return;
  setup();
}

/** Jalankan sekali dari editor (atau otomatis saat pertama kali dibuka). Aman dijalankan ulang. */
function setup() {
  Object.keys(SCHEMA).forEach(getSheet_);
  const seed = function (name, rows) {
    if (readAll_(name).length) return;
    rows.forEach(function (r) { upsert_(name, r); });
  };

  const settings = getSettings_();
  const defaults = {
    company_name: 'PT Contoh Sejahtera',
    tagline: 'Bergabunglah dan tumbuh bersama kami',
    logo_url: '',
    primary_color: '#4f46e5',
    careers_title: 'Lowongan Pekerjaan',
    careers_intro: 'Kami mencari talenta terbaik untuk tumbuh bersama. Temukan posisi yang sesuai dan kirim lamaran Anda hari ini.',
    footer_text: '© PT Contoh Sejahtera. Semua hak dilindungi.',
    apply_button_text: 'Lamar Sekarang',
    success_message: 'Terima kasih! Lamaran Anda telah kami terima. Tim kami akan menghubungi Anda bila profil Anda sesuai.',
    cv_required: 'true',
    cv_label: 'Upload CV (PDF/DOC, maks 10 MB)',
    email_notifications: 'true',
    email_from_name: 'Tim Rekrutmen',
    admin_notify_email: '',
    show_salary: 'true',
    careers_benefits: 'Lingkungan Kolaboratif | Tim yang suportif dan budaya kerja yang saling menghargai.\n' +
      'Pengembangan Karier | Pelatihan rutin dan jenjang karier yang jelas.\n' +
      'Benefit Kompetitif | Gaji bersaing, BPJS, dan tunjangan yang menarik.\n' +
      'Keseimbangan Hidup | Jam kerja yang sehat dan cuti yang memadai.',
    cta_title: 'Belum menemukan posisi yang cocok?',
    cta_text: 'Kirimkan CV Anda kepada kami. Kami akan menghubungi Anda saat ada posisi yang sesuai dengan profil Anda.',
    cta_email: '',
  };
  const missing = {};
  Object.keys(defaults).forEach(function (k) { if (settings[k] === undefined) missing[k] = defaults[k]; });
  if (Object.keys(missing).length) {
    delete READ_CACHE_.Settings;
    const sh = getSheet_('Settings');
    const rows = Object.keys(missing).map(function (k) { return [k, missing[k]]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
  }

  seed('Stages', [
    { name: 'Lamaran Masuk', color: '#64748b', order: '1', is_final: '' },
    { name: 'Screening', color: '#0ea5e9', order: '2', is_final: '' },
    { name: 'Interview', color: '#f59e0b', order: '3', is_final: '' },
    { name: 'Offering', color: '#8b5cf6', order: '4', is_final: '' },
    { name: 'Diterima', color: '#16a34a', order: '5', is_final: 'hired' },
    { name: 'Ditolak', color: '#dc2626', order: '6', is_final: 'rejected' },
  ]);

  seed('FormFields', [
    { label: 'Tanggal Lahir', key: 'tanggal_lahir', type: 'date', options: '', placeholder: '', required: 'false', order: '1', active: 'true' },
    { label: 'Domisili', key: 'domisili', type: 'text', options: '', placeholder: 'Kota tempat tinggal', required: 'true', order: '2', active: 'true' },
    { label: 'Pendidikan Terakhir', key: 'pendidikan', type: 'select', options: 'SMA/SMK\nD3\nS1\nS2\nS3', placeholder: '', required: 'true', order: '3', active: 'true' },
    { label: 'Pengalaman Kerja (tahun)', key: 'pengalaman', type: 'number', options: '', placeholder: '0', required: 'true', order: '4', active: 'true' },
    { label: 'Ekspektasi Gaji', key: 'ekspektasi_gaji', type: 'text', options: '', placeholder: 'Contoh: 8.000.000', required: 'false', order: '5', active: 'true' },
    { label: 'Profil LinkedIn / Portofolio', key: 'linkedin', type: 'url', options: '', placeholder: 'https://', required: 'false', order: '6', active: 'true' },
    { label: 'Ceritakan tentang diri Anda', key: 'cover_letter', type: 'textarea', options: '', placeholder: '', required: 'false', order: '7', active: 'true' },
  ]);

  seed('Master', [
    { type: 'department', value: 'Human Resources', order: '1' },
    { type: 'department', value: 'IT', order: '2' },
    { type: 'department', value: 'Finance', order: '3' },
    { type: 'department', value: 'Marketing', order: '4' },
    { type: 'department', value: 'Operasional', order: '5' },
    { type: 'location', value: 'Jakarta', order: '1' },
    { type: 'location', value: 'Bandung', order: '2' },
    { type: 'location', value: 'Surabaya', order: '3' },
    { type: 'location', value: 'Remote', order: '4' },
    { type: 'job_type', value: 'Full-time', order: '1' },
    { type: 'job_type', value: 'Part-time', order: '2' },
    { type: 'job_type', value: 'Kontrak', order: '3' },
    { type: 'job_type', value: 'Magang', order: '4' },
    { type: 'source', value: 'Website Karir', order: '1' },
    { type: 'source', value: 'LinkedIn', order: '2' },
    { type: 'source', value: 'Jobstreet', order: '3' },
    { type: 'source', value: 'Referensi Karyawan', order: '4' },
    { type: 'source', value: 'Input Manual', order: '5' },
  ]);

  const stages = sortByOrder_(readAll_('Stages'));
  const stageBy = function (n) { return (stages.filter(function (s) { return s.name === n; })[0] || {}).id || ''; };
  seed('EmailTemplates', [
    { name: 'Konfirmasi Lamaran', trigger: 'apply', active: 'true',
      subject: 'Lamaran Anda untuk posisi {{job}} telah diterima',
      body: 'Halo {{name}},\n\nTerima kasih telah melamar posisi {{job}} di {{company}}. Lamaran Anda sudah kami terima dan sedang dalam proses peninjauan.\n\nSalam,\nTim Rekrutmen {{company}}' },
    { name: 'Undangan Interview', trigger: 'stage:' + stageBy('Interview'), active: 'true',
      subject: 'Undangan Interview - {{job}}',
      body: 'Halo {{name}},\n\nSelamat! Anda lolos ke tahap interview untuk posisi {{job}}. Tim kami akan segera menghubungi Anda untuk jadwal detail.\n\nSalam,\nTim Rekrutmen {{company}}' },
    { name: 'Selamat Diterima', trigger: 'stage:' + stageBy('Diterima'), active: 'true',
      subject: 'Selamat! Anda diterima sebagai {{job}}',
      body: 'Halo {{name}},\n\nDengan senang hati kami informasikan bahwa Anda diterima untuk posisi {{job}} di {{company}}.\n\nSalam,\nTim Rekrutmen {{company}}' },
    { name: 'Pemberitahuan Tidak Lolos', trigger: 'stage:' + stageBy('Ditolak'), active: 'false',
      subject: 'Hasil Seleksi - {{job}}',
      body: 'Halo {{name}},\n\nTerima kasih atas minat Anda pada posisi {{job}}. Setelah pertimbangan, kami memutuskan untuk melanjutkan dengan kandidat lain. Semoga sukses untuk karier Anda.\n\nSalam,\nTim Rekrutmen {{company}}' },
    { name: 'Email Bebas', trigger: 'manual', active: 'true',
      subject: 'Informasi Rekrutmen - {{job}}',
      body: 'Halo {{name}},\n\n...\n\nSalam,\nTim Rekrutmen {{company}}' },
  ]);

  seed('Jobs', [{
    title: 'Staff Administrasi', department: 'Operasional', location: 'Jakarta', type: 'Full-time',
    salary: 'Rp 5.000.000 - Rp 7.000.000', quota: '2', deadline: '', status: 'Open',
    description: 'Mengelola administrasi harian, dokumen, dan mendukung operasional kantor.',
    requirements: '- Minimal D3 semua jurusan\n- Menguasai Microsoft Office\n- Teliti dan komunikatif',
  }]);

  if (!readAll_('Users').length) {
    upsert_('Users', { name: 'Administrator', email: 'admin@admin.com', password: makePassword_('admin123'), role: 'admin', active: 'true' });
  }

  // Cek akses folder Drive
  DriveApp.getFolderById(DRIVE_FOLDER_ID).getName();
  PropertiesService.getScriptProperties().setProperty('SETUP_DONE', '3');
  return 'Setup selesai';
}
