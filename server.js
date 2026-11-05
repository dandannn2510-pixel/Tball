const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

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

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const pathname = req.url.split('?')[0];

    // /api -> proxy ไป Google Apps Script
    if (pathname === '/api' || pathname.startsWith('/api/')) {
        await proxyToGas(req, res);
        return;
    }

    // Static files
    const safePath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
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
});

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
    console.log(`🚀 Smart Sensor Dashboard is running locally!`);
    console.log(`👉 Open in browser: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});
