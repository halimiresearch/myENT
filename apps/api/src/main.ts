import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { SensitiveThrottleMiddleware } from './common/sensitive-throttle.middleware';
import { requireFileSecret, requireQrSecret } from './common/jwt-secret';

async function bootstrap() {
  // Gagal cepat bila secret lemah di production (dev fallback hanya untuk lokal).
  if (process.env.NODE_ENV === 'production') {
    const s = process.env.JWT_SECRET ?? '';
    if (s.length < 32) throw new Error('JWT_SECRET minimal 32 karakter di production');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib di production');
    if ((process.env.TOTP_ENC_KEY ?? '').length < 32)
      throw new Error('TOTP_ENC_KEY minimal 32 karakter di production (secret 2FA wajib terenkripsi)');
    // B-12: kunci HMAC file/QR wajib terpisah di production (tanpa fallback JWT_SECRET).
    requireFileSecret();
    requireQrSecret();
  }
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const throttle = new SensitiveThrottleMiddleware();
  app.use(throttle.use.bind(throttle));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // Header keamanan transport (PRD §18). Tanpa lib — cukup untuk API tanpa SSR.
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // CORS allowlist eksplisit — PRD §18. Tanpa ALLOWED_ORIGINS = tertutup (default aman).
  const origins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins });
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
