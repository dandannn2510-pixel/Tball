// ========================================================
// Configuration for SEAMEO Smart Water Monitoring Dashboard
// ========================================================

const CONFIG = {
    // Google Apps Script Web App URL (ผูกกับ Google Sheets ของคุณ)
    GAS_URL: "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec",

    // Proxy path (server.js ตอนรันในเครื่อง / บน Vercel)
    PROXY_URL: "/api",

    // หมายเลขเครื่องเริ่มต้น (ให้ทุกเครื่องที่เปิดเว็บเชื่อมต่อเข้าเครื่องเดียวกันอัตโนมัติ)
    DEFAULT_MACHINE_ID: "00002",

    // ปริมาตรน้ำต่อรอบ (1 ครั้ง = 100 ลิตร)
    LITERS_PER_CYCLE: 100,

    // Request timeout (ms)
    REQUEST_TIMEOUT_MS: 25000,

    // ดึงค่าเซนเซอร์และจำนวนรอบจากช่อง ec ล่าสุดทุกๆ 2 วินาที
    POLL_INTERVAL_MS: 2000,

    // รีเฟรชกราฟทุกๆ 10 วินาที
    HISTORY_REFRESH_MS: 10000,

    // เกณฑ์แจ้งเตือน (อุณหภูมิน้ำ Temp และ pH)
    THRESHOLDS: {
        temp: { danger: 40, risky: 35 },
        ph: { dangerMin: 4, dangerMax: 9, riskyMin: 5.5, riskyMax: 7.5 }
    }
};
