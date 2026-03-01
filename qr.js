import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import zlib from 'zlib';

const router = express.Router();

/**
 * Utility to clean up session directories
 */
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    // Generate unique session ID for each request to avoid conflicts
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./infinity_qr_sessions/session_${sessionId}`;

    // Ensure session directory exists
    if (!fs.existsSync('./infinity_qr_sessions')) {
        fs.mkdirSync('./infinity_qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let qrGenerated = false;
            let responseSent = false;

            // Handle QR Code generation for the web/API response
            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;
                qrGenerated = true;
                
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        await res.send({ 
                            qr: qrDataURL, 
                            message: '♾️ Infinity MD: Scan the QR code with WhatsApp.'
                        });
                    }
                } catch (e) {
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                }
            };

            let sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
            });

            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr && !qrGenerated) await handleQRCode(qr);

                if (connection === 'open') {
                    console.log('✅ Infinity MD: QR Connection Successful!');
                    
                    try {
                        // Read credentials and compress into a Session ID string
                        const credsData = fs.readFileSync(dirs + '/creds.json', 'utf-8');
                        const compressed = zlib.gzipSync(credsData);
                        const sessionString = "Infinity_MD!" + compressed.toString('base64');

                        const userJid = sock.authState.creds.me?.id ? jidNormalizedUser(sock.authState.creds.me.id) : null;
                        
                        if (userJid) {
                            // 1. Send the raw Session ID string
                            await sock.sendMessage(userJid, { text: sessionString });
                            
                            // 2. Send the branded signature
                            await sock.sendMessage(userJid, {
                                text: `⚠️ *IMPORTANT: DO NOT SHARE THIS ID* ⚠️\n\n` +
                                      `┌┤♾️ *Infinity MD Session*\n` +
                                      `│└────────────┈ ⳹\n` +
                                      `│ *ID:* ${sessionString.substring(0, 15)}...\n` +
                                      `│ ©2025 Infinity MD Team\n` +
                                      `└─────────────────┈ ⳹\n\n` +
                                      `Copy the ID above to deploy your bot.`
                            });
                        }
                    } catch (e) {
                        console.error('Error sending session ID:', e);
                    }

                    // Clean up local session folder after successful login
                    setTimeout(() => {
                        console.log('🧹 Cleaning up temporary QR session...');
                        removeFile(dirs);
                    }, 10000);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        removeFile(dirs);
                    } else {
                        // Attempt reconnection for transient errors
                        setTimeout(() => {
                            initiateSession();
                        }, 2000);
                    }
                }
            };

            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

            // Timeout if no connection is made within 60 seconds
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    removeFile(dirs);
                }
            }, 60000);

        } catch (err) {
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Global exception handling
process.on('uncaughtException', (err) => {
    const errorMsg = String(err);
    const ignorePatterns = ["conflict", "not-authorized", "timeout", "rate-overlimit", "Stream"];
    if (ignorePatterns.some(p => errorMsg.includes(p))) return;
    console.log('Infinity MD QR Caught Exception: ', err);
});

export default router;
