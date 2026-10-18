'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Btn, Card, Err, Loading, PageHeader, field } from '@/lib/ui';

export default function Config() {
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [first, setFirst] = useState(true);
  const load = () => api<Record<string, any>>('config').then((c) => {
    setCfg(c);
    setKey((k) => k || 'retention_selfie_months');
  }).catch((e) => setErr(e.message)).finally(() => setFirst(false));
  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    let v: any = val;
    try {
      v = JSON.parse(val);
    } catch {
      /* string biasa */
    }
    try {
      await api('config', { method: 'PATCH', body: JSON.stringify({ key, value: v }) });
      setVal('');
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Konfigurasi" sub="Pengaturan global aplikasi" />
      <Err msg={err} />
      {first ? (
        <Card className="p-4"><Loading /></Card>
      ) : (
        <>
      {key === 'effective_statuses' && (
        <p className="rounded-xl border border-gold-400/60 bg-gold-100 p-3 text-sm text-gray-700">
          Perubahan status efektif berlaku pada seluruh histori rekap (PRD §15.8).
        </p>
      )}
      <Card className="p-4">
        <form onSubmit={save} className="grid gap-2 md:grid-cols-3">
          <select className={field} value={key} onChange={(e) => setKey(e.target.value)}>
            {Object.keys(cfg).map((k) => <option key={k}>{k}</option>)}
          </select>
          <input className={field} placeholder='Nilai (JSON, mis. 6 atau ["A"])' value={val} onChange={(e) => setVal(e.target.value)} required />
          <Btn primary>Simpan</Btn>
        </form>
      </Card>
      <Card className="p-4">
        <pre className="overflow-auto text-xs text-gray-600">{JSON.stringify(cfg, null, 2)}</pre>
      </Card>
        </>
      )}
    </div>
  );
}
