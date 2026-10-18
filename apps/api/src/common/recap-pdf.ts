import PDFDocument from 'pdfkit';

// Rekap pribadi PDF: sulit diubah dibanding XLSX; bukan surat resmi (PRD §15.6).
export function recapPdf(r: {
  name: string;
  nim: string;
  counted: number;
  present: number;
  permitted: number;
  sick: number;
  dispensation: number;
  absent: number;
  percentage: number | null;
  history: { title: string; status: string; date: string }[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40 });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text('Rekap Kehadiran Pribadi');
    doc.fontSize(10).text(`${r.name} (${r.nim})`);
    doc.text(`Hadir ${r.present} · Izin ${r.permitted} · Sakit ${r.sick} · Dispensasi ${r.dispensation} · Alpha ${r.absent}`);
    doc.text(`Kehadiran: ${r.percentage ?? '–'}${r.percentage !== null ? '%' : ''} dari ${r.counted} kegiatan`);
    doc.moveDown().fontSize(12).text('Riwayat');
    doc.fontSize(9);
    for (const h of r.history.slice(0, 200)) doc.text(`${h.date} · ${h.title} · ${h.status}`);
    doc.text(`\nDibuat ${new Date().toISOString()}`, 40, doc.page.height - 60);
    doc.end();
  });
}
