'use client';

import type { ReactNode } from 'react';

// Kartu putih rounded — wadah utama konten.
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-white rounded-2xl border border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${className}`}>{children}</section>;
}

// Satu kartu statistik ringkas ala "Quick Stats".
export function Stat({ icon, label, value, sub, tone = 'brand' }: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'brand' | 'green' | 'amber' | 'red';
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-100 text-brand-700',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-4">
      <div className="flex items-center gap-2 text-gray-500">
        <span className={`grid place-items-center size-6 rounded-lg ${tones[tone]}`}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

// Label pil status.
export function Pill({ children, tone = 'gray' }: {
  children: ReactNode;
  tone?: 'green' | 'amber' | 'red' | 'brand' | 'sky' | 'gray';
}) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    brand: 'bg-brand-100 text-brand-700 ring-brand-200',
    sky: 'bg-brand-100 text-brand-700 ring-brand-200',
    gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

// Avatar inisial — tanpa aset gambar.
export function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const palettes = [
    'bg-violet-100 text-violet-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-sky-100 text-sky-700',
    'bg-rose-100 text-rose-700',
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return (
    <span aria-hidden className={`grid place-items-center size-8 shrink-0 rounded-full text-xs font-bold ${palettes[h % palettes.length]}`}>
      {initials}
    </span>
  );
}

// Kepala halaman: judul + subjudul + tombol aksi.
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-gray-600">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Btn({ children, href, primary, onClick, disabled }: {
  children: ReactNode;
  href?: string;
  primary?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const cls = primary
    ? 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm'
    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50';
  const c = `inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 ${cls}`;
  if (href) return <a href={href} className={c}>{children}</a>;
  // Tanpa onClick (mis. tombol submit form) → biarkan tombol browser default (submit).
  return <button type={onClick ? 'button' : 'submit'} onClick={onClick} disabled={disabled} className={c}>{children}</button>;
}

// Kelas input standar — pakai untuk input/select/textarea.
export const field =
  'rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-500 focus:border-brand-200 focus:ring-2 focus:ring-brand-100 disabled:opacity-50';

// Pil status domain — satu pemetaan untuk semua halaman.
const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'brand' | 'gray'> = {
  PRESENT: 'green', PUBLISHED: 'green', ACTIVE: 'green', RETURNED: 'green', APPROVED: 'green',
  PENDING: 'amber', DRAFT: 'amber', OVERDUE: 'amber',
  ABSENT: 'red', REJECTED: 'red', CANCELLED: 'red', INACTIVE: 'red',
  ADMIN: 'brand', OFFICER: 'brand',
};

export function StatusPill({ value }: { value: string }) {
  return <Pill tone={STATUS_TONES[value] ?? 'gray'}>{value}</Pill>;
}

// Kepala tabel standar.
export function Thead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
        {cols.map((c, i) => <th key={c} className={`py-2 pr-2 font-medium ${i === 0 ? 'pl-1' : ''}`}>{c}</th>)}
      </tr>
    </thead>
  );
}

export function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - page) <= 1,
  );
  const btn = 'min-w-8 rounded-lg px-2 py-1 text-sm transition disabled:opacity-40';
  return (
    <div className="flex flex-wrap gap-1 items-center text-sm mt-3">
      <button aria-label="Halaman sebelumnya" className={`${btn} border border-gray-200 bg-white hover:bg-gray-50`} disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1] > 1 && <span className="text-gray-500">…</span>}
          <button
            aria-label={`Halaman ${n}`}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPage(n)}
            className={`${btn} ${n === page ? 'bg-brand-700 text-white font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
          >{n}</button>
        </span>
      ))}
      <button aria-label="Halaman berikutnya" className={`${btn} border border-gray-200 bg-white hover:bg-gray-50`} disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}

export function Empty({ text = 'Belum ada data' }: { text?: string }) {
  return <p className="text-gray-500 text-sm py-8 text-center">{text}</p>;
}

export function Loading({ text = 'Memuat…' }: { text?: string }) {
  return (
    <div className="space-y-2 py-4" role="status" aria-label={text}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded-xl bg-gray-100" />
      ))}
      <p className="text-center text-xs text-gray-500">{text}</p>
    </div>
  );
}

export function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200 mb-3">{msg}</p>;
}
