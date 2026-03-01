import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';

// Importing the modules
import pairRouter from './pair.js';
import qrRouter from './qr.js';

const app = express();

// Resolve the current directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port configuration
const PORT = process.env.PORT || 8000;

// Increase event listener limit to prevent memory leak warnings during multiple socket connections
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, JS) from the root directory
app.use(express.static(__dirname));

// Primary Route: Serves the main UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Router mounting
app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// Start Server
app.listen(PORT, () => {
    console.log(`
♾️ Infinity MD Session Generator
--------------------------------
🚀 Status: Running
🌐 URL: http://localhost:${PORT}
📁 Routes: /pair, /qr
--------------------------------
© 2025 Infinity MD Team
    `);
});

export default app;
