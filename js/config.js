// ========================================================
// Configuration for Smart Sensor & Control Dashboard
// ========================================================

const CONFIG = {
    // Uses internal proxy /api when on web server (eliminates Google CORS issues)
    // Falls back to direct Google Apps Script URL if opened as local file
    API_URL: window.location.protocol.startsWith('http')
        ? "/api"
        : "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec",
    
    // Polling interval in milliseconds (3000ms = 3s)
    POLL_INTERVAL_MS: 3000,
    
    // Thresholds for status evaluation
    THRESHOLDS: {
        temp: {
            danger: 40,
            risky: 35
        },
        ph: {
            dangerMin: 4,
            dangerMax: 9,
            riskyMin: 5.5,
            riskyMax: 7.5
        },
        ec: {
            danger: 3.0,
            risky: 2.0
        }
    }
};
