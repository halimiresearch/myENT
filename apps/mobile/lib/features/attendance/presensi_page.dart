import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:geolocator/geolocator.dart';
import '../../core/api_client.dart';
import '../../core/helpers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

// Alur singkat (AGENTS §14): Kegiatan → Kamera → Preview → Submit → Sukses.
// Kamera langsung (bukan galeri), kompres sebelum upload, foto lokal disimpan sampai sukses.
class PresensiPage extends StatefulWidget {
  final Map meeting;
  final String? qrToken;
  const PresensiPage({super.key, required this.meeting, this.qrToken});
  @override
  State<PresensiPage> createState() => _PresensiPageState();
}

class _PresensiPageState extends State<PresensiPage> {
  File? foto;
  String? status;
  String? lastError;
  int percobaan = 0;
  bool kirim = false;

  Future<void> jepret() async {
    try {
      final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1280);
      if (x == null) return;
      final out = '${x.path}.jpg';
      final r = await FlutterImageCompress.compressAndGetFile(x.path, out, quality: 80);
      final f = r == null ? File(x.path) : File(r.path);
      if (await f.length() > 5 * 1024 * 1024) {
        if (mounted) setState(() => status = 'Foto terlalu besar, ulangi');
        return;
      }
      if (mounted) {
        setState(() {
          foto = f;
          status = null;
          lastError = null;
          percobaan = 0;
        });
      }
    } catch (e) {
      if (mounted) setState(() => status = 'Kamera gagal: $e');
    }
  }

  Future<Position?> _lokasi() async {
    if (widget.meeting['latitude'] == null) return null;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied) {
      throw ApiException(400, 'Izin lokasi ditolak. Aktifkan di pengaturan');
    }
    if (p == LocationPermission.deniedForever) {
      throw ApiException(400, 'Izin lokasi permanen ditolak. Buka pengaturan aplikasi');
    }
    final off = await Geolocator.isLocationServiceEnabled();
    if (!off) throw ApiException(400, 'GPS mati. Nyalakan lokasi dulu');
    return Geolocator.getCurrentPosition().timeout(const Duration(seconds: 10));
  }

  Future<int> _kirimSekali() async {
    try {
      final pos = await _lokasi();
      final fields = {
        if (pos != null) 'latitude': '${pos.latitude}',
        if (pos != null) 'longitude': '${pos.longitude}',
        if (widget.qrToken != null) 'token': widget.qrToken!,
      };
      await Api.postMultipart(
        widget.qrToken == null
            ? "/meetings/${widget.meeting['id']}/attendance"
            : "/meetings/${widget.meeting['id']}/attendance/qr",
        fields,
        foto,
        'selfie',
      );
      return 200;
    } on ApiException catch (e) {
      lastError = e.message;
      return e.status;
    } catch (e) {
      // Timeout/socket/GPS/dll → jalur retry yang cek status dulu.
      lastError = e.toString().replaceFirst('Exception: ', '');
      return 0;
    }
  }

  Future<void> submit() async {
    if (foto == null || kirim) {
      return;
    }
    setState(() {
      kirim = true;
      status = 'Mengunggah…';
    });
    try {
      await _submitLoop();
    } on MustChange {
      if (mounted) setState(() => status = 'Perlu ganti password, masuk ulang');
    } catch (e) {
      if (mounted) setState(() => status = 'Gagal: $e');
    } finally {
      if (mounted) setState(() => kirim = false);
    }
  }

  // Privacy consent (PRD §17): backend 403 PRIVACY_CONSENT_REQUIRED sebelum selfie pertama.
  Future<bool> _mintaConsent() async {
    final setuju = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (c) => AlertDialog(
        title: const Text('Izin privasi'),
        content: const Text(
            'Presensi memakai foto selfie yang disimpan privat dan dihapus otomatis setelah masa retensi. '
            'Lanjutkan hanya bila kamu setuju.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Batal')),
          ElevatedButton(onPressed: () => Navigator.pop(c, true), child: const Text('Setuju')),
        ],
      ),
    );
    if (setuju != true) return false;
    try {
      await Api.post('/auth/privacy-consent', {});
      return true;
    } catch (e) {
      lastError = e.toString();
      return false;
    }
  }

  Future<void> _submitLoop() async {
    final mid = widget.meeting['id'];
    while (true) {
      final s = await _kirimSekali();
      if (s == 403 && (lastError ?? '').contains('PRIVACY_CONSENT_REQUIRED')) {
        if (await _mintaConsent()) continue; // consent tersimpan → ulangi kirim
        if (mounted) setState(() => status = 'Presensi butuh persetujuan privasi');
        break;
      }
      if (s == 409) {
        // 409 = duplikat milik sendiri (BR-01) → verifikasi dulu biar tak false-positive.
        try {
          await Api.get("/meetings/$mid/attendance/me");
          if (mounted) setState(() => status = 'Berhasil tercatat');
          await _bersihFoto();
          break;
        } catch (_) {
          if (mounted) setState(() => status = 'Gagal: ${lastError ?? 'duplikat'}');
          break;
        }
      }
      if (presensiSukses(s)) {
        if (mounted) setState(() => status = 'Berhasil tercatat');
        await _bersihFoto();
        break;
      }
      if (presensiBerhenti(s) || s == 401) {
        if (mounted) {
          setState(() => status = s == 401
              ? 'Sesi habis, masuk ulang'
              : 'Gagal: ${lastError ?? 'hubungi pengurus bila window tutup'}');
        }
        break;
      }
      // Timeout: cek status dulu (request mungkin sempat masuk).
      try {
        await Api.get("/meetings/$mid/attendance/me");
        if (mounted) setState(() => status = 'Berhasil tercatat');
        await _bersihFoto();
        break;
      } catch (_) {}
      percobaan++;
      if (!bolehRetry(percobaan)) {
        if (mounted) setState(() => status = 'Gagal terkirim, coba lagi');
        break;
      }
      if (mounted) setState(() => status = 'Mengulang… ($percobaan/3)');
      await Future.delayed(Duration(seconds: percobaan)); // backoff 1s,2s
    }
  }

  Future<void> _bersihFoto() async {
    try {
      final f = foto;
      foto = null;
      if (f != null && await f.exists()) await f.delete();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final ok = status == 'Berhasil tercatat';
    return Scaffold(
      appBar: AppBar(title: Text(widget.meeting['title'] ?? 'Presensi')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AppCard(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: foto != null
                      ? Image.file(foto!, height: 280, fit: BoxFit.cover)
                      : Container(
                          height: 200,
                          color: brandSoft,
                          child: const Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.camera_alt_outlined, size: 44, color: brand),
                              SizedBox(height: 8),
                              Text('Belum ada foto', style: TextStyle(color: brand)),
                            ],
                          ),
                        ),
                ),
                if (status != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: ok ? okBg : brandSoft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Icon(ok ? Icons.check_circle : Icons.info_outline, color: ok ? okFg : brand, size: 20),
                        const SizedBox(width: 8),
                        Expanded(child: Text(status!, style: TextStyle(color: ok ? okFg : brandDeep, fontWeight: FontWeight.w600, fontSize: 13))),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (!ok) ElevatedButton.icon(onPressed: jepret, icon: const Icon(Icons.camera_alt_outlined), label: const Text('Ambil Foto')),
          if (foto != null && !ok) ...[
            const SizedBox(height: 8),
            ElevatedButton.icon(onPressed: kirim ? null : submit, icon: const Icon(Icons.cloud_upload_outlined), label: const Text('Submit Presensi')),
          ],
          if (ok) ...[
            const SizedBox(height: 8),
            ElevatedButton.icon(onPressed: () => Navigator.pop(context, true), icon: const Icon(Icons.check), label: const Text('Selesai')),
          ],
        ],
      ),
    );
  }
}
