// ========================================================
// Configuration for Smart Sensor & Control Dashboard
// ========================================================

const CONFIG = {
    // Google Apps Script Web App URL (ผูกกับ Google Sheets ของคุณ)
    // ถ้า Deploy Apps Script ใหม่แล้วได้ URL ใหม่ ให้เปลี่ยนตรงนี้ + ใน server.js + api/index.js
    GAS_URL: "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec",

    // Proxy path (server.js ตอนรันในเครื่อง / api/index.js บน Vercel)
    PROXY_URL: "/api",

    // Request timeout (ms) - Apps Script บางครั้งตอบช้า
    REQUEST_TIMEOUT_MS: 25000,

    // ดึงค่าเซนเซอร์ล่าสุดทุกๆ กี่ ms
    POLL_INTERVAL_MS: 3000,

    // รีเฟรชกราฟทุกๆ กี่ ms
    HISTORY_REFRESH_MS: 60000,

    // หลังกดสวิตช์ จะไม่ให้ค่าจาก Sheet มาทับสวิตช์นั้นกี่ ms (กันสวิตช์เด้งกลับ)
    SWITCH_LOCK_MS: 8000,

    // เกณฑ์แจ้งเตือน
    THRESHOLDS: {
        temp: { danger: 40, risky: 35 },
        ph: { dangerMin: 4, dangerMax: 9, riskyMin: 5.5, riskyMax: 7.5 },
        ec: { danger: 3.0, risky: 2.0 }
    }
};
