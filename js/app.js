// ========================================================
// SEAMEO — Water Quality Telemetry & Control System
// ========================================================

let currentMachine = '';
let pollTimer = null;
let historyTimer = null;
let charts = {};
let isLoginMode = true;
let apiBase = null;
let machineNotFoundWarned = false;
let lastHistoryRecords = [];
let lastServerData = null;
let hasInitialSwitchSync = false;
const switchLocks = {};
const knownSwitchState = {};

// ช่องทางการซิงค์ข้ามแท็บในเบราว์เซอร์เดียวกันแบบทันที (0ms)
const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('seameo_switch_sync') : null;

// ช่องสัญญาณที่ 1: มอเตอร์ | ช่องสัญญาณที่ 2: ปั๊มน้ำ | ช่องสัญญาณที่ 4: แผ่นอะลูมิเนียม
const DEVICES = [
    { id: 'motor1Toggle', cardId: 'motor1Card', code: '1', name: 'มอเตอร์ (ช่อง 1)',         field: 'motor1_command', ledId: 'motor1Led', textId: 'motor1StateText' },
    { id: 'motor2Toggle', cardId: 'motor2Card', code: '2', name: 'ปั๊มน้ำ (ช่อง 2)',          field: 'motor2_command', ledId: 'motor2Led', textId: 'motor2StateText' },
    { id: 'pump2Toggle',  cardId: 'pump2Card',  code: '4', name: 'แผ่นอะลูมิเนียม (ช่อง 4)',  field: 'pump2_command',  ledId: 'pump2Led',  textId: 'pump2StateText' }
];

// กฎ Interlock: มอเตอร์ (ช่อง 1) กับ แผ่นอะลูมิเนียม (ช่อง 4) ห้ามเปิดพร้อมกัน
const EXCLUSIVE_PAIRS = {
    '1': '4',
    '4': '1'
};

// ========================================================
// API Layer
// ========================================================
async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function tryEndpoint(base) {
    const res = await fetchWithTimeout(`${base}?action=ping`, { method: 'GET' }, 20000);
    const text = await res.text();
    JSON.parse(text);
    return true;
}

async function resolveApiBase(force = false) {
    if (apiBase && !force) return apiBase;

    const candidates = [];
    if (location.protocol.startsWith('http')) candidates.push(CONFIG.PROXY_URL);
    candidates.push(CONFIG.GAS_URL);

    for (const base of candidates) {
        try {
            await tryEndpoint(base);
            apiBase = base;
            return apiBase;
        } catch (err) {
            console.warn('[API] fallback:', base);
        }
    }
    throw new Error('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
}

async function callApi(action, params = {}, method = 'GET') {
    const base = await resolveApiBase();
    const query = new URLSearchParams({ action, _t: Date.now() });
    const options = { method, cache: 'no-store' };

    if (method === 'GET') {
        Object.entries(params).forEach(([k, v]) => query.append(k, v));
    } else {
        options.body = new URLSearchParams(params);
    }

    const res = await fetchWithTimeout(`${base}?${query.toString()}`, options);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        apiBase = null;
        throw new Error('ข้อมูลตอบกลับไม่ถูกต้อง');
    }
}

// ========================================================
// Initialization & Real-Time Listeners
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
    const datePicker = document.getElementById('datePicker');
    if (datePicker) datePicker.value = localDateKey(new Date());

    const machineInput = document.getElementById('machineIdInput');
    if (machineInput) {
        machineInput.addEventListener('keydown', e => { if (e.key === 'Enter') bindMachine(); });
    }

    // เมื่อสลับกลับมาเปิดหน้าเว็บ ให้ซิงค์สถานะสวิตช์ทันที
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentMachine) {
            fetchCurrentData();
        }
    });

    // ซิงค์ข้ามแท็บทันทีเมื่อมีการกดสวิตช์
    if (syncChannel) {
        syncChannel.onmessage = (ev) => {
            const msg = ev.data;
            if (!msg) return;
            if (msg.type === 'MACHINE_CHANGED' && msg.machineId && msg.machineId !== currentMachine) {
                document.getElementById('machineIdInput').value = msg.machineId;
                bindMachine(msg.machineId, true);
            } else if (msg.type === 'SWITCH_UPDATED' && msg.switches) {
                applySwitchMap(msg.switches, true);
            }
        };
    }

    startSystemClock();
    checkLoginStatus();
    checkApiStatus();
    if (window.lucide) lucide.createIcons();
});

function startSystemClock() {
    const updateClock = () => {
        const el = document.getElementById('systemClock');
        if (!el) return;
        const now = new Date();
        el.innerText = now.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) +
            ' | ' + now.toLocaleTimeString('th-TH', { hour12: false });
    };
    updateClock();
    setInterval(updateClock, 1000);
}

async function checkApiStatus() {
    const el = document.getElementById('apiStatus');
    if (!el) return;
    el.className = 'text-xs text-slate-400 flex items-center gap-2';
    el.innerHTML = '<span class="led-dot led-standby"></span><span>กำลังตรวจสอบฐานข้อมูล...</span>';
    try {
        await resolveApiBase(true);
        el.className = 'text-xs text-emerald-700 font-medium flex items-center gap-2';
        el.innerHTML = '<span class="led-dot led-online"></span><span>เชื่อมต่อฐานข้อมูลพร้อมใช้งาน</span>';
    } catch (err) {
        el.className = 'text-xs text-rose-600 flex items-center gap-2';
        el.innerHTML = `<span class="led-dot led-error"></span><span>${escapeHtml(err.message)}</span> <button type="button" onclick="checkApiStatus()" class="underline font-semibold ml-1">ลองใหม่</button>`;
    }
}

// ========================================================
// Helpers
// ========================================================
function localDateKey(dateInput) {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatNumber(value) {
    if (value === '' || value === null || value === undefined || isNaN(parseFloat(value))) return '--';
    return parseFloat(value).toFixed(2);
}

function extractWaterLevel(data) {
    if (!data) return null;
    const candidates = [
        data.current_water_level,
        data.water_level,
        data.current_level,
        data.level,
        data.pump1_command
    ];
    for (const val of candidates) {
        if (val !== undefined && val !== null && String(val).trim() !== '') {
            return val;
        }
    }
    return null;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const styles = {
        success: 'bg-slate-900 border-l-4 border-emerald-500 text-white',
        error: 'bg-slate-900 border-l-4 border-rose-500 text-white',
        info: 'bg-slate-900 border-l-4 border-sky-500 text-white'
    };
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-xs font-medium transition-all duration-300 translate-y-2 opacity-0 ${styles[type] || styles.info}`;
    toast.innerText = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove('translate-y-2', 'opacity-0'));
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function showAuthMessage(html, type = 'error') {
    const box = document.getElementById('authMsgBox');
    if (!box) return;
    const styles = {
        error: 'bg-rose-50 text-rose-800 border-rose-200',
        success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        info: 'bg-sky-50 text-sky-800 border-sky-200'
    };
    box.className = `mb-5 p-3.5 rounded-lg text-xs border text-center ${styles[type] || styles.error}`;
    box.innerHTML = html;
}

function hideAuthMessage() {
    const box = document.getElementById('authMsgBox');
    if (box) { box.className = 'hidden'; box.innerHTML = ''; }
}

// ========================================================
// Authentication & Auto-Station Sync
// ========================================================
async function autoConnectSharedMachine() {
    let targetMachine = localStorage.getItem('currentMachine') || '';
    try {
        const syncInfo = await callApi('get_sync_state');
        if (syncInfo && syncInfo.active_machine_id) {
            // ถ้าเครื่องนี้ยังไม่ได้ตั้งค่า หรือใช้ค่าเริ่มต้น ให้เกาะตามเครื่องล่าสุดที่ระบบใช้งานอยู่ทันที
            if (!targetMachine) {
                targetMachine = syncInfo.active_machine_id;
            }
        }
    } catch (_) {}

    if (!targetMachine) {
        targetMachine = CONFIG.DEFAULT_MACHINE_ID || 'ESP32-01';
    }

    const input = document.getElementById('machineIdInput');
    if (input) input.value = targetMachine;
    if (targetMachine !== currentMachine) {
        bindMachine(targetMachine, true);
    }
}

function checkLoginStatus() {
    const userId = localStorage.getItem('userID');
    const username = localStorage.getItem('username');
    const authScreen = document.getElementById('authScreen');
    const dashboardScreen = document.getElementById('dashboardScreen');

    if (userId && username) {
        authScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        document.getElementById('displayUsername').innerText = username;
        autoConnectSharedMachine();
    } else {
        authScreen.classList.remove('hidden');
        dashboardScreen.classList.add('hidden');
    }
    if (window.lucide) lucide.createIcons();
}

function switchAuthTab(mode) {
    isLoginMode = (mode === 'login');
    const active = 'pb-3 pr-6 text-sm font-bold border-b-2 border-slate-900 text-slate-900 transition-all';
    const inactive = 'pb-3 px-6 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-700 transition-all';

    document.getElementById('authTitle').innerText = isLoginMode ? 'เข้าสู่ระบบควบคุม' : 'สมัครสมาชิกผู้ใช้งานใหม่';
    document.getElementById('authSubmitText').innerText = isLoginMode ? 'เข้าสู่แผงควบคุมระบบ' : 'ยืนยันการสมัครสมาชิก';
    document.getElementById('authUsernameLabel').innerText = isLoginMode
        ? 'ชื่อผู้ใช้งาน (Username)'
        : 'ตั้งชื่อผู้ใช้งานใหม่ (New Username)';
    document.getElementById('tabLogin').className = isLoginMode ? active : inactive;
    document.getElementById('tabRegister').className = isLoginMode ? inactive : active;
    hideAuthMessage();
}

function toggleAuthMode() {
    switchAuthTab(isLoginMode ? 'register' : 'login');
}

function setAuthLoading(loading, text) {
    const btn = document.getElementById('authSubmitBtn');
    const label = document.getElementById('authSubmitText');
    btn.disabled = loading;
    btn.classList.toggle('opacity-70', loading);
    btn.classList.toggle('cursor-wait', loading);
    label.innerText = loading ? text : (isLoginMode ? 'เข้าสู่แผงควบคุมระบบ' : 'ยืนยันการสมัครสมาชิก');
}

function completeLogin(userId, username) {
    localStorage.setItem('userID', String(userId));
    localStorage.setItem('username', String(username));
    document.getElementById('authUsername').value = '';
    hideAuthMessage();
    showToast(`เข้าสู่ระบบสำเร็จ — สวัสดีคุณ ${username}`, 'success');
    checkLoginStatus();
}

async function handleAuth(event) {
    if (event) event.preventDefault();

    const username = document.getElementById('authUsername').value.trim();
    if (!username) {
        showAuthMessage('กรุณากรอกชื่อผู้ใช้งาน');
        return;
    }

    hideAuthMessage();

    try {
        if (isLoginMode) {
            setAuthLoading(true, 'กำลังตรวจสอบสิทธิ์...');
            const data = await callApi('login_user', { username }, 'POST');

            if (data.status === 'success') {
                completeLogin(data.user_id, data.username);
            } else {
                const msg = escapeHtml(data.message || 'ไม่พบชื่อผู้ใช้งานนี้');
                const safeName = escapeHtml(username).replace(/'/g, '&#39;');
                showAuthMessage(
                    `<div>${msg}</div>
                     <button type="button" onclick="registerAndLogin('${safeName}')"
                        class="mt-2 text-sky-700 hover:text-sky-900 font-semibold underline text-xs">
                        คลิกเพื่อสมัครสมาชิกชื่อ "${safeName}" และเข้าสู่ระบบทันที
                     </button>`
                );
            }
        } else {
            await registerAndLogin(username);
        }
    } catch (err) {
        showAuthMessage(`เชื่อมต่อไม่สำเร็จ: ${escapeHtml(err.name === 'AbortError' ? 'หมดเวลาเชื่อมต่อ กรุณาลองใหม่' : err.message)}`);
    } finally {
        setAuthLoading(false);
    }
}

async function registerAndLogin(username) {
    hideAuthMessage();
    setAuthLoading(true, 'กำลังบันทึกข้อมูล...');
    try {
        const reg = await callApi('register_user', { username }, 'POST');
        if (reg.status !== 'success' && !(reg.message || '').includes('มีคนใช้แล้ว')) {
            showAuthMessage(escapeHtml(reg.message || 'ไม่สามารถสมัครสมาชิกได้'));
            return;
        }

        setAuthLoading(true, 'กำลังเข้าสู่ระบบ...');
        const login = await callApi('login_user', { username }, 'POST');
        if (login.status === 'success') {
            completeLogin(login.user_id, login.username);
        } else {
            isLoginMode = true;
            switchAuthTab('login');
            showAuthMessage('สมัครสมาชิกสำเร็จ กรุณากดเข้าสู่ระบบ', 'success');
        }
    } catch (err) {
        showAuthMessage(`เชื่อมต่อไม่สำเร็จ: ${escapeHtml(err.message)}`);
    } finally {
        setAuthLoading(false);
    }
}

function quickGuestLogin() {
    completeLogin('DEMO', 'DEMO_EVALUATOR');
}

function logout() {
    stopPolling();
    currentMachine = '';
    localStorage.removeItem('userID');
    localStorage.removeItem('username');
    localStorage.removeItem('currentMachine');

    document.getElementById('machineIdInput').value = '';
    const badge = document.getElementById('connectionBadge');
    if (badge) badge.className = 'hidden';
    resetDashboard();

    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    checkLoginStatus();
}

// ========================================================
// Station Binding & Registration
// ========================================================
function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (historyTimer) clearInterval(historyTimer);
    pollTimer = null;
    historyTimer = null;
}

function resetDashboard() {
    ['tempCurrent', 'phCurrent', 'ecCurrent', 'levelCurrent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '--';
    });
    const unitEl = document.getElementById('levelUnit');
    if (unitEl) unitEl.innerText = '%';
    ['tempStatus', 'phStatus', 'ecStatus', 'levelStatus'].forEach(id => updateBadge(id, evaluateStatus('', null)));
    ['tempGaugeArc', 'phGaugeArc', 'ecGaugeArc', 'levelGaugeArc'].forEach(id => {
        const arc = document.getElementById(id);
        if (arc) arc.style.strokeDashoffset = '144.5';
    });
    DEVICES.forEach(d => {
        const el = document.getElementById(d.id);
        if (el) el.checked = false;
        updateDeviceIndicator(d, false);
        delete knownSwitchState[d.id];
    });
    updateActiveEquipmentBanner();
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
    lastHistoryRecords = [];
    lastServerData = null;
    hasInitialSwitchSync = false;
    const lu = document.getElementById('lastUpdated');
    if (lu) lu.innerText = 'ยังไม่ได้เชื่อมต่อเครื่อง';
}

function bindMachine(targetId, silent = false) {
    const input = document.getElementById('machineIdInput');
    const machineId = String(targetId || input.value || '').trim();

    if (!machineId) {
        showToast('กรุณาระบุหมายเลขเครื่อง (Machine ID)', 'error');
        return;
    }

    stopPolling();
    resetDashboard();
    currentMachine = machineId;
    machineNotFoundWarned = false;
    localStorage.setItem('currentMachine', currentMachine);

    if (syncChannel && !silent) {
        try { syncChannel.postMessage({ type: 'MACHINE_CHANGED', machineId: currentMachine }); } catch (_) {}
    }

    const badge = document.getElementById('connectionBadge');
    badge.innerText = `กำลังเชื่อมต่อ ${currentMachine}...`;
    badge.className = 'px-2.5 py-1 text-xs rounded-md font-medium bg-amber-50 text-amber-700 border border-amber-200 inline-block';

    if (!silent) showToast(`กำลังซิงค์ข้อมูลจาก ${currentMachine}...`, 'info');

    fetchCurrentData();
    fetchHistory();
    pollTimer = setInterval(fetchCurrentData, CONFIG.POLL_INTERVAL_MS);
    historyTimer = setInterval(fetchHistory, CONFIG.HISTORY_REFRESH_MS);
}

function openAddMachineModal() {
    const modal = document.getElementById('addMachineModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => document.getElementById('newMachineIdInput').focus(), 50);
}

function closeAddMachineModal() {
    const modal = document.getElementById('addMachineModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('newMachineIdInput').value = '';
}

async function submitNewMachine(event) {
    if (event) event.preventDefault();

    const newId = document.getElementById('newMachineIdInput').value.trim();
    if (!newId) return;

    const btn = document.getElementById('addMachineBtn');
    const originalText = btn.innerText;
    btn.innerText = 'กำลังบันทึก...';
    btn.disabled = true;

    try {
        const data = await callApi('add_machine', {
            machine_id: newId,
            user_id: localStorage.getItem('userID') || '1'
        }, 'POST');

        if (data.status === 'success') {
            showToast(`เพิ่มเครื่อง "${newId}" สำเร็จ`, 'success');
        } else {
            showToast(data.message || 'ไม่สามารถเพิ่มเครื่องได้', 'error');
            if (!(data.message || '').includes('ลงทะเบียนไปแล้ว')) return;
        }
        closeAddMachineModal();
        document.getElementById('machineIdInput').value = newId;
        bindMachine(newId, false);
    } catch (err) {
        showToast(`เชื่อมต่อไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ========================================================
// Real-time Telemetry Polling & Gauges
// ========================================================
function evaluateStatus(type, value) {
    const none = { text: 'รอข้อมูล', badgeClass: 'bg-slate-100 text-slate-500' };
    if (value === null || value === undefined || value === '') return none;

    const danger = { text: 'เกินเกณฑ์วิกฤต', badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold' };
    const risky = { text: 'เฝ้าระวัง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };
    const safe = { text: 'ปกติ', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold' };

    if (type === 'level') {
        const rawStr = String(value).trim();
        const num = parseFloat(rawStr);
        if (isNaN(num)) {
            if (rawStr.includes('ต่ำ') || rawStr.toLowerCase().includes('low')) {
                return { text: 'ระดับน้ำต่ำ', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };
            }
            if (rawStr.includes('สูง') || rawStr.includes('ล้น') || rawStr.toLowerCase().includes('high')) {
                return { text: 'ระดับน้ำสูง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };
            }
            return safe;
        }
        const lowTh = (CONFIG.THRESHOLDS.level && CONFIG.THRESHOLDS.level.low) || 20;
        const highTh = (CONFIG.THRESHOLDS.level && CONFIG.THRESHOLDS.level.high) || 95;
        if (num < lowTh) return { text: 'ระดับน้ำต่ำ', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };
        if (num > highTh) return { text: 'ระดับน้ำสูง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };
        return safe;
    }

    const num = parseFloat(value);
    if (isNaN(num)) return none;
    const th = CONFIG.THRESHOLDS;

    if (type === 'temp') return num > th.temp.danger ? danger : num >= th.temp.risky ? risky : safe;
    if (type === 'ph') {
        if (num < th.ph.dangerMin || num > th.ph.dangerMax) return danger;
        if (num < th.ph.riskyMin || num > th.ph.riskyMax) return risky;
        return safe;
    }
    if (type === 'ec') return num > th.ec.danger ? danger : num > th.ec.risky ? risky : safe;
    return none;
}

function updateBadge(id, stat) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = stat.text;
    el.className = `px-2.5 py-1 rounded-md text-xs transition-colors duration-200 shrink-0 ${stat.badgeClass}`;
}

function updateGaugeArc(arcId, value, maxVal) {
    const arc = document.getElementById(arcId);
    if (!arc) return;
    const num = parseFloat(value);
    if (isNaN(num)) {
        arc.style.strokeDashoffset = '144.5';
        return;
    }
    const pct = Math.max(0, Math.min(100, (num / maxVal) * 100));
    const offset = 144.5 - (pct / 100) * 144.5;
    arc.style.strokeDashoffset = offset.toFixed(1);
}

function updateWaterLevelCard(rawLevel) {
    const valEl = document.getElementById('levelCurrent');
    const unitEl = document.getElementById('levelUnit');
    if (!valEl) return;

    if (rawLevel === null || rawLevel === undefined || String(rawLevel).trim() === '') {
        valEl.innerText = '--';
        if (unitEl) unitEl.innerText = '%';
        updateBadge('levelStatus', evaluateStatus('level', null));
        updateGaugeArc('levelGaugeArc', null, 100);
        return;
    }

    const str = String(rawLevel).trim();
    const num = parseFloat(str);
    if (!isNaN(num) && /^-?\d+(\.\d+)?%?$/.test(str)) {
        valEl.innerText = Number.isInteger(num) ? String(num) : num.toFixed(1);
        if (unitEl) unitEl.innerText = '%';
        updateGaugeArc('levelGaugeArc', num, 100);
    } else {
        valEl.innerText = str;
        if (unitEl) unitEl.innerText = '';
        updateGaugeArc('levelGaugeArc', !isNaN(num) ? num : 75, 100);
    }
    updateBadge('levelStatus', evaluateStatus('level', rawLevel));
}

function updateOverallWaterStatus(data) {
    const el = document.getElementById('overallWaterStatus');
    if (!el) return;
    const statuses = [
        evaluateStatus('temp', data.current_temp).text,
        evaluateStatus('ph', data.current_ph).text,
        evaluateStatus('ec', data.current_ec).text
    ];
    if (statuses.includes('เกินเกณฑ์วิกฤต')) {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: เกินเกณฑ์วิกฤต (ควรเดินเครื่องบำบัด)';
        el.className = 'px-3 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-xs';
    } else if (statuses.includes('เฝ้าระวัง')) {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: มีค่าอยู่ในเกณฑ์เฝ้าระวัง';
        el.className = 'px-3 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-xs';
    } else if (statuses.every(s => s === 'ปกติ')) {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: อยู่ในเกณฑ์ปกติทุกพารามิเตอร์';
        el.className = 'px-3 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-xs';
    } else {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: กำลังรับข้อมูลจากเซนเซอร์';
        el.className = 'px-3 py-1 rounded-md bg-slate-100 text-slate-600 font-semibold text-xs';
    }
}

async function fetchCurrentData() {
    if (!currentMachine) return;
    const machineAtRequest = currentMachine;

    try {
        const data = await callApi('get_current', { machine_id: machineAtRequest });
        if (machineAtRequest !== currentMachine) return;

        const badge = document.getElementById('connectionBadge');

        if (!data || Object.keys(data).length === 0 || data.status === 'error') {
            badge.innerText = `ไม่พบเครื่อง: ${currentMachine}`;
            badge.className = 'px-2.5 py-1 text-xs rounded-md font-medium bg-rose-50 text-rose-700 border border-rose-200 inline-block';
            if (!machineNotFoundWarned) {
                machineNotFoundWarned = true;
                showToast(`ไม่พบเครื่อง "${currentMachine}" กด "+ เพิ่มเครื่องใหม่" เพื่อลงทะเบียน`, 'error');
            }
            return;
        }

        lastServerData = data;

        badge.innerText = `ออนไลน์: ${currentMachine}`;
        badge.className = 'px-2.5 py-1 text-xs rounded-md font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block';

        document.getElementById('tempCurrent').innerText = formatNumber(data.current_temp);
        document.getElementById('phCurrent').innerText = formatNumber(data.current_ph);
        document.getElementById('ecCurrent').innerText = formatNumber(data.current_ec);

        updateBadge('tempStatus', evaluateStatus('temp', data.current_temp));
        updateBadge('phStatus', evaluateStatus('ph', data.current_ph));
        updateBadge('ecStatus', evaluateStatus('ec', data.current_ec));

        updateGaugeArc('tempGaugeArc', data.current_temp, 50);
        updateGaugeArc('phGaugeArc', data.current_ph, 14);
        updateGaugeArc('ecGaugeArc', data.current_ec, 4);

        updateWaterLevelCard(extractWaterLevel(data));
        updateOverallWaterStatus(data);

        syncSwitchesWithServer(data);

        const lu = document.getElementById('lastUpdated');
        if (lu) lu.innerText = `ซิงค์ล่าสุด ${new Date().toLocaleTimeString('th-TH', { hour12: false })}`;
    } catch (err) {
        const lu = document.getElementById('lastUpdated');
        if (lu) lu.innerText = 'กำลังซิงค์ข้อมูลใหม่...';
    }
}

function updateDeviceIndicator(dev, isOn) {
    const led = document.getElementById(dev.ledId);
    const txt = document.getElementById(dev.textId);
    const card = dev.cardId ? document.getElementById(dev.cardId) : null;
    if (led) led.className = isOn ? 'led-dot led-online' : 'led-dot led-standby';
    if (txt) {
        txt.innerText = isOn ? 'กำลังทำงาน (ON)' : 'หยุดพัก (OFF)';
        txt.className = isOn ? 'text-xs font-semibold text-emerald-600' : 'text-xs font-medium text-slate-500';
    }
    if (card) {
        card.className = isOn
            ? 'border border-emerald-400 rounded-xl p-4 flex flex-col justify-between gap-4 bg-emerald-50/30 ring-1 ring-emerald-400/25 transition-all duration-200'
            : 'border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 bg-slate-50/40 transition-all duration-200';
    }
}

// อัปเดตแถบแจ้งเตือนว่ามีอุปกรณ์ใดเปิดทำงานอยู่บ้าง ให้ทุกเครื่องที่เปิดเว็บเห็นชัดเจน
function updateActiveEquipmentBanner() {
    const banner = document.getElementById('activeEquipmentBanner');
    const dot = document.getElementById('activeEquipmentDot');
    const listEl = document.getElementById('activeEquipmentList');
    if (!banner || !listEl || !dot) return;

    const activeNames = [];
    DEVICES.forEach(dev => {
        const el = document.getElementById(dev.id);
        if (el && el.checked) activeNames.push(dev.name);
    });

    if (activeNames.length > 0) {
        banner.className = 'mb-5 px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50/70 flex flex-wrap items-center justify-between gap-2 text-xs transition-all';
        dot.className = 'led-dot led-online';
        listEl.innerHTML = activeNames.map(n =>
            `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-semibold mr-1.5">${escapeHtml(n)}: เปิดทำงาน (ON)</span>`
        ).join('');
    } else {
        banner.className = 'mb-5 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs transition-all';
        dot.className = 'led-dot led-standby';
        listEl.innerText = 'ไม่มีอุปกรณ์กำลังทำงาน (หยุดพักทั้งหมด)';
    }
}

function applySwitchMap(data, fromBroadcast = false) {
    const now = Date.now();
    const changedRemote = [];

    DEVICES.forEach(dev => {
        if (!fromBroadcast && switchLocks[dev.id] && now - switchLocks[dev.id] < CONFIG.SWITCH_LOCK_MS) return;
        const el = document.getElementById(dev.id);
        if (el && data[dev.field] !== undefined) {
            const isOn = String(data[dev.field]) === dev.code;
            const prev = knownSwitchState[dev.id];
            if (hasInitialSwitchSync && prev !== undefined && prev !== isOn) {
                changedRemote.push(`${dev.name}: ${isOn ? 'เปิดทำงาน (ON)' : 'หยุดพัก (OFF)'}`);
            }
            knownSwitchState[dev.id] = isOn;
            el.checked = isOn;
            updateDeviceIndicator(dev, isOn);
        }
    });

    // บังคับ Interlock บนหน้าจอเสมอ: ถ้าช่อง 1 และช่อง 4 เปิดคู่กัน ให้ปิดช่อง 4
    const m1El = document.getElementById('motor1Toggle');
    const p2El = document.getElementById('pump2Toggle');
    if (m1El && p2El && m1El.checked && p2El.checked) {
        const p2Dev = DEVICES.find(d => d.code === '4');
        p2El.checked = false;
        knownSwitchState['pump2Toggle'] = false;
        if (p2Dev) updateDeviceIndicator(p2Dev, false);
    }

    hasInitialSwitchSync = true;
    updateActiveEquipmentBanner();

    if (changedRemote.length > 0) {
        showToast(`ซิงค์สถานะสวิตช์: ${changedRemote.join(' | ')}`, 'info');
    }
}

function syncSwitchesWithServer(data) {
    applySwitchMap(data, false);
}

// ========================================================
// Actuator Controls (พร้อมระบบ Interlock & ซิงค์ทุกเครื่อง)
// ========================================================
async function toggleDevice(elementId, onCommandCode) {
    const checkbox = document.getElementById(elementId);
    const dev = DEVICES.find(d => d.id === elementId);

    if (!currentMachine) {
        await autoConnectSharedMachine();
        if (!currentMachine) {
            checkbox.checked = !checkbox.checked;
            showToast('กรุณาเชื่อมต่อเครื่องก่อนสั่งงานอุปกรณ์', 'error');
            return;
        }
    }

    const isOn = checkbox.checked;
    const partnerCode = EXCLUSIVE_PAIRS[onCommandCode];
    const partnerDev = partnerCode ? DEVICES.find(d => d.code === partnerCode) : null;
    const partnerEl = partnerDev ? document.getElementById(partnerDev.id) : null;

    let partnerWasOn = false;
    if (isOn && partnerDev && partnerEl) {
        partnerWasOn = partnerEl.checked || (lastServerData && String(lastServerData[partnerDev.field]) === partnerDev.code);
        partnerEl.checked = false;
        partnerEl.disabled = true;
        knownSwitchState[partnerDev.id] = false;
        updateDeviceIndicator(partnerDev, false);
        switchLocks[partnerDev.id] = Date.now();
    }

    switchLocks[elementId] = Date.now();
    knownSwitchState[elementId] = isOn;
    checkbox.disabled = true;
    if (dev) updateDeviceIndicator(dev, isOn);
    updateActiveEquipmentBanner();

    // กระจายสถานะไปยังแท็บอื่นทันที
    if (syncChannel) {
        const currentSwitchMap = {};
        DEVICES.forEach(d => {
            const el = document.getElementById(d.id);
            currentSwitchMap[d.field] = (el && el.checked) ? d.code : '0';
        });
        try { syncChannel.postMessage({ type: 'SWITCH_UPDATED', switches: currentSwitchMap }); } catch (_) {}
    }

    try {
        if (isOn && partnerDev) {
            await callApi('set_device_command', {
                machine_id: currentMachine,
                command: '0',
                device_type: partnerDev.code
            }, 'POST');
            if (lastServerData) lastServerData[partnerDev.field] = '0';
            switchLocks[partnerDev.id] = Date.now();
        }

        const result = await callApi('set_device_command', {
            machine_id: currentMachine,
            command: isOn ? onCommandCode : '0',
            device_type: onCommandCode
        }, 'POST');

        if (result.status === 'success') {
            if (lastServerData && dev) lastServerData[dev.field] = isOn ? onCommandCode : '0';
            switchLocks[elementId] = Date.now();
            if (isOn && partnerDev && partnerWasOn) {
                showToast(`${dev ? dev.name : 'อุปกรณ์'}: เปิดทำงาน (ON) — ปิด${partnerDev.name}อัตโนมัติ`, 'success');
            } else {
                showToast(`${dev ? dev.name : 'อุปกรณ์'}: ${isOn ? 'เปิดทำงาน (ON)' : 'หยุดพัก (OFF)'}`, 'success');
            }
        } else {
            checkbox.checked = !isOn;
            knownSwitchState[elementId] = !isOn;
            if (dev) updateDeviceIndicator(dev, !isOn);
            updateActiveEquipmentBanner();
            delete switchLocks[elementId];
            showToast(result.message || 'ไม่สามารถส่งคำสั่งได้', 'error');
        }
    } catch (err) {
        checkbox.checked = !isOn;
        knownSwitchState[elementId] = !isOn;
        if (dev) updateDeviceIndicator(dev, !isOn);
        updateActiveEquipmentBanner();
        delete switchLocks[elementId];
        showToast(`ส่งคำสั่งไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
        checkbox.disabled = false;
        if (partnerEl) partnerEl.disabled = false;
    }
}

// ========================================================
// Historical Charts & CSV Export
// ========================================================
function updateStatsLabel(elementId, values, unit) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const nums = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (nums.length === 0) {
        el.innerText = 'ต่ำสุด: -- | เฉลี่ย: -- | สูงสุด: --';
        return;
    }
    const min = Math.min(...nums).toFixed(2);
    const max = Math.max(...nums).toFixed(2);
    const avg = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
    el.innerText = `ต่ำสุด: ${min} ${unit} | เฉลี่ย: ${avg} ${unit} | สูงสุด: ${max} ${unit}`;
}

async function fetchHistory() {
    if (!currentMachine) return;
    const machineAtRequest = currentMachine;

    try {
        const data = await callApi('get_history', { machine_id: machineAtRequest });
        if (machineAtRequest !== currentMachine || !Array.isArray(data)) return;

        const selectedDate = document.getElementById('datePicker').value || localDateKey(new Date());
        const filtered = data
            .filter(d => d.recorded_at && localDateKey(d.recorded_at) === selectedDate)
            .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

        lastHistoryRecords = filtered;

        const countEl = document.getElementById('historyCount');
        if (countEl) countEl.innerText = `ข้อมูลที่บันทึก: ${filtered.length} รายการ`;

        const labels = filtered.map(d => new Date(d.recorded_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }));
        const temps = filtered.map(d => d.temperature);
        const phs = filtered.map(d => d.ph);
        const ecs = filtered.map(d => d.ec);

        updateStatsLabel('tempStats', temps, '°C');
        updateStatsLabel('phStats', phs, 'pH');
        updateStatsLabel('ecStats', ecs, 'mS/cm');

        renderChart('tempChart', 'Temperature (°C)', labels, temps, '#F97316', 'rgba(249, 115, 22, 0.08)');
        renderChart('phChart', 'pH Level', labels, phs, '#0284C7', 'rgba(2, 132, 199, 0.08)');
        renderChart('ecChart', 'EC Level (mS/cm)', labels, ecs, '#10B981', 'rgba(16, 185, 129, 0.08)');
    } catch (err) {
        console.warn('fetchHistory:', err);
    }
}

function exportCsv() {
    if (!currentMachine) {
        showToast('กรุณาเชื่อมต่อเครื่องก่อนส่งออกข้อมูล', 'error');
        return;
    }
    if (!lastHistoryRecords || lastHistoryRecords.length === 0) {
        showToast('ไม่มีข้อมูลในวันที่เลือกสำหรับส่งออก', 'error');
        return;
    }

    const selectedDate = document.getElementById('datePicker').value || localDateKey(new Date());
    const header = ['Machine_ID', 'Timestamp', 'Temperature_C', 'pH_Level', 'EC_mS_cm'];
    const rows = lastHistoryRecords.map(r => [
        currentMachine,
        new Date(r.recorded_at).toLocaleString('th-TH', { hour12: false }),
        r.temperature,
        r.ph,
        r.ec
    ]);

    const csvContent = '\uFEFF' + [header, ...rows].map(e => e.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seameo_${currentMachine}_${selectedDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`ส่งออกไฟล์ CSV สำเร็จ (${lastHistoryRecords.length} รายการ)`, 'success');
}

function renderChart(canvasId, label, labels, dataPoints, borderColor, bgColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    if (charts[canvasId]) charts[canvasId].destroy();

    charts[canvasId] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label,
                data: dataPoints,
                borderColor,
                backgroundColor: bgColor,
                borderWidth: 2,
                pointRadius: dataPoints.length > 80 ? 0 : 2.5,
                pointHoverRadius: 5,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0F172A',
                    titleFont: { family: 'Kanit', size: 11 },
                    bodyFont: { family: 'Bai Jamjuree', size: 12 },
                    padding: 10,
                    cornerRadius: 6
                }
            },
            scales: {
                y: {
                    grid: { color: '#E2E8F0' },
                    ticks: { font: { family: 'Kanit', size: 11 }, color: '#64748B' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Kanit', size: 10 }, color: '#94A3B8', maxTicksLimit: 12 }
                }
            }
        }
    });
}
