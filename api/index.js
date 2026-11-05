// Vercel Serverless Function: proxy /api -> Google Apps Script
const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function getBody(req) {
    if (req.body === undefined || req.body === null) return readRawBody(req);
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'string') return req.body;
    if (typeof req.body === 'object') return new URLSearchParams(req.body).toString();
    return '';
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    try {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
        const targetUrl = `${GAS_URL}${query ? '?' + query : ''}`;

        const options = { method: req.method === 'POST' ? 'POST' : 'GET', redirect: 'follow' };
        if (options.method === 'POST') {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            options.body = await getBody(req);
        }

        const gasRes = await fetch(targetUrl, options);
        const text = await gasRes.text();

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(text);
    } catch (error) {
        console.error('GAS Proxy Error:', error);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.end(JSON.stringify({ status: 'error', message: error.message }));
    }
};
