"use strict";

/* ============================================================
   排行榜（Supabase）
   ============================================================ */
const LB_LOCAL_SIG_KEY = 'pong84_local_sig_v5';
const LB_NAME_KEY = 'pong84.player.name';
const LB_MY_STATS_KEY = 'pong84.my.stats.v6';   /* ★ 版本升级 */
const LB_DEVICE_KEY  = 'pong84.device.id';     /* ★ 设备码持久化 */
const LB_MAX_HELL21 = 20000;
const LB_MAX_HARD21 = 50000;
const LB_MAX_HELL21_POINTS = 200000;           /* ★ 积分上限 */
const LB_MAX_HARD21_POINTS = 200000;
const LB_MAX_TIMER_SCORE = { 30: 999999, 60: 999999, 120: 999999 };
const LB_MAX_PLAYTIME = 100000 * 3600 * 1000;
const LB_MAX_NAME_LEN = 16;
const supabaseClient = createPong84Client('pong84.player.auth');
let deviceBanned = false, DEVICE_ID = '';
let accountUser = null, accountProfile = null, accountChallenge;
let board = { wins: [], time: [], mine: null, rank: null, count: 0 };
let leaderboardStatus = 'connecting', renderPending = false, boardRequest = 0;
let rankedMatch = null, pendingReport = Promise.resolve();

function lbFastHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}
function getOrCreateDeviceId() {
  let id = '';
  try { id = localStorage.getItem(LB_DEVICE_KEY) || ''; } catch (e) {}
  if (!/^D[0-9A-F]{14,15}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    id = 'D' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').slice(0, 15).toUpperCase();
    try { localStorage.setItem(LB_DEVICE_KEY, id); } catch (e) {}
  }
  return id;
}
function getPlayerName() { try { return localStorage.getItem(LB_NAME_KEY) || ''; } catch (e) { return ''; } }
function setPlayerNameStore(n) { try { localStorage.setItem(LB_NAME_KEY, n); } catch (e) {} }
function sanitizeName(n) { n = String(n || '').replace(/[\x00-\x1f\x7f]/g, '').trim(); return n.slice(0, LB_MAX_NAME_LEN) || '匿名'; }
let playerName = getPlayerName() || '匿名';

/* ★ myStats 增加积分字段 */
let myStats = {
  hell21Wins: 0, hard21Wins: 0,
  hell21Points: 0, hard21Points: 0,
  playMs: 0,
  hellTimer: { 30: { wins: 0, totalScore: 0 }, 60: { wins: 0, totalScore: 0 }, 120: { wins: 0, totalScore: 0 } }
};
function loadMyStats() {
  try {
    const raw = localStorage.getItem(LB_MY_STATS_KEY);
    if (!raw) return;
    let obj; try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.d === 'string' && typeof obj.s === 'string') {
      if (lbFastHash(obj.d + '|' + LB_LOCAL_SIG_KEY) !== obj.s) { saveMyStats(); return; }
      let d; try { d = JSON.parse(obj.d); } catch (e) { return; }
      applyStatsObject(d); return;
    }
    if (typeof obj.hell21Wins === 'number' || obj.hellTimer) { applyStatsObject(obj); saveMyStats(); }
  } catch (e) {}
}
function applyStatsObject(d) {
  if (!d || typeof d !== 'object') return;
  myStats.hell21Wins = Math.max(0, Math.min(LB_MAX_HELL21, (d.hell21Wins | 0) || 0));
  myStats.hard21Wins = Math.max(0, Math.min(LB_MAX_HARD21, (d.hard21Wins | 0) || 0));
  myStats.hell21Points = Math.max(0, Math.min(LB_MAX_HELL21_POINTS, (d.hell21Points | 0) || 0));
  myStats.hard21Points = Math.max(0, Math.min(LB_MAX_HARD21_POINTS, (d.hard21Points | 0) || 0));
  myStats.playMs = Math.max(0, Math.min(LB_MAX_PLAYTIME, Math.trunc(Number(d.playMs) || 0)));
  if (d.hellTimer && typeof d.hellTimer === 'object') {
    for (const k of [30, 60, 120]) {
      const s = d.hellTimer[k];
      if (s && typeof s === 'object') {
        myStats.hellTimer[k].wins = Math.max(0, Math.min(100000, (s.wins | 0) || 0));
        myStats.hellTimer[k].totalScore = Math.max(0, Math.min(LB_MAX_TIMER_SCORE[k], (s.totalScore | 0) || 0));
      }
    }
  }
}
function saveMyStats() {
  try {
    const dataStr = JSON.stringify(myStats);
    const sig = lbFastHash(dataStr + '|' + LB_LOCAL_SIG_KEY);
    localStorage.setItem(LB_MY_STATS_KEY, JSON.stringify({ d: dataStr, s: sig, v: 2, t: Date.now() }));
  } catch (e) {}
}
function lbEscapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function fmtPlayTime(ms) {
  const minutes = Math.floor((Number(ms) || 0) / 60000);
  return minutes < 60 ? minutes + ' 分钟' : (minutes / 60).toFixed(1) + ' 小时';
}

function updateBanBanner() {
  const banner = $('banBanner');
  banner.classList.toggle('hidden-section', !deviceBanned);
  if (deviceBanned) banner.textContent = '当前账号或设备已被限制参与排行榜';
}

function lbScheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    lbRenderAll();
  });
}

function lbRenderMyStats() {
  const mine = board.mine;
  const stats = accountUser ? {
    hell21Points: mine?.hell21_points || 0,
    hard21Points: mine?.hard21_points || 0,
    playMs: mine?.play_ms || 0,
    hellTimer: {
      30: { totalScore: mine?.timer_30_score || 0 },
      60: { totalScore: mine?.timer_60_score || 0 },
      120: { totalScore: mine?.timer_120_score || 0 }
    }
  } : myStats;
  $('lbMyHell21').textContent = stats.hell21Points;
  $('lbMyHard21').textContent = stats.hard21Points;
  $('lbMyT30').textContent = stats.hellTimer[30].totalScore;
  $('lbMyT60').textContent = stats.hellTimer[60].totalScore;
  $('lbMyT120').textContent = stats.hellTimer[120].totalScore;
  $('lbMyPlayTime').textContent = fmtPlayTime(stats.playMs);
}

function lbRenderAll() {
  lbRenderMyStats();
  const messages = {
    connected: '已同步至全球服务器',
    connecting: '正在连接全球服务器…',
    offline: '全球排行榜暂时无法同步'
  };
  $('leaderboardStatus').textContent = messages[leaderboardStatus];
  $('lbMyRank').textContent = board.rank ? '第 ' + board.rank + ' 名 / 共 ' + board.count + ' 人' : '未上榜';

  function renderRows(id, rows, renderStats) {
    $(id).innerHTML = rows.map((entry, index) =>
      '<div class="lb-row ' + (entry.player_id === accountProfile?.player_id ? 'mine' : '') + '">' +
      '<span class="lb-rank">' + (index + 1) + '</span>' +
      '<span class="lb-name">' + lbEscapeHtml(entry.name) + '</span>' +
      renderStats(entry) + '</div>'
    ).join('') || '<div style="padding:16px;text-align:center;color:var(--crt-mid);font-size:10px;">' +
      (leaderboardStatus === 'connected' ? '暂无数据' : messages[leaderboardStatus]) + '</div>';
  }
  renderRows('lbList', board.wins, entry =>
    '<span class="lb-win">' + Number(entry.hell21_wins) + '</span>' +
    '<span class="lb-hard">' + Number(entry.hard21_wins) + '</span>' +
    '<span class="lb-times">' + [entry.timer_30_score, entry.timer_60_score, entry.timer_120_score].map(Number).join('/') + '</span>'
  );
  renderRows('lbTimeList', board.time, entry =>
    '<span class="lb-win">' + fmtPlayTime(entry.play_ms) + '</span>'
  );
}

async function lbConnect() {
  const request = ++boardRequest;
  if (!supabaseClient) {
    leaderboardStatus = 'offline';
    lbScheduleRender();
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('pong84_board');
    if (request !== boardRequest) return;
    if (error) throw error;
    board = data;
    const previousName = accountProfile?.name;
    accountProfile = data.profile;
    if (accountProfile) {
      playerName = accountProfile.name;
      const input = $('lbNameInput');
      if (previousName !== playerName && document.activeElement !== input) input.value = playerName;
    }
    deviceBanned = data.banned;
    leaderboardStatus = 'connected';
    updateNicknameDisplay();
    updateBanBanner();
  } catch (error) {
    if (request !== boardRequest) return;
    leaderboardStatus = 'offline';
    console.warn('[PONG-84] 排行榜同步失败', error.message);
  }
  lbScheduleRender();
}

function rankedMode() {
  if (onlineRole || lanRole || gameMode !== 'ai') return null;
  if (timerMode) return currentDiff === 'hell' && [30, 60, 120].includes(timerSeconds) ? 'timer' + timerSeconds : null;
  return winScore === 21 && ['hell', 'hard'].includes(currentDiff) ? currentDiff + '21' : null;
}

function lbStartMatch() {
  rankedMatch = null;
  const mode = rankedMode();
  if (!accountUser || !accountProfile || !mode || deviceBanned || isDebugDirty()) return;
  const userId = accountUser.id, control = lastGameControlMode;
  const pending = pendingReport.then(async () => {
    if (accountUser?.id !== userId) return null;
    const { data, error } = await supabaseClient.rpc('pong84_begin_match', {
      p_mode: mode, p_control: control, p_device_id: DEVICE_ID
    });
    if (error) throw error;
    return data;
  }).catch(error => {
    if (accountUser?.id !== userId) return null;
    if (error.message === 'ranked_banned') {
      deviceBanned = true;
      updateBanBanner();
    }
    console.warn('[PONG-84] 排位对局无法开启', error.message);
    return null;
  });
  rankedMatch = { userId, pending };
}

function lbFinishMatch(check) {
  const match = rankedMatch;
  rankedMatch = null;
  const mode = rankedMode();
  if (!mode || !check.ok) return;
  if (playerScore > aiScore) {
    const multiplier = lastGameControlMode === 'buttons' ? 3 : 1;
    if (timerMode) {
      const limit = { 30: 40, 60: 80, 120: 160 }[timerSeconds];
      if (playerScore <= limit) {
        const stats = myStats.hellTimer[timerSeconds];
        stats.wins++;
        stats.totalScore += playerScore * multiplier;
      }
    } else if (playerScore >= 21) {
      if (currentDiff === 'hell') {
        myStats.hell21Wins++;
        myStats.hell21Points += 3 * multiplier;
      } else {
        myStats.hard21Wins++;
        myStats.hard21Points += 2 * multiplier;
      }
    }
    saveMyStats();
    lbRenderMyStats();
  }

  if (!match) return;
  const result = { p_player: playerScore, p_opponent: aiScore, p_active_ms: check.activeMs };
  pendingReport = match.pending.then(async id => {
    if (accountUser?.id !== match.userId) return;
    if (!id) {
      lbResultStatus(' · 全球榜未记录本局', match);
      return;
    }
    const { error } = await supabaseClient.rpc('pong84_finish_match', { p_match_id: id, ...result });
    if (error) throw error;
    lbResultStatus(' · 已计入全球榜', match);
    void lbConnect();
  }).catch(error => {
    if (accountUser?.id !== match.userId) return;
    if (error.message === 'ranked_banned') {
      deviceBanned = true;
      updateBanBanner();
    }
    console.warn('[PONG-84] 排位结算失败', error.message);
    lbResultStatus(' · 全球榜未记录本局', match);
  });
}

let resultMatch;
function lbResultStatus(message, match) {
  // A late response must not overwrite the result shown for a new match.
  if (currentPanel === 'result' && resultMatch === match) $('resultSub').textContent += message;
}

function flushPlayTime() {
  if (playTimeAccum <= 0) return;
  myStats.playMs += Math.round(playTimeAccum);
  playTimeAccum = 0;
  saveMyStats();
  lbRenderMyStats();
}

function updateNicknameDisplay() {
  $('mainNickname').textContent = playerName || '匿名';
  const hint = $('accountIdHint');
  hint.textContent = accountUser ?
    (accountProfile ? '玩家 ID：' + accountProfile.player_id + ' · 显示账号战绩' : '设置昵称后即可参加全球榜') :
    '当前显示本机战绩';
}

function lbUpdateAccountPanel() {
  $('accountForm').classList.toggle('hidden-section', !!accountUser);
  $('accountSession').classList.toggle('hidden-section', !accountUser);
  if (!accountUser && currentPanel === 'account') void accountChallenge.show();
  else accountChallenge.hide();
}

function lbBindAccount() {
  const signIn = $('accountSignIn'), signUp = $('accountSignUp');
  const form = $('accountForm'), status = $('accountStatus'), nick = $('lbNameInput');
  const saveName = $('lbSaveNameBtn'), signOut = $('accountSignOut');
  accountChallenge = bindAccountChallenge(
    $('accountChallenge'), $('accountChallengeStatus'), $('accountChallengeRetry'), [signIn, signUp]
  );

  async function authenticate(register) {
    const captchaToken = accountChallenge.token;
    if (!supabaseClient || !captchaToken || !form.reportValidity()) return;
    accountChallenge.setBusy(true);
    status.textContent = '正在验证…';
    try {
      const credentials = {
        email: $('accountEmail').value.trim(), password: $('accountPassword').value, options: { captchaToken }
      };
      const response = register
        ? await supabaseClient.auth.signUp({
          ...credentials, options: { captchaToken, emailRedirectTo: location.origin + location.pathname }
        })
        : await supabaseClient.auth.signInWithPassword(credentials);
      if (response.error) throw response.error;
      $('accountPassword').value = '';
      status.textContent = response.data.session ? '已登录' : '请查看邮箱并确认账号';
    } catch (error) {
      status.textContent = pongAuthMessage(error);
    } finally {
      accountChallenge.reset();
      accountChallenge.setBusy(false);
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (!signIn.disabled) void authenticate(false); });
  signUp.addEventListener('click', () => { if (!signUp.disabled) void authenticate(true); });
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
      if (error) throw error;
      status.textContent = '已退出';
    } catch (error) {
      status.textContent = pongAuthMessage(error);
    } finally {
      signOut.disabled = false;
    }
  });
  saveName.addEventListener('click', async () => {
    const name = sanitizeName(nick.value);
    if (accountUser) {
      const userId = accountUser.id;
      saveName.disabled = true;
      try {
        const { data, error } = await supabaseClient.rpc('pong84_save_nickname', { p_name: name });
        if (error) throw error;
        if (accountUser?.id !== userId) return;
        accountProfile = data;
        playerName = data.name;
        status.textContent = '账号昵称已保存';
        void lbConnect();
      } catch (error) {
        status.textContent = error.code === '23505' ? '该昵称已被使用' :
          error.message === 'invalid_nickname' ? '请输入有效的昵称' : '昵称保存失败，请稍后重试';
        return;
      } finally {
        saveName.disabled = false;
      }
    } else {
      playerName = name;
      setPlayerNameStore(name);
      status.textContent = '本机昵称已保存';
    }
    nick.value = playerName === '匿名' ? '' : playerName;
    updateNicknameDisplay();
    broadcastRoomState();
  });
  nick.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); saveName.click(); }
  });

  if (!supabaseClient) { void lbConnect(); return; }
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event !== 'INITIAL_SESSION' && accountUser?.id === session?.user?.id) return;
    boardRequest++;
    accountUser = session?.user || null;
    accountProfile = null;
    deviceBanned = false;
    board = { ...board, mine: null, rank: null, profile: null, banned: false };
    playerName = getPlayerName() || '匿名';
    $('lbNameInput').value = playerName === '匿名' ? '' : playerName;
    updateNicknameDisplay();
    updateBanBanner();
    lbUpdateAccountPanel();
    lbScheduleRender();
    // Supabase Auth callbacks run while its session lock is held.
    setTimeout(() => void lbConnect(), 0);
  });
}
