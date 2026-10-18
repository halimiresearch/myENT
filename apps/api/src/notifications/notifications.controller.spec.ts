import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageQuery } from './notifications.controller';

describe('notifications PageQuery (B-17)', () => {
  it("?unreadOnly=false → false (bukan true)", async () => {
    const q = plainToInstance(PageQuery, { unreadOnly: 'false' });
    expect(q.unreadOnly).toBe(false);
    expect(await validate(q)).toHaveLength(0);
  });

  it("?unreadOnly=true → true", () => {
    const q = plainToInstance(PageQuery, { unreadOnly: 'true' });
    expect(q.unreadOnly).toBe(true);
  });

  it('tanpa unreadOnly → undefined (semua notif)', () => {
    const q = plainToInstance(PageQuery, {});
    expect(q.unreadOnly).toBeUndefined();
  });

  it('nilai asing → ditolak validasi (bukan diam-diam true)', async () => {
    const q = plainToInstance(PageQuery, { unreadOnly: 'iya' });
    expect((await validate(q)).length).toBeGreaterThan(0);
  });
});
