'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, Empty, Err, Loading, PageHeader, StatusPill, Thead, field } from '@/lib/ui';

export default function Inventory() {
  const [items, setItems] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  const [form, setForm] = useState({ name: '', code: '', category: '' });
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;
  const [ret, setRet] = useState<{ id: string; damaged: boolean; note: string } | null>(null);
  const [hist, setHist] = useState<any[]>([]);
  const load = () => {
    const p1 = api<any[]>('items').then(setItems).catch((e) => setErr(e.message));
    const q = [`page=${page}`, `limit=${LIMIT}`, ...(filter ? [`status=${filter}`] : [])].join('&');
    const p2 = api<any>(`loans?${q}`).then((r) => {
      setLoans(Array.isArray(r) ? r : r.data ?? []);
      setTotal(Array.isArray(r) ? r.length : r.total ?? 0);
    }).catch((e) => setErr(e.message));
    Promise.allSettled([p1, p2]).then(() => setFirst(false));
  };
  useEffect(load, []);
  useEffect(() => {
    load();
  }, [filter, page]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('items', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', code: '', category: '' });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function doReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ret) return;
    const f = new FormData(e.currentTarget).get('photo') as File | null;
    if (!f?.size) return setErr('Foto akhir wajib');
    if (f.size > 5 * 1024 * 1024) return setErr('Foto maksimal 5 MB');
    const fd = new FormData();
    fd.append('photo', f);
    fd.append('noteIn', ret.note);
    fd.append('damaged', ret.damaged ? 'true' : 'false');
    try {
      await api(`loans/${ret.id}/return`, { method: 'POST', body: fd });
      setRet(null);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Inventaris" sub="Kelola barang dan pinjaman" />
      <Err msg={err} />
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-2 md:grid-cols-4">
          <input className={field} placeholder="Nama (Kamera A)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className={field} placeholder="Kode (CAM-01)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          <input className={field} placeholder="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Btn primary>Tambah</Btn>
        </form>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Barang</h2>
        {first ? <Loading /> : items.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <Thead cols={['Kode', 'Nama', 'Kondisi', 'Status', '']} />
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 font-medium">{it.code}</td>
                    <td className="py-2.5 pr-2">{it.name}</td>
                    <td className="py-2.5 pr-2">{it.condition}</td>
                    <td className="py-2.5 pr-2"><StatusPill value={it.status} /></td>
                    <td className="py-2.5"><button className="font-medium text-brand-700 hover:text-brand-800" onClick={async () => { try { const r = await api<{ data: any[] }>(`items/${it.id}/history?limit=20`); setHist(r.data); } catch (e: any) { setErr(e.message); } }}>Riwayat</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {hist.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Riwayat Barang</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <Thead cols={['Waktu', 'Aksi', 'Sebelum', 'Sesudah', 'Catatan']} />
              <tbody>
                {hist.map((h: any) => (
                  <tr key={h.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 text-gray-500">{new Date(h.createdAt).toLocaleString('id-ID')}</td>
                    <td className="py-2.5 pr-2 font-medium">{h.action}</td>
                    <td className="py-2.5 pr-2">{h.oldValue}</td>
                    <td className="py-2.5 pr-2">{h.newValue}</td>
                    <td className="py-2.5">{h.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Pinjaman</h2>
          <select className={field} aria-label="Filter status pinjaman" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="">Semua</option><option>ACTIVE</option><option>OVERDUE</option><option>RETURNED</option>
          </select>
        </div>
        {ret && (
          <form onSubmit={doReturn} className="mb-3 grid gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-4">
            <span className="flex items-center text-sm font-medium">{ret.damaged ? 'Tandai RUSAK' : 'Terima kembali'}</span>
            <input name="photo" type="file" accept="image/*" className={field} />
            <input className={field} placeholder="Catatan kondisi" value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} />
            <div className="flex gap-2">
              <Btn primary>Kirim</Btn>
              <Btn onClick={() => setRet(null)}>Batal</Btn>
            </div>
          </form>
        )}
        {first ? <Loading /> : loans.length === 0 ? <Empty text="Belum ada pinjaman" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <Thead cols={['Barang', 'Peminjam', 'Tenggat', 'Status', 'Aksi']} />
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-2 font-medium">{l.item?.code}</td>
                    <td className="py-2.5 pr-2">{l.snapName} <span className="text-gray-500">({l.snapNim})</span></td>
                    <td className="py-2.5 pr-2 text-gray-500">{new Date(l.dueAt).toLocaleDateString('id-ID')}</td>
                    <td className="py-2.5 pr-2"><StatusPill value={l.status} /></td>
                    <td className="py-2.5">
                      {['ACTIVE', 'OVERDUE'].includes(l.status) && (
                        <span className="flex gap-3">
                          <button className="font-medium text-emerald-700 hover:text-emerald-900" onClick={() => setRet({ id: l.id, damaged: false, note: '' })}>Terima</button>
                          <button className="font-medium text-rose-600 hover:text-rose-800" onClick={() => setRet({ id: l.id, damaged: true, note: '' })}>Rusak</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
              <span>Halaman {page} · {total} pinjaman</span>
              <span className="flex gap-2">
                <Btn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹ Prev</Btn>
                <Btn onClick={() => setPage((p) => p + 1)} disabled={page * LIMIT >= total}>Next ›</Btn>
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
