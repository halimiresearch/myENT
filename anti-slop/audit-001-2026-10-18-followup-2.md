# Tindak Lanjut Audit 001: Batch B (B-01, B-02, B-03)

Tanggal: 2026-10-18
Status: SELESAI, terverifikasi (unit + lint + build + integrasi API nyata + review independen)
Rencana: docs/superpowers/plans/2026-10-18-b01-b02-b03-api-fixes.md
Bukti lengkap (log merah/hijau per task, skrip integrasi): .superpowers/sdd/2026-10-18-b01-b02-b03-api-fixes/

## Perubahan

### B-02 - konstanta `60_1000` (harusnya `60_000`), 3 tempat

| Lokasi | Sebelum | Sesudah |
|---|---|---|
| apps/api/src/auth/auth.service.ts:84 (challenge 2FA) | 5 * 60_1000 (~50 menit) | 5 * 60_000 (5 menit) |
| apps/api/src/meetings/meetings.service.ts:177 (token QR) | 5 * 60_1000 (~50 menit) | 5 * 60_000 (5 menit) |
| apps/api/src/meetings/meetings.service.ts:262 (reminder penutupan) | 30 * 60_1000 (~5 jam) | 30 * 60_000 (30 menit) |

`grep 60_1000 apps/api/src` = 0.

### B-03 - jam piket = WIB, bukan UTC

- apps/api/src/duty/duty.service.ts `at()`: `setUTCHours(h - 7, ...)`. Default 06:00/22:00 kini benar-benar 06:00/22:00 WIB (sebelumnya 13:00/05:00 WIB).
- Validasi baru sebelum transaksi: `openTime < closeTime` (termasuk `open == close`), pesan "Jam buka harus sebelum jam tutup". Window terbalik kini HTTP 400, bukan 500 dari CHECK constraint `meetings_window_chk`.

### B-01 - scope divisi, 4 lubang

1. apps/api/src/assignments/assignments.service.ts `review()`: menerima objek actor, menyertakan `user` submission, menolak bila `!canManageMember` (403 "Di luar divisi Anda"). Controller mengirim `req.user`. Officer tidak bisa review submission sendiri (sejalan `absence.decide`/`correction.decide`).
2. apps/api/src/users/users.controller.ts import CSV: non-ADMIN dipaksa divisi aktor (meniru `create`); ADMIN tetap memakai divisi dari CSV.
3. apps/api/src/attendance/attendance.service.ts `adjust()`: self ditolak untuk semua role ("Tidak boleh menyesuaikan kehadiran sendiri"), lalu `canManageMember` tanpa bypass self.
4. apps/api/src/loans/loan.service.ts `returnLoan()`: menerima objek actor; peminjam sendiri boleh; selain itu wajib `canManageMember`; cek dilakukan sebelum foto disimpan dan sebelum write DB. Guard endpoint tetap OFFICER/ADMIN, jadi MEMBER biasa tetap tidak bisa memanggil return.

## Verifikasi

| Elemen | Hasil |
|---|---|
| Baseline unit | 15 suite / 28 test hijau |
| Unit setelah perubahan | 22 suite / 46 test hijau (18 test baru) |
| TDD | tiap fix punya run MERAH dulu (task-N-red.log), lalu HIJAU (task-N-tests.log) |
| Lint API (tsc --noEmit) | exit 0 |
| Build API (nest build) | exit 0 |
| grep 60_1000 (apps/api/src) | 0 |
| Integrasi API nyata (Postgres temp + API :3000) | 20/20 PASS (integration-results.txt) |
| Review independen (subagent code-reviewer) | Approved with follow-ups (temuan di luar scope, tercatat di bawah) |

### Detail integrasi (integrasi.ts, 20 cek)

- Roster 2026-12-12: startAt 2026-12-11T23:00:00.000Z (= 06:00 WIB), endAt 2026-12-12T15:00:00.000Z (= 22:00 WIB). PASS
- Roster openTime 22:00 / closeTime 06:00: HTTP 400 "Jam buka harus sebelum jam tutup". PASS
- GET /meetings/:id/qr: TTL ~300,0 detik (bukan ~3000). PASS
- Review submission: lintas divisi 403, se-divisi 200. PASS
- Import CSV: officer -> divisi dipaksa "Foto"; admin -> divisi CSV "Jurnalistik" dipertahankan. PASS
- Adjust attendance: self 403, se-divisi 201, lintas divisi 403, admin 201. PASS
- Return loan: lintas divisi 403 (storage.save tidak dipanggil), admin 201, se-divisi 201. PASS

Catatan: TTL challenge 2FA diverifikasi unit test (tidak praktis via curl tanpa user TOTP); window reminder 30 menit diverifikasi unit test pada `tick`.

## Temuan baru dari review (di luar scope batch, belum diperbaiki)

1. [minor] apps/admin/app/api/auth/login/route.ts:24 dan apps/admin/app/api/auth/2fa/verify/route.ts:9: `10 * 60_1000` = ~100 menit (niat 10 menit). Kelas bug B-02 tetapi di admin app; kandidat batch berikut.
2. [minor] Duty roster: `dto.division` (duty.controller.ts:26) dipakai mentah di duty.service.ts; OFFICER bisa membuat roster untuk divisi lain. Kelas B-01, kandidat B-01.5.

## Catatan dan risiko

- Data piket lama (sebelum fix) masih tersimpan dengan window UTC lama; tidak ada migrasi data (di luar scope). Regenerate roster bila ingin data baru.
- Self-adjust kini dilarang juga untuk ADMIN, mengikuti pola `absence.decide`/`correction.decide` (keputusan disetujui saat review plan).
- UI admin: tombol review kemungkinan masih tampil untuk submission milik officer sendiri lalu berakhir 403; dicatat sebagai observasi UI, tidak diubah di batch ini.
- Pola serupa di auth.service.ts:156 (`actor.id !== before.id`) tidak disentuh (di luar nomor yang disetujui).
- A-06 dan B-04..B-19 tidak disentuh; B-18/B-19 masih menunggu keputusan.
- Tidak ada commit; semua perubahan ada di working tree (mengikuti cara kerja batch A).

## Reproduksi

```bash
# unit + lint + build (dari root repo)
bun --filter api test    # 22 suite / 46 test
bun --filter api lint
bun --filter api build

# integrasi (Postgres temp /tmp/opencode/pg, port 5433)
pg_ctl -D /tmp/opencode/pg -o "-p 5433 -k /tmp/opencode/pgsock -c listen_addresses=127.0.0.1" -l /tmp/opencode/pg.log start
cd apps/api && DATABASE_URL='postgresql://postgres@127.0.0.1:5433/jurnalistik?schema=public' \
  JWT_SECRET='...min-32-char...' TOTP_ENC_KEY='...min-32-char...' STORAGE_DRIVER=local bun run start
bun .superpowers/sdd/2026-10-18-b01-b02-b03-api-fixes/integration.ts   # 20/20 PASS
```

Login admin di DB temp: admin001 / AdminPass12345! (diubah dari password seed pada verifikasi sebelumnya).
