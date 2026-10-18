import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_client.dart';
import '../../core/helpers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

class TugasPage extends StatefulWidget {
  const TugasPage({super.key});
  @override
  State<TugasPage> createState() => _TugasPageState();
}

class _TugasPageState extends State<TugasPage>
    with SingleTickerProviderStateMixin {
  late TabController tab;
  List tugas = [];
  List materi = [];
  List kumpul = [];
  List barang = [];
  List pinjamku = [];
  String? err;
  @override
  void initState() {
    super.initState();
    tab = TabController(length: 4, vsync: this);
    _load();
  }

  Future<void> _load() async {
    // Paralel: dulu sekuensial (waterfall 5x).
    final results = await Future.wait([
      Api.get('/assignments?limit=50').then((v) => v['data']).catchError((_) => null),
      Api.get('/materials?limit=50').then((v) => v['data']).catchError((_) => null),
      Api.get('/submissions/me?limit=50').then((v) => v['data']).catchError((_) => null),
      Api.get('/items').then((v) => v is List ? v : (v['data'] ?? [])).catchError((_) => null),
      Api.get('/loans/me').then((v) => v is List ? v : (v['data'] ?? [])).catchError((_) => null),
    ]);
    if (!mounted) return;
    setState(() {
      if (results[0] != null) tugas = results[0];
      if (results[1] != null) materi = results[1];
      if (results[2] != null) kumpul = results[2];
      if (results[3] != null) barang = results[3];
      if (results[4] != null) pinjamku = results[4];
      // Semua gagal (bukan kosong): tampilkan, jangan daftar sunyi.
      err = results.every((v) => v == null) ? 'Gagal memuat. Tarik untuk coba lagi' : null;
    });
  }

  Future<void> buka(String path) async {
    try {
      final r = await Api.get(path);
      final uri = Uri.parse(r['url']);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> kumpulkan(String assignmentId) async {
    final files = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
    );
    final f = files.firstOrNull?.path;
    if (f == null) return;
    if (await File(f).length() > 5 * 1024 * 1024) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('File maksimal 5 MB')));
      return;
    }
    try {
      await Api.postMultipart(
        "/assignments/$assignmentId/submissions",
        {},
        File(f),
        'file',
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Terkumpul')));
      }
      _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> pinjam(Map item) async {
    final dueC = TextEditingController(text: DateTime.now().add(const Duration(days: 3)).toString().substring(0, 10));
    try {
      final ok = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Pinjam ${item['code']}'),
          content: TextField(controller: dueC, decoration: const InputDecoration(labelText: 'Tenggat (YYYY-MM-DD)')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Lanjut foto')),
          ],
        ),
      );
      if (ok != true) return;
      final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1280);
      if (x == null) return;
      // Kompres seperti presensi: foto mentah HP 3-8 MB → ratusan KB.
      final out = '${x.path}.jpg';
      final r = await FlutterImageCompress.compressAndGetFile(x.path, out, quality: 80);
      final foto = File(r?.path ?? x.path);
      if (await foto.length() > 5 * 1024 * 1024) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Foto maksimal 5 MB')));
        return;
      }
      final due = DateTime.tryParse(dueC.text);
      if (due == null || !due.isAfter(DateTime.now())) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tenggat harus tanggal valid di masa depan')));
        return;
      }
      await Api.postMultipart('/loans', {
        'itemId': '${item['id']}',
        'dueAt': due.toUtc().toIso8601String(),
      }, foto, 'photo');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pinjaman aktif')));
      }
      _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      dueC.dispose();
    }
  }

  @override
  void dispose() {
    tab.dispose();
    super.dispose();
  }

  Widget _list(List rows, Widget Function(dynamic) item, String empty, IconData icon) {
    if (rows.isEmpty) return AppCard(child: EmptyState(text: empty, icon: icon));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: rows.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) => AppCard(padding: const EdgeInsets.all(12), child: item(rows[i])),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tugas & Materi'),
        bottom: TabBar(
          controller: tab,
          labelColor: brand,
          unselectedLabelColor: Colors.grey,
          indicatorColor: gold,
          indicatorWeight: 3,
          tabs: const [
            Tab(text: 'Tugas'),
            Tab(text: 'Materi'),
            Tab(text: 'Kumpulanku'),
            Tab(text: 'Pinjam'),
          ],
        ),
      ),
      body: Column(
        children: [
          if (err != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              padding: const EdgeInsets.all(10),
              decoration: const BoxDecoration(color: badBg, borderRadius: BorderRadius.all(Radius.circular(12))),
              child: Text(err!, style: const TextStyle(fontSize: 12, color: badFg)),
            ),
          Expanded(
            child: TabBarView(
        controller: tab,
        children: [
          _list(
            tugas,
            (t) => Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: const BoxDecoration(color: brandSoft, borderRadius: BorderRadius.all(Radius.circular(14))),
                  child: const Icon(Icons.assignment_outlined, color: brand),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${t['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
                      Text('Deadline ${wib(t['deadline'])}', style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                    ],
                  ),
                ),
                TextButton(onPressed: () => kumpulkan(t['id']), child: const Text('Kumpul')),
              ],
            ),
            'Belum ada tugas',
            Icons.assignment_outlined,
          ),
          _list(
            materi,
            (m) => Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: const BoxDecoration(color: badBg, borderRadius: BorderRadius.all(Radius.circular(14))),
                  child: const Icon(Icons.picture_as_pdf_outlined, color: badFg),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${m['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
                      Text('${((m['size'] ?? 0) / 1024).toStringAsFixed(0)} KB', style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                    ],
                  ),
                ),
                TextButton(onPressed: () => buka("/materials/${m['id']}/file"), child: const Text('Buka')),
              ],
            ),
            'Belum ada materi',
            Icons.book_outlined,
          ),
          _list(
            kumpul,
            (s) => Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${s['assignment']?['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
                      Text(wib(s['submittedAt']), style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                    ],
                  ),
                ),
                StatusChip(status: '${s['status'] ?? ''}'),
              ],
            ),
            'Belum ada submission',
            Icons.upload_file_outlined,
          ),
          (barang.isEmpty && pinjamku.isEmpty)
              ? const AppCard(child: EmptyState(text: 'Belum ada barang', icon: Icons.inventory_2_outlined))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      const SectionHead(title: 'Katalog'),
                      ...barang.map(
                        (b) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: AppCard(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('${b['code']} · ${b['name']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                                      Text('${b['condition'] ?? ''} · ${b['status']}', style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                                    ],
                                  ),
                                ),
                                if (b['status'] == 'AVAILABLE')
                                  TextButton(onPressed: () => pinjam(b), child: const Text('Pinjam')),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SectionHead(title: 'Pinjamanku'),
                      ...pinjamku.map(
                        (l) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: AppCard(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('${l['item']?['code']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                                      Text('kembali ${wib(l['dueAt'])}', style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                                    ],
                                  ),
                                ),
                                StatusChip(status: '${l['status']}'),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
        ],
            ),
          ),
        ],
      ),
    );
  }
}
