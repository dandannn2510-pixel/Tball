// ========================================================
// Configuration for SEAMEO Smart Sensor & Control Dashboard
// ========================================================

const CONFIG = {
    // Google Apps Script Web App URL (ผูกกับ Google Sheets ของคุณ)
    GAS_URL: "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec",

    // Proxy path (server.js ตอนรันในเครื่อง / บน Vercel)
    PROXY_URL: "/api",

    // หมายเลขเครื่องเริ่มต้น (ให้ทุกเครื่องที่เปิดเว็บเชื่อมต่อเข้าเครื่องเดียวกันอัตโนมัติ)
    DEFAULT_MACHINE_ID: "ESP32-01",

    // Request timeout (ms)
    REQUEST_TIMEOUT_MS: 25000,

    // ดึงค่าเซนเซอร์และสถานะสวิตช์ล่าสุดทุกๆ 2 วินาที เพื่อให้ทุกเครื่องซิงค์ตรงกันแบบเรียลไทม์
    POLL_INTERVAL_MS: 2000,

    // รีเฟรชกราฟทุกๆ กี่ ms
    HISTORY_REFRESH_MS: 60000,

    // หลังกดสวิตช์ จะล็อกสวิตช์ในเครื่องที่กดกี่ ms เพื่อรอให้คลาวด์บันทึกเสร็จ
    SWITCH_LOCK_MS: 4500,

    // เกณฑ์แจ้งเตือน
    THRESHOLDS: {
        temp: { danger: 40, risky: 35 },
        ph: { dangerMin: 4, dangerMax: 9, riskyMin: 5.5, riskyMax: 7.5 },
        ec: { danger: 3.0, risky: 2.0 },
        level: { low: 20, high: 95 }
    }
};
