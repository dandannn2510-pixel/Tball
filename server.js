const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GAS_URL = "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec";

// Real-time shared memory layer + Google Sheets persistence
// Active-Low Relay Polarity: '0' = ON (เปิดเครื่อง), '1'/'2'/'3'/'4' = OFF (ปิดเครื่อง)
const sharedState = {
    activeMachineId: '00002',
    switchesByMachine: {}
};

function getMachineSwitchCache(machineId) {
    if (!sharedState.switchesByMachine[machineId]) {
        sharedState.switchesByMachine[machineId] = {
            motor1_command: '1', // ช่อง 1 มอเตอร์ (motor1): '1' = OFF, '0' = ON
            motor2_command: '2', // ช่อง 2 ปั๊มน้ำ (motor2): '2' = OFF, '0' = ON
            pump1_command: '3',  // ช่อง 3 แผ่นอะลูมิเนียม (pump1): '3' = OFF, '0' = ON
            pump2_command: '4',  // ช่อง 4 วาล์วน้ำไฟฟ้า (pump2): '4' = OFF, '0' = ON
            updatedAt: 0
        };
    }
    return sharedState.switchesByMachine[machineId];
}

// Embedded fallback assets so Vercel's serverless runtime always has index.html, config.js, and app.js
const EMBEDDED_ASSETS = {
    '/index.html': {
        file: 'index.html',
        type: 'text/html; charset=UTF-8',
        content: `<!DOCTYPE html>
<html lang="th">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SEAMEO — ระบบตรวจวัดคุณภาพน้ำและควบคุมการบำบัดอัตโนมัติ</title>
    <link rel="icon" type="image/svg+xml"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%2338BDF8'/%3E%3Cstop offset='100%25' stop-color='%230284C7'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='32' cy='32' r='30' fill='%23071324' stroke='url(%23g)' stroke-width='3'/%3E%3Cpath d='M32 12 C32 12 18 29 18 39 C18 46.7 24.3 53 32 53 C39.7 53 46 46.7 46 39 C46 29 32 12 32 12 Z' fill='url(%23g)'/%3E%3Cpath d='M22 39 Q27 34 32 39 T42 39' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link
        href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&family=Prompt:wght@400;500;600;700&display=swap"
        rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Prompt"', '"Kanit"', 'sans-serif'],
                        display: ['"Kanit"', '"Prompt"', 'sans-serif'],
                        mono: ['"Kanit"', 'sans-serif'],
                    }
                }
            }
        }
    </script>
    <style>
        body {
            font-family: 'Prompt', 'Kanit', sans-serif;
            background-color: #EEF3F8;
            color: #0F172A;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }

        .font-mono-num {
            font-family: 'Kanit', sans-serif;
            font-variant-numeric: tabular-nums;
        }

        .graphic-title {
            font-family: 'Kanit', sans-serif;
            line-height: 1.35;
        }

        .graphic-num {
            font-family: 'Kanit', sans-serif;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.02em;
            line-height: 1.05;
        }

        .led-dot {
            width: 9px;
            height: 9px;
            border-radius: 9999px;
            display: inline-block;
            flex-shrink: 0;
        }

        .led-online {
            background-color: #10B981;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.22);
        }

        .led-standby {
            background-color: #94A3B8;
        }

        .led-error {
            background-color: #EF4444;
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.22);
        }

        .gauge-arc {
            transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease;
        }

        .bar-fill {
            transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }
    </style>
</head>

<body class="min-h-screen flex flex-col selection:bg-sky-700 selection:text-white">

    <!-- Toast Notification Container -->
    <div id="toastContainer" class="fixed top-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
    </div>

    <!-- ===================================================================== -->
    <!-- 1. หน้าเข้าสู่ระบบ (LOGIN PORTAL)                                       -->
    <!-- ===================================================================== -->
    <div id="authScreen" class="min-h-screen flex flex-col lg:flex-row bg-white">

        <!-- ฝั่งซ้าย: ภาพพื้นหลังน้ำและรายละเอียดระบบ -->
        <div
            class="lg:w-[56%] xl:w-[58%] relative min-h-[420px] lg:min-h-screen flex flex-col justify-between p-8 sm:p-12 lg:p-16 text-white overflow-hidden bg-[#061A2E]">

            <img src="https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1800&q=85"
                alt="Water Surface" class="absolute inset-0 w-full h-full object-cover object-center" />

            <div class="absolute inset-0 bg-gradient-to-b from-[#061A2E]/75 via-[#08243E]/55 to-[#04111F]/95"></div>

            <!-- โลโก้ด้านบน -->
            <div class="relative z-10 flex items-center justify-between">
                <div class="flex items-center gap-3.5">
                    <div
                        class="w-11 h-11 rounded-xl bg-sky-500/20 backdrop-blur-md border border-sky-300/30 flex items-center justify-center">
                        <svg class="w-6 h-6 text-sky-300" viewBox="0 0 32 32" fill="none"
                            xmlns="http://www.w3.org/2000/svg">
                            <path d="M5 13.5C8.5 10 12.2 10 16 13.5C19.8 17 23.5 17 27 13.5" stroke="currentColor"
                                stroke-width="2.5" stroke-linecap="round" />
                            <path d="M5 19.5C8.5 16 12.2 16 16 19.5C19.8 23 23.5 23 27 19.5" stroke="currentColor"
                                stroke-width="2.5" stroke-linecap="round" opacity="0.7" />
                        </svg>
                    </div>
                    <div>
                        <div class="text-base font-bold tracking-wider uppercase text-white">SEAMEO</div>
                        <div class="text-xs text-sky-200/80">Smart Water Monitoring &amp; Control</div>
                    </div>
                </div>
            </div>

            <!-- ข้อความหลักและตารางสรุป 4 ส่วน -->
            <div class="relative z-10 mt-auto pt-12 max-w-2xl">
                <h1 class="font-display graphic-title text-3xl sm:text-4xl font-bold text-white">
                    ระบบตรวจวัดคุณภาพน้ำ<br>
                    <span class="text-sky-300 font-semibold">และควบคุมชุดบำบัดอัตโนมัติ</span>
                </h1>

                <p class="text-sm sm:text-base text-slate-200 leading-relaxed mt-4 max-w-xl">
                    ติดตามค่าอุณหภูมิน้ำ ความเป็นกรด-ด่าง (pH) และระดับน้ำแบบเรียลไทม์
                    พร้อมแผงสวิตช์ควบคุมมอเตอร์ ปั๊มน้ำ แผ่นอะลูมิเนียม และวาล์วน้ำไฟฟ้า
                </p>

                <div class="mt-10 pt-6 border-t border-white/20 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div class="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/15">
                        <div class="text-xs font-semibold text-orange-300">1. อุณหภูมิน้ำ</div>
                        <div class="text-sm font-bold text-white mt-0.5">Temperature</div>
                        <div class="text-xs text-white/70 mt-0.5">ปกติ &lt; 35.0 °C</div>
                    </div>
                    <div class="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/15">
                        <div class="text-xs font-semibold text-sky-300">2. ค่ากรด-ด่าง</div>
                        <div class="text-sm font-bold text-white mt-0.5">pH Level</div>
                        <div class="text-xs text-white/70 mt-0.5">ปกติ 5.50 – 7.50</div>
                    </div>
                    <div class="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/15">
                        <div class="text-xs font-semibold text-teal-300">3. ระดับน้ำ</div>
                        <div class="text-sm font-bold text-white mt-0.5">Water Level</div>
                        <div class="text-xs text-white/70 mt-0.5">ปกติ 20% – 95%</div>
                    </div>
                    <div class="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/15">
                        <div class="text-xs font-semibold text-emerald-300">4. ชุดควบคุม</div>
                        <div class="text-sm font-bold text-white mt-0.5">สวิตช์ 4 ช่อง</div>
                        <div class="text-xs text-white/70 mt-0.5">มอเตอร์·ปั๊ม·แผ่น·วาล์ว</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ฝั่งขวา: ฟอร์มเข้าสู่ระบบ -->
        <div class="lg:w-[44%] xl:w-[42%] bg-white flex flex-col justify-between p-8 sm:p-12 lg:p-16">

            <div class="flex items-center justify-between border-b border-slate-100 pb-4">
                <span class="text-xs font-semibold tracking-wider text-slate-400">ระบบผู้ใช้งาน</span>
                <div id="apiStatus" class="text-xs text-slate-500 flex items-center gap-2">
                    <span class="led-dot led-standby"></span>
                    <span>กำลังตรวจสอบฐานข้อมูล...</span>
                </div>
            </div>

            <div class="my-10 lg:my-auto max-w-[360px] w-full mx-auto">
                <div class="mb-7">
                    <h2 id="authTitle" class="graphic-title text-2xl sm:text-3xl font-bold text-slate-900">
                        เข้าสู่ระบบควบคุม
                    </h2>
                    <p class="text-sm text-slate-500 mt-1.5">
                        กรอกชื่อผู้ใช้งานเพื่อเข้าถึงหน้าแสดงผลและสั่งการอุปกรณ์
                    </p>
                </div>

                <!-- แท็บสลับ เข้าสู่ระบบ / สมัครสมาชิก -->
                <div class="flex border-b border-slate-200 mb-6">
                    <button type="button" id="tabLogin" onclick="switchAuthTab('login')"
                        class="pb-3 pr-6 text-sm font-bold border-b-2 border-sky-600 text-sky-700 transition-all">
                        เข้าสู่ระบบ
                    </button>
                    <button type="button" id="tabRegister" onclick="switchAuthTab('register')"
                        class="pb-3 px-6 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-700 transition-all">
                        สมัครสมาชิกใหม่
                    </button>
                </div>

                <div id="authMsgBox" class="hidden mb-5 p-3.5 rounded-lg text-xs border transition"></div>

                <form onsubmit="handleAuth(event)" class="space-y-4">
                    <div>
                        <label id="authUsernameLabel" class="block text-sm font-semibold text-slate-700 mb-2">
                            ชื่อผู้ใช้งาน (Username)
                        </label>
                        <input type="text" id="authUsername" required autocomplete="username"
                            class="w-full px-4 py-3 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 text-slate-900 text-sm transition"
                            placeholder="ระบุชื่อผู้ใช้งานของคุณ">
                    </div>

                    <button type="submit" id="authSubmitBtn"
                        class="w-full py-3.5 px-5 rounded-lg bg-[#0B2545] hover:bg-sky-800 text-white text-sm font-semibold transition flex items-center justify-center gap-2 shadow-sm">
                        <span id="authSubmitText">เข้าสู่แผงควบคุมระบบ</span>
                    </button>
                </form>

                <div class="mt-8 pt-6 border-t border-slate-100 text-center">
                    <button type="button" onclick="quickGuestLogin()"
                        class="w-full py-3 px-4 rounded-lg border border-slate-200 hover:border-sky-300 hover:bg-sky-50 text-slate-700 text-xs font-semibold transition">
                        เข้าใช้งานโหมดสาธิต (สำหรับคณะกรรมการ / ทดสอบระบบ)
                    </button>
                </div>
            </div>

            <div class="text-xs text-slate-400 flex items-center justify-between pt-4 border-t border-slate-100">
                <span>SEAMEO SYSTEM</span>
                <span class="font-mono-num">SMART WATER DASHBOARD</span>
            </div>
        </div>
    </div>

    <!-- ===================================================================== -->
    <!-- 2. หน้าแผงควบคุมหลัก (MAIN DASHBOARD)                                   -->
    <!-- ===================================================================== -->
    <div id="dashboardScreen" class="hidden flex-1 flex flex-col">

        <!-- แถบหัวเว็บสีกรมท่าเข้ม -->
        <header class="bg-[#0B2545] text-white border-b border-sky-900/60 sticky top-0 z-30 shadow">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3.5">
                    <div
                        class="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
                        <svg class="w-5 h-5 text-sky-300" viewBox="0 0 32 32" fill="none"
                            xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 13C7.5 9.5 11.5 9.5 16 13C20.5 16.5 24.5 16.5 28 13" stroke="currentColor"
                                stroke-width="2.6" stroke-linecap="round" />
                            <path d="M4 20C7.5 16.5 11.5 16.5 16 20C20.5 23.5 24.5 23.5 28 20" stroke="currentColor"
                                stroke-width="2.6" stroke-linecap="round" opacity="0.65" />
                        </svg>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-display font-bold text-base tracking-wider text-white">SEAMEO</span>
                            <span
                                class="text-[11px] font-mono-num font-semibold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">LIVE</span>
                        </div>
                        <h1 class="font-display text-xs sm:text-sm text-sky-100/80">
                            ระบบตรวจวัดคุณภาพน้ำและควบคุมชุดบำบัดอัตโนมัติ
                        </h1>
                    </div>
                </div>

                <div class="flex items-center gap-2.5 sm:gap-3">
                    <div
                        class="hidden lg:flex items-center gap-2 bg-[#071A33] border border-sky-800/70 px-3.5 py-1.5 rounded-lg text-xs font-mono-num text-sky-100">
                        <i data-lucide="clock" class="w-3.5 h-3.5 text-sky-400"></i>
                        <span id="systemClock">--:--:--</span>
                    </div>

                    <div
                        class="hidden sm:flex items-center gap-2 bg-[#071A33] border border-sky-800/70 py-1.5 px-3.5 rounded-lg text-xs">
                        <span class="text-slate-300">ผู้ใช้งาน:</span>
                        <strong id="displayUsername" class="text-sky-300 font-semibold">OPERATOR</strong>
                    </div>

                    <button onclick="openAddMachineModal()"
                        class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition shadow-sm">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        <span>เพิ่มเครื่องใหม่</span>
                    </button>

                    <button onclick="logout()"
                        class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 border border-sky-800/80 rounded-lg transition">
                        <i data-lucide="log-out" class="w-4 h-4"></i>
                        <span class="hidden sm:inline">ออกจากระบบ</span>
                    </button>
                </div>
            </div>
        </header>

        <!-- พื้นที่เนื้อหาหลัก แยกเป็น 4 ส่วนชัดเจน -->
        <main class="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 flex-1">

            <!-- ============================================================= -->
            <!-- ส่วนควบคุมการเชื่อมต่อเครื่อง & สรุปสถานะน้ำ                      -->
            <!-- ============================================================= -->
            <div
                class="bg-white border border-slate-200/90 rounded-xl p-4 sm:p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
                            <i data-lucide="cpu" class="w-4 h-4"></i>
                        </div>
                        <label for="machineIdInput" class="text-sm font-bold text-slate-800">
                            หมายเลขเครื่อง (Machine ID):
                        </label>
                    </div>

                    <div class="flex items-center gap-2">
                        <input type="text" id="machineIdInput" placeholder="เช่น ESP32-01"
                            class="px-3.5 py-2 text-sm font-mono-num font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600 w-40 sm:w-44 bg-slate-50 text-slate-900">
                        <button onclick="bindMachine()"
                            class="px-4 py-2 text-xs font-semibold text-white bg-[#0B2545] hover:bg-sky-800 rounded-lg transition flex items-center gap-1.5">
                            <i data-lucide="radio" class="w-3.5 h-3.5 text-sky-300"></i>
                            <span>เชื่อมต่อ</span>
                        </button>
                    </div>
                    <span id="connectionBadge" class="hidden px-3 py-1 text-xs rounded-lg font-semibold"></span>
                </div>

                <div
                    class="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100 text-xs">
                    <div id="overallWaterStatus"
                        class="px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-semibold">
                        ภาพรวมคุณภาพน้ำ: รอการเชื่อมต่อเครื่อง
                    </div>
                    <div class="flex items-center gap-1.5 text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200/70">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5 text-sky-600"></i>
                        <span id="lastUpdated">ยังไม่ได้เชื่อมต่อเครื่อง</span>
                    </div>
                </div>
            </div>

            <!-- ============================================================= -->
            <!-- ส่วนที่ 1: แสดงผลค่าเซนเซอร์ 3 ตัว (อุณหภูมิน้ำ, pH, ระดับน้ำ)       -->
            <!-- ============================================================= -->
            <section class="bg-white border border-slate-200/90 rounded-xl shadow-sm p-5 sm:p-6">
                <div class="flex flex-wrap items-center justify-between gap-2 pb-4 mb-5 border-b border-slate-100">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center font-display font-bold text-sm">
                            1
                        </div>
                        <div>
                            <h2 class="font-display text-base sm:text-lg font-bold text-slate-900">
                                ข้อมูลตรวจวัดคุณภาพน้ำและระดับน้ำปัจจุบัน
                            </h2>
                            <p class="text-xs text-slate-500">แสดงผลค่าอุณหภูมิน้ำ ความเป็นกรด-ด่าง (pH) และระดับน้ำแบบเรียลไทม์</p>
                        </div>
                    </div>
                    <span class="text-xs font-medium text-sky-700 bg-sky-50 px-3 py-1 rounded-full border border-sky-200/70">
                        ซิงค์ข้อมูลอัตโนมัติทุก 2 วินาที
                    </span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-5">

                    <!-- การ์ด 1: อุณหภูมิน้ำ (สีส้ม) -->
                    <div class="bg-white border-2 border-orange-100 rounded-xl overflow-hidden shadow-sm flex flex-col justify-between">
                        <div class="h-2 bg-orange-500"></div>
                        <div class="p-5 flex-1 flex flex-col justify-between">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-10 h-10 rounded-lg bg-orange-50 border border-orange-200/70 text-orange-600 flex items-center justify-center shrink-0">
                                        <i data-lucide="thermometer" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="font-display text-base font-bold text-slate-900">
                                            อุณหภูมิน้ำ (Temperature)
                                        </h3>
                                        <p class="text-xs text-slate-500">เกณฑ์ปกติ &lt; 35.0 °C</p>
                                    </div>
                                </div>
                                <span id="tempStatus"
                                    class="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-500 shrink-0">รอข้อมูล</span>
                            </div>

                            <div class="my-5 flex items-end justify-between gap-3">
                                <div class="flex items-baseline gap-1.5">
                                    <span id="tempCurrent"
                                        class="graphic-num text-4xl sm:text-5xl font-bold text-slate-900">--</span>
                                    <span class="text-base font-mono-num font-semibold text-orange-600">°C</span>
                                </div>
                                <svg class="w-24 h-14 shrink-0" viewBox="0 0 120 68">
                                    <path d="M 14 58 A 46 46 0 0 1 106 58" fill="none" stroke="#FFF7ED"
                                        stroke-width="10" stroke-linecap="round" />
                                    <path id="tempGaugeArc" class="gauge-arc" d="M 14 58 A 46 46 0 0 1 106 58"
                                        fill="none" stroke="#F97316" stroke-width="10" stroke-linecap="round"
                                        stroke-dasharray="144.5" stroke-dashoffset="144.5" />
                                </svg>
                            </div>

                            <div class="pt-3 border-t border-slate-100">
                                <div class="w-full h-2 bg-orange-100/70 rounded-full overflow-hidden">
                                    <div id="tempBarFill" class="bar-fill h-full bg-orange-500 rounded-full" style="width: 0%"></div>
                                </div>
                                <div class="flex justify-between text-[11px] font-mono-num text-slate-500 mt-1.5">
                                    <span>0 °C</span>
                                    <span class="text-orange-600 font-medium">ปกติ &lt; 35.0 °C</span>
                                    <span>50 °C</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- การ์ด 2: ความเป็นกรด-ด่าง pH (สีฟ้า) -->
                    <div class="bg-white border-2 border-sky-100 rounded-xl overflow-hidden shadow-sm flex flex-col justify-between">
                        <div class="h-2 bg-sky-500"></div>
                        <div class="p-5 flex-1 flex flex-col justify-between">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200/70 text-sky-600 flex items-center justify-center shrink-0">
                                        <i data-lucide="flask-conical" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="font-display text-base font-bold text-slate-900">
                                            ความเป็นกรด-ด่าง (pH)
                                        </h3>
                                        <p class="text-xs text-slate-500">เกณฑ์ปกติ 5.50 – 7.50 pH</p>
                                    </div>
                                </div>
                                <span id="phStatus"
                                    class="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-500 shrink-0">รอข้อมูล</span>
                            </div>

                            <div class="my-5 flex items-end justify-between gap-3">
                                <div class="flex items-baseline gap-1.5">
                                    <span id="phCurrent"
                                        class="graphic-num text-4xl sm:text-5xl font-bold text-slate-900">--</span>
                                    <span class="text-base font-mono-num font-semibold text-sky-600">pH</span>
                                </div>
                                <svg class="w-24 h-14 shrink-0" viewBox="0 0 120 68">
                                    <path d="M 14 58 A 46 46 0 0 1 106 58" fill="none" stroke="#F0F9FF"
                                        stroke-width="10" stroke-linecap="round" />
                                    <path id="phGaugeArc" class="gauge-arc" d="M 14 58 A 46 46 0 0 1 106 58"
                                        fill="none" stroke="#0284C7" stroke-width="10" stroke-linecap="round"
                                        stroke-dasharray="144.5" stroke-dashoffset="144.5" />
                                </svg>
                            </div>

                            <div class="pt-3 border-t border-slate-100">
                                <div class="w-full h-2 bg-sky-100/70 rounded-full overflow-hidden">
                                    <div id="phBarFill" class="bar-fill h-full bg-sky-500 rounded-full" style="width: 0%"></div>
                                </div>
                                <div class="flex justify-between text-[11px] font-mono-num text-slate-500 mt-1.5">
                                    <span>0 (กรด)</span>
                                    <span class="text-sky-600 font-medium">สมดุล 5.5 – 7.5</span>
                                    <span>14 (ด่าง)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- การ์ด 3: ระดับน้ำ (สีเขียวอมฟ้า Teal) -->
                    <div class="bg-white border-2 border-teal-100 rounded-xl overflow-hidden shadow-sm flex flex-col justify-between">
                        <div class="h-2 bg-teal-500"></div>
                        <div class="p-5 flex-1 flex flex-col justify-between">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200/70 text-teal-600 flex items-center justify-center shrink-0">
                                        <i data-lucide="waves" class="w-5 h-5"></i>
                                    </div>
                                    <div>
                                        <h3 class="font-display text-base font-bold text-slate-900">
                                            ระดับน้ำ (Water Level)
                                        </h3>
                                        <p class="text-xs text-slate-500">เกณฑ์ปกติ 20% – 95%</p>
                                    </div>
                                </div>
                                <span id="levelStatus"
                                    class="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-500 shrink-0">รอข้อมูล</span>
                            </div>

                            <div class="my-5 flex items-end justify-between gap-3">
                                <div class="flex items-baseline gap-1.5">
                                    <span id="levelCurrent"
                                        class="graphic-num text-4xl sm:text-5xl font-bold text-slate-900">--</span>
                                    <span id="levelUnit"
                                        class="text-base font-mono-num font-semibold text-teal-600">%</span>
                                </div>
                                <svg class="w-24 h-14 shrink-0" viewBox="0 0 120 68">
                                    <path d="M 14 58 A 46 46 0 0 1 106 58" fill="none" stroke="#F0FDFA"
                                        stroke-width="10" stroke-linecap="round" />
                                    <path id="levelGaugeArc" class="gauge-arc" d="M 14 58 A 46 46 0 0 1 106 58"
                                        fill="none" stroke="#0D9488" stroke-width="10" stroke-linecap="round"
                                        stroke-dasharray="144.5" stroke-dashoffset="144.5" />
                                </svg>
                            </div>

                            <div class="pt-3 border-t border-slate-100">
                                <div class="w-full h-2 bg-teal-100/70 rounded-full overflow-hidden">
                                    <div id="levelBarFill" class="bar-fill h-full bg-teal-500 rounded-full" style="width: 0%"></div>
                                </div>
                                <div class="flex justify-between text-[11px] font-mono-num text-slate-500 mt-1.5">
                                    <span>0% (ต่ำ)</span>
                                    <span class="text-teal-600 font-medium">ปกติ 20% – 95%</span>
                                    <span>100% (เต็ม)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </section>

            <!-- ============================================================= -->
            <!-- ส่วนที่ 2: แผงควบคุมอุปกรณ์และวาล์วน้ำไฟฟ้า (4 ช่องสัญญาณ)       -->
            <!-- ============================================================= -->
            <section class="bg-white border border-slate-200/90 rounded-xl shadow-sm p-5 sm:p-6">
                <div class="flex flex-wrap items-center justify-between gap-2 pb-4 mb-5 border-b border-slate-100">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-[#0B2545] text-white flex items-center justify-center font-display font-bold text-sm">
                            2
                        </div>
                        <div>
                            <h2 class="font-display text-base sm:text-lg font-bold text-slate-900">
                                แผงควบคุมชุดขับเคลื่อน ระบบบำบัด และวาล์วน้ำไฟฟ้า
                            </h2>
                            <p class="text-xs text-slate-500">
                                สั่งเปิด-ปิดอุปกรณ์แบบเรียลไทม์ (มอเตอร์และแผ่นอะลูมิเนียมสลับการทำงานอัตโนมัติ • วาล์วน้ำไฟฟ้าเป็นรีเลย์แยกอิสระ)
                            </p>
                        </div>
                    </div>
                </div>

                <!-- แถบสรุปสถานะอุปกรณ์ที่กำลังเปิดทำงาน -->
                <div id="activeEquipmentBanner"
                    class="mb-5 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs transition-all">
                    <div class="flex flex-wrap items-center gap-2">
                        <span id="activeEquipmentDot" class="led-dot led-standby"></span>
                        <span class="font-bold text-slate-700">สถานะอุปกรณ์ปัจจุบัน:</span>
                        <span id="activeEquipmentList" class="text-slate-600">ไม่มีอุปกรณ์กำลังทำงาน (หยุดพักทั้งหมด)</span>
                    </div>
                    <span class="text-[11px] text-slate-400">ซิงค์สถานะตรงกันทุกหน้าจออัตโนมัติ</span>
                </div>

                <!-- ตารางสวิตช์ควบคุม 4 ตัว เรียงลำดับ 1 -> 2 -> 3 -> 4 -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

                    <!-- 1. ช่องสัญญาณที่ 1: มอเตอร์ -->
                    <div id="motor1Card"
                        class="border-2 border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 bg-slate-50/50 transition-all duration-200">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <span class="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[11px] font-semibold mb-1.5">
                                    ช่องสัญญาณที่ 1
                                </span>
                                <h3 class="font-display font-bold text-slate-900 text-base">มอเตอร์ (Motor)</h3>
                                <p class="text-xs text-slate-500 mt-0.5">ชุดใบพัดกวนน้ำ (สลับกับช่อง 3)</p>
                            </div>
                            <div class="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                                <i data-lucide="cog" class="w-5 h-5"></i>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-slate-200/80 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span id="motor1Led" class="led-dot led-standby"></span>
                                <span id="motor1StateText" class="text-xs font-semibold text-slate-500">หยุดพัก (OFF)</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="motor1Toggle" onchange="toggleDevice('motor1Toggle', '1')"
                                    class="sr-only peer">
                                <div
                                    class="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:w-5 after:h-5 after:transition-all peer-checked:bg-emerald-600">
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- 2. ช่องสัญญาณที่ 2: ปั๊มน้ำ -->
                    <div id="motor2Card"
                        class="border-2 border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 bg-slate-50/50 transition-all duration-200">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <span class="inline-block px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-[11px] font-semibold mb-1.5">
                                    ช่องสัญญาณที่ 2
                                </span>
                                <h3 class="font-display font-bold text-slate-900 text-base">ปั๊มน้ำ (Water Pump)</h3>
                                <p class="text-xs text-slate-500 mt-0.5">สูบจ่ายและหมุนเวียนน้ำ</p>
                            </div>
                            <div class="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shrink-0">
                                <i data-lucide="waves" class="w-5 h-5"></i>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-slate-200/80 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span id="motor2Led" class="led-dot led-standby"></span>
                                <span id="motor2StateText" class="text-xs font-semibold text-slate-500">หยุดพัก (OFF)</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="motor2Toggle" onchange="toggleDevice('motor2Toggle', '2')"
                                    class="sr-only peer">
                                <div
                                    class="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:w-5 after:h-5 after:transition-all peer-checked:bg-emerald-600">
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- 3. ช่องสัญญาณที่ 3 (คอลัมน์ pump1): แผ่นอะลูมิเนียม -->
                    <div id="pump1Card"
                        class="border-2 border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 bg-slate-50/50 transition-all duration-200">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <span class="inline-block px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[11px] font-semibold mb-1.5">
                                    ช่องสัญญาณที่ 3 (pump1)
                                </span>
                                <h3 class="font-display font-bold text-slate-900 text-base">แผ่นอะลูมิเนียม</h3>
                                <p class="text-xs text-slate-500 mt-0.5">ชุดบำบัดน้ำ (สลับกับมอเตอร์ ช่อง 1)</p>
                            </div>
                            <div class="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
                                <i data-lucide="layers" class="w-5 h-5"></i>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-slate-200/80 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span id="pump1Led" class="led-dot led-standby"></span>
                                <span id="pump1StateText" class="text-xs font-semibold text-slate-500">หยุดพัก (OFF)</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="pump1Toggle" onchange="toggleDevice('pump1Toggle', '3')"
                                    class="sr-only peer">
                                <div
                                    class="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:w-5 after:h-5 after:transition-all peer-checked:bg-emerald-600">
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- 4. ช่องสัญญาณที่ 4 (คอลัมน์ pump2): วาล์วน้ำไฟฟ้า -->
                    <div id="valveCard"
                        class="border-2 border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 bg-slate-50/50 transition-all duration-200">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <span class="inline-block px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[11px] font-semibold mb-1.5">
                                    ช่องสัญญาณที่ 4 (pump2)
                                </span>
                                <h3 class="font-display font-bold text-slate-900 text-base">วาล์วน้ำไฟฟ้า</h3>
                                <p class="text-xs text-slate-500 mt-0.5">เปิด-ปิดวาล์วน้ำแบบไฟฟ้า</p>
                            </div>
                            <div class="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shrink-0">
                                <i data-lucide="droplets" class="w-5 h-5"></i>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-slate-200/80 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span id="valveLed" class="led-dot led-standby"></span>
                                <span id="valveStateText" class="text-xs font-semibold text-slate-500">ปิดวาล์ว (CLOSED)</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="valveToggle" onchange="toggleDevice('valveToggle', '4')"
                                    class="sr-only peer">
                                <div
                                    class="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:w-5 after:h-5 after:transition-all peer-checked:bg-sky-600">
                                </div>
                            </label>
                        </div>
                    </div>

                </div>
            </section>

            <!-- ============================================================= -->
            <!-- ส่วนที่ 3: กราฟวิเคราะห์แนวโน้มข้อมูลย้อนหลัง                      -->
            <!-- ============================================================= -->
            <section class="bg-white border border-slate-200/90 rounded-xl shadow-sm p-5 sm:p-6 space-y-5">
                <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-display font-bold text-sm">
                            3
                        </div>
                        <div>
                            <h2 class="font-display text-base sm:text-lg font-bold text-slate-900">
                                กราฟวิเคราะห์แนวโน้มข้อมูลย้อนหลัง
                            </h2>
                            <p id="historyCount" class="text-xs text-slate-500">ข้อมูลที่บันทึก: 0 รายการ</p>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2.5">
                        <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                            <label for="datePicker" class="text-xs font-semibold text-slate-600">วันที่:</label>
                            <input type="date" id="datePicker" onchange="fetchHistory()"
                                class="text-xs font-mono-num text-slate-800 focus:outline-none bg-transparent">
                        </div>

                        <button type="button" onclick="fetchHistory()"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition">
                            <i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i>
                            <span>รีเฟรช</span>
                        </button>

                        <button type="button" onclick="exportCsv()"
                            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition">
                            <i data-lucide="download" class="w-3.5 h-3.5"></i>
                            <span>ส่งออก CSV</span>
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <!-- กราฟที่ 1: อุณหภูมิน้ำ -->
                    <div class="border border-orange-200/80 rounded-xl p-4 bg-orange-50/20">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <div class="flex items-center gap-2">
                                <span class="w-3 h-3 rounded-full bg-orange-500"></span>
                                <h3 class="font-display text-sm font-bold text-slate-800">แนวโน้มอุณหภูมิน้ำ (°C)</h3>
                            </div>
                            <div id="tempStats" class="text-xs font-mono-num text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-200">
                                ต่ำสุด: -- | เฉลี่ย: -- | สูงสุด: --
                            </div>
                        </div>
                        <div class="h-56 relative bg-white rounded-lg p-2 border border-slate-100">
                            <canvas id="tempChart"></canvas>
                        </div>
                    </div>

                    <!-- กราฟที่ 2: ความเป็นกรด-ด่าง (pH) -->
                    <div class="border border-sky-200/80 rounded-xl p-4 bg-sky-50/20">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <div class="flex items-center gap-2">
                                <span class="w-3 h-3 rounded-full bg-sky-600"></span>
                                <h3 class="font-display text-sm font-bold text-slate-800">แนวโน้มความเป็นกรด-ด่าง (pH)</h3>
                            </div>
                            <div id="phStats" class="text-xs font-mono-num text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-200">
                                ต่ำสุด: -- | เฉลี่ย: -- | สูงสุด: --
                            </div>
                        </div>
                        <div class="h-56 relative bg-white rounded-lg p-2 border border-slate-100">
                            <canvas id="phChart"></canvas>
                        </div>
                    </div>

                    <!-- กราฟที่ 3: ระดับน้ำ -->
                    <div class="lg:col-span-2 border border-teal-200/80 rounded-xl p-4 bg-teal-50/20">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <div class="flex items-center gap-2">
                                <span class="w-3 h-3 rounded-full bg-teal-600"></span>
                                <h3 class="font-display text-sm font-bold text-slate-800">แนวโน้มระดับน้ำในระบบ (%)</h3>
                            </div>
                            <div id="levelStats" class="text-xs font-mono-num text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-200">
                                ต่ำสุด: -- | เฉลี่ย: -- | สูงสุด: --
                            </div>
                        </div>
                        <div class="h-56 relative bg-white rounded-lg p-2 border border-slate-100">
                            <canvas id="levelChart"></canvas>
                        </div>
                    </div>
                </div>
            </section>

        </main>

        <footer class="bg-white border-t border-slate-200 py-4 px-4 sm:px-6 lg:px-8 text-xs text-slate-400">
            <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
                <div>SEAMEO — ระบบตรวจวัดคุณภาพน้ำและควบคุมการบำบัดอัตโนมัติ</div>
                <div class="font-mono-num text-[11px]">SEAMEO SMART WATER TELEMETRY</div>
            </div>
        </footer>
    </div>

    <!-- ===================================================================== -->
    <!-- 3. หน้าต่างเพิ่มเครื่องตรวจวัดใหม่                                        -->
    <!-- ===================================================================== -->
    <div id="addMachineModal" class="fixed inset-0 bg-slate-900/50 z-50 hidden items-center justify-center p-4">
        <div class="bg-white w-full max-w-md rounded-xl border border-slate-200 shadow-2xl overflow-hidden">
            <div class="bg-slate-50 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
                <h3 class="font-display text-sm font-bold text-slate-900">
                    เพิ่มเครื่องตรวจวัดใหม่ (Register Machine ID)
                </h3>
                <button onclick="closeAddMachineModal()" class="text-slate-400 hover:text-slate-700">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>

            <form onsubmit="submitNewMachine(event)" class="p-5 space-y-4">
                <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1.5">หมายเลขเครื่อง (Machine ID)</label>
                    <input type="text" id="newMachineIdInput" required placeholder="เช่น ESP32-01"
                        class="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600 text-slate-900 font-mono-num text-sm">
                </div>

                <div class="flex justify-end gap-2 pt-2">
                    <button type="button" onclick="closeAddMachineModal()"
                        class="py-2 px-4 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition">
                        ยกเลิก
                    </button>
                    <button type="submit" id="addMachineBtn"
                        class="py-2 px-4 rounded-lg bg-[#0B2545] hover:bg-sky-800 text-white text-xs font-semibold transition">
                        บันทึกและเชื่อมต่อ
                    </button>
                </div>
            </form>
        </div>
    </div>

    <script src="js/config.js?v=16"></script>
    <script src="js/app.js?v=16"></script>
    <script>
        if (window.lucide) lucide.createIcons();
    </script>
</body>

</html>`
    },
    '/js/config.js': {
        file: 'js/config.js',
        type: 'text/javascript; charset=UTF-8',
        content: `// ========================================================
// Configuration for SEAMEO Smart Sensor & Control Dashboard
// ========================================================

const CONFIG = {
    // Google Apps Script Web App URL (ผูกกับ Google Sheets ของคุณ)
    GAS_URL: "https://script.google.com/macros/s/AKfycbyW_f_iNkLrh3U4hPlSX8-X2ldmRLgTnsrZvWUD-qIqchbCkIlVG-1xYE9WRgiDNscw/exec",

    // Proxy path (server.js ตอนรันในเครื่อง / บน Vercel)
    PROXY_URL: "/api",

    // หมายเลขเครื่องเริ่มต้น (ให้ทุกเครื่องที่เปิดเว็บเชื่อมต่อเข้าเครื่องเดียวกันอัตโนมัติ)
    DEFAULT_MACHINE_ID: "00002",

    // Request timeout (ms)
    REQUEST_TIMEOUT_MS: 25000,

    // ดึงค่าเซนเซอร์และสถานะสวิตช์ล่าสุดทุกๆ 2 วินาที เพื่อให้ทุกเครื่องซิงค์ตรงกันแบบเรียลไทม์
    POLL_INTERVAL_MS: 2000,

    // รีเฟรชกราฟทุกๆ กี่ ms
    HISTORY_REFRESH_MS: 60000,

    // หลังกดสวิตช์ จะล็อกสวิตช์ในเครื่องที่กดกี่ ms เพื่อรอให้คลาวด์บันทึกเสร็จ
    SWITCH_LOCK_MS: 4500,

    // เกณฑ์แจ้งเตือน (อุณหภูมิน้ำ, pH, ระดับน้ำ)
    THRESHOLDS: {
        temp: { danger: 40, risky: 35 },
        ph: { dangerMin: 4, dangerMax: 9, riskyMin: 5.5, riskyMax: 7.5 },
        level: { low: 20, high: 95 }
    }
};`
    },
    '/js/app.js': {
        file: 'js/app.js',
        type: 'text/javascript; charset=UTF-8',
        content: "// ========================================================\n" +
            "// SEAMEO — Water Quality Telemetry & Control System\n" +
            "// ========================================================\n\n" +
            "let currentMachine = '';\n" +
            "let pollTimer = null;\n" +
            "let historyTimer = null;\n" +
            "let charts = {};\n" +
            "let isLoginMode = true;\n" +
            "let apiBase = null;\n" +
            "let machineNotFoundWarned = false;\n" +
            "let lastHistoryRecords = [];\n" +
            "let lastServerData = null;\n" +
            "let hasInitialSwitchSync = false;\n" +
            "const switchLocks = {};\n" +
            "const knownSwitchState = {};\n\n" +
            "const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('seameo_switch_sync') : null;\n\n" +
            "const DEVICES = [\n" +
            "    { id: 'motor1Toggle', cardId: 'motor1Card', code: '1', onCmd: '0', offCmd: '1', name: 'มอเตอร์ (ช่อง 1)', field: 'motor1_command', ledId: 'motor1Led', textId: 'motor1StateText', onLabel: 'กำลังทำงาน (ON)', offLabel: 'หยุดพัก (OFF)', activeTheme: 'emerald' },\n" +
            "    { id: 'motor2Toggle', cardId: 'motor2Card', code: '2', onCmd: '0', offCmd: '2', name: 'ปั๊มน้ำ (ช่อง 2)', field: 'motor2_command', ledId: 'motor2Led', textId: 'motor2StateText', onLabel: 'กำลังทำงาน (ON)', offLabel: 'หยุดพัก (OFF)', activeTheme: 'emerald' },\n" +
            "    { id: 'pump1Toggle', cardId: 'pump1Card', code: '3', onCmd: '0', offCmd: '3', name: 'แผ่นอะลูมิเนียม (pump1)', field: 'pump1_command', ledId: 'pump1Led', textId: 'pump1StateText', onLabel: 'กำลังทำงาน (ON)', offLabel: 'หยุดพัก (OFF)', activeTheme: 'emerald' },\n" +
            "    { id: 'valveToggle', cardId: 'valveCard', code: '4', onCmd: '0', offCmd: '4', name: 'วาล์วน้ำไฟฟ้า (pump2)', field: 'pump2_command', ledId: 'valveLed', textId: 'valveStateText', onLabel: 'เปิดวาล์ว (OPEN)', offLabel: 'ปิดวาล์ว (CLOSED)', activeTheme: 'sky' }\n" +
            "];\n\n" +
            "const EXCLUSIVE_PAIRS = { '1': '3', '3': '1' };\n\n" +
            "function isDeviceOnValue(dev, rawVal) {\n" +
            "    if (rawVal === undefined || rawVal === null || rawVal === '') return false;\n" +
            "    return String(rawVal).trim() === dev.onCmd;\n" +
            "}\n\n" +
            "function getLocalValveFallback(machineId) {\n" +
            "    if (!machineId) return '5';\n" +
            "    return localStorage.getItem('seameo_valve_' + machineId) || '5';\n" +
            "}\n\n" +
            "function setLocalValveFallback(machineId, cmd) {\n" +
            "    if (!machineId) return;\n" +
            "    localStorage.setItem('seameo_valve_' + machineId, String(cmd));\n" +
            "}\n\n" +
            "async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.REQUEST_TIMEOUT_MS) {\n" +
            "    const controller = new AbortController();\n" +
            "    const timer = setTimeout(() => controller.abort(), timeoutMs);\n" +
            "    try {\n" +
            "        return await fetch(url, { ...options, signal: controller.signal });\n" +
            "    } finally {\n" +
            "        clearTimeout(timer);\n" +
            "    }\n" +
            "}\n\n" +
            "async function tryEndpoint(base) {\n" +
            "    const res = await fetchWithTimeout(base + '?action=ping', { method: 'GET' }, 20000);\n" +
            "    const text = await res.text();\n" +
            "    JSON.parse(text);\n" +
            "    return true;\n" +
            "}\n\n" +
            "async function resolveApiBase(force = false) {\n" +
            "    if (apiBase && !force) return apiBase;\n" +
            "    const candidates = [];\n" +
            "    if (location.protocol.startsWith('http')) candidates.push(CONFIG.PROXY_URL);\n" +
            "    candidates.push(CONFIG.GAS_URL);\n" +
            "    for (const base of candidates) {\n" +
            "        try {\n" +
            "            await tryEndpoint(base);\n" +
            "            apiBase = base;\n" +
            "            return apiBase;\n" +
            "        } catch (err) {\n" +
            "            console.warn('[API] fallback:', base);\n" +
            "        }\n" +
            "    }\n" +
            "    throw new Error('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');\n" +
            "}\n\n" +
            "async function callApi(action, params = {}, method = 'GET') {\n" +
            "    const base = await resolveApiBase();\n" +
            "    const query = new URLSearchParams({ action, _t: Date.now() });\n" +
            "    const options = { method, cache: 'no-store' };\n" +
            "    if (method === 'GET') {\n" +
            "        Object.entries(params).forEach(([k, v]) => query.append(k, v));\n" +
            "    } else {\n" +
            "        options.body = new URLSearchParams(params);\n" +
            "    }\n" +
            "    const res = await fetchWithTimeout(base + '?' + query.toString(), options);\n" +
            "    const text = await res.text();\n" +
            "    try {\n" +
            "        return JSON.parse(text);\n" +
            "    } catch (e) {\n" +
            "        apiBase = null;\n" +
            "        throw new Error('ข้อมูลตอบกลับไม่ถูกต้อง');\n" +
            "    }\n" +
            "}\n\n" +
            "document.addEventListener('DOMContentLoaded', () => {\n" +
            "    const datePicker = document.getElementById('datePicker');\n" +
            "    if (datePicker) datePicker.value = localDateKey(new Date());\n" +
            "    const machineInput = document.getElementById('machineIdInput');\n" +
            "    if (machineInput) {\n" +
            "        machineInput.addEventListener('keydown', e => { if (e.key === 'Enter') bindMachine(); });\n" +
            "    }\n" +
            "    document.addEventListener('visibilitychange', () => {\n" +
            "        if (!document.hidden && currentMachine) fetchCurrentData();\n" +
            "    });\n" +
            "    if (syncChannel) {\n" +
            "        syncChannel.onmessage = (ev) => {\n" +
            "            const msg = ev.data;\n" +
            "            if (!msg) return;\n" +
            "            if (msg.type === 'MACHINE_CHANGED' && msg.machineId && msg.machineId !== currentMachine) {\n" +
            "                document.getElementById('machineIdInput').value = msg.machineId;\n" +
            "                bindMachine(msg.machineId, true);\n" +
            "            } else if (msg.type === 'SWITCH_UPDATED' && msg.switches) {\n" +
            "                applySwitchMap(msg.switches, true);\n" +
            "            }\n" +
            "        };\n" +
            "    }\n" +
            "    startSystemClock();\n" +
            "    checkLoginStatus();\n" +
            "    checkApiStatus();\n" +
            "    if (window.lucide) lucide.createIcons();\n" +
            "});\n\n" +
            "function startSystemClock() {\n" +
            "    const updateClock = () => {\n" +
            "        const el = document.getElementById('systemClock');\n" +
            "        if (!el) return;\n" +
            "        const now = new Date();\n" +
            "        el.innerText = now.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) + ' | ' + now.toLocaleTimeString('th-TH', { hour12: false });\n" +
            "    };\n" +
            "    updateClock();\n" +
            "    setInterval(updateClock, 1000);\n" +
            "}\n\n" +
            "async function checkApiStatus() {\n" +
            "    const el = document.getElementById('apiStatus');\n" +
            "    if (!el) return;\n" +
            "    el.className = 'text-xs text-slate-400 flex items-center gap-2';\n" +
            "    el.innerHTML = '<span class=\"led-dot led-standby\"></span><span>กำลังตรวจสอบฐานข้อมูล...</span>';\n" +
            "    try {\n" +
            "        await resolveApiBase(true);\n" +
            "        el.className = 'text-xs text-emerald-700 font-semibold flex items-center gap-2';\n" +
            "        el.innerHTML = '<span class=\"led-dot led-online\"></span><span>เชื่อมต่อฐานข้อมูลพร้อมใช้งาน</span>';\n" +
            "    } catch (err) {\n" +
            "        el.className = 'text-xs text-rose-600 flex items-center gap-2';\n" +
            "        el.innerHTML = '<span class=\"led-dot led-error\"></span><span>' + escapeHtml(err.message) + '</span> <button type=\"button\" onclick=\"checkApiStatus()\" class=\"underline font-semibold ml-1\">ลองใหม่</button>';\n" +
            "    }\n" +
            "}\n\n" +
            "function localDateKey(dateInput) {\n" +
            "    const d = new Date(dateInput);\n" +
            "    if (isNaN(d.getTime())) return '';\n" +
            "    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');\n" +
            "}\n\n" +
            "function escapeHtml(str) {\n" +
            "    return String(str).replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n" +
            "}\n\n" +
            "function formatNumber(value) {\n" +
            "    if (value === '' || value === null || value === undefined || isNaN(parseFloat(value))) return '--';\n" +
            "    return parseFloat(value).toFixed(2);\n" +
            "}\n\n" +
            "function extractWaterLevel(data) {\n" +
            "    if (!data) return null;\n" +
            "    const candidates = [data.current_water_level, data.water_level, data.current_level, data.level];\n" +
            "    for (const val of candidates) {\n" +
            "        if (val !== undefined && val !== null && String(val).trim() !== '') return val;\n" +
            "    }\n" +
            "    return null;\n" +
            "}\n\n" +
            "function showToast(message, type = 'info') {\n" +
            "    const container = document.getElementById('toastContainer');\n" +
            "    if (!container) return;\n" +
            "    const styles = {\n" +
            "        success: 'bg-slate-900 border-l-4 border-emerald-500 text-white',\n" +
            "        error: 'bg-slate-900 border-l-4 border-rose-500 text-white',\n" +
            "        info: 'bg-slate-900 border-l-4 border-sky-500 text-white'\n" +
            "    };\n" +
            "    const toast = document.createElement('div');\n" +
            "    toast.className = 'pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-xs font-medium transition-all duration-300 translate-y-2 opacity-0 ' + (styles[type] || styles.info);\n" +
            "    toast.innerText = message;\n" +
            "    container.appendChild(toast);\n" +
            "    requestAnimationFrame(() => toast.classList.remove('translate-y-2', 'opacity-0'));\n" +
            "    setTimeout(() => {\n" +
            "        toast.classList.add('opacity-0', 'translate-y-2');\n" +
            "        setTimeout(() => toast.remove(), 300);\n" +
            "    }, 3500);\n" +
            "}\n\n" +
            "function showAuthMessage(html, type = 'error') {\n" +
            "    const box = document.getElementById('authMsgBox');\n" +
            "    if (!box) return;\n" +
            "    const styles = {\n" +
            "        error: 'bg-rose-50 text-rose-800 border-rose-200',\n" +
            "        success: 'bg-emerald-50 text-emerald-800 border-emerald-200',\n" +
            "        info: 'bg-sky-50 text-sky-800 border-sky-200'\n" +
            "    };\n" +
            "    box.className = 'mb-5 p-3.5 rounded-lg text-xs border text-center ' + (styles[type] || styles.error);\n" +
            "    box.innerHTML = html;\n" +
            "}\n\n" +
            "function hideAuthMessage() {\n" +
            "    const box = document.getElementById('authMsgBox');\n" +
            "    if (box) { box.className = 'hidden'; box.innerHTML = ''; }\n" +
            "}\n\n" +
            "async function autoConnectSharedMachine() {\n" +
            "    let targetMachine = localStorage.getItem('currentMachine') || '';\n" +
            "    try {\n" +
            "        const syncInfo = await callApi('get_sync_state');\n" +
            "        if (syncInfo && syncInfo.active_machine_id && !targetMachine) {\n" +
            "            targetMachine = syncInfo.active_machine_id;\n" +
            "        }\n" +
            "    } catch (_) {}\n" +
            "    if (!targetMachine) targetMachine = CONFIG.DEFAULT_MACHINE_ID || 'ESP32-01';\n" +
            "    const input = document.getElementById('machineIdInput');\n" +
            "    if (input) input.value = targetMachine;\n" +
            "    if (targetMachine !== currentMachine) bindMachine(targetMachine, true);\n" +
            "}\n\n" +
            "function checkLoginStatus() {\n" +
            "    const userId = localStorage.getItem('userID');\n" +
            "    const username = localStorage.getItem('username');\n" +
            "    const authScreen = document.getElementById('authScreen');\n" +
            "    const dashboardScreen = document.getElementById('dashboardScreen');\n" +
            "    if (userId && username) {\n" +
            "        authScreen.classList.add('hidden');\n" +
            "        dashboardScreen.classList.remove('hidden');\n" +
            "        document.getElementById('displayUsername').innerText = username;\n" +
            "        autoConnectSharedMachine();\n" +
            "    } else {\n" +
            "        authScreen.classList.remove('hidden');\n" +
            "        dashboardScreen.classList.add('hidden');\n" +
            "    }\n" +
            "    if (window.lucide) lucide.createIcons();\n" +
            "}\n\n" +
            "function switchAuthTab(mode) {\n" +
            "    isLoginMode = (mode === 'login');\n" +
            "    const active = 'pb-3 pr-6 text-sm font-bold border-b-2 border-sky-600 text-sky-700 transition-all';\n" +
            "    const inactive = 'pb-3 px-6 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-700 transition-all';\n" +
            "    document.getElementById('authTitle').innerText = isLoginMode ? 'เข้าสู่ระบบควบคุม' : 'สมัครสมาชิกผู้ใช้งานใหม่';\n" +
            "    document.getElementById('authSubmitText').innerText = isLoginMode ? 'เข้าสู่แผงควบคุมระบบ' : 'ยืนยันการสมัครสมาชิก';\n" +
            "    document.getElementById('authUsernameLabel').innerText = isLoginMode ? 'ชื่อผู้ใช้งาน (Username)' : 'ตั้งชื่อผู้ใช้งานใหม่ (New Username)';\n" +
            "    document.getElementById('tabLogin').className = isLoginMode ? active : inactive;\n" +
            "    document.getElementById('tabRegister').className = isLoginMode ? inactive : active;\n" +
            "    hideAuthMessage();\n" +
            "}\n\n" +
            "function toggleAuthMode() {\n" +
            "    switchAuthTab(isLoginMode ? 'register' : 'login');\n" +
            "}\n\n" +
            "function setAuthLoading(loading, text) {\n" +
            "    const btn = document.getElementById('authSubmitBtn');\n" +
            "    const label = document.getElementById('authSubmitText');\n" +
            "    btn.disabled = loading;\n" +
            "    btn.classList.toggle('opacity-70', loading);\n" +
            "    btn.classList.toggle('cursor-wait', loading);\n" +
            "    label.innerText = loading ? text : (isLoginMode ? 'เข้าสู่แผงควบคุมระบบ' : 'ยืนยันการสมัครสมาชิก');\n" +
            "}\n\n" +
            "function completeLogin(userId, username) {\n" +
            "    localStorage.setItem('userID', String(userId));\n" +
            "    localStorage.setItem('username', String(username));\n" +
            "    document.getElementById('authUsername').value = '';\n" +
            "    hideAuthMessage();\n" +
            "    showToast('เข้าสู่ระบบสำเร็จ — สวัสดีคุณ ' + username, 'success');\n" +
            "    checkLoginStatus();\n" +
            "}\n\n" +
            "async function handleAuth(event) {\n" +
            "    if (event) event.preventDefault();\n" +
            "    const username = document.getElementById('authUsername').value.trim();\n" +
            "    if (!username) {\n" +
            "        showAuthMessage('กรุณากรอกชื่อผู้ใช้งาน');\n" +
            "        return;\n" +
            "    }\n" +
            "    hideAuthMessage();\n" +
            "    try {\n" +
            "        if (isLoginMode) {\n" +
            "            setAuthLoading(true, 'กำลังตรวจสอบสิทธิ์...');\n" +
            "            const data = await callApi('login_user', { username }, 'POST');\n" +
            "            if (data.status === 'success') {\n" +
            "                completeLogin(data.user_id, data.username);\n" +
            "            } else {\n" +
            "                const msg = escapeHtml(data.message || 'ไม่พบชื่อผู้ใช้งานนี้');\n" +
            "                const safeName = escapeHtml(username).replace(/'/g, '&#39;');\n" +
            "                showAuthMessage('<div>' + msg + '</div><button type=\"button\" onclick=\"registerAndLogin(\\'' + safeName + '\\')\" class=\"mt-2 text-sky-700 hover:text-sky-900 font-semibold underline text-xs\">คลิกเพื่อสมัครสมาชิกชื่อ \"' + safeName + '\" และเข้าสู่ระบบทันที</button>');\n" +
            "            }\n" +
            "        } else {\n" +
            "            await registerAndLogin(username);\n" +
            "        }\n" +
            "    } catch (err) {\n" +
            "        showAuthMessage('เชื่อมต่อไม่สำเร็จ: ' + escapeHtml(err.name === 'AbortError' ? 'หมดเวลาเชื่อมต่อ กรุณาลองใหม่' : err.message));\n" +
            "    } finally {\n" +
            "        setAuthLoading(false);\n" +
            "    }\n" +
            "}\n\n" +
            "async function registerAndLogin(username) {\n" +
            "    hideAuthMessage();\n" +
            "    setAuthLoading(true, 'กำลังบันทึกข้อมูล...');\n" +
            "    try {\n" +
            "        const reg = await callApi('register_user', { username }, 'POST');\n" +
            "        if (reg.status !== 'success' && !(reg.message || '').includes('มีคนใช้แล้ว')) {\n" +
            "            showAuthMessage(escapeHtml(reg.message || 'ไม่สามารถสมัครสมาชิกได้'));\n" +
            "            return;\n" +
            "        }\n" +
            "        setAuthLoading(true, 'กำลังเข้าสู่ระบบ...');\n" +
            "        const login = await callApi('login_user', { username }, 'POST');\n" +
            "        if (login.status === 'success') {\n" +
            "            completeLogin(login.user_id, login.username);\n" +
            "        } else {\n" +
            "            isLoginMode = true;\n" +
            "            switchAuthTab('login');\n" +
            "            showAuthMessage('สมัครสมาชิกสำเร็จ กรุณากดเข้าสู่ระบบ', 'success');\n" +
            "        }\n" +
            "    } catch (err) {\n" +
            "        showAuthMessage('เชื่อมต่อไม่สำเร็จ: ' + escapeHtml(err.message));\n" +
            "    } finally {\n" +
            "        setAuthLoading(false);\n" +
            "    }\n" +
            "}\n\n" +
            "function quickGuestLogin() {\n" +
            "    completeLogin('DEMO', 'DEMO_EVALUATOR');\n" +
            "}\n\n" +
            "function logout() {\n" +
            "    stopPolling();\n" +
            "    currentMachine = '';\n" +
            "    localStorage.removeItem('userID');\n" +
            "    localStorage.removeItem('username');\n" +
            "    localStorage.removeItem('currentMachine');\n" +
            "    document.getElementById('machineIdInput').value = '';\n" +
            "    const badge = document.getElementById('connectionBadge');\n" +
            "    if (badge) badge.className = 'hidden';\n" +
            "    resetDashboard();\n" +
            "    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');\n" +
            "    checkLoginStatus();\n" +
            "}\n\n" +
            "function stopPolling() {\n" +
            "    if (pollTimer) clearInterval(pollTimer);\n" +
            "    if (historyTimer) clearInterval(historyTimer);\n" +
            "    pollTimer = null;\n" +
            "    historyTimer = null;\n" +
            "}\n\n" +
            "function resetDashboard() {\n" +
            "    ['tempCurrent', 'phCurrent', 'levelCurrent'].forEach(id => {\n" +
            "        const el = document.getElementById(id);\n" +
            "        if (el) el.innerText = '--';\n" +
            "    });\n" +
            "    const unitEl = document.getElementById('levelUnit');\n" +
            "    if (unitEl) unitEl.innerText = '%';\n" +
            "    ['tempStatus', 'phStatus', 'levelStatus'].forEach(id => updateBadge(id, evaluateStatus('', null)));\n" +
            "    ['tempGaugeArc', 'phGaugeArc', 'levelGaugeArc'].forEach(id => {\n" +
            "        const arc = document.getElementById(id);\n" +
            "        if (arc) arc.style.strokeDashoffset = '144.5';\n" +
            "    });\n" +
            "    ['tempBarFill', 'phBarFill', 'levelBarFill'].forEach(id => {\n" +
            "        const bar = document.getElementById(id);\n" +
            "        if (bar) bar.style.width = '0%';\n" +
            "    });\n" +
            "    DEVICES.forEach(d => {\n" +
            "        const el = document.getElementById(d.id);\n" +
            "        if (el) el.checked = false;\n" +
            "        updateDeviceIndicator(d, false);\n" +
            "        delete knownSwitchState[d.id];\n" +
            "    });\n" +
            "    updateActiveEquipmentBanner();\n" +
            "    Object.values(charts).forEach(c => c.destroy());\n" +
            "    charts = {};\n" +
            "    lastHistoryRecords = [];\n" +
            "    lastServerData = null;\n" +
            "    hasInitialSwitchSync = false;\n" +
            "    const lu = document.getElementById('lastUpdated');\n" +
            "    if (lu) lu.innerText = 'ยังไม่ได้เชื่อมต่อเครื่อง';\n" +
            "}\n\n" +
            "function bindMachine(targetId, silent = false) {\n" +
            "    const input = document.getElementById('machineIdInput');\n" +
            "    const machineId = String(targetId || input.value || '').trim();\n" +
            "    if (!machineId) {\n" +
            "        showToast('กรุณาระบุหมายเลขเครื่อง (Machine ID)', 'error');\n" +
            "        return;\n" +
            "    }\n" +
            "    stopPolling();\n" +
            "    resetDashboard();\n" +
            "    currentMachine = machineId;\n" +
            "    machineNotFoundWarned = false;\n" +
            "    localStorage.setItem('currentMachine', currentMachine);\n" +
            "    if (syncChannel && !silent) {\n" +
            "        try { syncChannel.postMessage({ type: 'MACHINE_CHANGED', machineId: currentMachine }); } catch (_) {}\n" +
            "    }\n" +
            "    const badge = document.getElementById('connectionBadge');\n" +
            "    badge.innerText = 'กำลังเชื่อมต่อ ' + currentMachine + '...';\n" +
            "    badge.className = 'px-3 py-1 text-xs rounded-lg font-semibold bg-amber-50 text-amber-700 border border-amber-200 inline-block';\n" +
            "    if (!silent) showToast('กำลังซิงค์ข้อมูลจาก ' + currentMachine + '...', 'info');\n" +
            "    fetchCurrentData();\n" +
            "    fetchHistory();\n" +
            "    pollTimer = setInterval(fetchCurrentData, CONFIG.POLL_INTERVAL_MS);\n" +
            "    historyTimer = setInterval(fetchHistory, CONFIG.HISTORY_REFRESH_MS);\n" +
            "}\n\n" +
            "function openAddMachineModal() {\n" +
            "    const modal = document.getElementById('addMachineModal');\n" +
            "    modal.classList.remove('hidden');\n" +
            "    modal.classList.add('flex');\n" +
            "    setTimeout(() => document.getElementById('newMachineIdInput').focus(), 50);\n" +
            "}\n\n" +
            "function closeAddMachineModal() {\n" +
            "    const modal = document.getElementById('addMachineModal');\n" +
            "    modal.classList.add('hidden');\n" +
            "    modal.classList.remove('flex');\n" +
            "    document.getElementById('newMachineIdInput').value = '';\n" +
            "}\n\n" +
            "async function submitNewMachine(event) {\n" +
            "    if (event) event.preventDefault();\n" +
            "    const newId = document.getElementById('newMachineIdInput').value.trim();\n" +
            "    if (!newId) return;\n" +
            "    const btn = document.getElementById('addMachineBtn');\n" +
            "    const originalText = btn.innerText;\n" +
            "    btn.innerText = 'กำลังบันทึก...';\n" +
            "    btn.disabled = true;\n" +
            "    try {\n" +
            "        const data = await callApi('add_machine', {\n" +
            "            machine_id: newId,\n" +
            "            user_id: localStorage.getItem('userID') || '1'\n" +
            "        }, 'POST');\n" +
            "        if (data.status === 'success') {\n" +
            "            showToast('เพิ่มเครื่อง \"' + newId + '\" สำเร็จ', 'success');\n" +
            "        } else {\n" +
            "            showToast(data.message || 'ไม่สามารถเพิ่มเครื่องได้', 'error');\n" +
            "            if (!(data.message || '').includes('ลงทะเบียนไปแล้ว')) return;\n" +
            "        }\n" +
            "        closeAddMachineModal();\n" +
            "        document.getElementById('machineIdInput').value = newId;\n" +
            "        bindMachine(newId, false);\n" +
            "    } catch (err) {\n" +
            "        showToast('เชื่อมต่อไม่สำเร็จ: ' + err.message, 'error');\n" +
            "    } finally {\n" +
            "        btn.innerText = originalText;\n" +
            "        btn.disabled = false;\n" +
            "    }\n" +
            "}\n\n" +
            "function evaluateStatus(type, value) {\n" +
            "    const none = { text: 'รอข้อมูล', badgeClass: 'bg-slate-100 text-slate-500' };\n" +
            "    if (value === null || value === undefined || value === '') return none;\n" +
            "    const danger = { text: 'เกินเกณฑ์วิกฤต', badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold' };\n" +
            "    const risky = { text: 'เฝ้าระวัง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };\n" +
            "    const safe = { text: 'ปกติ', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold' };\n" +
            "    if (type === 'level') {\n" +
            "        const rawStr = String(value).trim();\n" +
            "        const num = parseFloat(rawStr);\n" +
            "        if (isNaN(num)) {\n" +
            "            if (rawStr.includes('ต่ำ') || rawStr.toLowerCase().includes('low')) return { text: 'ระดับน้ำต่ำ', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };\n" +
            "            if (rawStr.includes('สูง') || rawStr.includes('ล้น') || rawStr.toLowerCase().includes('high')) return { text: 'ระดับน้ำสูง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };\n" +
            "            return safe;\n" +
            "        }\n" +
            "        const lowTh = (CONFIG.THRESHOLDS.level && CONFIG.THRESHOLDS.level.low) || 20;\n" +
            "        const highTh = (CONFIG.THRESHOLDS.level && CONFIG.THRESHOLDS.level.high) || 95;\n" +
            "        if (num < lowTh) return { text: 'ระดับน้ำต่ำ', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };\n" +
            "        if (num > highTh) return { text: 'ระดับน้ำสูง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };\n" +
            "        return safe;\n" +
            "    }\n" +
            "    const num = parseFloat(value);\n" +
            "    if (isNaN(num)) return none;\n" +
            "    const th = CONFIG.THRESHOLDS;\n" +
            "    if (type === 'temp') return num > th.temp.danger ? danger : num >= th.temp.risky ? risky : safe;\n" +
            "    if (type === 'ph') {\n" +
            "        if (num < th.ph.dangerMin || num > th.ph.dangerMax) return danger;\n" +
            "        if (num < th.ph.riskyMin || num > th.ph.riskyMax) return risky;\n" +
            "        return safe;\n" +
            "    }\n" +
            "    return none;\n" +
            "}\n\n" +
            "function updateBadge(id, stat) {\n" +
            "    const el = document.getElementById(id);\n" +
            "    if (!el) return;\n" +
            "    el.innerText = stat.text;\n" +
            "    el.className = 'px-2.5 py-1 rounded-md text-xs transition-colors duration-200 shrink-0 ' + stat.badgeClass;\n" +
            "}\n\n" +
            "function updateGaugeAndBar(arcId, barId, value, maxVal) {\n" +
            "    const arc = document.getElementById(arcId);\n" +
            "    const bar = document.getElementById(barId);\n" +
            "    const num = parseFloat(value);\n" +
            "    if (isNaN(num)) {\n" +
            "        if (arc) arc.style.strokeDashoffset = '144.5';\n" +
            "        if (bar) bar.style.width = '0%';\n" +
            "        return;\n" +
            "    }\n" +
            "    const pct = Math.max(0, Math.min(100, (num / maxVal) * 100));\n" +
            "    const offset = 144.5 - (pct / 100) * 144.5;\n" +
            "    if (arc) arc.style.strokeDashoffset = offset.toFixed(1);\n" +
            "    if (bar) bar.style.width = pct.toFixed(1) + '%';\n" +
            "}\n\n" +
            "function updateWaterLevelCard(rawLevel) {\n" +
            "    const valEl = document.getElementById('levelCurrent');\n" +
            "    const unitEl = document.getElementById('levelUnit');\n" +
            "    if (!valEl) return;\n" +
            "    if (rawLevel === null || rawLevel === undefined || String(rawLevel).trim() === '') {\n" +
            "        valEl.innerText = '--';\n" +
            "        if (unitEl) unitEl.innerText = '%';\n" +
            "        updateBadge('levelStatus', evaluateStatus('level', null));\n" +
            "        updateGaugeAndBar('levelGaugeArc', 'levelBarFill', null, 100);\n" +
            "        return;\n" +
            "    }\n" +
            "    const str = String(rawLevel).trim();\n" +
            "    const num = parseFloat(str);\n" +
            "    if (!isNaN(num) && /^-?\\d+(\\.\\d+)?%?$/.test(str)) {\n" +
            "        valEl.innerText = Number.isInteger(num) ? String(num) : num.toFixed(1);\n" +
            "        if (unitEl) unitEl.innerText = '%';\n" +
            "        updateGaugeAndBar('levelGaugeArc', 'levelBarFill', num, 100);\n" +
            "    } else {\n" +
            "        valEl.innerText = str;\n" +
            "        if (unitEl) unitEl.innerText = '';\n" +
            "        updateGaugeAndBar('levelGaugeArc', 'levelBarFill', !isNaN(num) ? num : 75, 100);\n" +
            "    }\n" +
            "    updateBadge('levelStatus', evaluateStatus('level', rawLevel));\n" +
            "}\n\n" +
            "function updateOverallWaterStatus(data) {\n" +
            "    const el = document.getElementById('overallWaterStatus');\n" +
            "    if (!el) return;\n" +
            "    const tempStat = evaluateStatus('temp', data.current_temp).text;\n" +
            "    const phStat = evaluateStatus('ph', data.current_ph).text;\n" +
            "    const levelStat = evaluateStatus('level', extractWaterLevel(data)).text;\n" +
            "    const statuses = [tempStat, phStat, levelStat];\n" +
            "    if (statuses.includes('เกินเกณฑ์วิกฤต')) {\n" +
            "        el.innerText = 'ภาพรวมคุณภาพน้ำ: เกินเกณฑ์วิกฤต (ควรเดินเครื่องบำบัด)';\n" +
            "        el.className = 'px-3.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-xs';\n" +
            "    } else if (statuses.includes('เฝ้าระวัง') || statuses.includes('ระดับน้ำต่ำ') || statuses.includes('ระดับน้ำสูง')) {\n" +
            "        el.innerText = 'ภาพรวมคุณภาพน้ำ: มีค่าอยู่ในเกณฑ์เฝ้าระวัง';\n" +
            "        el.className = 'px-3.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-xs';\n" +
            "    } else if (statuses.every(s => s === 'ปกติ')) {\n" +
            "        el.innerText = 'ภาพรวมคุณภาพน้ำ: อยู่ในเกณฑ์ปกติทุกพารามิเตอร์';\n" +
            "        el.className = 'px-3.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-xs';\n" +
            "    } else {\n" +
            "        el.innerText = 'ภาพรวมคุณภาพน้ำ: กำลังรับข้อมูลจากเซนเซอร์';\n" +
            "        el.className = 'px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-xs';\n" +
            "    }\n" +
            "}\n\n" +
            "async function fetchCurrentData() {\n" +
            "    if (!currentMachine) return;\n" +
            "    const machineAtRequest = currentMachine;\n" +
            "    try {\n" +
            "        const data = await callApi('get_current', { machine_id: machineAtRequest });\n" +
            "        if (machineAtRequest !== currentMachine) return;\n" +
            "        const badge = document.getElementById('connectionBadge');\n" +
            "        if (!data || Object.keys(data).length === 0 || data.status === 'error') {\n" +
            "            badge.innerText = 'ไม่พบเครื่อง: ' + currentMachine;\n" +
            "            badge.className = 'px-3 py-1 text-xs rounded-lg font-semibold bg-rose-50 text-rose-700 border border-rose-200 inline-block';\n" +
            "            if (!machineNotFoundWarned) {\n" +
            "                machineNotFoundWarned = true;\n" +
            "                showToast('ไม่พบเครื่อง \"' + currentMachine + '\" กด \"+ เพิ่มเครื่องใหม่\" เพื่อลงทะเบียน', 'error');\n" +
            "            }\n" +
            "            return;\n" +
            "        }\n" +
            "        if (data.valve_command === undefined || data.valve_command === null || data.valve_command === '') {\n" +
            "            data.valve_command = getLocalValveFallback(currentMachine);\n" +
            "        } else {\n" +
            "            setLocalValveFallback(currentMachine, data.valve_command);\n" +
            "        }\n" +
            "        lastServerData = data;\n" +
            "        badge.innerText = 'ออนไลน์: ' + currentMachine;\n" +
            "        badge.className = 'px-3 py-1 text-xs rounded-lg font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block';\n" +
            "        document.getElementById('tempCurrent').innerText = formatNumber(data.current_temp);\n" +
            "        document.getElementById('phCurrent').innerText = formatNumber(data.current_ph);\n" +
            "        updateBadge('tempStatus', evaluateStatus('temp', data.current_temp));\n" +
            "        updateBadge('phStatus', evaluateStatus('ph', data.current_ph));\n" +
            "        updateGaugeAndBar('tempGaugeArc', 'tempBarFill', data.current_temp, 50);\n" +
            "        updateGaugeAndBar('phGaugeArc', 'phBarFill', data.current_ph, 14);\n" +
            "        updateWaterLevelCard(extractWaterLevel(data));\n" +
            "        updateOverallWaterStatus(data);\n" +
            "        syncSwitchesWithServer(data);\n" +
            "        const lu = document.getElementById('lastUpdated');\n" +
            "        if (lu) lu.innerText = 'ซิงค์ล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour12: false });\n" +
            "    } catch (err) {\n" +
            "        const lu = document.getElementById('lastUpdated');\n" +
            "        if (lu) lu.innerText = 'กำลังซิงค์ข้อมูลใหม่...';\n" +
            "    }\n" +
            "}\n\n" +
            "function updateDeviceIndicator(dev, isOn) {\n" +
            "    const led = document.getElementById(dev.ledId);\n" +
            "    const txt = document.getElementById(dev.textId);\n" +
            "    const card = dev.cardId ? document.getElementById(dev.cardId) : null;\n" +
            "    const isSky = dev.activeTheme === 'sky';\n" +
            "    if (led) led.className = isOn ? 'led-dot led-online' : 'led-dot led-standby';\n" +
            "    if (txt) {\n" +
            "        txt.innerText = isOn ? (dev.onLabel || 'กำลังทำงาน (ON)') : (dev.offLabel || 'หยุดพัก (OFF)');\n" +
            "        txt.className = isOn ? (isSky ? 'text-xs font-bold text-sky-700' : 'text-xs font-bold text-emerald-600') : 'text-xs font-semibold text-slate-500';\n" +
            "    }\n" +
            "    if (card) {\n" +
            "        if (isOn) {\n" +
            "            card.className = isSky\n" +
            "                ? 'border-2 border-sky-400 rounded-xl p-4 flex flex-col justify-between gap-4 bg-sky-50/40 shadow-sm transition-all duration-200'\n" +
            "                : 'border-2 border-emerald-400 rounded-xl p-4 flex flex-col justify-between gap-4 bg-emerald-50/40 shadow-sm transition-all duration-200';\n" +
            "        } else {\n" +
            "            card.className = 'border-2 border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 bg-slate-50/50 transition-all duration-200';\n" +
            "        }\n" +
            "    }\n" +
            "}\n\n" +
            "function updateActiveEquipmentBanner() {\n" +
            "    const banner = document.getElementById('activeEquipmentBanner');\n" +
            "    const dot = document.getElementById('activeEquipmentDot');\n" +
            "    const listEl = document.getElementById('activeEquipmentList');\n" +
            "    if (!banner || !listEl || !dot) return;\n" +
            "    const activeItems = [];\n" +
            "    DEVICES.forEach(dev => {\n" +
            "        const el = document.getElementById(dev.id);\n" +
            "        if (el && el.checked) {\n" +
            "            activeItems.push({ name: dev.name, label: dev.onLabel || 'เปิดทำงาน (ON)', theme: dev.activeTheme });\n" +
            "        }\n" +
            "    });\n" +
            "    if (activeItems.length > 0) {\n" +
            "        banner.className = 'mb-5 px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50/80 flex flex-wrap items-center justify-between gap-2 text-xs transition-all';\n" +
            "        dot.className = 'led-dot led-online';\n" +
            "        listEl.innerHTML = activeItems.map(item => {\n" +
            "            const pillClass = item.theme === 'sky' ? 'bg-sky-600 text-white' : 'bg-emerald-600 text-white';\n" +
            "            return '<span class=\"inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ' + pillClass + ' font-semibold mr-1.5\">' + escapeHtml(item.name) + ': ' + escapeHtml(item.label) + '</span>';\n" +
            "        }).join('');\n" +
            "    } else {\n" +
            "        banner.className = 'mb-5 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs transition-all';\n" +
            "        dot.className = 'led-dot led-standby';\n" +
            "        listEl.innerText = 'ไม่มีอุปกรณ์กำลังทำงาน (หยุดพักทั้งหมด)';\n" +
            "    }\n" +
            "}\n\n" +
            "function applySwitchMap(data, fromBroadcast = false) {\n" +
            "    const now = Date.now();\n" +
            "    const changedRemote = [];\n" +
            "    DEVICES.forEach(dev => {\n" +
            "        if (!fromBroadcast && switchLocks[dev.id] && now - switchLocks[dev.id] < CONFIG.SWITCH_LOCK_MS) return;\n" +
            "        const el = document.getElementById(dev.id);\n" +
            "        if (el && data[dev.field] !== undefined) {\n" +
            "            const isOn = isDeviceOnValue(dev, data[dev.field]);\n" +
            "            const prev = knownSwitchState[dev.id];\n" +
            "            if (hasInitialSwitchSync && prev !== undefined && prev !== isOn) {\n" +
            "                changedRemote.push(dev.name + ': ' + (isOn ? (dev.onLabel || 'เปิดทำงาน (ON)') : (dev.offLabel || 'หยุดพัก (OFF)')));\n" +
            "            }\n" +
            "            knownSwitchState[dev.id] = isOn;\n" +
            "            el.checked = isOn;\n" +
            "            updateDeviceIndicator(dev, isOn);\n" +
            "        }\n" +
            "    });\n" +
            "    const m1El = document.getElementById('motor1Toggle');\n" +
            "    const p1El = document.getElementById('pump1Toggle');\n" +
            "    if (m1El && p1El && m1El.checked && p1El.checked) {\n" +
            "        const p1Dev = DEVICES.find(d => d.code === '3');\n" +
            "        p1El.checked = false;\n" +
            "        knownSwitchState['pump1Toggle'] = false;\n" +
            "        if (p1Dev) updateDeviceIndicator(p1Dev, false);\n" +
            "    }\n" +
            "    hasInitialSwitchSync = true;\n" +
            "    updateActiveEquipmentBanner();\n" +
            "    if (changedRemote.length > 0) {\n" +
            "        showToast('ซิงค์สถานะสวิตช์: ' + changedRemote.join(' | '), 'info');\n" +
            "    }\n" +
            "}\n\n" +
            "function syncSwitchesWithServer(data) {\n" +
            "    applySwitchMap(data, false);\n" +
            "}\n\n" +
            "async function toggleDevice(elementId, onCommandCode) {\n" +
            "    const checkbox = document.getElementById(elementId);\n" +
            "    const dev = DEVICES.find(d => d.id === elementId);\n" +
            "    if (!currentMachine) {\n" +
            "        await autoConnectSharedMachine();\n" +
            "        if (!currentMachine) {\n" +
            "            checkbox.checked = !checkbox.checked;\n" +
            "            showToast('กรุณาเชื่อมต่อเครื่องก่อนสั่งงานอุปกรณ์', 'error');\n" +
            "            return;\n" +
            "        }\n" +
            "    }\n" +
            "    const isOn = checkbox.checked;\n" +
            "    const targetCmd = isOn ? dev.onCmd : dev.offCmd;\n" +
            "    const partnerCode = EXCLUSIVE_PAIRS[onCommandCode];\n" +
            "    const partnerDev = partnerCode ? DEVICES.find(d => d.code === partnerCode) : null;\n" +
            "    const partnerEl = partnerDev ? document.getElementById(partnerDev.id) : null;\n" +
            "    let partnerWasOn = false;\n" +
            "    if (isOn && partnerDev && partnerEl) {\n" +
            "        partnerWasOn = partnerEl.checked || (lastServerData && isDeviceOnValue(partnerDev, lastServerData[partnerDev.field]));\n" +
            "        partnerEl.checked = false;\n" +
            "        partnerEl.disabled = true;\n" +
            "        knownSwitchState[partnerDev.id] = false;\n" +
            "        updateDeviceIndicator(partnerDev, false);\n" +
            "        switchLocks[partnerDev.id] = Date.now();\n" +
            "    }\n" +
            "    const m1El = document.getElementById('motor1Toggle');\n" +
            "    const vEl = document.getElementById('valveToggle');\n" +
            "    const motor1ShouldStayOn = (onCommandCode === '4' && isOn && m1El && m1El.checked);\n" +
            "    const valveShouldStayOn = (onCommandCode === '1' && isOn && vEl && vEl.checked);\n" +
            "    switchLocks[elementId] = Date.now();\n" +
            "    knownSwitchState[elementId] = isOn;\n" +
            "    checkbox.disabled = true;\n" +
            "    if (dev) updateDeviceIndicator(dev, isOn);\n" +
            "    updateActiveEquipmentBanner();\n" +
            "    if (syncChannel) {\n" +
            "        const currentSwitchMap = {};\n" +
            "        DEVICES.forEach(d => {\n" +
            "            const el = document.getElementById(d.id);\n" +
            "            currentSwitchMap[d.field] = (el && el.checked) ? d.onCmd : d.offCmd;\n" +
            "        });\n" +
            "        try { syncChannel.postMessage({ type: 'SWITCH_UPDATED', switches: currentSwitchMap }); } catch (_) {}\n" +
            "    }\n" +
            "    try {\n" +
            "        if (isOn && partnerDev) {\n" +
            "            await callApi('set_device_command', {\n" +
            "                machine_id: currentMachine,\n" +
            "                command: partnerDev.offCmd,\n" +
            "                device_type: partnerDev.code\n" +
            "            }, 'POST');\n" +
            "            if (lastServerData) lastServerData[partnerDev.field] = partnerDev.offCmd;\n" +
            "            switchLocks[partnerDev.id] = Date.now();\n" +
            "        }\n" +
            "        const result = await callApi('set_device_command', {\n" +
            "            machine_id: currentMachine,\n" +
            "            command: targetCmd,\n" +
            "            device_type: onCommandCode\n" +
            "        }, 'POST');\n" +
            "        if (motor1ShouldStayOn) {\n" +
            "            switchLocks['motor1Toggle'] = Date.now();\n" +
            "            await callApi('set_device_command', { machine_id: currentMachine, command: '0', device_type: '1' }, 'POST');\n" +
            "        } else if (valveShouldStayOn) {\n" +
            "            switchLocks['valveToggle'] = Date.now();\n" +
            "            await callApi('set_device_command', { machine_id: currentMachine, command: '0', device_type: '4' }, 'POST');\n" +
            "        }\n" +
            "        if (result.status === 'success') {\n" +
            "            if (lastServerData && dev) lastServerData[dev.field] = targetCmd;\n" +
            "            switchLocks[elementId] = Date.now();\n" +
            "            const stateDesc = isOn ? (dev ? dev.onLabel : 'เปิดทำงาน (ON)') : (dev ? dev.offLabel : 'หยุดพัก (OFF)');\n" +
            "            if (isOn && partnerDev && partnerWasOn) {\n" +
            "                showToast((dev ? dev.name : 'อุปกรณ์') + ': ' + stateDesc + ' — หยุดการทำงานของ' + partnerDev.name + 'อัตโนมัติ', 'success');\n" +
            "            } else {\n" +
            "                showToast((dev ? dev.name : 'อุปกรณ์') + ': ' + stateDesc, 'success');\n" +
            "            }\n" +
            "        } else {\n" +
            "            checkbox.checked = !isOn;\n" +
            "            knownSwitchState[elementId] = !isOn;\n" +
            "            if (dev) updateDeviceIndicator(dev, !isOn);\n" +
            "            updateActiveEquipmentBanner();\n" +
            "            delete switchLocks[elementId];\n" +
            "            showToast(result.message || 'ไม่สามารถส่งคำสั่งได้', 'error');\n" +
            "        }\n" +
            "    } catch (err) {\n" +
            "        checkbox.checked = !isOn;\n" +
            "        knownSwitchState[elementId] = !isOn;\n" +
            "        if (dev) updateDeviceIndicator(dev, !isOn);\n" +
            "        updateActiveEquipmentBanner();\n" +
            "        delete switchLocks[elementId];\n" +
            "        showToast('ส่งคำสั่งไม่สำเร็จ: ' + err.message, 'error');\n" +
            "    } finally {\n" +
            "        checkbox.disabled = false;\n" +
            "        if (partnerEl) partnerEl.disabled = false;\n" +
            "    }\n" +
            "}\n\n" +
            "function updateStatsLabel(elementId, values, unit) {\n" +
            "    const el = document.getElementById(elementId);\n" +
            "    if (!el) return;\n" +
            "    const nums = values.map(v => parseFloat(v)).filter(v => !isNaN(v));\n" +
            "    if (nums.length === 0) {\n" +
            "        el.innerText = 'ต่ำสุด: -- | เฉลี่ย: -- | สูงสุด: --';\n" +
            "        return;\n" +
            "    }\n" +
            "    const min = Math.min(...nums).toFixed(2);\n" +
            "    const max = Math.max(...nums).toFixed(2);\n" +
            "    const avg = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);\n" +
            "    el.innerText = 'ต่ำสุด: ' + min + ' ' + unit + ' | เฉลี่ย: ' + avg + ' ' + unit + ' | สูงสุด: ' + max + ' ' + unit;\n" +
            "}\n\n" +
            "async function fetchHistory() {\n" +
            "    if (!currentMachine) return;\n" +
            "    const machineAtRequest = currentMachine;\n" +
            "    try {\n" +
            "        const data = await callApi('get_history', { machine_id: machineAtRequest });\n" +
            "        if (machineAtRequest !== currentMachine || !Array.isArray(data)) return;\n" +
            "        const selectedDate = document.getElementById('datePicker').value || localDateKey(new Date());\n" +
            "        const filtered = data.filter(d => d.recorded_at && localDateKey(d.recorded_at) === selectedDate).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));\n" +
            "        lastHistoryRecords = filtered;\n" +
            "        const countEl = document.getElementById('historyCount');\n" +
            "        if (countEl) countEl.innerText = 'ข้อมูลที่บันทึก: ' + filtered.length + ' รายการ';\n" +
            "        const currentLevelNumeric = lastServerData ? parseFloat(extractWaterLevel(lastServerData)) : NaN;\n" +
            "        const labels = filtered.map(d => new Date(d.recorded_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }));\n" +
            "        const temps = filtered.map(d => d.temperature);\n" +
            "        const phs = filtered.map(d => d.ph);\n" +
            "        const levels = filtered.map(d => {\n" +
            "            const rawLv = d.water_level ?? d.level;\n" +
            "            if (rawLv !== undefined && rawLv !== null && rawLv !== '') return rawLv;\n" +
            "            return !isNaN(currentLevelNumeric) ? currentLevelNumeric : null;\n" +
            "        });\n" +
            "        updateStatsLabel('tempStats', temps, '°C');\n" +
            "        updateStatsLabel('phStats', phs, 'pH');\n" +
            "        updateStatsLabel('levelStats', levels, '%');\n" +
            "        renderChart('tempChart', 'Temperature (°C)', labels, temps, '#F97316', 'rgba(249, 115, 22, 0.1)');\n" +
            "        renderChart('phChart', 'pH Level', labels, phs, '#0284C7', 'rgba(2, 132, 199, 0.1)');\n" +
            "        renderChart('levelChart', 'Water Level (%)', labels, levels, '#0D9488', 'rgba(13, 148, 136, 0.1)');\n" +
            "    } catch (err) {\n" +
            "        console.warn('fetchHistory:', err);\n" +
            "    }\n" +
            "}\n\n" +
            "function exportCsv() {\n" +
            "    if (!currentMachine) {\n" +
            "        showToast('กรุณาเชื่อมต่อเครื่องก่อนส่งออกข้อมูล', 'error');\n" +
            "        return;\n" +
            "    }\n" +
            "    if (!lastHistoryRecords || lastHistoryRecords.length === 0) {\n" +
            "        showToast('ไม่มีข้อมูลในวันที่เลือกสำหรับส่งออก', 'error');\n" +
            "        return;\n" +
            "    }\n" +
            "    const selectedDate = document.getElementById('datePicker').value || localDateKey(new Date());\n" +
            "    const fallbackLevel = lastServerData ? (extractWaterLevel(lastServerData) ?? '') : '';\n" +
            "    const header = ['Machine_ID', 'Timestamp', 'Temperature_C', 'pH_Level', 'Water_Level_Pct'];\n" +
            "    const rows = lastHistoryRecords.map(r => [\n" +
            "        currentMachine,\n" +
            "        new Date(r.recorded_at).toLocaleString('th-TH', { hour12: false }),\n" +
            "        r.temperature,\n" +
            "        r.ph,\n" +
            "        r.water_level ?? r.level ?? fallbackLevel\n" +
            "    ]);\n" +
            "    const csvContent = '\\uFEFF' + [header, ...rows].map(e => e.map(v => '\"' + String(v ?? '').replace(/\"/g, '\"\"') + '\"').join(',')).join('\\r\\n');\n" +
            "    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });\n" +
            "    const url = URL.createObjectURL(blob);\n" +
            "    const a = document.createElement('a');\n" +
            "    a.href = url;\n" +
            "    a.download = 'seameo_' + currentMachine + '_' + selectedDate + '.csv';\n" +
            "    document.body.appendChild(a);\n" +
            "    a.click();\n" +
            "    document.body.removeChild(a);\n" +
            "    URL.revokeObjectURL(url);\n" +
            "    showToast('ส่งออกไฟล์ CSV สำเร็จ (' + lastHistoryRecords.length + ' รายการ)', 'success');\n" +
            "}\n\n" +
            "function renderChart(canvasId, label, labels, dataPoints, borderColor, bgColor) {\n" +
            "    const canvas = document.getElementById(canvasId);\n" +
            "    if (!canvas || typeof Chart === 'undefined') return;\n" +
            "    if (charts[canvasId]) charts[canvasId].destroy();\n" +
            "    charts[canvasId] = new Chart(canvas.getContext('2d'), {\n" +
            "        type: 'line',\n" +
            "        data: {\n" +
            "            labels,\n" +
            "            datasets: [{\n" +
            "                label,\n" +
            "                data: dataPoints,\n" +
            "                borderColor,\n" +
            "                backgroundColor: bgColor,\n" +
            "                borderWidth: 2.5,\n" +
            "                pointRadius: dataPoints.length > 80 ? 0 : 3,\n" +
            "                pointHoverRadius: 5,\n" +
            "                fill: true,\n" +
            "                tension: 0.3\n" +
            "            }]\n" +
            "        },\n" +
            "        options: {\n" +
            "            responsive: true,\n" +
            "            maintainAspectRatio: false,\n" +
            "            animation: false,\n" +
            "            plugins: {\n" +
            "                legend: { display: false },\n" +
            "                tooltip: {\n" +
            "                    backgroundColor: '#0F172A',\n" +
            "                    titleFont: { family: 'Kanit', size: 12 },\n" +
            "                    bodyFont: { family: 'Prompt', size: 12 },\n" +
            "                    padding: 10,\n" +
            "                    cornerRadius: 8\n" +
            "                }\n" +
            "            },\n" +
            "            scales: {\n" +
            "                y: {\n" +
            "                    grid: { color: '#E2E8F0' },\n" +
            "                    ticks: { font: { family: 'Kanit', size: 11 }, color: '#64748B' }\n" +
            "                },\n" +
            "                x: {\n" +
            "                    grid: { display: false },\n" +
            "                    ticks: { font: { family: 'Kanit', size: 10 }, color: '#94A3B8', maxTicksLimit: 12 }\n" +
            "                }\n" +
            "            }\n" +
            "        }\n" +
            "    });\n" +
            "}\n"
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

// Inline config.js and app.js into embedded index.html so a single file is 100% self-contained
EMBEDDED_ASSETS['/index.html'].content = EMBEDDED_ASSETS['/index.html'].content.replace(
    '<script src="js/config.js?v=16"></script>\n    <script src="js/app.js?v=16"></script>',
    '<script>\n' + EMBEDDED_ASSETS['/js/config.js'].content + '\n' + EMBEDDED_ASSETS['/js/app.js'].content + '\n</script>'
);

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

    // Fast endpoint for cross-device station discovery
    if (action === 'get_sync_state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
            status: 'ok',
            active_machine_id: sharedState.activeMachineId,
            switches: sharedState.switchesByMachine[sharedState.activeMachineId] || null
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
        let bodyStr = '';
        let bodyParams = null;

        if (options.method === 'POST') {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            bodyStr = await readBody(req);
            options.body = bodyStr;
            bodyParams = new URLSearchParams(bodyStr);
        }

        // Update instant shared switch state on set_device_command
        // Active-Low: '0' = ON (เปิดเครื่อง), '1'/'2'/'3'/'4' = OFF (ปิดเครื่อง)
        if (action === 'set_device_command' && bodyParams) {
            const mId = (bodyParams.get('machine_id') || sharedState.activeMachineId || '00002').trim();
            const cmd = String(bodyParams.get('command') ?? '');
            const devType = String(bodyParams.get('device_type') || '');
            sharedState.activeMachineId = mId;

            const cache = getMachineSwitchCache(mId);
            if (devType === '1') {
                cache.motor1_command = cmd;
                if (cmd === '0') cache.pump1_command = '3'; // Interlock: Ch1 Motor ON ('0') -> Ch3 Aluminum Plate (pump1) OFF ('3')
            } else if (devType === '2') {
                cache.motor2_command = cmd;
            } else if (devType === '3') {
                cache.pump1_command = cmd;
                if (cmd === '0') cache.motor1_command = '1'; // Interlock: Ch3 Aluminum Plate (pump1) ON ('0') -> Ch1 Motor OFF ('1')
            } else if (devType === '4') {
                cache.pump2_command = cmd; // Ch4 Electric Valve (pump2) ทำงานอิสระ
            }
            cache.updatedAt = Date.now();
        }

        let gasRes = await fetch(targetUrl, options);
        let text = await gasRes.text();

        // Auto-register machine in Google Sheets if set_device_command says "Machine not found"
        if (action === 'set_device_command' && bodyParams && text.includes('Machine not found')) {
            const mId = (bodyParams.get('machine_id') || '00002').trim();
            await ensureMachineInSheet(mId);
            gasRes = await fetch(targetUrl, options);
            text = await gasRes.text();
        }

        // Enhance get_current so all devices get real-time synced switch states
        if (action === 'get_current') {
            const mId = (queryParams.get('machine_id') || sharedState.activeMachineId || '00002').trim();
            sharedState.activeMachineId = mId;
            const cache = getMachineSwitchCache(mId);

            let parsed = {};
            try { parsed = JSON.parse(text); } catch (_) { parsed = {}; }

            if (!parsed || Object.keys(parsed).length === 0) {
                ensureMachineInSheet(mId);
                parsed = {
                    current_temp: 0,
                    current_ph: 0,
                    current_water_level: 0,
                    motor1_command: cache.motor1_command,
                    motor2_command: cache.motor2_command,
                    pump1_command: cache.pump1_command,
                    pump2_command: cache.pump2_command
                };
            } else {
                const now = Date.now();
                if (cache.updatedAt && (now - cache.updatedAt < 8000)) {
                    parsed.motor1_command = cache.motor1_command;
                    parsed.motor2_command = cache.motor2_command;
                    parsed.pump1_command = cache.pump1_command;
                    parsed.pump2_command = cache.pump2_command;
                } else {
                    cache.motor1_command = String(parsed.motor1_command ?? '1');
                    cache.motor2_command = String(parsed.motor2_command ?? '2');
                    cache.pump1_command = String(parsed.pump1_command ?? '3');
                    cache.pump2_command = String(parsed.pump2_command ?? '4');
                }
            }

            // Enforce interlock between Channel 1 (motor1) and Channel 3 (pump1 = แผ่นอะลูมิเนียม)
            if (String(parsed.motor1_command) === '0' && String(parsed.pump1_command) === '0') {
                parsed.pump1_command = '3';
                cache.pump1_command = '3';
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

    // 1. Proxy /api requests to Google Apps Script
    if (pathname === '/api' || pathname.startsWith('/api/')) {
        await proxyToGas(req, res);
        return;
    }

    // 2. Serve core assets (reads from disk locally if present, falls back to embedded on Vercel)
    if (EMBEDDED_ASSETS[pathname]) {
        const asset = EMBEDDED_ASSETS[pathname];
        let output = asset.content;
        try {
            const diskPath = path.join(__dirname, asset.file);
            if (fs.existsSync(diskPath)) {
                output = fs.readFileSync(diskPath, 'utf8');
            }
        } catch (_) {}

        res.writeHead(200, {
            'Content-Type': asset.type,
            'Cache-Control': 'no-cache'
        });
        res.end(output);
        return;
    }

    // 3. Fallback for any other static files
    const safePath = decodeURIComponent(pathname).replace(/^\/+/, '');
    const filePath = path.join(__dirname, safePath);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' });
            res.end(EMBEDDED_ASSETS['/index.html'].content);
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
    console.log(`🚀 SEAMEO Smart Sensor Dashboard is running!`);
    console.log(`👉 Open in browser: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});
