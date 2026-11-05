const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
        const targetUrl = `${GAS_URL}${query ? '?' + query : ''}`;

        let gasResponse;
        if (req.method === 'POST') {
            let bodyData = '';
            if (typeof req.body === 'object' && req.body !== null) {
                bodyData = new URLSearchParams(req.body).toString();
            } else if (typeof req.body === 'string') {
                bodyData = req.body;
            }

            gasResponse = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: bodyData,
                redirect: 'follow'
            });
        } else {
            gasResponse = await fetch(targetUrl, {
                method: 'GET',
                redirect: 'follow'
            });
        }

        const data = await gasResponse.text();
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.status(200).send(data);
    } catch (error) {
        console.error('GAS Proxy Error on Vercel:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};
