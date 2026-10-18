import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { requireFileSecret } from '../common/jwt-secret';

// ponytail: driver local untuk dev/smoke tanpa R2; R2 S3-compatible untuk prod (PRD §10).
// STORAGE_DRIVER=local| r2. Upgrade path: hapus driver local saat semua env punya R2.
function fileSecret(): string {
  return requireFileSecret();
}

// Base URL untuk signed URL lokal: API_PUBLIC_URL bila diisi (prod), else host request (dev).
export function baseFromReq(req: any): string {
  const pub = (process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (pub) return pub;
  return `${req.protocol}://${req.get('host')}`;
}

// Ekstensi key dari mime: writer baru selalu menyertakan ekstensi agar Content-Type lokal benar (B-17).
export const extFor = (contentType: string) => (contentType === 'application/pdf' ? '.pdf' : '.jpg');

@Injectable()
export class StorageService {
  private driver = process.env.STORAGE_DRIVER ?? 'local';
  private dir = resolve(process.env.UPLOAD_DIR ?? './uploads');
  private s3?: S3Client;
  private bucket = process.env.R2_BUCKET ?? '';

  private client() {
    if (!this.s3) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
        },
      });
    }
    return this.s3;
  }

  // Path harus tetap di dalam dir upload (anti traversal, termasuk encoded/normalisasi).
  private localPath(key: string) {
    const p = resolve(this.dir, key);
    if (p !== this.dir && !p.startsWith(this.dir + sep)) throw new Error('Invalid key');
    return p;
  }

  async save(key: string, buf: Buffer, contentType: string) {
    this.localPath(key); // validasi sebelum sentuh R2/disk.
    if (this.driver === 'r2')
      await this.client().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: contentType }));
    else {
      const p = this.localPath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, buf);
    }
    return key;
  }

  async remove(key: string) {
    if (this.driver === 'r2') await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    else {
      try {
        await unlink(this.localPath(key));
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e; // hilang = anggap terhapus; gagal lain = retry tick berikut
      }
    }
  }

  // URL berumur pendek untuk file privat. Lokal: token HMAC via /files (dev saja).
  async signedUrl(key: string, baseUrl: string, secs = 300) {
    if (this.driver === 'r2')
      return getSignedUrl(this.client(), new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: secs });
    const exp = Math.floor(Date.now() / 1000) + secs;
    const sig = createHmac('sha256', fileSecret()).update(`${key}:${exp}`).digest('hex');
    return `${baseUrl}/files/${key}?exp=${exp}&sig=${sig}`;
  }

  static verifyLocalToken(key: string, exp: string, sig: string) {
    if (Date.now() / 1000 > Number(exp)) return false;
    const want = createHmac('sha256', fileSecret()).update(`${key}:${exp}`).digest('hex');
    return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  }

  // Content-Type untuk driver lokal: dari ekstensi key (key dibuat server, bukan client).
  // Fallback image/jpeg = key lama tanpa ekstensi (data pra-B-17, sengaja tanpa migrasi).
  static contentTypeFor(key: string) {
    if (key.endsWith('.pdf')) return 'application/pdf';
    if (key.endsWith('.png')) return 'image/png';
    if (key.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  async readLocal(key: string) {
    return readFile(this.localPath(key));
  }
}
