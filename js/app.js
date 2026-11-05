// ========================================================
// Main Application Logic
// ========================================================

let currentMachine = '';
let pollInterval = null;
let charts = {};
let isLoginMode = true;
let isUpdatingSwitchesFromServer = false;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Set default date picker to today
    const datePicker = document.getElementById('datePicker');
    if (datePicker) {
        datePicker.valueAsDate = new Date();
    }

    // Check existing session
    checkLoginStatus();

    // Re-initialize lucide icons
    if (window.lucide) {
        lucide.createIcons();
    }
});

// ========================================================
// Toast Notification System
// ========================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm transition-all duration-300 transform translate-y-2 opacity-0`;
    
    if (type === 'success') {
        toast.className += ' bg-emerald-50 border-emerald-200 text-emerald-800';
    } else if (type === 'error') {
        toast.className += ' bg-rose-50 border-rose-200 text-rose-800';
    } else {
        toast.className += ' bg-indigo-50 border-indigo-200 text-indigo-800';
    }

    toast.innerText = message;
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    });

    // Auto dismiss after 3.5s
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ========================================================
// Auth Logic (Login / Register / Logout)
// ========================================================
function checkLoginStatus() {
    const activeUserId = localStorage.getItem("userID");
    const activeUsername = localStorage.getItem("username");
    
    const authScreen = document.getElementById("authScreen");
    const dashboardScreen = document.getElementById("dashboardScreen");

    if (activeUserId && activeUsername) {
        authScreen.classList.add("hidden");
        dashboardScreen.classList.remove("hidden");
        document.getElementById("displayUsername").innerText = activeUsername;

        // Restore saved machine if available
        const savedMachine = localStorage.getItem("currentMachine");
        if (savedMachine) {
            document.getElementById('machineIdInput').value = savedMachine;
            bindMachine(savedMachine);
        }
    } else {
        authScreen.classList.remove("hidden");
        dashboardScreen.classList.add("hidden");
    }

    if (window.lucide) lucide.createIcons();
}

function switchAuthTab(mode) {
    isLoginMode = (mode === 'login');
    const authTitle = document.getElementById('authTitle');
    const authSubmitText = document.getElementById('authSubmitText');
    const authUsernameLabel = document.getElementById('authUsernameLabel');
    const authMsgBox = document.getElementById('authMsgBox');
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');

    if (isLoginMode) {
        authTitle.innerText = "เข้าสู่ระบบ";
        authSubmitText.innerText = "เข้าสู่ระบบ";
        if (authUsernameLabel) authUsernameLabel.innerText = "ชื่อผู้ใช้งาน (Username)";
        tabLogin.className = "flex-1 py-2 text-sm font-medium rounded-lg transition-all shadow-sm bg-white text-indigo-600";
        tabRegister.className = "flex-1 py-2 text-sm font-medium rounded-lg transition-all text-slate-500 hover:text-slate-800";
    } else {
        authTitle.innerText = "สมัครสมาชิกใหม่";
        authSubmitText.innerText = "ยืนยันการสมัครสมาชิก";
        if (authUsernameLabel) authUsernameLabel.innerText = "ตั้งชื่อผู้ใช้งานใหม่ (New Username)";
        tabRegister.className = "flex-1 py-2 text-sm font-medium rounded-lg transition-all shadow-sm bg-white text-indigo-600";
        tabLogin.className = "flex-1 py-2 text-sm font-medium rounded-lg transition-all text-slate-500 hover:text-slate-800";
    }

    authMsgBox.classList.add('hidden');
    authMsgBox.innerHTML = "";
    if (window.lucide) lucide.createIcons();
}

function quickGuestLogin() {
    const guestUser = "Guest_" + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem("userID", "9999");
    localStorage.setItem("username", guestUser);
    showToast(`เข้าสู่ระบบในโหมดด่วน (${guestUser})`, 'success');
    checkLoginStatus();
}

function toggleAuthMode() {
    switchAuthTab(isLoginMode ? 'register' : 'login');
}

async function handleAuth(event) {
    if (event) event.preventDefault();

    const usernameInput = document.getElementById('authUsername');
    const username = usernameInput.value.trim();
    if (!username) return;

    const action = isLoginMode ? "login_user" : "register_user";
    const submitBtn = document.getElementById('authSubmitBtn');
    const submitText = document.getElementById('authSubmitText');
    const authMsgBox = document.getElementById('authMsgBox');

    const originalText = submitText.innerText;
    submitText.innerText = "กำลังประมวลผล...";
    submitBtn.disabled = true;
    authMsgBox.classList.add('hidden');

    try {
        const params = new URLSearchParams();
        params.append("username", username);

        const res = await fetch(`${CONFIG.API_URL}?action=${action}`, {
            method: 'POST',
            body: params
        });
        const data = await res.json();

        if (data.status === "success") {
            if (isLoginMode) {
                localStorage.setItem("userID", data.user_id);
                localStorage.setItem("username", data.username);
                showToast(`ยินดีต้อนรับคุณ ${data.username}`, 'success');
                usernameInput.value = "";
                checkLoginStatus();
            } else {
                showToast("สมัครสมาชิกสำเร็จ! กำลังเข้าสู่ระบบให้อัตโนมัติ...", 'success');
                // Automatically switch to login and attempt login
                isLoginMode = true;
                const loginParams = new URLSearchParams();
                loginParams.append("username", username);
                try {
                    const loginRes = await fetch(`${CONFIG.API_URL}?action=login_user`, {
                        method: 'POST',
                        body: loginParams
                    });
                    const loginData = await loginRes.json();
                    if (loginData.status === "success") {
                        localStorage.setItem("userID", loginData.user_id);
                        localStorage.setItem("username", loginData.username);
                        checkLoginStatus();
                        return;
                    }
                } catch(e) {}
                switchAuthTab('login');
                authMsgBox.className = "mb-4 p-3 rounded-xl text-sm border bg-emerald-50 text-emerald-700 border-emerald-200 text-center";
                authMsgBox.innerText = `สมัครสมาชิกสำเร็จ! กรุณากด "เข้าสู่ระบบ" ได้เลย`;
                authMsgBox.classList.remove('hidden');
            }
        } else {
            authMsgBox.className = "mb-4 p-3 rounded-xl text-sm border bg-rose-50 text-rose-700 border-rose-200 text-center";
            if (isLoginMode && (data.message && data.message.includes('ไม่พบ'))) {
                authMsgBox.innerHTML = `<div>${data.message}</div><button type="button" onclick="switchAuthTab('register')" class="mt-2 text-indigo-600 hover:text-indigo-800 font-semibold underline text-xs block mx-auto">👉 คลิกที่นี่เพื่อสมัครสมาชิกด้วยชื่อ "${username}" ทันที</button>`;
            } else {
                authMsgBox.innerText = data.message || "เกิดข้อผิดพลาดในการดำเนินการ";
            }
            authMsgBox.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Auth error:", err);
        authMsgBox.innerText = "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง";
        authMsgBox.classList.remove('hidden');
    } finally {
        submitText.innerText = originalText;
        submitBtn.disabled = false;
    }
}

function logout() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    currentMachine = '';
    
    localStorage.removeItem("userID");
    localStorage.removeItem("username");
    localStorage.removeItem("currentMachine");

    const input = document.getElementById('machineIdInput');
    if (input) input.value = '';

    showToast("ออกจากระบบเรียบร้อยแล้ว", 'info');
    checkLoginStatus();
}

// ========================================================
// Machine Connection & Registration
// ========================================================
function bindMachine(targetId) {
    const input = document.getElementById('machineIdInput');
    const machineId = (targetId || (input ? input.value : '')).trim();

    if (!machineId) {
        showToast('กรุณากรอก Machine ID', 'error');
        return;
    }

    currentMachine = machineId;
    localStorage.setItem("currentMachine", currentMachine);

    // Update connection badge
    const badge = document.getElementById('connectionBadge');
    if (badge) {
        badge.innerText = `เชื่อมต่อกับ ${currentMachine}`;
        badge.className = 'px-2.5 py-1 text-xs rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block';
    }

    showToast(`กำลังดึงข้อมูลจาก ${currentMachine}...`, 'info');

    // Fetch history and current
    fetchCurrentData();
    fetchHistory();

    // Start polling
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(fetchCurrentData, CONFIG.POLL_INTERVAL_MS);
}

function openAddMachineModal() {
    const modal = document.getElementById('addMachineModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeAddMachineModal() {
    const modal = document.getElementById('addMachineModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.getElementById('newMachineIdInput').value = '';
    }
}

async function submitNewMachine(event) {
    if (event) event.preventDefault();

    const newIdInput = document.getElementById("newMachineIdInput");
    const newId = newIdInput.value.trim();
    const activeUserId = localStorage.getItem("userID");

    if (!newId) return;

    const btn = document.getElementById('addMachineBtn');
    const originalText = btn.innerText;
    btn.innerText = "กำลังบันทึก...";
    btn.disabled = true;

    try {
        const params = new URLSearchParams();
        params.append("machine_id", newId);
        params.append("user_id", activeUserId);

        const res = await fetch(`${CONFIG.API_URL}?action=add_machine`, {
            method: 'POST',
            body: params
        });
        const data = await res.json();

        if (data.status === "success") {
            showToast(`เพิ่ม Machine ID "${newId}" สำเร็จ!`, 'success');
            closeAddMachineModal();
            document.getElementById('machineIdInput').value = newId;
            bindMachine(newId);
        } else {
            showToast(data.message || "ไม่สามารถเพิ่ม Machine ID ได้", 'error');
        }
    } catch (err) {
        console.error("Add machine error:", err);
        showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ========================================================
// Real-time Data Polling & Status Evaluation
// ========================================================
function evaluateStatus(type, value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) {
        return { text: 'รอข้อมูล', badgeClass: 'bg-slate-100 text-slate-500' };
    }
    const num = parseFloat(value);
    const th = CONFIG.THRESHOLDS;

    if (type === 'temp') {
        if (num > th.temp.danger) return { text: 'อันตราย', badgeClass: 'bg-rose-100 text-rose-700 font-semibold' };
        if (num >= th.temp.risky) return { text: 'เสี่ยง', badgeClass: 'bg-amber-100 text-amber-700 font-semibold' };
        return { text: 'ปลอดภัย', badgeClass: 'bg-emerald-100 text-emerald-700 font-semibold' };
    }
    if (type === 'ph') {
        if (num < th.ph.dangerMin || num > th.ph.dangerMax) return { text: 'อันตราย', badgeClass: 'bg-rose-100 text-rose-700 font-semibold' };
        if (num < th.ph.riskyMin || num > th.ph.riskyMax) return { text: 'เสี่ยง', badgeClass: 'bg-amber-100 text-amber-700 font-semibold' };
        return { text: 'ปลอดภัย', badgeClass: 'bg-emerald-100 text-emerald-700 font-semibold' };
    }
    if (type === 'ec') {
        if (num > th.ec.danger) return { text: 'อันตราย', badgeClass: 'bg-rose-100 text-rose-700 font-semibold' };
        if (num > th.ec.risky) return { text: 'เสี่ยง', badgeClass: 'bg-amber-100 text-amber-700 font-semibold' };
        return { text: 'ปลอดภัย', badgeClass: 'bg-emerald-100 text-emerald-700 font-semibold' };
    }
    return { text: 'รอข้อมูล', badgeClass: 'bg-slate-100 text-slate-500' };
}

async function fetchCurrentData() {
    if (!currentMachine) return;

    try {
        const res = await fetch(`${CONFIG.API_URL}?action=get_current&machine_id=${encodeURIComponent(currentMachine)}`);
        const data = await res.json();

        if (data && Object.keys(data).length > 0) {
            // Update sensor readings
            const tempVal = (data.current_temp !== '' && data.current_temp !== undefined) ? parseFloat(data.current_temp).toFixed(2) : '--';
            const phVal = (data.current_ph !== '' && data.current_ph !== undefined) ? parseFloat(data.current_ph).toFixed(2) : '--';
            const ecVal = (data.current_ec !== '' && data.current_ec !== undefined) ? parseFloat(data.current_ec).toFixed(2) : '--';

            document.getElementById('tempCurrent').innerText = tempVal;
            document.getElementById('phCurrent').innerText = phVal;
            document.getElementById('ecCurrent').innerText = ecVal;

            // Update status badges
            const tStat = evaluateStatus('temp', data.current_temp);
            const pStat = evaluateStatus('ph', data.current_ph);
            const eStat = evaluateStatus('ec', data.current_ec);

            updateBadge('tempStatus', tStat);
            updateBadge('phStatus', pStat);
            updateBadge('ecStatus', eStat);

            // Sync hardware switches with server state
            syncSwitchesWithServer(data);
        }
    } catch (err) {
        console.warn("fetchCurrentData warning:", err);
    }
}

function updateBadge(id, stat) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = stat.text;
    el.className = `px-3 py-1 rounded-full text-xs transition-colors duration-200 ${stat.badgeClass}`;
}

// Sync switches safely without triggering duplicate network requests
function syncSwitchesWithServer(data) {
    isUpdatingSwitchesFromServer = true;

    const m1 = document.getElementById('motor1Toggle');
    const m2 = document.getElementById('motor2Toggle');
    const p1 = document.getElementById('pump1Toggle');
    const p2 = document.getElementById('pump2Toggle');

    if (m1 && data.motor1_command !== undefined) m1.checked = (String(data.motor1_command) === '1');
    if (m2 && data.motor2_command !== undefined) m2.checked = (String(data.motor2_command) === '2');
    if (p1 && data.pump1_command !== undefined) p1.checked = (String(data.pump1_command) === '3');
    if (p2 && data.pump2_command !== undefined) p2.checked = (String(data.pump2_command) === '4');

    isUpdatingSwitchesFromServer = false;
}

// ========================================================
// Device Hardware Controls (Relay Switch)
// ========================================================
async function toggleDevice(elementId, onCommandCode) {
    if (isUpdatingSwitchesFromServer) return;

    const checkbox = document.getElementById(elementId);
    if (!currentMachine) {
        checkbox.checked = !checkbox.checked;
        showToast('กรุณาเชื่อมต่อ Machine ID ก่อนสั่งงาน', 'error');
        return;
    }

    const isChecked = checkbox.checked;
    const command = isChecked ? onCommandCode : "0";

    const params = new URLSearchParams();
    params.append('machine_id', currentMachine);
    params.append('command', command);
    params.append('device_type', onCommandCode);

    try {
        const res = await fetch(`${CONFIG.API_URL}?action=set_device_command`, {
            method: 'POST',
            body: params
        });
        const result = await res.json();
        
        if (result.status === "success") {
            const devName = onCommandCode === '1' ? 'Motor 1' : onCommandCode === '2' ? 'Motor 2' : onCommandCode === '3' ? 'Pump 1' : 'Pump 2';
            showToast(`${devName}: ${isChecked ? 'เปิด (ON)' : 'ปิด (OFF)'}`, 'info');
        }
    } catch (err) {
        console.error("Error sending device command:", err);
        showToast('เกิดข้อผิดพลาดในการส่งคำสั่งไปยังอุปกรณ์', 'error');
    }
}

// ========================================================
// History & Chart.js Rendering
// ========================================================
async function fetchHistory() {
    if (!currentMachine) return;

    try {
        const res = await fetch(`${CONFIG.API_URL}?action=get_history&machine_id=${encodeURIComponent(currentMachine)}`);
        const data = await res.json();

        if (!Array.isArray(data)) return;

        const datePicker = document.getElementById('datePicker');
        const selectedDate = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];

        const filteredData = data.filter(d => {
            if (!d.recorded_at) return false;
            const dDate = new Date(d.recorded_at).toISOString().split('T')[0];
            return dDate === selectedDate;
        });

        const labels = filteredData.map(d => {
            const dt = new Date(d.recorded_at);
            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        });

        const temps = filteredData.map(d => d.temperature);
        const phs = filteredData.map(d => d.ph);
        const ecs = filteredData.map(d => d.ec);

        renderChart('tempChart', 'Temperature (°C)', labels, temps, '#EF4444', 'rgba(239, 68, 68, 0.1)');
        renderChart('phChart', 'pH Level', labels, phs, '#3B82F6', 'rgba(59, 130, 246, 0.1)');
        renderChart('ecChart', 'EC Level (mS/cm)', labels, ecs, '#10B981', 'rgba(16, 185, 129, 0.1)');
    } catch (err) {
        console.warn("fetchHistory error:", err);
    }
}

function renderChart(canvasId, label, labels, dataPoints, borderColor, bgColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: dataPoints,
                borderColor: borderColor,
                backgroundColor: bgColor,
                borderWidth: 2.5,
                pointRadius: 3,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
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
                y: {
                    grid: { color: 'rgba(226, 232, 240, 0.6)' },
                    ticks: { font: { family: 'Prompt', size: 11 }, color: '#64748B' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Prompt', size: 11 }, color: '#64748B' }
                }
            }
        }
    });
}

