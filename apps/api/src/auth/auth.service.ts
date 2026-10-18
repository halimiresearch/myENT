import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { generateSecret, keyuri, verifyTotp } from './totp';
import { openTotpSecret, protectTotpSecret } from './totp-crypto';
import { canManageMember } from '../common/policy';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Hash pembanding agar waktu respons NIM-tak-ada ≈ password-salah (anti timing oracle).
const DUMMY_HASH = bcrypt.hashSync('dummy-tidak-pernah-cocok', 10);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  private refreshDays() {
    return Number(this.config.get('REFRESH_EXPIRES_DAYS') ?? 14);
  }

  private lockoutMinutes() {
    return Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);
  }

  // Keputusan kunci dari nilai DB pasca-increment, bukan dari read stale.
  private async registerFailedLogin(userId: string) {
    const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    if (updated.failedLogins >= maxAttempts) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + this.lockoutMinutes() * 60_000) },
      });
    }
  }

  private async issueTokens(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const raw = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshDays() * 86400_000);
    await this.prisma.session.create({
      data: { userId: user.id, refreshTokenHash: sha256(raw), expiresAt },
    });
    return { accessToken, refreshToken: raw, mustChangePassword: user.mustChangePassword };
  }

  async login(nim: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { nim } });
    // Generic message agar tidak bocor enumerasi — PRD §18.
    if (!user || user.status !== 'ACTIVE') {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException('NIM atau password salah');
    }
    // Lockout sementara DB-backed, selamat dari restart (PRD §6.3).
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new UnauthorizedException('Akun terkunci sementara, coba lagi nanti');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.registerFailedLogin(user.id);
      await this.audit.log(
        { actorId: user.id, action: 'auth.login-failed', entity: 'User', entityId: user.id },
      ).catch(() => {});
      throw new UnauthorizedException('NIM atau password salah');
    }
    if (user.failedLogins > 0 || user.lockedUntil)
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    // 2FA aktif → challenge one-time 5 menit (KURANG.md §4). pendingToken = id challenge (opaque).
    if (user.totpEnabled && user.totpSecret) {
      const c = await this.prisma.twoFaChallenge.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 5 * 60_000) },
      });
      return { twoFactorRequired: true, pendingToken: c.id };
    }
    return this.issueTokens(user.id);
  }

  async refresh(raw: string) {
    const hash = sha256(raw);
    const sess = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!sess || sess.revokedAt || sess.expiresAt < new Date() || sess.user.status !== 'ACTIVE')
      throw new UnauthorizedException('Unauthorized');
    // Atomic revoke: konkuren kedua dapat count 0 → ditolak (anti-reuse).
    const revoked = await this.prisma.session.updateMany({
      where: { id: sess.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!revoked.count) throw new UnauthorizedException('Unauthorized');
    return this.issueTokens(sess.userId);
  }

  async logout(raw: string) {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: sha256(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  // Consent privasi selfie (PRD §17): sekali, tercatat waktu pertama, tak bisa di-reset client.
  async consentPrivacy(userId: string) {
    const now = new Date();
    await this.prisma.user.updateMany({
      where: { id: userId, privacyConsentedAt: null },
      data: { privacyConsentedAt: now },
    });
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { privacyConsentedAt: true },
    });
    return { ok: true, consentedAt: u.privacyConsentedAt };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Password lama salah');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(
        { actorId: userId, action: 'user.change-password', entity: 'User', entityId: userId },
        tx as any,
      );
    });
    return { ok: true };
  }

  async resetPassword(actor: { id: string; role: string; division: string }, targetId: string) {
    const temp = randomBytes(9).toString('base64url'); // ~12 char, sekali tampil — PRD §6.2
    const passwordHash = await bcrypt.hash(temp, 10);
    await this.prisma.$transaction(async (tx: any) => {
      // B-06: id tak dikenal → 404 eksplisit, bukan 500 dari findUniqueOrThrow.
      const before = await tx.user.findUnique({ where: { id: targetId } });
      if (!before) throw new NotFoundException('User tidak ditemukan');
      // Anti-eskalasi: ADMIN hanya oleh ADMIN; officer hanya se-divisi (diri sendiri boleh).
      if (before.role === 'ADMIN' && actor.role !== 'ADMIN')
        throw new ForbiddenException('Hanya ADMIN dapat mereset ADMIN');
      if (actor.id !== before.id && !canManageMember(actor as any, before as any))
        throw new ForbiddenException('Di luar divisi Anda');
      await tx.user.update({
        where: { id: targetId },
        data: { passwordHash, mustChangePassword: true },
      });
      await tx.session.updateMany({ where: { userId: targetId }, data: { revokedAt: new Date() } });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'user.reset-password',
          entity: 'User',
          entityId: targetId,
          oldValue: { mustChangePassword: before.mustChangePassword } as any,
          newValue: { mustChangePassword: true } as any,
        },
        tx as any,
      );
    });
    return { temporaryPassword: temp };
  }

  // P1: reset mandiri via email (PRD §6.2). Selalu 200 agar tak bocor enumerasi.
  // SMTP di luar transaksi: tx hanya DB agar tak menahan koneksi + tak kirim email saat rollback.
  async forgotPassword(nim: string) {
    const user = await this.prisma.user.findUnique({ where: { nim } });
    if (user && user.status === 'ACTIVE' && user.email) {
      const raw = randomBytes(32).toString('hex');
      await this.prisma.$transaction(async (tx: any) => {
        // Kunci baris user: dua request konkuren jalan berurutan — hanya token terbaru yang hidup.
        await tx.$queryRawUnsafe(`SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE`, user.id);
        // Satu token aktif per user: cabut yang belum terpakai sebelum buat baru.
        await tx.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } });
        await tx.passwordReset.create({
          data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3600_000) },
        });
      });
      const email = user.email;
      const text = `Tautan reset (1 jam): ${(process.env.WEB_URL ?? '').replace(/\/$/, '')}/reset?token=${raw}`;
      try {
        await this.sendMail(email, 'Reset password JURNALISTIK APP', text);
      } catch (e) {
        console.error('[forgot-password] sendMail gagal');
      }
    }
    return { ok: true };
  }

  async resetViaEmail(token: string, newPassword: string) {
    const rec = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new UnauthorizedException('Tautan tidak valid');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async (tx: any) => {
      // Atomic consume: dua request konkuren → hanya satu yang dapat count 1.
      const claimed = await tx.passwordReset.updateMany({
        where: { id: rec.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!claimed.count) throw new UnauthorizedException('Tautan tidak valid');
      await tx.user.update({ where: { id: rec.userId }, data: { passwordHash, mustChangePassword: false } });
      await tx.session.updateMany({ where: { userId: rec.userId }, data: { revokedAt: new Date() } });
      await this.audit.log(
        { actorId: rec.userId, action: 'user.reset-via-email', entity: 'User', entityId: rec.userId },
        tx,
      );
    });
    return { ok: true };
  }

  // 2FA TOTP opt-in (authenticator app). Secret disimpan, aktif setelah kode benar.
  async setup2fa(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Password salah');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: protectTotpSecret(secret), totpEnabled: false } });
    return { secret, otpauthUrl: keyuri(user.nim, secret) };
  }

  async enable2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecret || !verifyTotp(openTotpSecret(user.totpSecret), code))
      throw new UnauthorizedException('Kode salah');
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.log({ actorId: userId, action: 'auth.2fa-enable', entity: 'User', entityId: userId }).catch(() => {});
    return { ok: true };
  }

  async disable2fa(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Password salah');
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabled: false } });
    await this.audit.log({ actorId: userId, action: 'auth.2fa-disable', entity: 'User', entityId: userId }).catch(() => {});
    return { ok: true };
  }

  async verify2fa(pendingToken: string, code: string) {
    // Atomic consume: konkuren kedua / replay dapat count 0 → ditolak.
    // Klaim yang gagal karena kode salah di-refund agar typo tak membakar
    // challenge (brute force tetap dibatasi lockout per-akun).
    const now = new Date();
    const claimed = await this.prisma.twoFaChallenge.updateMany({
      where: { id: pendingToken, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (!claimed.count) throw new UnauthorizedException('Sesi 2FA kedaluwarsa');
    // Salah 5x per challenge → hangus (tanpa refund), paksa login ulang.
    let keepConsumed = false;
    const refund = () => {
      if (keepConsumed) return Promise.resolve({ count: 0 });
      return this.prisma.twoFaChallenge.updateMany({ where: { id: pendingToken, usedAt: now }, data: { usedAt: null } });
    };
    try {
      const challenge = await this.prisma.twoFaChallenge.findUniqueOrThrow({ where: { id: pendingToken } });
      const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
      if (!user || user.status !== 'ACTIVE' || !user.totpEnabled || !user.totpSecret)
        throw new UnauthorizedException('Unauthorized');
      if (user.lockedUntil && user.lockedUntil > new Date()) throw new UnauthorizedException('Akun terkunci sementara');
      if (!verifyTotp(openTotpSecret(user.totpSecret), code)) {
        const cur = await this.prisma.twoFaChallenge.update({
          where: { id: pendingToken },
          data: { attempts: { increment: 1 } },
          select: { attempts: true },
        });
        if (cur.attempts >= 5) keepConsumed = true;
        await this.registerFailedLogin(user.id);
        throw new UnauthorizedException(keepConsumed ? 'Terlalu banyak salah. Login ulang' : 'Kode salah');
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      return { ...(await this.issueTokens(user.id)), mustChangePassword: user.mustChangePassword };
    } catch (e) {
      await refund().catch(() => {});
      throw e;
    }
  }

  private async sendMail(to: string, subject: string, text: string) {    if (!process.env.SMTP_HOST) {
      if (process.env.NODE_ENV !== 'production') console.log(`[mail:dev] to=${to} ${text}`);
      return;
    }
    const nodemailer = await import('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
    await t.sendMail({ from: process.env.SMTP_FROM ?? 'no-reply@jurnalistik', to, subject, text });
  }
}
