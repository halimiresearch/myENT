# Tindak Lanjut Audit 001: A-01 s/d A-05

Tanggal: 2026-10-18
Mode: antislop AFTER (perbaikan nomor yang disetujui user: "A-01 sampai A-05")
Status: **SELESAI + terverifikasi**. Nomor lain (A-06, B-01 s/d B-17) tidak disentuh.

Verifikasi memakai aplikasi yang benar-benar jalan: Postgres sementara di `/tmp/opencode/pg`
(port 5433, `initdb` sendiri karena Postgres sistem butuh sudo), migrasi + seed,
API `nest start` (port 3000), admin `next dev` (port 3102, `TURNSTILE_DISABLED=true`), lalu
click-through di browser. Semua proses sudah dimatikan lagi setelah verifikasi.

## Ringkasan Delivery Gate

| Aturan | Temuan | Status | Bukti utama |
|---|---|---|---|
| R-26 | A-01 tombol form mati | PASS | `type=submit` aktif; submit via klik nyata berhasil di 3 form (kegiatan, lokasi, roster) |
| R-25 | A-02 kontras gagal | PASS | Rasio dihitung ulang + sweep kontras DOM 6 halaman: 0 pelanggaran |
| R-27 | A-03 loading/error state | PASS | Skeleton `role=status` tampil; 13 halaman render tanpa alert; empty state Analitik benar |
| R-32 | A-04 drawer keyboard | PASS | Escape menutup, Tab/Shift+Tab wrap, fokus masuk drawer saat buka |
| R-02 | A-05 em dash | PASS | 0 em dash di teks user-visible (grep + scan DOM 13 halaman) |
| R-35 | Gate pengiriman | PASS | tsc admin+api, vitest 12, jest 28, `next build`, `flutter analyze` semua hijau |

Catatan R-35: mobile dianalisis statis (`flutter analyze`) tapi tidak dijalankan di
emulator/device. Perubahan mobile hanya 4 string teks, tidak menyentuh logika.

## Detail per temuan

### A-01 (R-26): 12 form admin tidak bisa disubmit

Akar masalah diperbaiki sekali di `apps/admin/lib/ui.tsx:100`:

```tsx
return <button type={onClick ? 'button' : 'submit'} onClick={onClick} ...>
```

Tombol `Btn` tanpa `onClick` (selalu tombol submit form) kini default `submit`;
yang punya `onClick` (Approve/Tolak/Cari/Export/dll) tetap `type="button"`.
Semua 12 form ikut sembuh tanpa menyentuh call site.

Bukti klik nyata di browser:
- Form kegiatan: DOM `BUTTON:submit:Buat DRAFT`; klik submit → `POST /api/meetings 201` → baris "Rapat Uji A-01" muncul di tabel.
- Detail kegiatan: `BUTTON:submit:Simpan lokasi`; klik → `PATCH /api/meetings/:id 200` → latitude -7.98 / longitude 112.63 / radiusM 150 tersimpan di DB.
- Piket: `BUTTON:submit:Generate roster`; klik → `POST /api/duty/roster 201` → 7 kegiatan piket DRAFT terbuat.

### A-02 (R-25): kontras teks gagal

Perubahan:
- `text-gray-400` → `text-gray-500` di 11 file admin (semua pemakaian: teks tabel, subjudul kartu, placeholder, label grup sidebar).
- Subjudul `PageHeader` (`ui.tsx:81`) dan tanggal header (`shell.tsx:192`) yang duduk di canvas: `gray-500` → `gray-600`.
- Chip peringkat emas di Analitik: `text-yellow-700` → `text-yellow-800`.

Rasio (dihitung oklch→sRGB, rumus WCAG):
- gray-500 (4.83:1 di putih, 4.66:1 di gray-50) lulus ambang 4.5:1.
- gray-600 6.83:1 di canvas.
- yellow-800 6.16:1 di gold-100 (sebelumnya yellow-700 cuma 4.44:1).

Bukti tambahan: sweep otomatis di DOM (semua teks visible vs background efektif di
Dashboard, Kegiatan, Anggota, Analitik, Konfigurasi, Inventaris): **0 teks di bawah ambang**.

### A-03 (R-27): tanpa loading state dan error senyap

Yang ditambahkan:
- Gate loading (`first` state + `.finally`) di Kegiatan, Detail Kegiatan, Anggota, Rekap,
  Konfigurasi, Pengumuman, Inventaris, Analitik. Pakai komponen `Loading` yang sudah ada.
- Analitik: `Points` (Poin Keaktifan) dapat state loading + error (sebelumnya `.then(setRows)` tanpa `.catch`).
- Inventaris: tombol "Riwayat" dibungkus try/catch, error tampil di `Err`.
- Detail Kegiatan: QR gagal dimuat tidak lagi senyap (`catch(() => {})` → pesan "QR gagal dimuat" di kartu).
- Piket: tombol jadi `disabled` + label "Memproses..." selama request.
- Profil: tombol ganti password dan setup 2FA `disabled` selama request.
- Bonus temuan saat verifikasi: gate lama Analitik (`semua array kosong = Memuat...`) membuat
  skeleton berputar selamanya di DB kosong. Diganti state `done` + Empty state di kartu Tren.

Bukti: skeleton `[status] "Memuat..."` tertangkap live saat halaman Kegiatan pertama load;
13 halaman admin dibuka berurutan, semua render tanpa `[role=alert]`; di DB kosong Analitik
kini menampilkan "Belum ada data" (bukan skeleton selamanya).

### A-04 (R-32): drawer mobile tidak bisa ditutup dengan keyboard

Di `apps/admin/app/shell.tsx`:
- `useEffect` saat drawer terbuka: fokus pindah ke elemen pertama di drawer, Escape menutup,
  Tab dari elemen terakhir wrap ke pertama, Shift+Tab dari pertama wrap ke terakhir,
  fokus dikembalikan ke elemen sebelumnya saat drawer tutup.
- `<aside role="dialog" aria-modal="true">` untuk pembaca layar.

Bukti keyboard live di browser (viewport desktop, utility `lg:hidden` di-override khusus tes
supaya drawer bisa terbuka):
- Buka drawer: fokus otomatis masuk ke elemen pertama ("Jurnalistik Admin Panel").
- Tab dari "Profil" (elemen terakhir) → fokus pindah ke elemen pertama.
- Shift+Tab dari elemen pertama → fokus pindah ke "Profil".
- Escape → drawer hilang dari DOM. Console bersih (satu-satunya error adalah iframe tes sendiri yang diblokir X-Frame-Options).

### A-05 (R-02): em dash di teks user-visible

Total 16 string diganti (titik dua, titik, atau tanda kurung):
- Admin 6: `page.tsx` ("Perlu Perhatian: Sering Alpha"), `meetings/[id]` 2, `members` 1, `duty` 1, `reset` 1.
- Mobile 4: `presensi_page.dart` 3 (izin lokasi/GPS), `tugas_page.dart` 1.
- API 6: `recap-pdf.ts` 1 (di PDF rekap) plus 5 pesan exception yang tampil di UI:
  `auth.service.ts:281`, `meetings.service.ts:164`, `attendance.rules.ts:23`,
  `absence.service.ts:32`, `correction.service.ts:32`. Lima ini tidak masuk daftar awal
  audit (grep audit terpotong), ditemukan saat verifikasi dan langsung dibetulkan karena
  sekelas (pesan tampil ke user).

Bukti: grep sisa em dash user-visible = 0 (yang tersisa hanya komentar kode, judul
`describe()` tes, dan file generated Prisma). Scan teks render 13 halaman admin: 0 em dash.

## Temuan baru saat verifikasi (belum dikerjakan, nomor lanjut)

- **B-18 (LOW)**: Next 16.4 memperingatkan konvensi `middleware` deprecated, anjuran migrasi
  ke `proxy` (`npx @next/codemod@canary middleware-to-proxy .`). Tidak urgent, tapi akan jadi
  error di versi Next berikutnya.
- **B-19 (LOW, housekeeping)**: `next dev`/`next build` menulis ulang `apps/admin/AGENTS.md`
  (baru, untracked) dan `apps/admin/next-env.d.ts`. Bukan hasil perbaikan ini; putuskan untuk
  di-commit sekali atau di-ignore supaya diff fitur tetap bersih.
- Observasi kecil (tanpa nomor): React sempat menulis warning controlled/uncontrolled input
  di halaman login saat ganti password. Perilaku lama, tidak terkait perbaikan ini.

## Daftar file yang berubah

Admin (15): `analytics`, `announcements`, `audit-logs`, `config`, `duty`, `inventory`, `login`,
`meetings/[id]`, `meetings`, `members`, `page` (dashboard), `profile`, `recap`, `reset`,
`shell`, plus `lib/ui.tsx`.
API (6): `absence/absence.service.ts`, `attendance/attendance.rules.ts`, `auth/auth.service.ts`,
`common/recap-pdf.ts`, `corrections/correction.service.ts`, `meetings/meetings.service.ts`.
Mobile (2): `features/attendance/presensi_page.dart`, `features/tugas/tugas_page.dart`.

## Cara reproduksi verifikasi

```bash
# DB sementara (sekali saja), lalu migrate + seed
initdb -D /tmp/opencode/pg -U postgres --auth=trust -E UTF8 --no-locale
pg_ctl -D /tmp/opencode/pg -o "-p 5433 -k /tmp/opencode/pgsock -c listen_addresses=127.0.0.1" -l /tmp/opencode/pg.log start
cd apps/api && DATABASE_URL='postgresql://postgres@127.0.0.1:5433/jurnalistik?schema=public' bun run prisma:deploy && bun run seed

# API (terminal 1)
cd apps/api && DATABASE_URL='postgresql://postgres@127.0.0.1:5433/jurnalistik?schema=public' \
  JWT_SECRET='...min-32-char...' TOTP_ENC_KEY='...min-32-char...' STORAGE_DRIVER=local bun run start

# Admin (terminal 2): login admin001 / ChangeMe12345! (wajib ganti password saat login pertama)
cd apps/admin && API_URL=http://localhost:3000 TURNSTILE_DISABLED=true bun run dev
```

Data uji (1 kegiatan, 7 piket, user admin001) hanya ada di cluster `/tmp/opencode/pg` yang
sudah dimatikan; tidak menyentuh database lain di mesin ini.
