import { BadRequestException } from '@nestjs/common';

// Aturan murni presensi SELF (PRD §9–§10) — tanpa DB agar unit-testable.

// Magic bytes: jpg FF D8 FF, png 89 50 4E 47, webp RIFF....WEBP.
export function detectImage(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

export function assertSelfWindow(
  m: { status: string; attendanceOpenAt: Date; attendanceCloseAt: Date },
  now = new Date(),
) {
  if (!['PUBLISHED', 'ONGOING'].includes(m.status)) throw new BadRequestException('Presensi belum/tidak dibuka');
  if (now < m.attendanceOpenAt) throw new BadRequestException('Presensi belum dibuka');
  if (now > m.attendanceCloseAt)
    throw new BadRequestException('Presensi sudah ditutup. Hubungi pengurus');
}

export function selfieKey(now = new Date(), uuid: string) {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `attendance/${y}/${mo}/${uuid}.jpg`;
}
