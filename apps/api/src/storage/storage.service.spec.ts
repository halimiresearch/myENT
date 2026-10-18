import { extFor, StorageService } from './storage.service';

describe('storage - ekstensi key & content-type (B-17)', () => {
  it('extFor: pdf → .pdf, selain itu foto → .jpg', () => {
    expect(extFor('application/pdf')).toBe('.pdf');
    expect(extFor('image/jpeg')).toBe('.jpg');
  });

  it('contentTypeFor: key ber-ekstensi dilayani dengan tipe benar', () => {
    expect(StorageService.contentTypeFor('assignments/abc.pdf')).toBe('application/pdf');
    expect(StorageService.contentTypeFor('attachments/m/u/abc.jpg')).toBe('image/jpeg');
  });

  it('key lama tanpa ekstensi tetap image/jpeg (data lama, tanpa migrasi)', () => {
    expect(StorageService.contentTypeFor('attachments/m/u/abc')).toBe('image/jpeg');
  });
});
