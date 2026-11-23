"use strict";

const supabaseClient = createPong84Client('pong84.admin.auth', false);

const SNAPSHOT_KEY = 'pong84.admin.snapshots.v1';

/* ★ 2000-01-01 之前的时间戳一律视为无效 */
const TS_SANE_MIN = 946684800000;
const TS_SANE_MAX = 4102444800000; /* 2100-01-01，防未来异常 */

const RISK_RULES = {
  minPlayTimePerWin: 90000,
  futureTsTolerance: 5 * 60 * 1000,
  maxHell21: 500,
  maxHard21: 2000,
  timerScoreCap: { 30: 40, 60: 80, 120: 160 },
  sessionWinsThreshold: 2,
  suspiciousNicknames: ['test','hack','cheat','bot','admin','script','fuck','auto','macro','脚本','外挂','测试'],
  highRiskThreshold: 60,
  midRiskThreshold: 30,
  hardBanStartDate: new Date('2026-09-18T00:00:00+08:00').getTime(),
  maxDailyMinutes: 240,
  minWinMinutes: 2,
  hardBanRatioPerm: 1.20,
  hardBanRatio3Day: 1.10
};

let entries = {};
let bans = {};
let banByIp = {};
let risks = {};
let selected = new Set();
let currentFilter = 'all';
let snapshots = {};
let sessionGrowth = {};
let _adminRefreshTimer = null;
let adminSession = 0, adminActive = false;
let accountBans = Object.create(null);

const $ = id => document.getElementById(id);

/* ★ 时间戳净化：无效返回 0，有效返回毫秒数 */
function sanitizeTs(raw) {
  if (raw == null) return 0;
  const t = new Date(raw).getTime();
  if (!isFinite(t)) return 0;
  if (t < TS_SANE_MIN) return 0;
  if (t > TS_SANE_MAX) return 0;
  return t;
}

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') snapshots = obj;
  } catch (e) { snapshots = {}; }
}
function saveSnapshots() {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots)); } catch (e) {}
}

const adminChallenge = bindAccountChallenge(
  $('adminChallenge'), $('adminChallengeStatus'), $('adminChallengeRetry'), [$('loginBtn')]
);
void adminChallenge.show();

function adminRpc(action, args = {}) {
  return supabaseClient.rpc('pong84_admin', { p_action: action, p_args: args });
}

async function openConsole() {
  const { error } = await adminRpc('check');
  if (error) throw error;
  adminActive = true;
  $('loginError').style.display = 'none';
  $('loginScreen').classList.add('hidden');
  $('consoleScreen').classList.remove('hidden');
  adminChallenge.hide();
  loadSnapshots();
  void connectSupabase(++adminSession);
}

function closeConsole() {
  adminSession++;
  adminActive = false;
  clearInterval(_adminRefreshTimer);
  _adminRefreshTimer = null;
  stopSnapshotLoop();
  closeEditModal();
  for (const id of ['playersBody', 'bansBody']) $(id).replaceChildren();
  entries = Object.create(null);
  bans = Object.create(null);
  accountBans = Object.create(null);
  banByIp = Object.create(null);
  selected.clear();
  $('consoleScreen').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('pwInput').value = '';
  void adminChallenge.show();
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const captchaToken = adminChallenge.token;
  const btn = $('loginBtn'), message = $('loginError');
  if (!supabaseClient || btn.disabled || !captchaToken) return;
  adminChallenge.setBusy(true);
  btn.textContent = '验证中…';
  message.style.display = 'none';
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: $('emailInput').value.trim(), password: $('pwInput').value, options: { captchaToken }
    });
    if (error) throw error;
    $('pwInput').value = '';
    try { await openConsole(); }
    catch (accessError) {
      await supabaseClient.auth.signOut({ scope: 'local' });
      throw accessError;
    }
  } catch (error) {
    message.textContent = error.message === 'admin_required' ? '此账号没有管理权限' : pongAuthMessage(error);
    message.style.display = 'block';
  } finally {
    adminChallenge.reset();
    adminChallenge.setBusy(false);
    btn.textContent = '进入控制台';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  closeConsole();
  const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
  if (error) {
    $('loginError').textContent = '退出登录失败，请重试';
    $('loginError').style.display = 'block';
  }
});
if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && adminActive) closeConsole();
  });
}

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const el = $('tab-' + t.dataset.tab);
    if (el) el.classList.add('active');
  });
});

async function connectSupabase(session) {
  if (!supabaseClient) { setStatus('offline', 'Supabase 未加载'); return; }
  setStatus('connecting', '连接中...');
  try {
    await refreshFromSupabase();
    if (session !== adminSession || !adminActive) return;
    setStatus('online', '已连接');
    startSnapshotLoop();
    if (_adminRefreshTimer) clearInterval(_adminRefreshTimer);
    _adminRefreshTimer = setInterval(() => { refreshFromSupabase().catch(() => {}); }, 20000);
  } catch (e) {
    if (session === adminSession) setStatus('offline', '连接失败：' + e.message);
  }
}
function setStatus(cls, text) {
  const el = $('connStatus');
  el.className = 'status ' + cls;
  el.textContent = text;
}

async function refreshFromSupabase() {
  if (!adminActive) return;
  const session = adminSession;
  const { data, error } = await adminRpc('snapshot');
  if (session !== adminSession) return;
  if (error) throw error;
  entries = Object.create(null);
  for (const row of data.players) {
    /* ★ 时间戳用 sanitizeTs 净化，避免 1970/NaN 显示异常 */
    entries[row.player_id] = {
      v: 3, id: row.player_id, name: row.name,
      ts: sanitizeTs(row.updated_at),
      legacy: row.legacy === true,
      deviceId: row.device_id,
      ipAddress: row.ip_address || '—',
      hell21Wins: row.hell21_wins, hard21Wins: row.hard21_wins,
      hell21Points: Number(row.hell21_points) || 0,
      hard21Points: Number(row.hard21_points) || 0,
      playMs: Number(row.play_ms) || 0,
      lastIntegrity: row.last_integrity || '',
      hellTimer: {
        30: { wins: row.timer_30_wins, totalScore: row.timer_30_score },
        60: { wins: row.timer_60_wins, totalScore: row.timer_60_score },
        120:{ wins: row.timer_120_wins, totalScore: row.timer_120_score }
      }
    };
  }
  bans = Object.create(null);
  banByIp = Object.create(null);
  accountBans = Object.create(null);
  const byKind = { device: bans, ip: banByIp, account: accountBans };
  for (const row of data.bans) {
    byKind[row.kind][row.key] = {
      reason: row.reason, ts: sanitizeTs(row.created_at), expiresAt: sanitizeTs(row.expires_at)
    };
  }
  renderAll();
}

function analyzeAll() {
  risks = Object.create(null);
  const deviceCount = Object.create(null);
  const ipCount = Object.create(null);
  for (const id in entries) {
    const dev = entries[id].deviceId;
    if (dev && dev !== '—') deviceCount[dev] = (deviceCount[dev] || 0) + 1;
    const ip = entries[id].ipAddress;
    if (ip && ip !== '—') ipCount[ip] = (ipCount[ip] || 0) + 1;
  }
  for (const id in entries) {
    risks[id] = analyzeEntry(entries[id], { deviceCount, ipCount, allBans: bans, allIpBans: banByIp, sessionGrowth });
  }
}

function analyzeEntry(e, ctx) {
  const reasons = [];
  let score = 0;
  let autoBanLevel = null;
  let tsBad = false;

  const playMs = e.playMs;
  const hell = e.hell21Wins | 0;
  const hard = e.hard21Wins | 0;
  const ts = e.ts;
  const totalWins = hell + hard;

  /* --- 时间戳异常（无效 / 未来） --- */
  if (!ts || ts < TS_SANE_MIN) {
    reasons.push('更新时间戳无效（早于 2000 年或为空）');
    score += 15;
    tsBad = true;
  } else if (ts > Date.now() + RISK_RULES.futureTsTolerance) {
    reasons.push('时间戳异常（未来时间）');
    score += 50;
    tsBad = true;
  }

  /* --- 理论最大胜场 --- */
  const now = Date.now();
  const daysSinceStart = Math.max(1, (now - RISK_RULES.hardBanStartDate) / 86400000);
  const playMinutes = playMs / 60000;
  const maxTotalMinutes = daysSinceStart * RISK_RULES.maxDailyMinutes;
  const effectiveMinutes = Math.min(maxTotalMinutes, playMinutes);
  const theoreticalMaxWins = effectiveMinutes / RISK_RULES.minWinMinutes;
  const ratio = theoreticalMaxWins > 0 ? totalWins / theoreticalMaxWins : 0;

  if (totalWins > 0 && theoreticalMaxWins > 0) {
    if (e.legacy && ratio > RISK_RULES.hardBanRatioPerm) {
      reasons.push('胜场数严重超出理论上限（' + totalWins + ' / ' + theoreticalMaxWins.toFixed(1) + '，超 ' + ((ratio - 1) * 100).toFixed(0) + '%）');
      score += 100;
      autoBanLevel = 'perm';
    } else if (e.legacy && ratio > RISK_RULES.hardBanRatio3Day) {
      reasons.push('胜场数超出理论上限（' + totalWins + ' / ' + theoreticalMaxWins.toFixed(1) + '，超 ' + ((ratio - 1) * 100).toFixed(0) + '%）');
      score += 80;
      autoBanLevel = '3day';
    }
  }

  /* --- 每胜平均时长 --- */
  if (totalWins > 0) {
    const perWin = playMs / totalWins;
    if (perWin < RISK_RULES.minPlayTimePerWin) {
      const deficit = RISK_RULES.minPlayTimePerWin - perWin;
      reasons.push('异常胜率（每胜 ' + (perWin / 1000).toFixed(0) + 's）');
      score += Math.min(50, Math.floor(deficit / 1500));
    }
  }

  /* --- 极端胜场数 --- */
  if (hell > RISK_RULES.maxHell21) { reasons.push('地狱胜场数过高（' + hell + '）'); score += 20; }
  if (hard > RISK_RULES.maxHard21) { reasons.push('困难胜场数过高（' + hard + '）'); score += 20; }

  /* --- 设备/IP 复用 --- */
  if (e.deviceId && e.deviceId !== '—') {
    const dup = ctx.deviceCount[e.deviceId] || 0;
    if (dup > 1) { reasons.push('设备关联 ' + dup + ' 个账号'); score += 10 * (dup - 1); }
  }
  if (e.ipAddress && e.ipAddress !== '—') {
    const dup = ctx.ipCount[e.ipAddress] || 0;
    if (dup > 1) { reasons.push('同 IP 关联 ' + dup + ' 个账号'); score += 8 * (dup - 1); }
  }

  /* --- 已封禁 --- */
  if (banActive(accountBans[e.id])) { reasons.push('账号已被封禁'); score += 100; }
  if (e.deviceId && banActive(ctx.allBans[e.deviceId])) { reasons.push('设备已被封禁'); score += 100; }
  if (e.ipAddress && banActive(ctx.allIpBans[e.ipAddress])) { reasons.push('IP 已被封禁'); score += 100; }

  /* --- 昵称可疑词 --- */
  const nm = String(e.name || '').toLowerCase();
  for (const kw of RISK_RULES.suspiciousNicknames) {
    if (nm.indexOf(kw) >= 0) { reasons.push('昵称含可疑词「' + kw + '」'); score += 5; break; }
  }

  /* --- 计时赛异常 --- */
  const ht = e.hellTimer || {};
  for (const k of [30, 60, 120]) {
    const s = ht[k];
    if (s && (s.wins | 0) > 0) {
      const avg = (s.totalScore | 0) / (s.wins | 0);
      const cap = RISK_RULES.timerScoreCap[k] * 3;
      if (avg > cap) { reasons.push(k + ' 秒计时赛平均分异常（' + avg.toFixed(0) + '）'); score += 25; }
    }
  }

  /* --- 会话爆发增长 --- */
  const growth = ctx.sessionGrowth[e.id];
  if (growth) {
    const age = Date.now() - growth.at;
    if (age < 120000) {
      reasons.push(growth.dtSec + 's 内新增 ' + growth.dWins + ' 胜');
      score += Math.min(80, growth.dWins * 25);
    }
  }

  score = Math.min(100, Math.max(0, score));
  let level = 'clean';
  if (score >= RISK_RULES.highRiskThreshold) level = 'high';
  else if (score >= RISK_RULES.midRiskThreshold) level = 'mid';
  else if (score >= 10) level = 'low';
  return { score, level, reasons, autoBanLevel, ratio, tsBad };
}

let snapshotTimer = null;
function startSnapshotLoop() {
  if (snapshotTimer) return;
  takeSnapshot(true);
  snapshotTimer = setInterval(() => takeSnapshot(false), 20000);
}
function stopSnapshotLoop() {
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
}
function takeSnapshot(isInitial) {
  const now = Date.now();
  for (const id in entries) {
    const e = entries[id];
    const prev = snapshots[id];
    if (prev && !isInitial) {
      const dt = now - prev.ts;
      if (dt >= 12000 && dt <= 600000) {
        const dHell = (e.hell21Wins | 0) - (prev.hell21 | 0);
        const dHard = (e.hard21Wins | 0) - (prev.hard21 | 0);
        const dWins = dHell + dHard;
        if (dWins >= RISK_RULES.sessionWinsThreshold) {
          const winsPerMin = dWins / (dt / 60000);
          sessionGrowth[id] = {
            dWins, dtSec: Math.round(dt / 1000),
            winsPerMin: Math.round(winsPerMin * 10) / 10,
            at: now
          };
        }
      }
    }
    snapshots[id] = {
      hell21: e.hell21Wins | 0,
      hard21: e.hard21Wins | 0,
      playMs: e.playMs,
      ts: now
    };
  }
  for (const id in sessionGrowth) {
    if (now - sessionGrowth[id].at > 180000) delete sessionGrowth[id];
  }
  saveSnapshots();
  if (!isInitial) renderAll();
}

let renderPending = false;
function renderAll() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    analyzeAll();
    renderPlayers();
    renderAnalysis();
    renderBans();
    renderStats();
    $('lastUpdate').textContent = '最后更新 ' + new Date().toLocaleTimeString();
  });
}
function renderStats() {
  const total = Object.keys(entries).length;
  const banCount = Object.keys(bans).length + Object.keys(accountBans).length;
  const ipBanCount = Object.keys(banByIp).length;
  let wins = 0, timeMs = 0, high = 0, autoBan = 0;
  for (const k in entries) {
    const e = entries[k];
    wins += (e.hell21Wins | 0) + (e.hard21Wins | 0);
    timeMs += (e.playMs);
  }
  for (const k in risks) {
    if (risks[k].level === 'high') high++;
    if (risks[k].autoBanLevel) autoBan++;
  }
  $('statPlayers').textContent = total;
  $('statBans').textContent = banCount;
  $('statIpBans').textContent = ipBanCount;
  $('statTotalWins').textContent = wins;
  $('statTotalTime').textContent = fmtTime(timeMs);
  $('statHighRisk').textContent = high;
  $('statAutoBan').textContent = autoBan;
}
function fmtTime(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + ' 分';
  return (min / 60).toFixed(1) + ' 时';
}
/* ★ 强化的 fmtAgo：无效时间戳返回「—」，一年以上返回模糊 */
function fmtAgo(ts) {
  // ★ 2000-01-01 之前的时间戳一律视为无效
  const TS_SANE_MIN = 946684800000;
  if (!ts || !isFinite(ts) || ts < TS_SANE_MIN) return '—';
  const d = Date.now() - ts;
  if (d < 0) return '时间异常';
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 时前';
  const days = Math.floor(d / 86400000);
  if (days > 365) return '一年前以上';
  return days + ' 天前';
}
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

function lbWinScore(e) { return (e.hell21Points || 0) + (e.hard21Points || 0); }

function getFilteredList() {
  const all = Object.values(entries).sort((a, b) => {
    const wa = lbWinScore(a);
    const wb = lbWinScore(b);
    if (wb !== wa) return wb - wa;
    return b.ts - a.ts;
  });
  const f = currentFilter;
  if (f === 'all') return all;
  return all.filter(e => {
    const r = risks[e.id] || { level: 'clean' };
    if (f === 'risk-high') return r.level === 'high';
    if (f === 'risk-mid') return r.level === 'mid';
    if (f === 'risk-suspicious') return r.level === 'high' || r.level === 'mid';
    if (f === 'autoban') return !!r.autoBanLevel;
    if (f === 'clean') return r.level === 'clean' || r.level === 'low';
    if (f === 'shared') {
      if (!e.deviceId || e.deviceId === '—') return false;
      const dup = Object.values(entries).filter(x => x.deviceId === e.deviceId).length;
      return dup > 1;
    }
    if (f === 'sharedip') {
      if (!e.ipAddress || e.ipAddress === '—') return false;
      const dup = Object.values(entries).filter(x => x.ipAddress === e.ipAddress).length;
      return dup > 1;
    }
    if (f === 'banned') return banActive(accountBans[e.id]) || banActive(bans[e.deviceId]) || banActive(banByIp[e.ipAddress]);
    return true;
  });
}

function renderPlayers() {
  const list = getFilteredList();
  const tb = $('playersBody');
  if (list.length === 0) {
    tb.innerHTML = '<tr><td colspan="13" class="empty">暂无符合条件的记录</td></tr>';
    updateSelectionUI();
    return;
  }
  tb.innerHTML = list.map((e, i) => {
    const devId = e.deviceId || '—';
    const ipAddr = e.ipAddress || '—';
    const isBanned = (banActive(accountBans[e.id]) || banActive(bans[devId]) || banActive(banByIp[ipAddr])) ? 'banned' : '';
    const r = risks[e.id] || { score: 0, level: 'clean', reasons: [], tsBad: false };
    const rowCls = ['risk-' + r.level, isBanned].filter(Boolean).join(' ');
    const isSel = selected.has(e.id) ? ' selected' : '';
    const devDup = (e.deviceId && e.deviceId !== '—') ? Object.values(entries).filter(x => x.deviceId === e.deviceId).length : 0;
    const ipDup = (e.ipAddress && e.ipAddress !== '—') ? Object.values(entries).filter(x => x.ipAddress === e.ipAddress).length : 0;
    const riskLabel = { high: '高危', mid: '中危', low: '低危', clean: '正常' }[r.level] || '正常';
    const riskTitle = r.reasons.length ? r.reasons.join(' · ') : '无明显异常';
    const ipSafe = ipAddr !== '—';
    const score = lbWinScore(e);
    let autoTag = '';
    if (r.autoBanLevel === 'perm') autoTag = '<span class="badge ban-perm" style="margin-left:4px;">永久</span>';
    else if (r.autoBanLevel === '3day') autoTag = '<span class="badge ban-3day" style="margin-left:4px;">3天</span>';
    const tsCell = r.tsBad
      ? '<span class="badge ts-bad" title="' + esc(r.reasons.filter(x=>x.indexOf('时间戳')>=0).join(' · ')) + '">异常</span>'
      : fmtAgo(e.ts);
    return '<tr class="' + rowCls + isSel + '" data-id="' + esc(e.id) + '">' +
      '<td><input type="checkbox" data-check="' + esc(e.id) + '"' + (selected.has(e.id) ? ' checked' : '') + '></td>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><span class="name">' + esc(e.name || '匿名') + '</span>' + (e.legacy ? ' <span class="muted">历史</span>' : '') + autoTag + '</td>' +
      '<td><span class="mono">' + esc(e.id || '') + '</span></td>' +
      '<td><span class="mono">' + esc(devId) + '</span>' + (devDup > 1 ? '<span class="badge dev-shared" style="margin-left:4px;">×' + devDup + '</span>' : '') + '</td>' +
      '<td><span class="mono">' + esc(ipAddr) + '</span>' + (ipDup > 1 ? '<span class="badge ip-shared" style="margin-left:4px;">×' + ipDup + '</span>' : '') + '</td>' +
      '<td>' + (e.hell21Wins | 0) + '</td>' +
      '<td>' + (e.hard21Wins | 0) + '</td>' +
      '<td><b>' + score.toFixed(0) + '</b></td>' +
      '<td>' + fmtTime(e.playMs) + '</td>' +
      '<td class="muted">' + tsCell + '</td>' +
      '<td><span class="badge risk-' + r.level + '" title="' + esc(riskTitle) + '">' + riskLabel + ' ' + r.score + '</span></td>' +
      '<td>' +
        '<button class="small" data-edit="' + esc(e.id) + '">编辑</button> ' +
        (e.legacy ? (devId === '—' ? '' : '<button class="small danger" data-ban="' + esc(devId) + '" data-name="' + esc(e.name || '匿名') + '">封设备</button> ') :
          '<button class="small danger" data-account-ban="' + esc(e.id) + '" data-name="' + esc(e.name || '匿名') + '">封账号</button> ') +
        (ipSafe ? '<button class="small danger" data-banip="' + esc(ipAddr) + '" data-name="' + esc(e.name || '匿名') + '">封 IP</button> ' : '') +
        '<button class="small" data-del="' + esc(e.id) + '">删除</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  tb.querySelectorAll('[data-check]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.check;
      if (cb.checked) selected.add(id); else selected.delete(id);
      updateSelectionUI();
      const row = cb.closest('tr');
      if (row) row.classList.toggle('selected', cb.checked);
    });
  });
  tb.querySelectorAll('[data-account-ban]').forEach(b => b.addEventListener('click', () => banAccount(b.dataset.accountBan, b.dataset.name)));
  tb.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditModal(b.dataset.edit)));
  tb.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', () => banDevice(b.dataset.ban, b.dataset.name)));
  tb.querySelectorAll('[data-banip]').forEach(b => b.addEventListener('click', () => banIp(b.dataset.banip, b.dataset.name)));
  tb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteEntry(b.dataset.del)));
  updateSelectionUI();
}

function renderAnalysis() {
  const highList = [], midList = [], permList = [], threeDayList = [], sharedList = [], sharedIpList = [], growthList = [], shortWinList = [], bannedActiveList = [], badTsList = [];
  for (const id in entries) {
    const e = entries[id];
    const r = risks[id];
    if (!r) continue;
    if (r.level === 'high') highList.push({ id, e, r });
    else if (r.level === 'mid') midList.push({ id, e, r });
    if (r.autoBanLevel === 'perm') permList.push(id);
    else if (r.autoBanLevel === '3day') threeDayList.push(id);
    if (r.reasons.some(x => x.indexOf('设备关联') >= 0)) sharedList.push(id);
    if (r.reasons.some(x => x.indexOf('同 IP 关联') >= 0)) sharedIpList.push(id);
    if (r.reasons.some(x => x.indexOf('内新增') >= 0)) growthList.push(id);
    if (r.reasons.some(x => x.indexOf('异常胜率') >= 0)) shortWinList.push(id);
    if (r.reasons.some(x => x.indexOf('设备已被封禁') >= 0 || x.indexOf('IP 已被封禁') >= 0)) bannedActiveList.push(id);
    if (r.tsBad) badTsList.push(id);
  }
  $('anaHigh').textContent = highList.length;
  $('anaMid').textContent = midList.length;
  $('anaPerm').textContent = permList.length;
  $('ana3day').textContent = threeDayList.length;
  $('anaShared').textContent = sharedList.length;
  $('anaSharedIp').textContent = sharedIpList.length;
  $('anaGrowth').textContent = growthList.length;
  $('anaShortWin').textContent = shortWinList.length;
  $('anaBanned').textContent = bannedActiveList.length;
  const elBadTs = $('anaBadTs'); if (elBadTs) elBadTs.textContent = badTsList.length;

  const combined = highList.concat(midList).sort((a, b) => b.r.score - a.r.score);
  const tb = $('analysisBody');
  if (combined.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">暂无可疑账号 · 分析引擎运行正常</td></tr>';
    return;
  }
  tb.innerHTML = combined.map(x => {
    const devId = x.e.deviceId || '—';
    const ip = x.e.ipAddress || '—';
    const ipSafe = ip !== '—';
    let lvlBadge = '<span class="muted">—</span>';
    if (x.r.autoBanLevel === 'perm') lvlBadge = '<span class="badge ban-perm">永久</span>';
    else if (x.r.autoBanLevel === '3day') lvlBadge = '<span class="badge ban-3day">3 天</span>';
    return '<tr class="risk-' + x.r.level + '">' +
      '<td><span class="name">' + esc(x.e.name || '匿名') + '</span><br><span class="mono muted">' + esc(x.id) + '</span></td>' +
      '<td><span class="badge risk-' + x.r.level + '">' + x.r.score + '</span></td>' +
      '<td>' + lvlBadge + '</td>' +
      '<td class="risk-detail">' + x.r.reasons.map(y => '<span class="reason">· ' + esc(y) + '</span>').join('') + '</td>' +
      '<td>' +
        '<button class="small" data-edit="' + esc(x.id) + '">编辑</button> ' +
        (x.e.legacy ? (devId === '—' ? '' : '<button class="small danger" data-anaban="' + esc(devId) + '" data-name="' + esc(x.e.name || '匿名') + '">封设备</button> ') :
          '<button class="small danger" data-account-ban="' + esc(x.id) + '" data-name="' + esc(x.e.name || '匿名') + '">封账号</button> ') +
        (ipSafe ? '<button class="small danger" data-anabanip="' + esc(ip) + '" data-name="' + esc(x.e.name || '匿名') + '">封 IP</button> ' : '') +
        '<button class="small" data-anadel="' + esc(x.id) + '">删除</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  tb.querySelectorAll('[data-account-ban]').forEach(b => b.addEventListener('click', () => banAccount(b.dataset.accountBan, b.dataset.name)));
  tb.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditModal(b.dataset.edit)));
  tb.querySelectorAll('[data-anaban]').forEach(b => b.addEventListener('click', () => banDevice(b.dataset.anaban, b.dataset.name)));
  tb.querySelectorAll('[data-anabanip]').forEach(b => b.addEventListener('click', () => banIp(b.dataset.anabanip, b.dataset.name)));
  tb.querySelectorAll('[data-anadel]').forEach(b => b.addEventListener('click', () => deleteEntry(b.dataset.anadel)));
}

function banActive(ban) {
  return !!ban && (!ban.expiresAt || ban.expiresAt > Date.now());
}
function renderBans() {
  const list = [];
  for (const k in accountBans) list.push(Object.assign({ kind: 'account', key: k }, accountBans[k]));
  for (const k in bans) list.push(Object.assign({ kind: 'device', key: k }, bans[k]));
  for (const k in banByIp) list.push(Object.assign({ kind: 'ip', key: k }, banByIp[k]));
  list.sort((a, b) => b.ts - a.ts);
  const tb = $('bansBody');
  if (list.length === 0) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">暂无封禁记录</td></tr>';
    return;
  }
  tb.innerHTML = list.map(b => {
    const devShow = b.kind === 'account' ? '账号 ' + b.key : b.kind === 'device' ? b.key : '—';
    const ipShow = b.kind === 'ip' ? b.key : (b.ip || '—');
    let typeTag;
    if (!banActive(b)) {
      typeTag = '<span class="badge">已过期</span>';
    } else if (b.expiresAt) {
      const remain = Math.max(0, Math.ceil((b.expiresAt - Date.now()) / 3600000));
      typeTag = '<span class="badge ban-temp">临时 ' + remain + 'h</span>';
    } else {
      typeTag = '<span class="badge ban-perm">永久</span>';
    }
    const tsShow = b.ts ? new Date(b.ts).toLocaleString() : '—';
    return '<tr>' +
      '<td><span class="mono">' + esc(devShow) + '</span></td>' +
      '<td><span class="mono">' + esc(ipShow) + '</span></td>' +
      '<td style="font-size:10px;">' + esc(b.reason || '违规行为') + '</td>' +
      '<td>' + typeTag + '</td>' +
      '<td class="muted">' + esc(b.by || 'admin') + '</td>' +
      '<td class="muted">' + tsShow + '</td>' +
      '<td><button class="small" data-unban="' + esc(b.key) + '" data-kind="' + b.kind + '">解封</button></td>' +
    '</tr>';
  }).join('');
  tb.querySelectorAll('[data-unban]').forEach(b => {
    b.addEventListener('click', () => unbanItem(b.dataset.unban, b.dataset.kind));
  });
}

function updateSelectionUI() {
  for (const id of Array.from(selected)) if (!entries[id]) selected.delete(id);
  const list = getFilteredList();
  const visible = list.map(x => x.id);
  const selVisible = visible.filter(id => selected.has(id)).length;
  $('selectedCount').textContent = '已选 ' + selected.size + ' 项';
  const selAllTop = $('selectAllTop'), selAll = $('selectAll');
  const allChecked = visible.length > 0 && selVisible === visible.length;
  if (selAllTop) { selAllTop.checked = allChecked; selAllTop.indeterminate = !allChecked && selVisible > 0; }
  if (selAll) { selAll.checked = allChecked; selAll.indeterminate = !allChecked && selVisible > 0; }
  const has = selected.size > 0;
  $('batchBanBtn').disabled = !has;
  $('batchBanIpBtn').disabled = !has;
  $('batchDeleteBtn').disabled = !has;
  $('batchUnbanBtn').disabled = !has;
}

$('selectAllTop').addEventListener('change', () => {
  const visible = getFilteredList().map(x => x.id);
  if ($('selectAllTop').checked) visible.forEach(id => selected.add(id));
  else visible.forEach(id => selected.delete(id));
  renderPlayers();
});
$('selectAll').addEventListener('change', () => {
  const visible = getFilteredList().map(x => x.id);
  if ($('selectAll').checked) visible.forEach(id => selected.add(id));
  else visible.forEach(id => selected.delete(id));
  renderPlayers();
});
$('filterSelect').addEventListener('change', () => {
  currentFilter = $('filterSelect').value;
  renderPlayers();
});

$('batchBanBtn').addEventListener('click', async () => {
  const devices = new Set(), accounts = [];
  for (const id of selected) {
    const entry = entries[id];
    if (!entry) continue;
    if (!entry.legacy) accounts.push(id);
    else if (entry.deviceId && entry.deviceId !== '—') devices.add(entry.deviceId);
  }
  if (!devices.size && !accounts.length) { alert('所选玩家没有可封禁的账号或设备'); return; }
  const reason = prompt('封禁 ' + accounts.length + ' 个账号和 ' + devices.size + ' 台设备？', '批量封禁');
  if (reason === null) return;
  try {
    const restrictions = [
      { kind: 'account', keys: accounts, reason },
      { kind: 'device', keys: [...devices], reason }
    ].filter(item => item.keys.length);
    const { error } = await adminRpc('bulk_ban', { restrictions });
    if (error) throw error;
    selected.clear();
    await refreshFromSupabase();
  } catch (error) { alert('操作失败：' + error.message); }
});

$('batchBanIpBtn').addEventListener('click', async () => {
  if (selected.size === 0) return;
  const ips = new Set();
  for (const id of selected) {
    const e = entries[id];
    if (e && e.ipAddress && e.ipAddress !== '—') ips.add(e.ipAddress);
  }
  if (ips.size === 0) { alert('选中的玩家没有 IP 地址，无法封禁'); return; }
  const reason = prompt('批量封禁 ' + ips.size + ' 个 IP？\n\n请输入封禁原因（可直接确定）', '批量封 IP');
  if (reason === null) return;
  try {
    const { error } = await adminRpc('ban', { kind: 'ip', keys: Array.from(ips), reason });
    if (error) throw error;
    selected.clear();
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
});

$('batchUnbanBtn').addEventListener('click', async () => {
  const devices = new Set(), ips = new Set(), accounts = [];
  for (const id of selected) {
    const entry = entries[id];
    if (!entry) continue;
    if (accountBans[id]) accounts.push(id);
    if (bans[entry.deviceId]) devices.add(entry.deviceId);
    if (banByIp[entry.ipAddress]) ips.add(entry.ipAddress);
  }
  const restrictions = [
    { kind: 'account', keys: accounts },
    { kind: 'device', keys: [...devices] },
    { kind: 'ip', keys: [...ips] }
  ].filter(item => item.keys.length);
  if (!restrictions.length) { alert('选中的玩家没有封禁记录'); return; }
  if (!confirm('解除所选玩家关联的账号、设备与历史 IP 封禁？')) return;
  try {
    const { error } = await adminRpc('bulk_unban', { restrictions });
    if (error) throw error;
    selected.clear();
    await refreshFromSupabase();
  } catch (error) { alert('操作失败：' + error.message); }
});

$('batchDeleteBtn').addEventListener('click', async () => {
  if (selected.size === 0) return;
  if (!confirm('批量删除 ' + selected.size + ' 条玩家排行榜记录？')) return;
  try {
    const { error } = await adminRpc('delete', { keys: Array.from(selected) });
    if (error) throw error;
    selected.clear();
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
});

$('autoBanHighBtn').addEventListener('click', async () => {
  const permIds = [], threeDayIds = [];
  for (const id in risks) {
    const r = risks[id];
    if (r.autoBanLevel === 'perm') permIds.push(id);
    else if (r.autoBanLevel === '3day') threeDayIds.push(id);
  }
  if (permIds.length === 0 && threeDayIds.length === 0) {
    alert('当前没有触发硬封阈值的账号');
    return;
  }
  const allIds = permIds.concat(threeDayIds);
  const devices = new Set(), ips = new Set();
  for (const id of allIds) {
    const e = entries[id];
    if (!e) continue;
    if (e.deviceId && e.deviceId !== '—') devices.add(e.deviceId);
    if (e.ipAddress && e.ipAddress !== '—') ips.add(e.ipAddress);
  }
  const msg =
    '将执行硬封（含删除排行榜数据）：\n' +
    '· 永久封禁（超 20%）: ' + permIds.length + ' 个\n' +
    '· 3 天封禁（超 10%）: ' + threeDayIds.length + ' 个\n' +
    '· 关联设备: ' + devices.size + ' 台，关联 IP: ' + ips.size + ' 个\n\n' +
    '确继续？';
  if (!confirm(msg)) return;

  try {
    const restrictions = new Map();
    for (const id of allIds) {
      const e = entries[id];
      if (!e) continue;
      const expires_at = permIds.includes(id) ? null : new Date(Date.now() + 3 * 86400000).toISOString();
      const targets = e.legacy ? [['device', e.deviceId], ['ip', e.ipAddress]] : [['account', id]];
      for (const [kind, key] of targets) {
        if (!key || key === '—') continue;
        const restrictionId = kind + ':' + key;
        if (restrictions.has(restrictionId) && restrictions.get(restrictionId).expires_at === null) continue;
        restrictions.set(restrictionId, { kind, key, expires_at, reason: '历史胜场数异常' });
      }
    }
    const { error } = await adminRpc('moderate', { keys: allIds, restrictions: [...restrictions.values()] });
    if (error) throw error;
    await refreshFromSupabase();
    alert('硬封完成：永久 ' + permIds.length + ' 个，3 天 ' + threeDayIds.length + ' 个。');
  } catch (e) {
    alert('硬封失败：' + e.message);
  }
});

async function banAccount(id, name) {
  const reason = prompt('封禁账号：' + name + '（' + id + '）', '数据异常');
  if (reason === null) return;
  try {
    const { error } = await adminRpc('ban', { kind: 'account', keys: [id], reason });
    if (error) throw error;
    await refreshFromSupabase();
  } catch (error) {
    alert('操作失败：' + error.message);
  }
}

async function banDevice(deviceId, name) {
  if (!deviceId || deviceId === '—') { alert('该记录没有设备指纹，无法封禁'); return; }
  const reason = prompt('封禁 ' + name + ' 的设备？\n设备 ID: ' + deviceId + '\n\n请输入封禁原因（可直接确定）', '数据异常');
  if (reason === null) return;
  try {
    const { error } = await adminRpc('ban', { kind: 'device', keys: [deviceId], reason });
    if (error) throw error;
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function banIp(ip, name) {
  if (!ip || ip === '—') { alert('该记录没有 IP 地址，无法封禁'); return; }
  const reason = prompt('封禁 IP：' + ip + '\n玩家：' + name + '\n\n请输入封禁原因（可直接确定）', '数据异常');
  if (reason === null) return;
  try {
    const { error } = await adminRpc('ban', { kind: 'ip', keys: [ip], reason });
    if (error) throw error;
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function unbanItem(key, kind) {
  if (!confirm('解除对 ' + key + ' 的封禁？')) return;
  try {
    const { error } = await adminRpc('unban', { kind, keys: [key] });
    if (error) throw error;
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function deleteEntry(id) {
  if (!confirm('确定删除该玩家的排行榜数据？')) return;
  try {
    const { error } = await adminRpc('delete', { keys: [id] });
    if (error) throw error;
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
}

$('refreshBtn').addEventListener('click', () => {
  refreshFromSupabase().catch(e => alert('刷新失败：' + e.message));
});
$('resetSnapshotBtn').addEventListener('click', () => {
  if (!confirm('重置所有行为快照？\n下次分析将从当前状态重新建立基线。')) return;
  snapshots = {}; sessionGrowth = {};
  saveSnapshots();
  takeSnapshot(true);
  renderAll();
});
$('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('确定清空整个排行榜？\n这将删除所有玩家的排行榜数据（不会解除设备/IP 封禁）。')) return;
  const ids = Object.keys(entries);
  if (!confirm('确认操作 ' + ids.length + ' 条记录？')) return;
  try {
    const { error } = await adminRpc('clear');
    if (error) throw error;
    entries = {};
    selected.clear();
    await refreshFromSupabase();
  } catch (e) { alert('操作失败：' + e.message); }
});

let _editMode = 'edit';
let _editPlayerId = null;

function openEditModal(playerId) {
  const modal = $('editModal');
  if (!modal) return;
  _editMode = (playerId === null) ? 'new' : 'edit';
  _editPlayerId = playerId;

  const title = $('editModalTitle');
  const piEl = $('editPlayerId');
  const nameEl = $('editName');
  const devEl = $('editDeviceId');
  const ipEl = $('editIpAddress');
  const delBtn = $('editDeleteBtn');

  if (_editMode === 'new') {
    title.textContent = '新增历史记录';
    devEl.readOnly = false; ipEl.readOnly = false;
    piEl.value = ''; piEl.readOnly = false;
    nameEl.value = ''; devEl.value = ''; ipEl.value = '';
    $('editHell21').value = 0;
    $('editHell21Points').value = 0;
    $('editHard21').value = 0;
    $('editHard21Points').value = 0;
    $('editPlayMin').value = 0;
    $('editT30Score').value = 0; $('editT30Wins').value = 0;
    $('editT60Score').value = 0; $('editT60Wins').value = 0;
    $('editT120Score').value = 0; $('editT120Wins').value = 0;
    delBtn.style.display = 'none';
    setTimeout(() => piEl.focus(), 100);
  } else {
    const e = entries[playerId];
    if (!e) { alert('找不到该玩家'); return; }
    title.textContent = '编辑玩家 · ' + playerId;
    piEl.value = e.id; piEl.readOnly = true;
    nameEl.value = e.name || '';
    devEl.value = e.deviceId || '';
    ipEl.value = e.ipAddress === '—' ? '' : e.ipAddress;
    devEl.readOnly = !e.legacy; ipEl.readOnly = !e.legacy;
    $('editHell21').value = e.hell21Wins | 0;
    $('editHell21Points').value = e.hell21Points | 0;
    $('editHard21').value = e.hard21Wins | 0;
    $('editHard21Points').value = e.hard21Points | 0;
    $('editPlayMin').value = Math.floor((e.playMs) / 60000);
    const t = e.hellTimer || {};
    $('editT30Score').value = (t[30] && t[30].totalScore) | 0;
    $('editT30Wins').value = (t[30] && t[30].wins) | 0;
    $('editT60Score').value = (t[60] && t[60].totalScore) | 0;
    $('editT60Wins').value = (t[60] && t[60].wins) | 0;
    $('editT120Score').value = (t[120] && t[120].totalScore) | 0;
    $('editT120Wins').value = (t[120] && t[120].wins) | 0;
    delBtn.style.display = '';
  }
  modal.classList.add('show');
}

function closeEditModal() {
  const modal = $('editModal');
  if (modal) modal.classList.remove('show');
  _editMode = 'edit';
  _editPlayerId = null;
}

async function saveEditModal() {
  const pi = $('editPlayerId').value.trim().toUpperCase();
  const nameVal = $('editName').value.trim() || '匿名';
  const dev = $('editDeviceId').value.trim();
  const ip = $('editIpAddress').value.trim();
  const h21 = parseInt($('editHell21').value, 10) || 0;
  const h21p = parseInt($('editHell21Points').value, 10) || 0;
  const hd21 = parseInt($('editHard21').value, 10) || 0;
  const hd21p = parseInt($('editHard21Points').value, 10) || 0;
  const pm = parseInt($('editPlayMin').value, 10) || 0;
  const t30s = parseInt($('editT30Score').value, 10) || 0;
  const t30w = parseInt($('editT30Wins').value, 10) || 0;
  const t60s = parseInt($('editT60Score').value, 10) || 0;
  const t60w = parseInt($('editT60Wins').value, 10) || 0;
  const t120s = parseInt($('editT120Score').value, 10) || 0;
  const t120w = parseInt($('editT120Wins').value, 10) || 0;

  if (_editMode === 'new') {
    if (!/^[A-Z0-9]{12}$/.test(pi)) { alert('玩家 ID 必须是 12 位大写字母或数字'); return; }
  } else {
    if (pi !== _editPlayerId) { alert('玩家 ID 不可修改'); return; }
  }

  try {
    const { error } = await adminRpc('save', {
      player_id: pi, name: nameVal, device_id: dev || null, ip_address: ip || null,
      hell21_wins: h21, hell21_points: h21p, hard21_wins: hd21, hard21_points: hd21p,
      play_ms: pm * 60000,
      timer_30_score: t30s, timer_60_score: t60s, timer_120_score: t120s,
      timer_30_wins: t30w, timer_60_wins: t60w, timer_120_wins: t120w
     });
    if (error) throw error;
    closeEditModal();
    await refreshFromSupabase();
  } catch (e) { alert('保存失败：' + e.message); }
}

async function deleteFromModal() {
  if (!_editPlayerId) return;
  if (!confirm('确定删除玩家 ' + _editPlayerId + ' 的所有排行榜数据？')) return;
  try {
    const { error } = await adminRpc('delete', { keys: [_editPlayerId] });
    if (error) throw error;
    closeEditModal();
    await refreshFromSupabase();
  } catch (e) { alert('删除失败：' + e.message); }
}

$('addPlayerBtn').addEventListener('click', () => openEditModal(null));
$('editCancelBtn').addEventListener('click', closeEditModal);
$('editSaveBtn').addEventListener('click', saveEditModal);
$('editDeleteBtn').addEventListener('click', deleteFromModal);
$('editModal').addEventListener('click', (e) => { if (e.target === $('editModal')) closeEditModal(); });
$('editPlayerId').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
});
