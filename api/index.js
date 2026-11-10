// Vercel Serverless Function: proxy /api -> Google Apps Script
const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

const sharedState = {
    activeMachineId: '00002',
    switchesByMachine: {}
};

function getMachineSwitchCache(machineId) {
    if (!sharedState.switchesByMachine[machineId]) {
        sharedState.switchesByMachine[machineId] = {
            motor1_command: '1', // ช่อง 1 มอเตอร์
            motor2_command: '2', // ช่อง 2 ปั๊มน้ำ
            pump1_command: '3',  // ช่อง 3 แผ่นอะลูมิเนียม (pump1)
            pump2_command: '4',  // ช่อง 4 วาล์วน้ำไฟฟ้า (pump2)
            updatedAt: 0
        };
    }
    return sharedState.switchesByMachine[machineId];
}

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
        const queryParams = new URLSearchParams(query);
        const action = queryParams.get('action') || '';

        if (action === 'get_sync_state') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({
                status: 'ok',
                active_machine_id: sharedState.activeMachineId,
                switches: sharedState.switchesByMachine[sharedState.activeMachineId] || null
            }));
            return;
        }

        if (action === 'ping') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ status: 'ok', active_machine_id: sharedState.activeMachineId }));
            return;
        }

        const targetUrl = `${GAS_URL}${query ? '?' + query : ''}`;

        const options = { method: req.method === 'POST' ? 'POST' : 'GET', redirect: 'follow' };
        let bodyParams = null;
        if (options.method === 'POST') {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            options.body = await getBody(req);
            bodyParams = new URLSearchParams(options.body);
        }

        if (action === 'set_device_command' && bodyParams) {
            const mId = (bodyParams.get('machine_id') || sharedState.activeMachineId || '00002').trim();
            const cmd = String(bodyParams.get('command') ?? '');
            const devType = String(bodyParams.get('device_type') || '');
            sharedState.activeMachineId = mId;

            const cache = getMachineSwitchCache(mId);
            if (devType === '1') {
                cache.motor1_command = cmd;
                if (cmd === '0') cache.pump1_command = '3';
            } else if (devType === '2') {
                cache.motor2_command = cmd;
            } else if (devType === '3') {
                cache.pump1_command = cmd;
                if (cmd === '0') cache.motor1_command = '1';
            } else if (devType === '4') {
                cache.pump2_command = cmd;
            }
            cache.updatedAt = Date.now();
        }

        const gasRes = await fetch(targetUrl, options);
        let text = await gasRes.text();

        if (action === 'get_current') {
            const mId = (queryParams.get('machine_id') || sharedState.activeMachineId || '00002').trim();
            sharedState.activeMachineId = mId;
            const cache = getMachineSwitchCache(mId);
            try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object') {
                    if (String(parsed.motor1_command) === '0' && String(parsed.pump1_command) === '0') {
                        parsed.pump1_command = '3';
                        cache.pump1_command = '3';
                    }
                    text = JSON.stringify(parsed);
                }
            } catch (_) {}
        }

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
