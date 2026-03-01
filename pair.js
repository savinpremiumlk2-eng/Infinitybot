import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Helper function to clean up session directories
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `infinity_session`);

    // Remove existing session if present to ensure a fresh start
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ 
                code: 'Invalid phone number. Please enter your full international number without + or spaces.' 
            });
        }
        return;
    }
    
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            // Rebranded instance: Infinity_MD
            let Infinity_MD = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            Infinity_MD.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Infinity MD Connected Successfully!");
                    console.log("📱 Sending session file to user...");
                    
                    try {
                        const sessionFile = fs.readFileSync(dirs + '/creds.json');
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        // 1. Send session credentials file
                        await Infinity_MD.sendMessage(userJid, {
                            document: sessionFile,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file sent successfully");

                        // 2. Send rebranded signature/warning message
                        await Infinity_MD.sendMessage(userJid, {
                            text: `⚠️ *IMPORTANT: DO NOT SHARE THIS FILE* ⚠️\n\n` +
                                  `┌┤♾️ *Infinity MD Session Authorized*\n` +
                                  `│└────────────┈ ⳹\n` +
                                  `│ *Status:* Active\n` +
                                  `│ *User:* ${num}\n` +
                                  `│ ©2025 Infinity MD Team\n` +
                                  `└─────────────────┈ ⳹\n\n` +
                                  `Deploy your bot now using the creds.json attached above.`
                        });
                        console.log("⚠️ Rebranded signature sent");

                        // Clean up session locally after successful delivery
                        console.log("🧹 Cleaning up local session cache...");
                        await delay(2000);
                        removeFile(dirs);
                        console.log("✅ Cleanup complete. Process finished!");
                        
                    } catch (error) {
                        console.error("❌ Error during message delivery:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log("🔐 Infinity MD: New login detected.");
                if (isOnline) console.log("📶 Infinity MD is online.");

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Unauthorized: Session logged out.");
                    } else {
                        console.log("🔁 Connection dropped. Restarting Infinity MD...");
                        initiateSession();
                    }
                }
            });

            // Handle Pairing Code request
            if (!Infinity_MD.authState.creds.registered) {
                await delay(3000); 
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await Infinity_MD.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log(`🔢 Code generated for ${num}: ${code}`);
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Infinity MD: Failed to fetch pairing code.' });
                    }
                }
            }

            Infinity_MD.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('Error initializing Infinity MD session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Infinity MD: Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global exception handling to keep the server running
process.on('uncaughtException', (err) => {
    let e = String(err);
    const ignoreLogs = [
        "conflict", "not-authorized", "Socket connection timeout", 
        "rate-overlimit", "Connection Closed", "Timed Out", 
        "Value not found", "Stream Errored", "statusCode: 515", "statusCode: 503"
    ];
    
    if (ignoreLogs.some(msg => e.includes(msg))) return;
    console.log('Infinity MD Caught Exception: ', err);
});

export default router;
