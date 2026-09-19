# TEDI Android Mirror

TEDI extension untuk mendeteksi satu atau banyak perangkat Android melalui USB atau Wi-Fi debugging, lalu menjalankan beberapa instance `scrcpy` dari panel TEDI.

## Install

1. Buka **Settings -> Extensions** di TEDI.
2. Pindah ke tab **From GitHub**.
3. Tempel `IlhamriSKY/TEDI.android-mirroring` lalu klik **Review -> Install**.

Butuh TEDI `>=0.4.7`. Panel **Android Mirror** dan **Android Play** muncul
sebagai tab setelah dipasang.

Untuk memasang hasil build lokal: `npm install && npm run build`, lalu zip
`manifest.json`, `extension.js` dan folder `play/` di akar arsip, dan pilih dari
tab **From .zip**. `play/` wajib ikut, karena panel Play menjalankan
`play/relay.mjs` dan mengirim `play/scrcpy-server` ke perangkat.

## Sistem operasi yang didukung

- Windows
- macOS
- Linux

Extension memilih cara menjalankan probe sesuai sistem operasi: PowerShell di Windows dan shell POSIX di macOS/Linux. Setiap perangkat memiliki tombol mirror sendiri sehingga beberapa Android dapat dicerminkan bersamaan.

## Prasyarat

- **USB debugging** aktif di Android jika memakai USB. Di Linux, user harus punya izin USB (aturan udev), kalau tidak statusnya `No USB permission`.
- `scrcpy` dan `adb`. Rilis resmi scrcpy sudah membawa `adb` sendiri, dan `adb` di sebelah `scrcpy` selalu dipilih lebih dulu supaya versinya sama (dua versi adb saling me-restart server dan memutus mirror yang sedang jalan). Kalau tidak ada, dicari di PATH, `ANDROID_HOME` / `ANDROID_SDK_ROOT`, dan lokasi SDK default.
- Lokasi scrcpy yang dikenali selain PATH:
  - Windows: `%LOCALAPPDATA%\Programs\scrcpy`, scoop, chocolatey, winget (symlink diikuti)
  - macOS: Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`)
  - Linux: `/usr/bin`, `~/.local/bin`, snap
- Untuk Wi-Fi, aktifkan **Wireless debugging** dan pastikan PC di jaringan yang sama. Perangkat yang belum pernah di-pair harus di-pair sekali dulu (`adb pair`).

Pada koneksi USB, Android akan menampilkan dialog RSA. Pilih **Allow**. Jika statusnya `unauthorized`, buka kunci HP lalu izinkan komputer ini.

## Cara memakai

1. Buka command palette TEDI lalu pilih **Open Android Mirror**, atau tekan `Ctrl+Alt+R` (`Cmd+Option+R` di macOS), atau klik ikon HP di status bar.
2. Daftar perangkat diperbarui otomatis. **Refresh** mencari ulang `adb`/`scrcpy` (misalnya setelah baru diinstal) dan layanan Wi-Fi.
3. Tekan **Connect** pada layanan Wi-Fi yang ditemukan, jika belum terhubung.
4. Tekan **Mirror** di baris perangkat. Beberapa perangkat bisa di-mirror bersamaan, masing-masing di jendela scrcpy sendiri.
5. Tekan **Stop** untuk menghentikan mirror yang dimulai dari panel ini.

### Play: layar HP + keymap drag and drop (seperti emulator)

Tombol **Play** di baris HP membuka pane **Android Play** (satu pane untuk semua HP) dan menjadikan HP itu yang aktif: layar HP langsung di TEDI, dengan editor tombol di atasnya.

- **Mode Play:** mouse menjadi jari (klik kanan = Back, klik tengah = Home); tombol keyboard yang dipetakan menjadi sentuhan. Beberapa tombol bisa ditahan bersamaan (multi-touch). Setiap tombol yang ditekan terlihat: lingkarannya mengecil selama ditahan dan cincin putih memancar keluar, tampil penuh sesaat walaupun **Keys** diset tipis (kecuali Hidden).
- **Shortcut Mode / Typing Mode:** klik layar HP dulu supaya keyboard masuk ke HP (bukan ke TEDI), lalu tekan **~** untuk berpindah. Shortcut Mode menjalankan keymap; Typing Mode mengetik ke HP (chat, kolom pencarian): huruf dikirim sebagai teks, Enter/Backspace/panah/Tab/Esc sebagai tombol, dan Ctrl+A/C/V/X/Z/Y ikut. Selama Typing Mode ada tanda di atas layar.
- **Mode Edit:** **+ Tap** (satu titik, bisa ditahan), **+ Joystick** (WASD, cincin bisa digeser dan diubah ukurannya), **+ Swipe** (geser dari titik awal ke titik akhir, durasi bisa diatur). Kontrol yang baru ditambahkan berdenyut (cincin putih memancar) sampai pertama kali ditarik, jadi langsung kelihatan mana yang harus dipindah. Tarik kontrol ke posisinya, klik kontrol lalu klik tombol key di panel kanan dan tekan huruf untuk memasangkan. Delete menghapus kontrol terpilih.
- **Profil:** satu set tombol per game (New, Rename, Delete). Tersimpan di `~/.tedi/android-keymaps.json`, dipakai lagi untuk HP yang sama. Kalau file itu rusak (misalnya salah edit tangan), salinannya disimpan dulu sebagai `android-keymaps.json.unreadable-<waktu>.json` sebelum ditimpa.
- **Di mana saja:** **Open in browser** membuka halaman yang sama di browser. Tanpa TEDI: `node play/relay.mjs --open`.
- **Banyak HP:** pane **Android Play** menampilkan semua HP dalam grid. Klik HP untuk menjadikannya aktif; **Sync** (ikon rantai) membuat HP itu mengikuti input HP aktif; ikon kamera mematikan layarnya (tetap bisa dikontrol); Grid/Focus mengatur tampilan.
- **Suara:** suara HP keluar di laptop, bukan di HP (Android 11 ke atas), selama Play terbuka. Ikon speaker di kepala tiap HP membisukannya **di laptop saja**; di jendela detach tombolnya muncul di pojok kanan atas saat mouse di atas layar (dan tetap terlihat selama dibisukan). HP yang dibisukan atau tidak tampil tidak dikirimi suara sama sekali. Di bawah Android 11 ikonnya mati dan suara tetap di HP. Suara dikirim mentah (48 kHz stereo, sekitar 190 KB/s per HP) supaya tanpa jeda encode.
- **Volume dan kecerahan:** ikon slider di kepala tiap HP (di jendela detach: pojok kanan atas) membuka panel kecil. **Volume** mengatur keras suara HP itu di laptop saja (0 sampai 100%, diingat). **Brightness** mengatur kecerahan layar HP sendiri, dibaca dari HP saat panel dibuka; menggesernya mematikan kecerahan otomatis seperti di HP, dan **Auto** menyalakannya lagi. Kecerahan diatur lewat layanan display Android (skala yang sama di semua HP, termasuk MIUI yang menyimpan angka versinya sendiri), dengan cadangan pengaturan 0 sampai 255 di Android lama.
- **Zoom:** tombol kaca pembesar di bar, `Ctrl` + scroll, atau `Ctrl+=` / `Ctrl+-` membesarkan dan mengecilkan layar HP di pane (50% sampai 300% dari ukuran pas). Kalau lebih besar dari pane, scroll untuk bergeser. Label di tengah (atau `Ctrl+0`) kembali ke **Fit**. Zoom diingat.
- **Detach:** ikon panel di kepala tiap HP langsung membuka HP itu di **jendela float TEDI** (selalu di atas, bisa dipindah ke mana saja), hanya layar tanpa bar dan tombol; keymap, mouse dan ~ tetap jalan. Jendelanya **ikut rotasi HP**: saat HP diputar ke landscape atau portrait, jendela berputar di tempat (tengahnya tetap, sisi panjangnya sama) dan tetap di dalam monitor. Detach HP yang sama lagi memunculkan jendelanya. Di grid HP itu disembunyikan selama jendelanya terbuka; tutup jendelanya untuk mengembalikannya. Keymap diatur dari grid dan langsung berlaku. Jendela float memakai relay jendela utama (tidak membuat sesi kedua) dan tidak menjalankan proses apa pun sendiri.
- **Detach All** (di TEDI): tombol di bar membuka setiap HP di jendelanya sendiri dan menyusunnya **berdampingan** di monitor TEDI, dalam satu baris atau lebih (dipilih yang membuat layar paling besar), semuanya diperkecil sama rata kalau tidak muat. HP yang sudah di-detach ikut disusun ulang. Setiap jendela lalu mengikuti rotasi HP-nya sendiri.
- **TEDI lama:** ikut rotasi dan penyusunan berdampingan butuh perintah `set_float_window_bounds` dari TEDI versi berikutnya. Di TEDI yang belum punya, jendela float tetap terbuka (di tengah jendela TEDI, tidak ikut berputar). Kalau jendela float sama sekali tidak bisa dibuka, HP itu dibuka di pane biasa.
- **Syarat:** Node.js (untuk relay) dan adb. Layar dikirim oleh `play/scrcpy-server` (scrcpy 4.1, Apache-2.0, lihat `play/NOTICE`), jadi scrcpy tidak wajib terpasang.

Cara kerja: `play/relay.mjs` (tanpa dependency) menjalankan scrcpy-server di HP lewat `adb forward`, meneruskan video H.264 ke halaman lewat WebSocket, dan mengubah sentuhan halaman menjadi pesan kontrol scrcpy. Halaman men-decode video dengan WebCodecs. Relay hanya mendengarkan `127.0.0.1` dan setiap permintaan harus membawa token acak per sesi, Host dan Origin miliknya sendiri, jadi situs web lain tidak bisa mengendalikan HP. Satu sesi scrcpy per HP dibagi ke semua halaman yang menampilkannya, dan berhenti beberapa detik setelah halaman terakhir ditutup.

Ikon di status bar hanya ikon. Jumlah perangkat ada di hover ikon dan di panel.

Cara kerja: satu proses `adb track-devices` berjalan selama extension aktif dan mengirim perubahan daftar perangkat, jadi tidak ada shell yang dijalankan tiap beberapa detik. Proses itu juga yang menjaga adb server tetap hidup; di Windows TEDI memasukkan setiap proses anak ke Job Object, dan server yang dinyalakan oleh adb berumur pendek ikut mati bersamanya. Layanan Wi-Fi (`adb mdns services`) hanya dipindai saat panel terbuka.

## Batasan penting

Tombol **Mirror** membuka scrcpy sebagai **jendela native terpisah** (suaranya juga keluar di laptop, bawaan scrcpy, tanpa tombol mute; bisukan lewat Volume Mixer Windows); untuk layar di dalam tab TEDI pakai **Play**. Extension ini mengelola proses scrcpy dari TEDI, tetapi tidak mencoba mengambil alih atau membunuh proses scrcpy yang tidak dibuat oleh extension ini.

Extension hanya memakai perintah tetap untuk mencari `adb`/`scrcpy`, lalu menjalankan `adb` langsung tanpa shell untuk membaca daftar perangkat, membaca mDNS ADB, dan `adb connect` ke endpoint mDNS yang tervalidasi. Extension tidak melakukan pemindaian IP arbitrer.

## Build dan validasi

```powershell
npm install
npm run build
npm test
npm run check
npm run typecheck
```

Validasi paket dari root TEDI dapat dilakukan dengan `tedi ext validate` jika subcommand tersebut tersedia pada build CLI yang dipakai.
