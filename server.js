const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

const sharedState = {
    activeMachineId: '00002'
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

async function ensureMachineInSheet(machineId) {
    if (!machineId) return;
    try {
        const body = new URLSearchParams({
            action: 'add_machine',
            machine_id: machineId,
            user_id: '1'
        }).toString();
        await fetch(`${GAS_URL}?action=add_machine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            redirect: 'follow'
        });
    } catch (_) {}
}

async function proxyToGas(req, res) {
    const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const queryParams = new URLSearchParams(queryStr);
    const action = queryParams.get('action') || '';

    if (action === 'get_sync_state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            status: 'ok',
            active_machine_id: sharedState.activeMachineId
        }));
        return;
    }

    if (action === 'ping') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ status: 'ok', active_machine_id: sharedState.activeMachineId }));
        return;
    }

    const targetUrl = `${GAS_URL}${queryStr ? '?' + queryStr : ''}`;

    try {
        const options = { method: req.method === 'POST' ? 'POST' : 'GET', redirect: 'follow' };
        if (options.method === 'POST') {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            options.body = await readBody(req);
        }

        const gasRes = await fetch(targetUrl, options);
        let text = await gasRes.text();

        if (action === 'get_current') {
            const mId = (queryParams.get('machine_id') || sharedState.activeMachineId || '00002').trim();
            sharedState.activeMachineId = mId;

            let parsed = {};
            try { parsed = JSON.parse(text); } catch (_) { parsed = {}; }

            if (!parsed || Object.keys(parsed).length === 0) {
                ensureMachineInSheet(mId);
                parsed = {
                    current_temp: 0,
                    current_ph: 0,
                    current_ec: 0
                };
            }

            parsed.active_machine_id = sharedState.activeMachineId;
            text = JSON.stringify(parsed);
        }

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

    const rawPath = (req.url || '/').split('?')[0];
    const pathname = (rawPath === '/' || rawPath === '') ? '/index.html' : rawPath;

    if (pathname === '/api' || pathname.startsWith('/api/')) {
        await proxyToGas(req, res);
        return;
    }

    const safePath = decodeURIComponent(pathname).replace(/^\/+/, '');
    const filePath = path.join(__dirname, safePath);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            const indexFallback = path.join(__dirname, 'index.html');
            fs.readFile(indexFallback, (err2, indexContent) => {
                if (err2) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
                    res.end('404 Not Found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' });
                res.end(indexContent);
            });
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
        console.error(`\n❌ Port ${PORT} ถูกใช้งานอยู่ (อาจมีเซิร์ฟเวอร์ตัวเก่ารันค้างอยู่)\n`);
        process.exit(1);
    }
    throw err;
});

server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 SEAMEO Smart Sensor Monitor is running!`);
    console.log(`👉 Open in browser: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});
