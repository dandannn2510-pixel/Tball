// ========================================================
// Smart Sensor & Control Dashboard - Main Application
// ========================================================

let currentMachine = '';
let pollTimer = null;
let historyTimer = null;
let charts = {};
let isLoginMode = true;
let apiBase = null;              // endpoint ที่ใช้งานได้จริง (proxy หรือ GAS ตรง)
let machineNotFoundWarned = false;
const switchLocks = {};          // { elementId: timestamp } กันค่าจาก Sheet ทับสวิตช์ที่เพิ่งกด

const DEVICES = [
    { id: 'motor1Toggle', code: '1', name: 'Motor 1', field: 'motor1_command' },
    { id: 'motor2Toggle', code: '2', name: 'Motor 2', field: 'motor2_command' },
    { id: 'pump1Toggle',  code: '3', name: 'Pump 1',  field: 'pump1_command' },
    { id: 'pump2Toggle',  code: '4', name: 'Pump 2',  field: 'pump2_command' }
];

// ========================================================
// API Layer (ตรวจหา endpoint ที่ใช้ได้อัตโนมัติ)
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
    JSON.parse(text); // GAS ตอบ JSON เสมอ ถ้า parse ไม่ได้ = endpoint นี้ใช้ไม่ได้
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
            console.log('[API] using endpoint:', base);
            return apiBase;
        } catch (err) {
            console.warn('[API] endpoint failed:', base, err);
        }
    }
    throw new Error('ไม่สามารถเชื่อมต่อ Google Sheets ได้ (ตรวจสอบอินเทอร์เน็ต หรือการ Deploy Apps Script)');
}

async function callApi(action, params = {}, method = 'GET') {
    const base = await resolveApiBase();
    const query = new URLSearchParams({ action });
    const options = { method };

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
        console.error('[API] non-JSON response:', text.slice(0, 300));
        apiBase = null; // บังคับตรวจ endpoint ใหม่ครั้งหน้า
        throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (ไม่ใช่ JSON)');
    }
}

// ========================================================
// Init
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
    const datePicker = document.getElementById('datePicker');
    if (datePicker) datePicker.value = localDateKey(new Date());

    const machineInput = document.getElementById('machineIdInput');
    if (machineInput) {
        machineInput.addEventListener('keydown', e => { if (e.key === 'Enter') bindMachine(); });
    }

    checkLoginStatus();
    checkApiStatus();
    if (window.lucide) lucide.createIcons();
});

async function checkApiStatus() {
    const el = document.getElementById('apiStatus');
    if (!el) return;
    el.className = 'mt-5 text-xs text-center text-slate-400';
    el.innerText = '⏳ กำลังตรวจสอบการเชื่อมต่อ Google Sheets...';
    try {
        const base = await resolveApiBase(true);
        el.className = 'mt-5 text-xs text-center text-emerald-600';
        el.innerText = `🟢 เชื่อมต่อ Google Sheets สำเร็จ (${base === CONFIG.PROXY_URL ? 'ผ่าน Server Proxy' : 'ผ่าน Apps Script โดยตรง'})`;
    } catch (err) {
        el.className = 'mt-5 text-xs text-center text-rose-600';
        el.innerHTML = `🔴 ${escapeHtml(err.message)} <button type="button" onclick="checkApiStatus()" class="underline font-semibold ml-1">ลองใหม่</button>`;
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

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const colors = {
        success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        error: 'bg-rose-50 border-rose-200 text-rose-800',
        info: 'bg-indigo-50 border-indigo-200 text-indigo-800'
    };
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto px-4 py-3 rounded-xl shadow-lg border text-sm transition-all duration-300 translate-y-2 opacity-0 ${colors[type] || colors.info}`;
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
        error: 'bg-rose-50 text-rose-700 border-rose-200',
        success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        info: 'bg-indigo-50 text-indigo-700 border-indigo-200'
    };
    box.className = `mb-4 p-3 rounded-xl text-sm border text-center ${styles[type] || styles.error}`;
    box.innerHTML = html;
}

function hideAuthMessage() {
    const box = document.getElementById('authMsgBox');
    if (box) { box.className = 'hidden'; box.innerHTML = ''; }
}

// ========================================================
// Auth (Login / Register / Guest / Logout)
// ========================================================
function checkLoginStatus() {
    const userId = localStorage.getItem('userID');
    const username = localStorage.getItem('username');
    const authScreen = document.getElementById('authScreen');
    const dashboardScreen = document.getElementById('dashboardScreen');

    if (userId && username) {
        authScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        document.getElementById('displayUsername').innerText = username;

        const savedMachine = localStorage.getItem('currentMachine');
        if (savedMachine && savedMachine !== currentMachine) {
            document.getElementById('machineIdInput').value = savedMachine;
            bindMachine(savedMachine, true);
        }
    } else {
        authScreen.classList.remove('hidden');
        dashboardScreen.classList.add('hidden');
    }
    if (window.lucide) lucide.createIcons();
}

function switchAuthTab(mode) {
    isLoginMode = (mode === 'login');
    const active = 'flex-1 py-2 text-sm font-medium rounded-lg transition-all shadow-sm bg-white text-indigo-600';
    const inactive = 'flex-1 py-2 text-sm font-medium rounded-lg transition-all text-slate-500 hover:text-slate-800';

    document.getElementById('authTitle').innerText = isLoginMode ? 'เข้าสู่ระบบ' : 'สมัครสมาชิกใหม่';
    document.getElementById('authSubmitText').innerText = isLoginMode ? 'เข้าสู่ระบบ' : 'ยืนยันการสมัครสมาชิก';
    document.getElementById('authUsernameLabel').innerText = isLoginMode ? 'ชื่อผู้ใช้งาน (Username)' : 'ตั้งชื่อผู้ใช้งานใหม่ (New Username)';
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
    label.innerText = loading ? text : (isLoginMode ? 'เข้าสู่ระบบ' : 'ยืนยันการสมัครสมาชิก');
}

function completeLogin(userId, username) {
    localStorage.setItem('userID', String(userId));
    localStorage.setItem('username', String(username));
    document.getElementById('authUsername').value = '';
    hideAuthMessage();
    showToast(`ยินดีต้อนรับคุณ ${username}`, 'success');
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
            setAuthLoading(true, 'กำลังเข้าสู่ระบบ...');
            const data = await callApi('login_user', { username }, 'POST');

            if (data.status === 'success') {
                completeLogin(data.user_id, data.username);
            } else {
                const msg = escapeHtml(data.message || 'เข้าสู่ระบบไม่สำเร็จ');
                const safeName = escapeHtml(username).replace(/'/g, '&#39;');
                showAuthMessage(
                    `<div>${msg}</div>
                     <button type="button" onclick="registerAndLogin('${safeName}')"
                        class="mt-2 text-indigo-600 hover:text-indigo-800 font-semibold underline text-xs">
                        👉 สมัครสมาชิกด้วยชื่อ "${safeName}" แล้วเข้าสู่ระบบทันที
                     </button>`
                );
            }
        } else {
            await registerAndLogin(username);
        }
    } catch (err) {
        console.error('Auth error:', err);
        showAuthMessage(`เชื่อมต่อไม่สำเร็จ: ${escapeHtml(err.name === 'AbortError' ? 'หมดเวลาการเชื่อมต่อ (Apps Script ตอบช้า) ลองใหม่อีกครั้ง' : err.message)}`);
    } finally {
        setAuthLoading(false);
    }
}

async function registerAndLogin(username) {
    hideAuthMessage();
    setAuthLoading(true, 'กำลังสมัครสมาชิก...');
    try {
        const reg = await callApi('register_user', { username }, 'POST');
        // ถ้าชื่อซ้ำ ก็ลองเข้าสู่ระบบด้วยชื่อนั้นต่อเลย
        if (reg.status !== 'success' && !(reg.message || '').includes('มีคนใช้แล้ว')) {
            showAuthMessage(escapeHtml(reg.message || 'สมัครสมาชิกไม่สำเร็จ'));
            return;
        }

        setAuthLoading(true, 'กำลังเข้าสู่ระบบ...');
        const login = await callApi('login_user', { username }, 'POST');
        if (login.status === 'success') {
            completeLogin(login.user_id, login.username);
        } else {
            isLoginMode = true;
            switchAuthTab('login');
            showAuthMessage('สมัครสมาชิกสำเร็จ! กรุณากด "เข้าสู่ระบบ" อีกครั้ง', 'success');
        }
    } catch (err) {
        console.error('Register error:', err);
        showAuthMessage(`เชื่อมต่อไม่สำเร็จ: ${escapeHtml(err.message)}`);
    } finally {
        setAuthLoading(false);
    }
}

function quickGuestLogin() {
    const guestUser = 'Guest_' + Math.floor(1000 + Math.random() * 9000);
    completeLogin('guest', guestUser);
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
// Machine Connection & Registration
// ========================================================
function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (historyTimer) clearInterval(historyTimer);
    pollTimer = null;
    historyTimer = null;
}

function resetDashboard() {
    ['tempCurrent', 'phCurrent', 'ecCurrent'].forEach(id => document.getElementById(id).innerText = '--');
    ['tempStatus', 'phStatus', 'ecStatus'].forEach(id => updateBadge(id, evaluateStatus('', null)));
    DEVICES.forEach(d => document.getElementById(d.id).checked = false);
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
    const lu = document.getElementById('lastUpdated');
    if (lu) lu.innerText = 'ยังไม่ได้เชื่อมต่อเครื่อง';
}

function bindMachine(targetId, silent = false) {
    const input = document.getElementById('machineIdInput');
    const machineId = String(targetId || input.value || '').trim();

    if (!machineId) {
        showToast('กรุณากรอก Machine ID', 'error');
        return;
    }

    stopPolling();
    resetDashboard();
    currentMachine = machineId;
    machineNotFoundWarned = false;
    localStorage.setItem('currentMachine', currentMachine);

    const badge = document.getElementById('connectionBadge');
    badge.innerText = `กำลังเชื่อมต่อ ${currentMachine}...`;
    badge.className = 'px-2.5 py-1 text-xs rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200 inline-block';

    if (!silent) showToast(`กำลังดึงข้อมูลจาก ${currentMachine}...`, 'info');

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
            user_id: localStorage.getItem('userID') || ''
        }, 'POST');

        if (data.status === 'success') {
            showToast(`เพิ่ม Machine ID "${newId}" สำเร็จ!`, 'success');
        } else {
            showToast(data.message || 'ไม่สามารถเพิ่ม Machine ID ได้', 'error');
            if (!(data.message || '').includes('ลงทะเบียนไปแล้ว')) return;
        }
        // เพิ่มสำเร็จ หรือมีอยู่แล้ว -> เชื่อมต่อเลย
        closeAddMachineModal();
        document.getElementById('machineIdInput').value = newId;
        bindMachine(newId, true);
    } catch (err) {
        console.error('Add machine error:', err);
        showToast(`เชื่อมต่อไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ========================================================
// Real-time Data & Status
// ========================================================
function evaluateStatus(type, value) {
    const none = { text: 'รอข้อมูล', badgeClass: 'bg-slate-100 text-slate-500' };
    if (value === null || value === undefined || value === '' || isNaN(parseFloat(value))) return none;

    const num = parseFloat(value);
    const th = CONFIG.THRESHOLDS;
    const danger = { text: 'อันตราย', badgeClass: 'bg-rose-100 text-rose-700 font-semibold' };
    const risky = { text: 'เสี่ยง', badgeClass: 'bg-amber-100 text-amber-700 font-semibold' };
    const safe = { text: 'ปลอดภัย', badgeClass: 'bg-emerald-100 text-emerald-700 font-semibold' };

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
    el.className = `px-3 py-1 rounded-full text-xs transition-colors duration-200 ${stat.badgeClass}`;
}

async function fetchCurrentData() {
    if (!currentMachine) return;
    const machineAtRequest = currentMachine;

    try {
        const data = await callApi('get_current', { machine_id: machineAtRequest });
        if (machineAtRequest !== currentMachine) return; // ผู้ใช้เปลี่ยนเครื่องระหว่างรอ

        const badge = document.getElementById('connectionBadge');

        if (!data || Object.keys(data).length === 0 || data.status === 'error') {
            badge.innerText = `ไม่พบ ${currentMachine}`;
            badge.className = 'px-2.5 py-1 text-xs rounded-full font-medium bg-rose-50 text-rose-700 border border-rose-200 inline-block';
            if (!machineNotFoundWarned) {
                machineNotFoundWarned = true;
                showToast(`ไม่พบ Machine ID "${currentMachine}" ในระบบ กด "+ เพิ่ม Machine ID" เพื่อลงทะเบียน`, 'error');
            }
            return;
        }

        badge.innerText = `เชื่อมต่อกับ ${currentMachine}`;
        badge.className = 'px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block';

        document.getElementById('tempCurrent').innerText = formatNumber(data.current_temp);
        document.getElementById('phCurrent').innerText = formatNumber(data.current_ph);
        document.getElementById('ecCurrent').innerText = formatNumber(data.current_ec);

        updateBadge('tempStatus', evaluateStatus('temp', data.current_temp));
        updateBadge('phStatus', evaluateStatus('ph', data.current_ph));
        updateBadge('ecStatus', evaluateStatus('ec', data.current_ec));

        syncSwitchesWithServer(data);

        const lu = document.getElementById('lastUpdated');
        if (lu) lu.innerText = `อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH')}`;
    } catch (err) {
        console.warn('fetchCurrentData:', err);
        const lu = document.getElementById('lastUpdated');
        if (lu) lu.innerText = '⚠️ ดึงข้อมูลไม่สำเร็จ กำลังลองใหม่...';
    }
}

function syncSwitchesWithServer(data) {
    const now = Date.now();
    DEVICES.forEach(dev => {
        if (switchLocks[dev.id] && now - switchLocks[dev.id] < CONFIG.SWITCH_LOCK_MS) return;
        const el = document.getElementById(dev.id);
        if (el && data[dev.field] !== undefined) {
            el.checked = String(data[dev.field]) === dev.code;
        }
    });
}

// ========================================================
// Device Controls (Relay Switch)
// ========================================================
async function toggleDevice(elementId, onCommandCode) {
    const checkbox = document.getElementById(elementId);
    const dev = DEVICES.find(d => d.id === elementId);

    if (!currentMachine) {
        checkbox.checked = !checkbox.checked;
        showToast('กรุณาเชื่อมต่อ Machine ID ก่อนสั่งงาน', 'error');
        return;
    }

    const isOn = checkbox.checked;
    switchLocks[elementId] = Date.now();
    checkbox.disabled = true;

    try {
        const result = await callApi('set_device_command', {
            machine_id: currentMachine,
            command: isOn ? onCommandCode : '0',
            device_type: onCommandCode
        }, 'POST');

        if (result.status === 'success') {
            switchLocks[elementId] = Date.now();
            showToast(`${dev ? dev.name : 'อุปกรณ์'}: ${isOn ? 'เปิด (ON)' : 'ปิด (OFF)'}`, 'success');
        } else {
            checkbox.checked = !isOn;
            delete switchLocks[elementId];
            showToast(result.message || 'สั่งงานไม่สำเร็จ', 'error');
        }
    } catch (err) {
        console.error('toggleDevice:', err);
        checkbox.checked = !isOn;
        delete switchLocks[elementId];
        showToast(`ส่งคำสั่งไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
        checkbox.disabled = false;
    }
}

// ========================================================
// History & Charts
// ========================================================
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

        const labels = filtered.map(d => new Date(d.recorded_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));

        renderChart('tempChart', 'Temperature (°C)', labels, filtered.map(d => d.temperature), '#EF4444', 'rgba(239, 68, 68, 0.1)');
        renderChart('phChart', 'pH Level', labels, filtered.map(d => d.ph), '#3B82F6', 'rgba(59, 130, 246, 0.1)');
        renderChart('ecChart', 'EC Level (mS/cm)', labels, filtered.map(d => d.ec), '#10B981', 'rgba(16, 185, 129, 0.1)');
    } catch (err) {
        console.warn('fetchHistory:', err);
    }
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
                borderWidth: 2.5,
                pointRadius: dataPoints.length > 100 ? 0 : 3,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: { family: 'Prompt', size: 12 },
                    bodyFont: { family: 'Prompt', size: 13 },
                    padding: 10,
                    cornerRadius: 8
                }
            },
            scales: {
                y: { grid: { color: 'rgba(226, 232, 240, 0.6)' }, ticks: { font: { family: 'Prompt', size: 11 }, color: '#64748B' } },
                x: { grid: { display: false }, ticks: { font: { family: 'Prompt', size: 11 }, color: '#64748B', maxTicksLimit: 12 } }
            }
        }
    });
}
