import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();

// Function to remove files or directories
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
    // Generate unique session for each request to avoid conflicts
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./infinity_qr_sessions/session_${sessionId}`;

    // Ensure infinity_qr_sessions directory exists
    if (!fs.existsSync('./infinity_qr_sessions')) {
        fs.mkdirSync('./infinity_qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        // Create the session folder before starting auth
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            let qrGenerated = false;
            let responseSent = false;

            // QR Code handling logic
            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;
                
                qrGenerated = true;
                console.log('♾️ Infinity MD: QR Code Generated!');
                
                try {
                    // Generate QR code as data URL
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        await res.send({ 
                            qr: qrDataURL, 
                            message: '♾️ Infinity MD QR Generated! Scan it with your WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code shown above'
                            ]
                        });
                    }
                } catch (qrError) {
                    console.error('Error generating QR code:', qrError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                }
            };

            // Baileys socket configuration
            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            };

            // Create socket
            let sock = makeWASocket(socketConfig);
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 3;

            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    console.log('✅ Infinity MD: Connected successfully!');
                    reconnectAttempts = 0;
                    
                    try {
                        const sessionFile = fs.readFileSync(dirs + '/creds.json');
                        const userJid = sock.authState.creds.me?.id ? jidNormalizedUser(sock.authState.creds.me.id) : null;
                            
                        if (userJid) {
                            // 1. Send session credentials file
                            await sock.sendMessage(userJid, {
                                document: sessionFile,
                                mimetype: 'application/json',
                                fileName: 'creds.json'
                            });
                            
                            // 2. Send rebranded signature (YouTube part removed)
                            await sock.sendMessage(userJid, {
                                text: `⚠️ *IMPORTANT: DO NOT SHARE THIS FILE* ⚠️\n\n` +
                                      `┌┤♾️ *Infinity MD Session Authorized*\n` +
                                      `│└────────────┈ ⳹\n` +
                                      `│ *Status:* Active\n` +
                                      `│ ©2025 Infinity MD Team\n` +
                                      `└─────────────────┈ ⳹\n\n` +
                                      `Deploy your bot now using the creds.json attached above.`
                            });
                            console.log("📄 Session file delivered to", userJid);
                        }
                    } catch (error) {
                        console.error("Error sending session file:", error);
                    }
                    
                    // Clean up session folder
                    setTimeout(() => {
                        console.log('🧹 Cleaning up Infinity MD temporary session...');
                        removeFile(dirs);
                    }, 10000); 
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log('🔐 Session expired or logged out.');
                        removeFile(dirs);
                    } else if (statusCode === 515 || statusCode === 503) {
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            reconnectAttempts++;
                            setTimeout(() => {
                                sock = makeWASocket(socketConfig);
                                sock.ev.on('connection.update', handleConnectionUpdate);
                                sock.ev.on('creds.update', saveCreds);
                            }, 2000);
                        }
                    }
                }
            };

            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

            // 30 second timeout for QR generation
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    removeFile(dirs);
                }
            }, 30000);

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
        }
    }

    await initiateSession();
});

// Global exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    const ignore = ["conflict", "not-authorized", "timeout", "rate-overlimit", "Closed", "Value not found", "Stream"];
    if (ignore.some(msg => e.includes(msg))) return;
    console.log('Infinity MD Caught Exception: ', err);
});

export default router;
