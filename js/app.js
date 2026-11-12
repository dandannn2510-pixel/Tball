// ========================================================
// SEAMEO — Temp, pH, EC = Cycle Count, Volume = Count * 100L, Daily Chart
// ========================================================

let currentMachine = '';
let pollTimer = null;
let historyTimer = null;
let charts = {};
let isLoginMode = true;
let apiBase = null;
let machineNotFoundWarned = false;
let lastHistoryRecords = [];
let allHistoryRecords = [];
let currentEcCycles = null;

const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('seameo_monitor_sync') : null;

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

document.addEventListener('DOMContentLoaded', () => {
    const datePicker = document.getElementById('datePicker');
    if (datePicker) datePicker.value = localDateKey(new Date());

    const machineInput = document.getElementById('machineIdInput');
    if (machineInput) {
        machineInput.addEventListener('keydown', e => { if (e.key === 'Enter') bindMachine(); });
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentMachine) {
            fetchCurrentData();
            fetchHistory();
        }
    });

    if (syncChannel) {
        syncChannel.onmessage = (ev) => {
            const msg = ev.data;
            if (!msg) return;
            if (msg.type === 'MACHINE_CHANGED' && msg.machineId && msg.machineId !== currentMachine) {
                document.getElementById('machineIdInput').value = msg.machineId;
                bindMachine(msg.machineId, true);
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
    el.innerHTML = `<span class="led-dot led-standby"></span><span>กำลังตรวจสอบฐานข้อมูล...</span>`;
    try {
        await resolveApiBase(true);
        el.className = 'text-xs text-emerald-700 font-semibold flex items-center gap-2';
        el.innerHTML = `<span class="led-dot led-online"></span><span>เชื่อมต่อฐานข้อมูลพร้อมใช้งาน</span>`;
    } catch (err) {
        el.className = 'text-xs text-rose-600 flex items-center gap-2';
        el.innerHTML = `<span class="led-dot led-error"></span><span>${escapeHtml(err.message)}</span> <button type="button" onclick="checkApiStatus()" class="underline font-semibold ml-1">ลองใหม่</button>`;
    }
}

function localDateKey(dateInput) {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatThaiDateLabel(dateKey) {
    if (!dateKey) return '';
    const parts = dateKey.split('-');
    if (parts.length !== 3) return dateKey;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateKey;
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatNumber(value) {
    if (value === '' || value === null || value === undefined || isNaN(parseFloat(value))) return '--';
    return parseFloat(value).toFixed(2);
}

function parseCycleCount(rawVal) {
    if (rawVal === '' || rawVal === null || rawVal === undefined) return null;
    const num = parseFloat(rawVal);
    if (isNaN(num) || num < 0) return null;
    return Number.isInteger(num) ? num : Number(num.toFixed(2));
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

function getDailyRoundsStorageKey(machineId) {
    return `seameo_daily_rounds_map_${machineId}`;
}

function getStoredDailyRoundsMap(machineId) {
    if (!machineId) return {};
    try {
        const raw = localStorage.getItem(getDailyRoundsStorageKey(machineId));
        return raw ? JSON.parse(raw) : {};
    } catch (_) {
        return {};
    }
}

function saveDailyRoundForDate(machineId, dateKey, cycles) {
    if (!machineId || !dateKey || cycles === null || isNaN(cycles)) return;
    const map = getStoredDailyRoundsMap(machineId);
    map[dateKey] = cycles;
    try {
        localStorage.setItem(getDailyRoundsStorageKey(machineId), JSON.stringify(map));
    } catch (_) {}
}

function updateCycleAndVolumeCard(rawEcValue) {
    const countEl = document.getElementById('cycleCountCurrent');
    const volEl = document.getElementById('volumeCurrent');
    const badgeEl = document.getElementById('cycleStatusBadge');
    const formulaEl = document.getElementById('volumeFormulaText');
    const barEl = document.getElementById('cycleBarFill');
    const timeEl = document.getElementById('lastCycleTime');

    const cycles = parseCycleCount(rawEcValue);
    currentEcCycles = cycles;

    if (cycles === null) {
        if (countEl) countEl.innerText = '--';
        if (volEl) volEl.innerText = '--';
        if (badgeEl) {
            badgeEl.innerText = 'รอข้อมูล';
            badgeEl.className = 'px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-500 shrink-0';
        }
        if (formulaEl) formulaEl.innerText = 'สูตรคำนวณ: จำนวนครั้ง × 100 ลิตร';
        if (barEl) barEl.style.width = '0%';
        return;
    }

    const volumeLiters = cycles * CONFIG.LITERS_PER_CYCLE;
    const todayKey = localDateKey(new Date());
    saveDailyRoundForDate(currentMachine, todayKey, cycles);

    if (countEl) countEl.innerText = cycles.toLocaleString('th-TH');
    if (volEl) volEl.innerText = volumeLiters.toLocaleString('th-TH');
    if (timeEl) timeEl.innerText = new Date().toLocaleTimeString('th-TH', { hour12: false });
    if (formulaEl) {
        formulaEl.innerText = `${cycles.toLocaleString('th-TH')} ครั้ง × 100 = ${volumeLiters.toLocaleString('th-TH')} ลิตร`;
    }
    if (badgeEl) {
        badgeEl.innerText = cycles > 0 ? `ทำงานแล้ว ${cycles.toLocaleString('th-TH')} ครั้ง` : '0 ครั้ง (พร้อมทำงาน)';
        badgeEl.className = cycles > 0
            ? 'px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0'
            : 'px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-600 shrink-0';
    }

    const maxScale = Math.max(20, Math.ceil((cycles || 1) / 20) * 20);
    const pct = Math.max(0, Math.min(100, (cycles / maxScale) * 100));
    if (barEl) barEl.style.width = `${pct.toFixed(1)}%`;

    renderDailyRoundsChartAndTable();
}

function buildDailyRoundsSeries() {
    const byDate = {};

    const storedMap = getStoredDailyRoundsMap(currentMachine);
    Object.entries(storedMap).forEach(([dKey, val]) => {
        const c = parseCycleCount(val);
        if (c !== null) byDate[dKey] = c;
    });

    if (Array.isArray(allHistoryRecords)) {
        const rowsByDate = {};
        allHistoryRecords.forEach(r => {
            if (!r.recorded_at) return;
            const dKey = localDateKey(r.recorded_at);
            if (!dKey) return;
            if (!rowsByDate[dKey]) rowsByDate[dKey] = [];
            rowsByDate[dKey].push(r);
        });

        Object.entries(rowsByDate).forEach(([dKey, rows]) => {
            const ecNums = rows
                .map(r => parseCycleCount(r.ec ?? r.water_level ?? r.level))
                .filter(v => v !== null && v > 0);
            let dayRounds = 0;
            if (ecNums.length > 0) {
                dayRounds = Math.max(...ecNums);
            } else {
                dayRounds = rows.length;
            }
            byDate[dKey] = Math.max(byDate[dKey] || 0, dayRounds);
        });
    }

    const todayKey = localDateKey(new Date());
    if (currentEcCycles !== null) {
        byDate[todayKey] = currentEcCycles;
    } else if (byDate[todayKey] === undefined) {
        byDate[todayKey] = 0;
    }

    const sortedDates = Object.keys(byDate).sort();
    return sortedDates.map(dKey => {
        const rounds = byDate[dKey] || 0;
        return {
            dateKey: dKey,
            label: `${formatThaiDateLabel(dKey)}${dKey === todayKey ? ' (วันนี้)' : ''}`,
            rounds,
            liters: rounds * CONFIG.LITERS_PER_CYCLE
        };
    });
}

function renderDailyRoundsChartAndTable() {
    const series = buildDailyRoundsSeries();
    const todayKey = localDateKey(new Date());
    const todayEntry = series.find(s => s.dateKey === todayKey) || { rounds: 0, liters: 0 };

    const statsEl = document.getElementById('dailySummaryStats');
    if (statsEl) {
        const totalAllDaysRounds = series.reduce((acc, s) => acc + s.rounds, 0);
        const totalAllDaysLiters = totalAllDaysRounds * CONFIG.LITERS_PER_CYCLE;
        statsEl.innerText = `วันนี้: ${todayEntry.rounds.toLocaleString('th-TH')} ครั้ง (${todayEntry.liters.toLocaleString('th-TH')} ลิตร) | สะสมทุกวัน: ${totalAllDaysRounds.toLocaleString('th-TH')} ครั้ง (${totalAllDaysLiters.toLocaleString('th-TH')} ลิตร)`;
    }

    const tbody = document.getElementById('dailyRoundsTableBody');
    if (tbody) {
        if (series.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="py-4 px-4 text-center text-slate-400">ยังไม่มีข้อมูลรายวัน</td></tr>';
        } else {
            tbody.innerHTML = [...series].reverse().map(item => {
                const isToday = item.dateKey === todayKey;
                return `<tr class="${isToday ? 'bg-teal-50/60 font-semibold text-slate-900' : 'text-slate-700'}">` +
                    `<td class="py-2.5 px-4">${escapeHtml(item.label)}</td>` +
                    `<td class="py-2.5 px-4 text-right text-emerald-700 font-bold">${item.rounds.toLocaleString('th-TH')} ครั้ง</td>` +
                    `<td class="py-2.5 px-4 text-right text-teal-700 font-bold">${item.liters.toLocaleString('th-TH')} ลิตร</td>` +
                    `</tr>`;
            }).join('');
        }
    }

    const canvas = document.getElementById('levelChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (charts['levelChart']) charts['levelChart'].destroy();

    charts['levelChart'] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: series.map(s => s.label),
            datasets: [
                {
                    label: 'จำนวนรอบต่อวัน (ครั้ง)',
                    data: series.map(s => s.rounds),
                    backgroundColor: 'rgba(13, 148, 136, 0.75)',
                    borderColor: '#0D9488',
                    borderWidth: 2,
                    borderRadius: 8,
                    maxBarThickness: 56
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0F172A',
                    titleFont: { family: 'Kanit', size: 12 },
                    bodyFont: { family: 'Prompt', size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function (ctx) {
                            const rounds = Number(ctx.raw) || 0;
                            const liters = rounds * CONFIG.LITERS_PER_CYCLE;
                            return [
                                `จำนวนการทำงาน: ${rounds.toLocaleString('th-TH')} ครั้ง (รอบ)`,
                                `ปริมาตรน้ำที่ได้: ${liters.toLocaleString('th-TH')} ลิตร`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#E2E8F0' },
                    ticks: {
                        font: { family: 'Kanit', size: 11 },
                        color: '#64748B',
                        precision: 0,
                        callback: function (val) {
                            return `${val} ครั้ง (${val * CONFIG.LITERS_PER_CYCLE} L)`;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Kanit', size: 11 }, color: '#334155' }
                }
            }
        }
    });
}

async function autoConnectSharedMachine() {
    let targetMachine = localStorage.getItem('currentMachine') || '';
    try {
        const syncInfo = await callApi('get_sync_state');
        if (syncInfo && syncInfo.active_machine_id && !targetMachine) {
            targetMachine = syncInfo.active_machine_id;
        }
    } catch (_) {}
    if (!targetMachine) targetMachine = CONFIG.DEFAULT_MACHINE_ID || '00002';
    const input = document.getElementById('machineIdInput');
    if (input) input.value = targetMachine;
    if (targetMachine !== currentMachine) bindMachine(targetMachine, true);
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
    const active = 'pb-3 pr-6 text-sm font-bold border-b-2 border-sky-600 text-sky-700 transition-all';
    const inactive = 'pb-3 px-6 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-700 transition-all';
    document.getElementById('authTitle').innerText = isLoginMode ? 'เข้าสู่หน้าแสดงผลข้อมูล' : 'สมัครสมาชิกผู้ใช้งานใหม่';
    document.getElementById('authSubmitText').innerText = isLoginMode ? 'เข้าสู่หน้าจอแสดงผล' : 'ยืนยันการสมัครสมาชิก';
    document.getElementById('authUsernameLabel').innerText = isLoginMode ? 'ชื่อผู้ใช้งาน (Username)' : 'ตั้งชื่อผู้ใช้งานใหม่ (New Username)';
    document.getElementById('tabLogin').className = isLoginMode ? active : inactive;
    document.getElementById('tabRegister').className = isLoginMode ? inactive : active;
    hideAuthMessage();
}

function setAuthLoading(loading, text) {
    const btn = document.getElementById('authSubmitBtn');
    const label = document.getElementById('authSubmitText');
    btn.disabled = loading;
    btn.classList.toggle('opacity-70', loading);
    btn.classList.toggle('cursor-wait', loading);
    label.innerText = loading ? text : (isLoginMode ? 'เข้าสู่หน้าจอแสดงผล' : 'ยืนยันการสมัครสมาชิก');
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
                showAuthMessage(`<div>${msg}</div><button type="button" onclick="registerAndLogin('${safeName}')" class="mt-2 text-sky-700 hover:text-sky-900 font-semibold underline text-xs">คลิกเพื่อสมัครสมาชิกชื่อ "${safeName}" และเข้าสู่ระบบทันที</button>`);
            }
        } else {
            await registerAndLogin(username);
        }
    } catch (err) {
        showAuthMessage('เชื่อมต่อไม่สำเร็จ: ' + escapeHtml(err.name === 'AbortError' ? 'หมดเวลาเชื่อมต่อ กรุณาลองใหม่' : err.message));
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
        showAuthMessage('เชื่อมต่อไม่สำเร็จ: ' + escapeHtml(err.message));
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

function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (historyTimer) clearInterval(historyTimer);
    pollTimer = null;
    historyTimer = null;
}

function resetDashboard() {
    ['tempCurrent', 'phCurrent', 'cycleCountCurrent', 'volumeCurrent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '--';
    });
    ['tempStatus', 'phStatus'].forEach(id => updateBadge(id, evaluateStatus('', null)));
    ['tempGaugeArc', 'phGaugeArc'].forEach(id => {
        const arc = document.getElementById(id);
        if (arc) arc.style.strokeDashoffset = '144.5';
    });
    ['tempBarFill', 'phBarFill', 'cycleBarFill'].forEach(id => {
        const bar = document.getElementById(id);
        if (bar) bar.style.width = '0%';
    });
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
    lastHistoryRecords = [];
    allHistoryRecords = [];
    currentEcCycles = null;
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
    badge.className = 'px-3 py-1 text-xs rounded-lg font-semibold bg-amber-50 text-amber-700 border border-amber-200 inline-block';
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
        showToast('เชื่อมต่อไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function evaluateStatus(type, value) {
    const none = { text: 'รอข้อมูล', badgeClass: 'bg-slate-100 text-slate-500' };
    if (value === null || value === undefined || value === '') return none;
    const danger = { text: 'เกินเกณฑ์วิกฤต', badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold' };
    const risky = { text: 'เฝ้าระวัง', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' };
    const safe = { text: 'ปกติ', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold' };
    const num = parseFloat(value);
    if (isNaN(num)) return none;
    const th = CONFIG.THRESHOLDS;
    if (type === 'temp') return num > th.temp.danger ? danger : num >= th.temp.risky ? risky : safe;
    if (type === 'ph') {
        if (num < th.ph.dangerMin || num > th.ph.dangerMax) return danger;
        if (num < th.ph.riskyMin || num > th.ph.riskyMax) return risky;
        return safe;
    }
    return none;
}

function updateBadge(id, stat) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = stat.text;
    el.className = `px-2.5 py-1 rounded-md text-xs transition-colors duration-200 shrink-0 ${stat.badgeClass}`;
}

function updateGaugeAndBar(arcId, barId, value, maxVal) {
    const arc = document.getElementById(arcId);
    const bar = document.getElementById(barId);
    const num = parseFloat(value);
    if (isNaN(num)) {
        if (arc) arc.style.strokeDashoffset = '144.5';
        if (bar) bar.style.width = '0%';
        return;
    }
    const pct = Math.max(0, Math.min(100, (num / maxVal) * 100));
    const offset = 144.5 - (pct / 100) * 144.5;
    if (arc) arc.style.strokeDashoffset = offset.toFixed(1);
    if (bar) bar.style.width = `${pct.toFixed(1)}%`;
}

function updateOverallWaterStatus(data) {
    const el = document.getElementById('overallWaterStatus');
    if (!el) return;
    const tempVal = data.current_temp ?? data.temp;
    const phVal = data.current_ph ?? data.ph;
    const tempStat = evaluateStatus('temp', tempVal).text;
    const phStat = evaluateStatus('ph', phVal).text;
    const statuses = [tempStat, phStat];
    if (statuses.includes('เกินเกณฑ์วิกฤต')) {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: เกินเกณฑ์วิกฤต';
        el.className = 'px-3.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-xs';
    } else if (statuses.includes('เฝ้าระวัง')) {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: มีค่าอยู่ในเกณฑ์เฝ้าระวัง';
        el.className = 'px-3.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-xs';
    } else if (statuses.every(s => s === 'ปกติ')) {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: อยู่ในเกณฑ์ปกติ (Temp & pH)';
        el.className = 'px-3.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-xs';
    } else {
        el.innerText = 'ภาพรวมคุณภาพน้ำ: กำลังรับข้อมูลจากเซนเซอร์';
        el.className = 'px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-xs';
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
            badge.className = 'px-3 py-1 text-xs rounded-lg font-semibold bg-rose-50 text-rose-700 border border-rose-200 inline-block';
            if (!machineNotFoundWarned) {
                machineNotFoundWarned = true;
                showToast(`ไม่พบเครื่อง "${currentMachine}" กด "+ เพิ่มเครื่องใหม่" เพื่อลงทะเบียน`, 'error');
            }
            return;
        }
        badge.innerText = `ออนไลน์: ${currentMachine}`;
        badge.className = 'px-3 py-1 text-xs rounded-lg font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block';
        const tempVal = data.current_temp ?? data.temp;
        const phVal = data.current_ph ?? data.ph;
        const ecCycleVal = data.current_ec ?? data.ec ?? 0;

        document.getElementById('tempCurrent').innerText = formatNumber(tempVal);
        document.getElementById('phCurrent').innerText = formatNumber(phVal);
        updateBadge('tempStatus', evaluateStatus('temp', tempVal));
        updateBadge('phStatus', evaluateStatus('ph', phVal));
        updateGaugeAndBar('tempGaugeArc', 'tempBarFill', tempVal, 50);
        updateGaugeAndBar('phGaugeArc', 'phBarFill', phVal, 14);
        updateOverallWaterStatus(data);

        updateCycleAndVolumeCard(ecCycleVal);

        const lu = document.getElementById('lastUpdated');
        if (lu) lu.innerText = `ซิงค์ล่าสุด ${new Date().toLocaleTimeString('th-TH', { hour12: false })}`;
    } catch (err) {
        const lu = document.getElementById('lastUpdated');
        if (lu) lu.innerText = 'กำลังซิงค์ข้อมูลใหม่...';
    }
}

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

        allHistoryRecords = data;
        renderDailyRoundsChartAndTable();

        const todayKey = localDateKey(new Date());
        const selectedDate = document.getElementById('datePicker').value || todayKey;
        const filtered = data.filter(d => d.recorded_at && localDateKey(d.recorded_at) === selectedDate)
            .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
        lastHistoryRecords = filtered;

        const countEl = document.getElementById('historyCount');
        if (countEl) countEl.innerText = `ข้อมูลที่บันทึกในวันที่เลือก: ${filtered.length} รายการ`;

        const labels = filtered.map(d => new Date(d.recorded_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }));
        const temps = filtered.map(d => d.temperature);
        const phs = filtered.map(d => d.ph);
        updateStatsLabel('tempStats', temps, '°C');
        updateStatsLabel('phStats', phs, 'pH');
        renderChart('tempChart', 'Temperature (°C)', labels, temps, '#F97316', 'rgba(249, 115, 22, 0.1)');
        renderChart('phChart', 'pH Level', labels, phs, '#0284C7', 'rgba(2, 132, 199, 0.1)');
    } catch (err) {
        console.warn('fetchHistory:', err);
    }
}

function exportCsv() {
    if (!currentMachine) {
        showToast('กรุณาเชื่อมต่อเครื่องก่อนส่งออกข้อมูล', 'error');
        return;
    }
    const dailySeries = buildDailyRoundsSeries();
    if ((!lastHistoryRecords || lastHistoryRecords.length === 0) && dailySeries.length === 0) {
        showToast('ไม่มีข้อมูลสำหรับส่งออก', 'error');
        return;
    }
    const selectedDate = document.getElementById('datePicker').value || localDateKey(new Date());
    const header = ['Machine_ID', 'Timestamp', 'Temperature_C', 'pH_Level', 'Cycles_Count_EC', 'Water_Volume_Liters'];
    const rows = (lastHistoryRecords.length > 0 ? lastHistoryRecords : [{
        recorded_at: new Date().toISOString(),
        temperature: document.getElementById('tempCurrent').innerText,
        ph: document.getElementById('phCurrent').innerText,
        ec: currentEcCycles ?? 0
    }]).map(r => {
        const c = parseCycleCount(r.ec ?? currentEcCycles ?? 0) || 0;
        return [
            currentMachine,
            new Date(r.recorded_at).toLocaleString('th-TH', { hour12: false }),
            r.temperature,
            r.ph,
            c,
            c * CONFIG.LITERS_PER_CYCLE
        ];
    });
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
    showToast('ส่งออกไฟล์ CSV สำเร็จ', 'success');
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
                pointRadius: dataPoints.length > 80 ? 0 : 3,
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
                    titleFont: { family: 'Kanit', size: 12 },
                    bodyFont: { family: 'Prompt', size: 12 },
                    padding: 10,
                    cornerRadius: 8
                }
            },
            scales: {
                y: {
                    grid: { color: '#E2E8F0' },
                    ticks: { font: { family: 'Kanit', size: 11 }, color: '#64748B' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Kanit', size: 10 }, color: '#94A3B8', maxTicksLimit: 10 }
                }
            }
        }
    });
}
