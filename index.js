const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const cron = require('node-cron');
const qrcode = require('qrcode-terminal');

// Menyimpan waktu terakhir nomor dibalas (format: nomor -> timestamp)
const riwayatBalasan = new Map();
const SATU_HARI = 24 * 60 * 60 * 1000; // 24 jam dalam milidetik

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('Scan QR Code di bawah ini menggunakan WhatsApp kamu:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan kembali...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot WhatsApp berhasil terhubung!');
            
            // Jadwal kirim pesan otomatis (Contoh: Jam 08:00 pagi)
            cron.schedule('0 8 * * *', () => {
                kirimPesanOtomatis(sock, '628xxxxxxxxxx@s.whatsapp.net', 'Halo, ini pesan otomatis jam 8 pagi!');
            }, {
                scheduled: true,
                timezone: "Asia/Jakarta"
            });
        }
    });

    // --- FITUR BALAS SEKALI DAN RESET SETELAH 1 HARI ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message) return;

        const nomorPengirim = msg.key.remoteJid;
        if (nomorPengirim.endsWith('@g.us')) return; // Abaikan pesan dari grup

        const isiPesan = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        // Abaikan jika pesan dikirim oleh bot sendiri atau teks balasan bot
        if (msg.key.fromMe || isiPesan.includes('This is jarvis') || isiPesan.includes('Pesan diterima AI Ultron')) {
            return;
        }

        const waktuSekarang = Date.now();
        
        // Cek apakah nomor ini sudah pernah dibalas dan belum lewat 1 hari
        if (riwayatBalasan.has(nomorPengirim)) {
            const waktuTerakhirDibalas = riwayatBalasan.get(nomorPengirim);
            if (waktuSekarang - waktuTerakhirDibalas < SATU_HARI) {
                console.log(`Mengabaikan pesan dari ${nomorPengirim} (belum 1 hari sejak balasan terakhir).`);
                return;
            }
        }

        const pesanLower = isiPesan.toLowerCase().trim();
        console.log(`Pesan masuk dari ${nomorPengirim}: "${isiPesan}"`);

        // Daftar kata kunci khusus
        const kataKunci = ['ger', 'gery', 'kak', 'permisi', 'p'];
        const mengandungKataKunci = kataKunci.some(keyword => pesanLower === keyword || pesanLower.includes(keyword));

        if (mengandungKataKunci) {
            await sock.sendMessage(nomorPengirim, { text: 'This is jarvis, AI yang dibuat Gery. Karena dia sedang bekerja silahkan menunggu untuk dibalas secara langsung' }, { quoted: msg });
        } else {
            await sock.sendMessage(nomorPengirim, { text: 'Pesan diterima AI Ultron, you can waiting my master text you back' }, { quoted: msg });
        }

        // Catat waktu terakhir nomor ini dibalas
        riwayatBalasan.set(nomorPengirim, waktuSekarang);
    });

    sock.ev.on('creds.update', saveCreds);
}

async function kirimPesanOtomatis(sock, nomorTujuan, teksPesan) {
    try {
        await sock.sendMessage(nomorTujuan, { text: teksPesan });
        console.log(`Pesan terkirim ke ${nomorTujuan}: "${teksPesan}"`);
    } catch (error) {
        console.error('Gagal mengirim pesan:', error);
    }
}

connectToWhatsApp();
