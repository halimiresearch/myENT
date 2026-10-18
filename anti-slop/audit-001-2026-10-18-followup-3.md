# Tindak Lanjut Audit 001: Batch C (temuan review batch B)

Tanggal: 2026-10-18
Status: SELESAI, terverifikasi (unit + lint + build + integrasi API + HTTP nyata BFF + click-through UI)
Sumber temuan: review independen batch B (anti-slop/audit-001-2026-10-18-followup-2.md, bagian "Temuan baru dari review")
Bukti: .superpowers/sdd/2026-10-18-batch-c-review-findings/ (log merah/hijau, skrip integrasi, screenshot)

## Perubahan

### C1 - konstanta rate limit BFF admin (kelas bug B-02, ~100 menit)

| Lokasi | Sebelum | Sesudah |
|---|---|---|
| apps/admin/app/api/auth/login/route.ts:24 | 10 * 60_1000 (6.010.000 ms, ~100 menit) | 10 * 60_000 (600.000 ms, 10 menit) |
| apps/admin/app/api/auth/2fa/verify/route.ts:9 | 10 * 60_1000 (6.010.000 ms, ~100 menit) | 10 * 60_000 (600.000 ms, 10 menit) |

`grep 60_1000` di source apps/admin: 0.

### C2 - scope divisi roster piket (kelas B-01)

- apps/api/src/duty/duty.service.ts `generate()` kini menerima objek actor (id, role, division), bukan hanya id.
- Divisi efektif: ADMIN = `dto.division` (boleh kosong = semua divisi); selain itu = `actor.division` secara paksa, termasuk bila string kosong (tidak ada lagi jalur "semua divisi" untuk non-ADMIN).
- Audit log `duty.roster` mencatat divisi efektif (sebelumnya mencatat dto mentah).
- apps/api/src/duty/duty.controller.ts mengirim `req.user`.
- Semantik force (bukan 403), konsisten dengan users.create:68 dan import CSV B-01.2. UI tidak diubah.

## Verifikasi (R-35)

| Elemen | Hasil |
|---|---|
| Test admin (vitest) | 6 file / 16 test hijau (4 test route baru di 2 file) |
| Test API (jest) | 22 suite / 50 test hijau (4 test scope baru; spec duty 7/7) |
| TDD merah dulu | c1-red.log: route dipanggil dengan 6.010.000 ms (gagal, ekspektasi 600.000); c2-red.log: TS2345 x7 (signature lama) |
| Lint admin (tsc) | exit 0 |
| Lint API (tsc) | exit 0 |
| Build admin (next build) | exit 0 |
| Build API (nest build) | exit 0 |
| Integrasi API nyata (integration-c.ts) | 8/8 PASS |
| Regresi batch B (rerun integration.ts) | 20/20 PASS |
| HTTP nyata BFF admin (bff-ratelimit-check.ts) | 3/3 PASS |
| Click-through browser (UI asli :3102) | LULUS (4 screenshot) |

### Detail C2 via API nyata (integration-c.ts)

- Officer divisi DivX meminta roster divisi DivY: roster dibuat (201); anggota DivY tidak mendapat assignment (count 0), anggota DivX mendapat assignment (count 1). PASS
- Officer tanpa `division`: tetap hanya DivX; anggota DivY tetap 0. PASS
- Admin dengan `division` DivY: anggota DivY mendapat assignment. PASS
- Admin tanpa `division`: roster tetap dibuat (semua divisi). PASS

### Detail C1 di HTTP nyata (bff-ratelimit-check.ts, server admin :3102)

- Login benar lolos (percobaan 1 dari 20 kuota). PASS
- Total 20 percobaan diizinkan per jendela; percobaan ke-21 diblokir HTTP 429. PASS
- Pesan 429 = "Terlalu banyak percobaan, coba lagi nanti". PASS

### Detail click-through (browser, admin dev :3102, TURNSTILE_DISABLED=true)

1. Buka /login, isi NIM admin001 + password, klik "Masuk" -> dashboard terbuka (c4-01-login-dashboard.png).
2. Menu "Piket" -> isi form: tanggal 2027-02-01, 1 hari, 1 orang/hari, divisi "Jurnalistik" -> klik "Generate roster".
3. Alert asli UI: "1 kegiatan piket (DRAFT) dibuat"; network POST /api/duty/roster -> 201 (c4-02-piket-form-selesai.png).
4. Halaman Kegiatan menampilkan baris "Piket 2027-02-01, 1/2/2027 06.00.00, DRAFT" (c4-03-kegiatan-16.png, c4-04-piket-2027-02-01.png). Jam 06.00.00 = WIB benar.

Catatan teknis click-through: tool `fill` browser tidak memicu submit pada input `type=date` (validasi `required` memblokir); tanggal diisi via setter native + event input/change. Untuk pengguna manusia perilaku form normal.

## Catatan dan risiko

- UI /duty belum memberi petunjuk bahwa field "Divisi" diabaikan untuk OFFICER (server sudah memaksa divisinya). Kandidat perbaikan UI kecil; bukan bug server.
- Data piket lama di DB temp masih menunjukkan window lama (mis. 13.00.00) karena tidak ada migrasi data; data baru sudah benar (06.00.00).
- Tidak ada commit; perubahan menyatu dengan working tree batch A/B.
- Sisa backlog: A-06 dan B-04..B-19; B-18/B-19 masih menunggu keputusan.

## Reproduksi

```bash
# unit + lint + build
bun --filter admin test     # 16 test / 6 file
bun --filter admin lint
bun --filter admin build
bun --filter api test       # 50 test / 22 suite
bun --filter api lint
bun --filter api build

# integrasi (Postgres temp 5433 + API 3000 hidup, resep followup.md)
bun .superpowers/sdd/2026-10-18-batch-c-review-findings/integration-c.ts   # 8/8
bun .superpowers/sdd/2026-10-18-b01-b02-b03-api-fixes/integration.ts       # 20/20 (regresi)

# BFF + click-through (admin dev 3102, API_URL=http://127.0.0.1:3000 TURNSTILE_DISABLED=true)
bun .superpowers/sdd/2026-10-18-batch-c-review-findings/bff-ratelimit-check.ts  # 3/3
```
