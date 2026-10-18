# Tindak lanjut audit-001 batch D (B-05, B-06, B-12, B-17)

Tanggal: 2026-10-18. Status: SELESAI, semua verifikasi hijau. Commit: d180d69 (sudah push ke main).

A-06 (dark mode) tidak dikerjakan sesuai keputusan pemilik proyek: "tidak butuh darkmode untuk saat ini".
Tidak ada temuan lain yang disentuh (B-04, B-07..B-16 tetap seperti semula).

## Ringkasan perubahan

| Temuan | Lokasi | Sebelum | Sesudah |
|---|---|---|---|
| B-05 | `apps/api/src/prisma/prisma.service.ts` | Pool `pg` dibuat saat import modul, sebelum `ConfigModule` memuat `.env`; dev lokal yang hanya punya `.env` memakai URL salah dan 500 di query pertama | Pool dibuat di constructor (setelah `.env` termuat); pool ditutup saat module destroy |
| B-06 | `auth.service.ts` `resetPassword` | userId tak dikenal: `findUniqueOrThrow` -> P2025 -> 500 | `findUnique` + `NotFoundException` -> 404 "User tidak ditemukan" |
| B-06 | `users.controller.ts` `CreateUserDto` | `role` string bebas diteruskan ke Prisma -> 500 | `@IsIn(['MEMBER','OFFICER','ADMIN'])` -> 400 dengan daftar nilai |
| B-06 | `loan.service.ts` `listItems` | `items?status=<apa pun>` -> error enum Prisma -> 500 | Validasi enum -> 400 "Status tidak valid" |
| B-06 | `users.controller.ts` `create` | NIM duplikat: P2002 bocor -> 500 | P2002 ditangkap -> 409 "NIM sudah terdaftar" |
| B-06 | `users.controller.ts` `import` | Balapan import: baris yang di-skip `skipDuplicates` tetap dilaporkan `ok` dengan password yang tidak berlaku; audit mencatat panjang batch | Hash tersimpan dibandingkan dengan hash batch: baris yang di-skip dilaporkan `failed`; audit memakai `count` nyata |
| B-12 | `common/jwt-secret.ts`, `main.ts`, `.env.example`, `.env.prod.example`, `docker-compose.prod.yml` | FILE_HMAC_SECRET/QR_HMAC_SECRET kosong = fallback JWT_SECRET, jadi satu kebocoran menjebol semua | Wajib di production: kosong atau < 32 karakter -> boot menolak dengan pesan jelas; fallback hanya non-production; compose dan contoh env memaksa isi |
| B-17 | `notifications.controller.ts` | `?unreadOnly=false` diparse `Boolean('false')` = true (filter terbalik) | Konversi eksplisit `'true'/'false'` + `@IsBoolean`; nilai asing -> 400 |
| B-17 | `users.controller.ts` `ImportDto` | `MaxLength(200_000)` di atas body limit 100kb -> 413 bukan 400 | `MaxLength(30_000)` (cukup untuk 100 baris) -> 400 validasi |
| B-17 | `assignments.controller.ts` + `assignments.service.ts` | Lampiran tugas bisa di-upload tapi tidak ada endpoint unduh; key tanpa ekstensi membuat PDF lokal dilayani `image/jpeg` | Endpoint baru `GET /assignments/:id/file` (signed URL); key baru selalu ber-ekstensi `.pdf`/`.jpg`, juga untuk submission, absence, dan correction (helper `extFor`) |
| B-17 | `.env.example` | LOGIN_MAX_ATTEMPTS=4 / LOCKOUT=60 (kode: 5/15); RETENTION_* tidak didokumentasikan | Diselaraskan 5/15 dan ditambah RETENTION_SELFIE_MONTHS=12, RETENTION_ATTACHMENT_MONTHS=6 |
| docs | `docs/DECISIONS.md` | - | Keputusan batch D dicatat |

## Bukti verifikasi

- Unit merah (sebelum fix): 7/7 suite gagal (`.superpowers/sdd/2026-10-18-batch-d-kecil-cepat/unit-red.txt`).
- Unit hijau (sesudah fix): 25 suite / 70 test hijau; sebelumnya 22 suite / 50 test (`unit-green-final.txt`).
- `lint` (tsc --noEmit) exit 0; `build` (nest build) exit 0.
- Integrasi API nyata: `integration-d` 11/11 PASS (`integration-d-green.txt`), termasuk:
  - D1 role asing -> 400, D2 NIM duplikat -> 409, D3 status item asing -> 400, D4 userId tak dikenal -> 404, D5 unreadOnly ketat.
  - D6 lampiran tugas: key `.pdf`, endpoint unduh ada, unduhan ber-Content-Type `application/pdf` dengan byte `%PDF-`.
  - D7 submission PDF: key `.pdf`, unduhan `application/pdf`.
  - D8 import CSV nyata: semua baris `ok` + password tampil.
- Regresi: `integration-b` 20/20 PASS, `integration-c` 8/8 PASS.
- B-05: boot hanya dengan `apps/api/.env` (tanpa export env) berhasil, `/health` 200 dan login 200
  (`b05-green.out`); baseline merah: 500 di query pertama (`b05-red-query.out`).
- B-12: produksi tanpa kunci HMAC gagal boot exit 1 dengan pesan "wajib di production"
  (`b12-green-missing.out`); dengan kunci HMAC boot normal (`b12-green-with.out`).
- Click-through browser: login admin -> dashboard -> halaman Kegiatan, tanpa error
  (`d5-01-dashboard.png`, `d5-02-kegiatan.png`).

## Catatan penting untuk deploy

- Setelah batch ini deploy produksi WAJIB mengisi `FILE_HMAC_SECRET` dan `QR_HMAC_SECRET`
  (min 32 karakter, beda dari JWT_SECRET). Docker compose akan menolak start bila kosong.
  Ini fail-closed yang disengaja (B-12).
- File lama dengan key tanpa ekstensi tetap dilayani `image/jpeg` (tidak ada migrasi file).
  Lampiran absence/correction lama berjenis PDF yang diakses lewat driver lokal masih bisa salah
  Content-Type; R2 (produksi) tidak terpengaruh karena presigned URL memakai metadata sendiri.
- Verifikasi memakai PG temp (port 5433), API :3000, admin dev :3102; semuanya sudah dimatikan
  dan `.env` temp sudah dihapus.

## Sisa backlog audit-001 (tidak disentuh di batch ini)

- A-06 (dilewati atas keputusan pemilik).
- B-04 (FCM kredensial produksi, butuh keputusan), B-07, B-08, B-09 (recovery 2FA, butuh keputusan),
  B-10, B-11, B-13, B-14, B-15, B-16.
