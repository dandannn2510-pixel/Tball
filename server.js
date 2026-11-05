const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

// Explicitly reference and preload static files with literal path.join(__dirname, ...)
// so Vercel's @vercel/nft file tracer always bundles them into the serverless runtime.
const STATIC_ASSETS = {
    '/': {
        file: path.join(__dirname, 'index.html'),
        type: 'text/html; charset=UTF-8',
        data: fs.readFileSync(path.join(__dirname, 'index.html'))
    },
    '/index.html': {
        file: path.join(__dirname, 'index.html'),
        type: 'text/html; charset=UTF-8',
        data: fs.readFileSync(path.join(__dirname, 'index.html'))
    },
    '/js/config.js': {
        file: path.join(__dirname, 'js/config.js'),
        type: 'text/javascript; charset=UTF-8',
        data: fs.readFileSync(path.join(__dirname, 'js/config.js'))
    },
    '/js/app.js': {
        file: path.join(__dirname, 'js/app.js'),
        type: 'text/javascript; charset=UTF-8',
        data: fs.readFileSync(path.join(__dirname, 'js/app.js'))
    }
};

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.js': 'text/javascript; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function readBody(req) {
    if (req.body !== undefined && req.body !== null) {
        if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
        if (typeof req.body === 'string') return Promise.resolve(req.body);
        if (typeof req.body === 'object') return Promise.resolve(new URLSearchParams(req.body).toString());
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function proxyToGas(req, res) {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const targetUrl = `${GAS_URL}${query ? '?' + query : ''}`;

    try {
        const options = { method: req.method === 'POST' ? 'POST' : 'GET', redirect: 'follow' };
        if (options.method === 'POST') {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            options.body = await readBody(req);
        }

        const gasRes = await fetch(targetUrl, options);
        const text = await gasRes.text();
        console.log(`[API] ${options.method} ${query.slice(0, 80)} -> ${gasRes.status}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
        res.end(text);
    } catch (err) {
        console.error('[API] Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ status: 'error', message: 'Proxy ติดต่อ Google Apps Script ไม่ได้: ' + err.message }));
    }
}

async function requestHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const pathname = (req.url || '/').split('?')[0];

    // 1. Proxy /api requests to Google Apps Script
    if (pathname === '/api' || pathname.startsWith('/api/')) {
        await proxyToGas(req, res);
        return;
    }

    // 2. Serve bundled core static assets (guaranteed on Vercel & local)
    if (STATIC_ASSETS[pathname]) {
        const asset = STATIC_ASSETS[pathname];
        let content = asset.data;
        try {
            content = fs.readFileSync(asset.file);
        } catch (_) {}
        res.writeHead(200, {
            'Content-Type': asset.type,
            'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
    }

    // 3. Fallback for any other local files
    const safePath = decodeURIComponent(pathname);
    const filePath = path.join(__dirname, safePath);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
            res.end('404 Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        res.end(content);
    });
}

const server = http.createServer(requestHandler);

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} ถูกใช้งานอยู่ (อาจมี npm run dev ตัวเก่ารันค้างอยู่)`);
        console.error(`   ปิด Terminal ตัวเก่า หรือกด Ctrl + C ในหน้าต่างนั้นก่อน แล้วรันใหม่\n`);
        process.exit(1);
    }
    throw err;
});

server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 Smart Sensor Dashboard is running!`);
    console.log(`👉 Open in browser: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});

module.exports = server;
