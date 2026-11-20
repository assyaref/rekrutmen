# Aplikasi Rekrutmen (Google Apps Script)

- **Database:** Spreadsheet `1mMQxGKMR0idaMDdMWx4H9v41Y1VITUYeydi1j65m-dI` (sheet dibuat otomatis)
- **File CV:** Folder Drive `1YkZb0yuUhwkswuy6hj983VuatNvWcPfx` (subfolder per lowongan)

## Cara deploy (±5 menit)

1. Buka https://script.google.com → **Proyek baru**. Beri nama, misalnya "Rekrutmen".
2. Klik ⚙️ **Setelan proyek** → centang **"Tampilkan file manifes appsscript.json di editor"**.
3. Di editor, buat file berikut, lalu salin isi dari folder `src/`:
   | File di editor | Isi dari |
   |---|---|
   | `Code.gs` (sudah ada, ganti isinya) | `src/Code.gs` |
   | `appsscript.json` (ganti isinya) | `src/appsscript.json` |
   | HTML → `Index` | `src/Index.html` |
   | HTML → `Styles` | `src/Styles.html` |
   | HTML → `Template` | `src/Template.html` |
   | HTML → `App` | `src/App.html` |
4. Pilih fungsi **`setup`** di toolbar → **Jalankan** → izinkan akses (Spreadsheet, Drive, Email).
   Ini membuat semua sheet + data awal di spreadsheet Anda.
5. **Terapkan → Deployment baru** → jenis **Aplikasi web**
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
   → **Terapkan**. Salin URL `.../exec` — itulah aplikasi online Anda.

> Setiap kali kode diubah: **Terapkan → Kelola deployment → Edit → Versi baru**, agar URL yang sama ikut terbarui.

## URL
- Halaman karir publik: `URL/exec`
- Panel admin: `URL/exec?page=admin`
- Link langsung ke lowongan: `URL/exec?job=<id>` (tombol 🔗 di menu Lowongan)

**Login awal:** `admin@admin.com` / `admin123` → **segera ganti password** di menu *Akun Saya*.

## Fitur (semua bisa diatur dari UI)
- **Halaman karir publik**: daftar lowongan, filter, detail, form lamaran + upload CV ke Drive, anti-duplikat & anti-bot.
- **Dashboard**: statistik kandidat per tahapan & per lowongan, pelamar terbaru, interview mendatang.
- **Lowongan**: tambah/edit/hapus, status Open/Closed/Draft, batas waktu, kuota, salin link.
- **Kandidat**: Kanban drag-and-drop & tabel, pencarian/filter, rating bintang, catatan, ganti CV, kirim email, riwayat aktivitas, export CSV, tambah kandidat manual.
- **Interview**: jadwal, pewawancara, link meeting, status, skor & feedback.
- **Pengaturan**
  - *Umum & Tampilan*: nama perusahaan, logo, warna, teks halaman karir, pesan sukses, CV wajib/tidak, notifikasi email.
  - *Tahapan Seleksi*: tambah/ubah/urutkan/warna, tandai tahap akhir Diterima/Ditolak.
  - *Form Lamaran*: buat pertanyaan sendiri (teks, paragraf, angka, tanggal, dropdown, radio, checkbox, URL, dll).
  - *Data Master*: departemen, lokasi, tipe kerja, sumber kandidat (bisa tambah jenis baru).
  - *Template Email*: email otomatis saat melamar / pindah tahap, dengan variabel `{{name}}`, `{{job}}`, dll.
  - *Pengguna*: role Admin / Recruiter / Viewer.

## Catatan
- File CV mengikuti izin folder Drive. Bagikan folder tersebut ke tim HR agar mereka bisa membuka CV.
- Kuota email Apps Script: ±100 email/hari (akun Gmail biasa), ±1.500/hari (Google Workspace).
- Folder `test/` hanya untuk pengujian lokal, tidak ikut di-push ke Apps Script.

## Deployment aktif
- Web app: https://script.google.com/macros/s/AKfycbx45EcCwwrQ_h5WHycl2cYJz1hMmZYeWO-Spuzfl3Vi3GzR8QbILgVbuX_zOqs3V7NQ-g/exec
- Editor: https://script.google.com/d/1S7cobYPMJSnDTGCG-hNVRUCQ9KagBfJF7lma4tdfrVjD2tZ9VTsw35DT/edit
- Update kode (dari root repo, `.clasp.json` sudah mengarah ke `src/`):
  ```bash
  npm i -g @google/clasp && clasp login
  clasp push -f && clasp update-deployment AKfycbx45EcCwwrQ_h5WHycl2cYJz1hMmZYeWO-Spuzfl3Vi3GzR8QbILgVbuX_zOqs3V7NQ-g
  ```

## Pengujian lokal
Simulasi Apps Script (Spreadsheet/Drive/Mail palsu) + uji browser Playwright:
```bash
cd test && npm install
node server.js        # buka http://localhost:8080
node e2e.js shots     # di terminal lain
```
