# RC Session Manager

Chrome extension (Manifest V3) premium dengan desain **Glassmorphism** untuk mengelola banyak akun secara instan, tanpa login/logout manual. Data sesi tersimpan **100% lokal** di IndexedDB browser, tanpa server pihak ketiga.

## Fitur Unggulan

- **Auto-Switching Session**: pindah profil cepat tanpa password; ekstensi menyimpan & memuat cookies asli browser.
- **Smart Cookie Extractor**: beradaptasi dengan website yang dikunjungi, tombol ekstrak raw cookie spesifik (misal hanya `LTOKEN`/`CTOKEN` di Hoyoverse).
- **Safe Local Logout**: bersihkan cookies sekali klik, tanpa terdeteksi server.
- **DOM Storage Injector**: dukungan penyimpanan DOM/local untuk kompatibilitas sesi yang lebih luas.
- **Glassmorphism UI**: micro-animations, neon hover, styling premium.

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Extension | Chrome Extension API (Manifest V3) |
| Bahasa | JavaScript (vanilla) |
| Storage | IndexedDB |
| Kualitas | ESLint 9, Prettier 3 |
| Testing | Jest 29 |

## Struktur Project

```
├── manifest.json      # Konfigurasi extension (MV3)
├── background.js      # Service worker (logic background)
├── popup.html         # UI popup
├── popup.js           # Logic UI popup
├── utils.js           # Utility functions (cookie, session)
├── tests/utils.test.js# Unit tests
├── fonts/             # Aset font
├── icon16/48/128.png  # Ikon extension
├── jest.config.js
├── eslint.config.js
└── .prettierrc
```

## Cara Install (Development)

1. Buka `chrome://extensions/` (Chrome) atau `brave://extensions/` (Brave).
2. Aktifkan **Developer mode** (pojok kanan atas).
3. Klik **Load unpacked** dan pilih folder repository ini.
4. Extension siap digunakan.

## Development & Testing

```bash
npm install
npm run lint        # ESLint
npm run lint:fix    # Auto-fix ESLint
npm run format      # Prettier
npm run format:check
npm test            # Jest unit tests (node --experimental-vm-modules)
```

## Catatan

Semua data sesi tersimpan lokal di IndexedDB browser. Tidak ada server, tidak ada telemetri, dan tidak
ada data yang keluar dari perangkat. Ekstensi hanya membaca dan menulis cookies atas tindakan pengguna.