"use strict";

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);
if (isMobile) document.body.classList.add('is-mobile');

const LOGICAL_W = 960, LOGICAL_H = 540, FPS_REF = 60;
const BALL_SPEED_BONUS = 1.1;
const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

const FOUR_NERF = { shieldChance: 0.07, shieldMax: 2, spearDouble: 0.04, spearPierce: 0.35 };
const isFourPlayerOnline = () => gameMode === 'online' && playerCount === 4;

function hexToRgb(hex) {
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbaFromHex(hex, a) {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

const CRT_THEMES = {
  green: { color:'#33ff33', glow:'rgba(51,255,51,0.6)',   bg:'#051005', dim:'rgba(51,255,51,0.2)',   trail:'rgba(51,255,51,' },
  amber: { color:'#ffb000', glow:'rgba(255,176,0,0.6)',   bg:'#120d00', dim:'rgba(255,176,0,0.2)',   trail:'rgba(255,176,0,' },
  white: { color:'#e0e0e0', glow:'rgba(224,224,224,0.6)', bg:'#050505', dim:'rgba(224,224,224,0.2)', trail:'rgba(224,224,224,' },
  blue:  { color:'#33ccff', glow:'rgba(51,204,255,0.6)',  bg:'#000a10', dim:'rgba(51,204,255,0.2)',  trail:'rgba(51,204,255,' }
};

let crtTheme = 'green', renderMode = 'classic', uiSize = 'small';
let targetFps = 60;
let gpuAccel = true;
let sfxEnabled = true, masterVolume = 0.7;
let autoFullscreen = true;
let blurAutoPause = true;
let paddleSpeedSetting = 1.0;
let touchControlMode = 'buttons';
const getTheme = () => CRT_THEMES[crtTheme];

const BLESSINGS = {
  none:        { label:'无加护', color:'#888888', icon:'○', tag:'基础', desc:'没有任何特殊效果，纯粹的公平对决。' },
  firstStrike: { label:'首发',   color:'#33ff99', icon:'★', tag:'回合', desc:'在第 1、11、21……回合，你的球拍会由地狱级 AI 代打一回合。' },
  spin:        { label:'旋转',   color:'#44ddff', icon:'↻', tag:'击球', desc:'击球位置更容易打出旋转球，判定范围比正常大 40%。' },
  longPaddle:  { label:'长拍',   color:'#ffaa44', icon:'▬', tag:'体型', desc:'球拍永久加长 30%。' },
  frenzy:      { label:'狂乱',   color:'#ff44aa', icon:'✦', tag:'回合', desc:'在第 8、16、24……回合，特殊球触发率提升 50%。特殊球即将让你丢分时，有 15% 概率被挡下。' },
  berserk:     { label:'狂暴',   color:'#ff6622', icon:'⚡', tag:'进攻', desc:'每次击球使球速提升 7%，最多叠加 4 层。丢分后层数重置。' },
  shield:      { label:'盾牌',   color:'#88aaff', icon:'⛨', tag:'防御', desc:'每回合开始时 10% 概率获得一个护盾（最多 3 个）。四人模式下会削弱。' },
  spear:       { label:'长矛',   color:'#ffdd44', icon:'↑', tag:'进攻', desc:'进球时有 6% 概率一次得两分。有 50% 概率无视对方护盾。四人模式下会削弱。' },
  gambler:     { label:'赌神',   color:'#ff4444', icon:'♠', tag:'概率', desc:'进球时有 0.008% 概率直接获得整局胜利。' }
};
const BLESSING_ORDER = ['none','firstStrike','spin','longPaddle','frenzy','berserk','shield','spear','gambler'];
const BLESSING_KEYS = BLESSING_ORDER.filter(k => k !== 'none');

const DEFAULT_DEBUG = {
  ballSpeedMul: 1.0, paddleSpeedMul: 1.0, aiSpeedMul: 1.0,
  ballSizeMul: 1.0, paddleHeightMul: 1.0, powerupRate: 1.0, curveProbMul: 1.0
};
const debugParams = Object.assign({}, DEFAULT_DEBUG);

const DIFFICULTY = {
  easy:   { aiSpeedMul:0.253, aiReaction:0.28, paddleHeightRatio:0.26,  ballCrossTime:1.65, curveProb:0.015,  mistakeRate:0.30, mistakeDuration:[20,50], predictAcc1:0.60, predictAcc2:0.50, attackChance:0.10, label:'简单' },
  normal: { aiSpeedMul:0.627, aiReaction:0.56, paddleHeightRatio:0.22,  ballCrossTime:1.65, curveProb:0.0275, mistakeRate:0.15, mistakeDuration:[15,35], predictAcc1:0.75, predictAcc2:0.70, attackChance:0.25, label:'普通' },
  hard:   { aiSpeedMul:0.946, aiReaction:0.72, paddleHeightRatio:0.185, ballCrossTime:1.32, curveProb:0.04,   mistakeRate:0.07, mistakeDuration:[10,25], predictAcc1:0.85, predictAcc2:0.80, attackChance:0.50, label:'困难' },
  hell:   { aiSpeedMul:1.06,  aiReaction:0.80, paddleHeightRatio:0.15,  ballCrossTime:1.32, curveProb:0.055,  mistakeRate:0.02, mistakeDuration:[5,15],  predictAcc1:0.92, predictAcc2:0.86, attackChance:0.75, label:'地狱' }
};
DIFFICULTY.easy.curveProb   *= 0.66;
DIFFICULTY.normal.curveProb *= 0.66;
DIFFICULTY.hard.curveProb   *= 0.66;
DIFFICULTY.hell.curveProb   *= 0.66;

const AI_SPEED_CAP = 1.3;

const ONLINE_DIFF_PRESETS = {
  easy:   { label:'简单', paddleHeightMul: 1.20, powerupRate: 1.35, curveProbMul: 0.55, ballSpeedMul: 0.85 },
  normal: { label:'普通', paddleHeightMul: 1.00, powerupRate: 1.00, curveProbMul: 1.00, ballSpeedMul: 1.00 },
  hard:   { label:'困难', paddleHeightMul: 0.82, powerupRate: 0.75, curveProbMul: 1.35, ballSpeedMul: 1.15 },
  hell:   { label:'地狱', paddleHeightMul: 0.68, powerupRate: 0.55, curveProbMul: 1.75, ballSpeedMul: 1.30 }
};

const PADDLE_CROSS_TIME = 0.6;
const POWERUPS = {
  speed: { color:'#ff4444', label:'加速', duration:300 },
  slow:  { color:'#4488ff', label:'减速', duration:300 },
  big:   { color:'#44ff88', label:'大球', duration:400 },
  long:  { color:'#ffaa44', label:'长拍', duration:400 },
  small: { color:'#cc44ff', label:'小球', duration:300 }
};
const POWERUP_WEIGHTS = { speed:1.25, slow:1.25, big:1.25, small:1.25, long:1.0 };
const SPIN_CURVE_PROB = 0.40;
const SPIN_SPEED_PROB = 0.40;
const POWERUP_BASE_PROB = 0.020;
const SERVE_DELAY_FRAMES = 90;
const SERVE_HINT_FRAMES = 30;

const FOUR_PADDLE_COLORS = { 1:'#ff5566', 2:'#ff9955', 3:'#5588ff', 4:'#55ddff' };

let gameRunning = false, paused = false, animId = null, lastFrameTime = 0;
let currentDiff = 'normal', gameMode = 'ai', winScore = 11;
let countdownActive = false, timerMode = false;
let timerOpponent = 'ai';
let timerSeconds = 60, timerRemaining = 0, timerInterval = null, lastTimerSecond = -1;
let gPaddleSpeed = 8, gBallBaseSpeed = 4.5;

const player = { x:30, y:0, width:12, height:100, baseHeight:100, speed:8, targetY:null };
const ai = { x:0, y:0, width:12, height:100, baseHeight:100, speed:5, targetY:null };
const p2Paddle = { x:30, y:0, width:12, height:100, baseHeight:100, speed:8, targetY:null };
const p4Paddle = { x:0, y:0, width:12, height:100, baseHeight:100, speed:8, targetY:null };

const ball = { x:0, y:0, size:10, baseSize:10, maxSize:20, speedX:0, speedY:0, baseSpeed:4.5, initialSpeed:4.5, maxSpeed:14, spin:0 };
let playerScore = 0, aiScore = 0;
let activePowerups = [], powerupTimer = 0;
let lastPowerupType = null;
let isCurvedBall = false, curveTimer = 0, curveChangeTimer = 0, curveMaxTimer = 1;
let p1ShieldCount = 0, p2ShieldCount = 0;
let aiMistakeTimer = 0, aiMistakeType = 'none';
let ballRespawnDelay = 0, nextBallDirection = 1;
let phosphorTrail = [];
const MAX_TRAIL = 15;
let cheatActive = false, cheatSequence = [];
const KONAMI_CODE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowLeft','ArrowRight','ArrowRight'];
let cheatBallSpeedMul = 1;

let roundNumber = 0;
let playerBlessing = 'none';
let player2Blessing = 'none';
let aiBlessing = 'none';
let aiBlessingMode = 'none';
let playerControlledByAI = false;
let frenzyActiveP1 = false;
let frenzyActiveP2 = false;
let berserkStack = 0;
const BERSERK_MAX = 4;
let gameStartedOnce = false;

let playerCount = 2;
let teamFormation = 'column';
let teamSqueeze = true;

let slotAiControl = { 1:false, 2:false, 3:false, 4:false };
let onlinePausedByHost = false;
let followTouchTargetY = null;

let floatTexts = [];
let playTimeAccum = 0;

let lastGameControlMode = 'buttons';

function spawnFloatText(x, y, text, color, size) {
  floatTexts.push({ x, y, text, color: color || '#ffffff', life: 1, vy: -0.7, size: size || 22 });
  if (floatTexts.length > 24) floatTexts.shift();
}
function updateFloatTexts(dt) {
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    f.y += f.vy * dt;
    f.life -= 0.016 * dt;
    if (f.life <= 0) floatTexts.splice(i, 1);
  }
}
function drawFloatTexts() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of floatTexts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.font = 'bold ' + f.size + 'px "Courier New", monospace';
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}
function isAiControlled() {
  if (onlineRole !== null || lanRole !== null) return false;
  if (gameMode === 'ai') return true;
  return false;
}
function getAIDiff() {
  if (gameMode === 'online' && onlineAILevel && DIFFICULTY[onlineAILevel]) return DIFFICULTY[onlineAILevel];
  return DIFFICULTY[currentDiff];
}

function predictBallLanding(targetX) {
  const r = ball.size / 2;
  const H = LOGICAL_H;
  if (Math.abs(ball.speedX) < 0.1) return ball.y;
  const t = (targetX - ball.x) / ball.speedX;
  if (t <= 0 || t > 500) return ball.y;
  let py = ball.y + ball.speedY * t;
  const minY = r, maxY = H - r;
  let iter = 0;
  while ((py < minY || py > maxY) && iter < 15) {
    if (py < minY) py = minY + (minY - py);
    else if (py > maxY) py = maxY - (py - maxY);
    iter++;
  }
  return clamp(py, 0, H);
}
function updateAISmart(pad, dt, opts) {
  opts = opts || {};
  const d = getAIDiff();
  const H = LOGICAL_H;
  if (typeof pad._aiTargetY === 'undefined') { pad._aiTargetY = H / 2; pad._aiTargetAt = 0; }
  const isLeft = !!opts.isLeft;
  const now = performance.now();
  const ballComing = isLeft ? (ball.speedX < 0) : (ball.speedX > 0);
  let halfMid = H / 2;
  if (opts.halfMin !== undefined && opts.halfMax !== undefined) halfMid = (opts.halfMin + opts.halfMax) / 2;
  const refreshMs = 300 - d.aiReaction * 220;
  if (ballComing && now - pad._aiTargetAt > refreshMs) {
    pad._aiTargetAt = now;
    const trueY = predictBallLanding(pad.x);
    let coarseY;
    if (Math.random() < d.predictAcc1) coarseY = trueY + (Math.random() - 0.5) * H * 0.10;
    else { const mag = (0.16 + Math.random() * 0.24) * H; coarseY = trueY + (Math.random() < 0.5 ? -mag : mag); }
    coarseY = clamp(coarseY, 0, H);
    const ph = pad.height;
    const wantAttack = Math.random() < d.attackChance;
    let hitRatio;
    if (wantAttack) hitRatio = (Math.random() < 0.5 ? -1 : 1) * (0.60 + Math.random() * 0.25);
    else hitRatio = (Math.random() - 0.5) * 0.30;
    let aim = coarseY - hitRatio * (ph / 2);
    if (Math.random() < d.predictAcc2) aim += (Math.random() - 0.5) * ph * 0.5;
    else aim += (Math.random() - 0.5) * ph * (2.2 + Math.random() * 1.6);
    if (opts.halfMin !== undefined && opts.halfMax !== undefined) aim = clamp(aim, opts.halfMin, opts.halfMax);
    pad._aiTargetY = clamp(aim, 0, H);
  } else if (!ballComing && now - pad._aiTargetAt > 600) {
    pad._aiTargetAt = now;
    pad._aiTargetY = halfMid + (Math.random() - 0.5) * 30;
  }
  let targetY = pad._aiTargetY;
  if (aiMistakeTimer > 0) {
    aiMistakeTimer -= dt;
    switch (aiMistakeType) {
      case 'freeze': return;
      case 'wrong': targetY = halfMid - (targetY - halfMid); break;
      case 'slow': targetY = (pad.y + pad.height / 2) * 0.7 + targetY * 0.3; break;
      case 'overshoot': targetY += (Math.random() - 0.5) * 80; break;
    }
  }
  const center = pad.y + pad.height / 2;
  const diff = targetY - center;
  const step = Math.min(Math.abs(diff), pad.speed * dt);
  if (diff > 2) pad.y += step;
  else if (diff < -2) pad.y -= step;
  if (aiMistakeTimer <= 0 && Math.random() < d.mistakeRate * dt * 0.5) {
    const types = ['freeze', 'wrong', 'slow', 'overshoot'];
    aiMistakeType = types[Math.floor(Math.random() * types.length)];
    aiMistakeTimer = d.mistakeDuration[0] + Math.random() * (d.mistakeDuration[1] - d.mistakeDuration[0]);
  }
  let minY = 0, maxY = H - pad.height;
  if (opts.halfMin !== undefined) minY = Math.max(minY, opts.halfMin);
  if (opts.halfMax !== undefined) maxY = Math.min(maxY, opts.halfMax - pad.height);
  pad.y = clamp(pad.y, minY, maxY);
}
function updatePlayerAsAI(dt) { updateAISmart(player, dt, { slot: 1, isLeft: true }); }

const matchCheck = {
  active: false, activeMs: 0, scores: 0, debugUsed: false,
  start() {
    this.active = true;
    this.activeMs = 0;
    this.scores = 0;
    this.debugUsed = isDebugDirty();
  },
  tick() {
    if (!this.active) return;
    this.activeMs += 1000 / 60;
    this.debugUsed ||= isDebugDirty();
  },
  score() { if (this.active) this.scores++; },
  finish() {
    const ok = this.active && !this.debugUsed && !isDebugDirty() && this.scores === playerScore + aiScore;
    this.active = false;
    return { ok, activeMs: Math.round(this.activeMs) };
  },
  cancel() { this.active = false; }
};

const stats = { frameTimes: [], lastSampleTime: 0, fps: 0, avgFrameMs: 0, ping: -1 };
const STATS_SAMPLE_MS = 400, STATS_WINDOW = 90;
let pingInterval = null;

function updateStatsDisplay() {
  const elFps = $('statFps'), elFrame = $('statFrame'), elPing = $('statPing'),
        elPingRow = $('statPingRow'), elRole = $('statRole'), elRoleRow = $('statRoleRow');
  if (elFps) elFps.textContent = stats.fps > 0 ? stats.fps.toFixed(0) : '--';
  if (elFrame) elFrame.textContent = stats.avgFrameMs > 0 ? stats.avgFrameMs.toFixed(1) + 'ms' : '--';
  if (elFps) {
    elFps.classList.toggle('warn', stats.fps > 0 && stats.fps < 50);
    elFps.classList.toggle('bad', stats.fps > 0 && stats.fps < 30);
  }
  if (elFrame) {
    elFrame.classList.toggle('warn', stats.avgFrameMs > 20);
    elFrame.classList.toggle('bad', stats.avgFrameMs > 33);
  }
  if (onlineRole || lanRole) {
    if (elPingRow) elPingRow.style.display = '';
    if (elRoleRow) elRoleRow.style.display = '';
    if (elRole) elRole.textContent = (onlineRole || lanRole) === 'host' ? '主机' : '客户端';
    if (elPing) {
      if (stats.ping < 0) { elPing.textContent = '测量中'; elPing.className = 'stat-value'; }
      else {
        elPing.textContent = stats.ping + 'ms'; elPing.className = 'stat-value';
        if (stats.ping > 120) elPing.classList.add('bad');
        else if (stats.ping > 60) elPing.classList.add('warn');
      }
    }
  } else {
    if (elPingRow) elPingRow.style.display = 'none';
    if (elRoleRow) elRoleRow.style.display = 'none';
  }
  const row = $('statDebugRow');
  if (row) row.style.display = isDebugDirty() ? '' : 'none';
  const banner = $('lbDebugBanner');
  if (banner) banner.classList.toggle('hidden-section', !isDebugDirty());
}
function isDebugDirty() {
  if (cheatActive) return true;
  return debugParams.ballSpeedMul !== 1.0 || debugParams.paddleSpeedMul !== 1.0 ||
         debugParams.aiSpeedMul !== 1.0 || debugParams.ballSizeMul !== 1.0 ||
         debugParams.paddleHeightMul !== 1.0 || debugParams.powerupRate !== 1.0 ||
         debugParams.curveProbMul !== 1.0;
}
function startPingLoop() {
  if (pingInterval) clearInterval(pingInterval);
  stats.ping = -1;
  pingInterval = setInterval(() => {
    if (rtcDc && rtcDc.readyState === 'open') { try { rtcDc.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) {} }
  }, 1000);
}
function stopPingLoop() { if (pingInterval) { clearInterval(pingInterval); pingInterval = null; } stats.ping = -1; }

const $ = id => document.getElementById(id);
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
canvas.width = LOGICAL_W;
canvas.height = LOGICAL_H;

const AudioEngine = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  playTone(freq, duration, type, vol) {
    if (!this.ctx || !sfxEnabled) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const v = (vol || 0.15) * masterVolume;
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(v, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  },
  hit()        { this.init(); this.playTone(440,0.08,'square',0.1); this.playTone(660,0.08,'square',0.08); },
  score()      { this.init(); this.playTone(880,0.15,'sine',0.12); setTimeout(()=>this.playTone(1100,0.2,'sine',0.1),80); },
  lose()       { this.init(); this.playTone(300,0.2,'sawtooth',0.08); setTimeout(()=>this.playTone(200,0.3,'sawtooth',0.08),100); },
  win()        { this.init(); [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.playTone(f,0.2,'sine',0.1),i*120)); },
  countdown()  { this.init(); this.playTone(600,0.12,'sine',0.08); },
  powerup()    { this.init(); this.playTone(400,0.1,'sine',0.06); setTimeout(()=>this.playTone(600,0.1,'sine',0.06),60); setTimeout(()=>this.playTone(800,0.15,'sine',0.06),120); },
  powerupEnd() { this.init(); this.playTone(800,0.08,'sine',0.05); setTimeout(()=>this.playTone(400,0.1,'sine',0.04),60); },
  shieldBreak(){ this.init(); this.playTone(900,0.1,'sine',0.08); setTimeout(()=>this.playTone(500,0.15,'sine',0.06),60); },
  curveBall()  { this.init(); this.playTone(350,0.08,'sawtooth',0.06); setTimeout(()=>this.playTone(500,0.1,'sawtooth',0.06),50); setTimeout(()=>this.playTone(700,0.12,'sawtooth',0.06),100); },
  spinHit()    { this.init(); this.playTone(520,0.06,'sine',0.07); this.playTone(780,0.08,'sine',0.06); },
  berserk()    { this.init(); this.playTone(300,0.06,'square',0.07); setTimeout(()=>this.playTone(420,0.08,'square',0.06),40); },
  timerTick()  { this.init(); this.playTone(440,0.05,'sine',0.04); }
};

const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
function lockLandscape() { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }
function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!fn) return;
  try { const p = fn.call(el); if (p && typeof p.then === 'function') p.then(lockLandscape).catch(() => {}); else lockLandscape(); } catch (e) {}
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (fn) { try { fn.call(document); } catch (e) {} }
}
function toggleFullscreen() { if (isFullscreen()) exitFullscreen(); else requestFullscreen(); }
function updateFsIcon() {
  const fsIcon = $('fsIcon');
  if (!fsIcon) return;
  if (isFullscreen()) {
    fsIcon.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>';
  } else {
    fsIcon.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>';
  }
}

function checkOrientation() {
  const portrait = window.innerWidth < window.innerHeight;
  const rotateHint = $('rotateHint');
  if (isMobile && portrait && !isFullscreen()) { if (rotateHint) rotateHint.classList.add('show'); return false; }
  if (rotateHint) rotateHint.classList.remove('show');
  return true;
}
function layoutGame() {
  const vw = window.innerWidth, vh = window.innerHeight, mob = isMobile;
  const ctrlW = mob && touchControlMode === 'buttons' ? 52 : 0;
  const ctrlGap = mob && touchControlMode === 'buttons' ? 5 : 0;
  const outerPad = mob ? 3 : 8;
  const decoPad = mob ? 8 : 12, bezelPad = mob ? 4 : 6, labelH = mob ? 12 : 16;
  const hDeco = 2 * (decoPad + bezelPad);
  const vDeco = 2 * (decoPad + bezelPad) + labelH;
  const topChrome = mob ? 96 : 104;
  const bottomChrome = mob ? 12 : 16;
  const availW = vw - outerPad * 2 - (ctrlW + ctrlGap) * 2;
  const availH = vh - topChrome - bottomChrome - outerPad * 2;
  let screenW = Math.min(availW - hDeco, (availH - vDeco) * 16 / 9, 1280);
  screenW = Math.max(screenW, 200);
  const crtAssembly = $('crtAssembly');
  if (!crtAssembly) return;
  crtAssembly.style.width = (screenW + hDeco) + 'px';
  crtAssembly.style.padding = decoPad + 'px';
  const bezel = crtAssembly.querySelector('.crt-bezel');
  if (bezel) bezel.style.padding = bezelPad + 'px';
}
function resizeCanvas() {
  if (canvas.width !== LOGICAL_W) canvas.width = LOGICAL_W;
  if (canvas.height !== LOGICAL_H) canvas.height = LOGICAL_H;
  recomputeSpeeds(); draw();
}
function layoutAll() { layoutGame(); resizeCanvas(); }

function recomputeSpeeds() {
  const W = LOGICAL_W, H = LOGICAL_H;
  const d = DIFFICULTY[currentDiff];
  const preset = ONLINE_DIFF_PRESETS[onlineDiff] || ONLINE_DIFF_PRESETS.hard;
  gPaddleSpeed = (H / (PADDLE_CROSS_TIME * FPS_REF)) * debugParams.paddleSpeedMul * paddleSpeedSetting;
  let onlineMul = 1.0;
  if (gameMode === 'online') onlineMul = onlineBallSpeed * (playerCount === 4 ? preset.ballSpeedMul : 1);
  gBallBaseSpeed = (W / (d.ballCrossTime * FPS_REF)) * debugParams.ballSpeedMul * BALL_SPEED_BONUS * onlineMul;

  let globalPaddleMul = 1.0, globalPaddleSpeed = 1.0;
  if (gameMode === 'online') { globalPaddleMul = onlinePaddleMul; globalPaddleSpeed = onlinePaddleSpeed; }

  let squeezeHalf = false;
  if (playerCount === 4 && teamFormation === 'column' && teamSqueeze) squeezeHalf = true;
  const halfMul = squeezeHalf ? 0.5 : 1.0;

  player.speed = gPaddleSpeed * globalPaddleSpeed * halfMul;
  p2Paddle.speed = gPaddleSpeed * globalPaddleSpeed * halfMul;
  p4Paddle.speed = gPaddleSpeed * globalPaddleSpeed * halfMul;

  const aiDiff = getAIDiff();
  let aiSpeedMul = 1.0;
  if (gameMode === 'ai') aiSpeedMul = aiDiff.aiSpeedMul;
  else if (gameMode === 'online' && playerCount === 4) aiSpeedMul = aiDiff.aiSpeedMul;
  const aiRawSpeed = gPaddleSpeed * aiSpeedMul * globalPaddleSpeed * halfMul;
  ai.speed = Math.min(aiRawSpeed, gPaddleSpeed * AI_SPEED_CAP) * debugParams.aiSpeedMul;

  const onlinePaddleHeightMul = (gameMode === 'online' && playerCount === 4) ? preset.paddleHeightMul : 1;
  const baseHeightFactor = H * d.paddleHeightRatio * debugParams.paddleHeightMul * onlinePaddleHeightMul * globalPaddleMul;

  player.baseHeight = baseHeightFactor;
  ai.baseHeight = baseHeightFactor;
  p2Paddle.baseHeight = baseHeightFactor;
  p4Paddle.baseHeight = baseHeightFactor;

  if (gameMode === 'ai') {
    if (playerBlessing === 'longPaddle') player.baseHeight *= 1.3;
    if (aiBlessing === 'longPaddle') ai.baseHeight *= 1.3;
  } else if (gameMode === 'pvp') {
    /* ★ 修复：本地 PvP 玩家 2 的长拍加护 */
    if (playerBlessing === 'longPaddle') player.baseHeight *= 1.3;
    if (player2Blessing === 'longPaddle') ai.baseHeight *= 1.3;
  } else if (gameMode === 'online' && playerCount === 4) {
    if (getBlessingBySlot(1) === 'longPaddle') player.baseHeight *= 1.3;
    if (getBlessingBySlot(2) === 'longPaddle') p2Paddle.baseHeight *= 1.3;
    if (getBlessingBySlot(3) === 'longPaddle') ai.baseHeight *= 1.3;
    if (getBlessingBySlot(4) === 'longPaddle') p4Paddle.baseHeight *= 1.3;
  } else if (gameMode === 'online' && playerCount === 2) {
    if (getBlessingBySlot(1) === 'longPaddle') player.baseHeight *= 1.3;
    if (getBlessingBySlot(2) === 'longPaddle') ai.baseHeight *= 1.3;
  }

  if (!cheatActive) player.height = player.baseHeight;
  ai.height = ai.baseHeight;
  p2Paddle.height = p2Paddle.baseHeight;
  p4Paddle.height = p4Paddle.baseHeight;
  player.width = Math.max(8, W * 0.013);
  ai.width = player.width;
  p2Paddle.width = player.width;
  p4Paddle.width = player.width;
  ball.baseSize = Math.max(7, W * 0.0115) * debugParams.ballSizeMul;
  ball.maxSize = ball.baseSize * 2;
}

function updateScore() {
  const sp = $('scorePlayer'), sa = $('scoreAI');
  if (sp) { sp.textContent = playerScore; sp.classList.toggle('active', playerScore > aiScore); }
  if (sa) { sa.textContent = aiScore; sa.classList.toggle('active', aiScore > playerScore); }
}
function showScoreboard(show) { const el = $('scoreboard'); if (el) el.classList.toggle('show', !!show); }
function updateShields() {
  const s1 = $('shieldP1'), s2 = $('shieldP2'), c1 = $('shieldP1Count'), c2 = $('shieldP2Count'), box = $('shieldsBox');
  if (s1) s1.classList.toggle('active', p1ShieldCount > 0);
  if (s2) s2.classList.toggle('active', p2ShieldCount > 0);
  if (c1) c1.textContent = p1ShieldCount;
  if (c2) c2.textContent = p2ShieldCount;
  if (box) box.classList.toggle('show', p1ShieldCount > 0 || p2ShieldCount > 0);
}
function updateRoundDisplay() { const e = $('roundNum'); if (e) e.textContent = Math.max(1, roundNumber); }
function updateBlessingDisplay() {
  /* ★ 修复：pvp 也显示加护 */
  const showBlessings = gameStartedOnce && (gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp');
  const topInfo = $('topInfo');
  if (!topInfo) return;
  topInfo.classList.toggle('show', showBlessings);
  if (!showBlessings) return;
  let html = '';
  if (playerCount === 4) {
    for (let s = 1; s <= 4; s++) {
      const info = slotInfo[s];
      const isMe = (onlineRole === 'host' && s === 1) ||
                   (onlineRole === 'client' && s === mySlot) ||
                   (lanRole === 'host' && s === 1) ||
                   (lanRole === 'client' && s === mySlot);
      let name = info ? (info.name || '玩家') : '空位';
      if (isMe) name = '★' + name;
      const bKey = getBlessingBySlot(s);
      const b = BLESSINGS[bKey] || BLESSINGS.none;
      let status = '';
      if (slotAiControl[s]) status = '[AI托管]';
      else if (info && info.isAI) status = '[AI]';
      const color = FOUR_PADDLE_COLORS[s] || '#fff';
      const position = slotLabel(s);
      html += '<div class="blessing-chip" style="border-left:3px solid ' + color + ';padding-left:6px;' +
        (isMe ? 'background:rgba(255,255,255,.06);' : '') + '">' +
        '<span class="bl-dot" style="background:' + b.color + ';color:' + b.color + ';"></span>' +
        '<span class="bl-txt" style="color:' + color + ';font-weight:700;">' + position + '</span>' +
        '<span class="bl-txt" style="color:#ddd;">' + lbEscapeHtml(name) + '</span>' +
        '<span class="bl-txt" style="color:' + b.color + ';font-weight:700;">' + b.label + '</span>' +
        (status ? '<span class="bl-shield" style="color:#ffaa33;font-size:8.5px;">' + status + '</span>' : '') +
        '</div>';
    }
  } else if (gameMode === 'ai') {
    const p1B = BLESSINGS[playerBlessing] || BLESSINGS.none;
    const p2B = BLESSINGS[aiBlessing] || BLESSINGS.none;
    html += '<div class="blessing-chip"><span class="bl-dot" style="background:' + p1B.color + ';color:' + p1B.color + ';"></span><span class="bl-txt" style="color:' + p1B.color + ';">你 · ' + p1B.label + '</span>' + (p1ShieldCount > 0 ? '<span class="bl-shield">🛡×' + p1ShieldCount + '</span>' : '') + '</div>';
    html += '<div class="blessing-chip"><span class="bl-dot" style="background:' + p2B.color + ';color:' + p2B.color + ';"></span><span class="bl-txt" style="color:' + p2B.color + ';">电脑 · ' + p2B.label + '</span>' + (p2ShieldCount > 0 ? '<span class="bl-shield">🛡×' + p2ShieldCount + '</span>' : '') + '</div>';
  } else if (gameMode === 'pvp') {
    /* ★ 本地 PvP 显示双玩家加护 */
    const p1B = BLESSINGS[playerBlessing] || BLESSINGS.none;
    const p2B = BLESSINGS[player2Blessing] || BLESSINGS.none;
    html += '<div class="blessing-chip"><span class="bl-dot" style="background:' + p1B.color + ';color:' + p1B.color + ';"></span><span class="bl-txt" style="color:' + p1B.color + ';">玩家1 · ' + p1B.label + '</span>' + (p1ShieldCount > 0 ? '<span class="bl-shield">🛡×' + p1ShieldCount + '</span>' : '') + '</div>';
    html += '<div class="blessing-chip"><span class="bl-dot" style="background:' + p2B.color + ';color:' + p2B.color + ';"></span><span class="bl-txt" style="color:' + p2B.color + ';">玩家2 · ' + p2B.label + '</span>' + (p2ShieldCount > 0 ? '<span class="bl-shield">🛡×' + p2ShieldCount + '</span>' : '') + '</div>';
  } else if (gameMode === 'online') {
    const isLeftTeam = (mySlot === 1 || mySlot === 2);
    const myB = BLESSINGS[getBlessingBySlot(mySlot)] || BLESSINGS.none;
    const oppSlot = isLeftTeam ? 3 : 1;
    const oppB = BLESSINGS[getBlessingBySlot(oppSlot)] || BLESSINGS.none;
    const myShield = isLeftTeam ? p1ShieldCount : p2ShieldCount;
    const oppShield = isLeftTeam ? p2ShieldCount : p1ShieldCount;
    html += '<div class="blessing-chip"><span class="bl-dot" style="background:' + myB.color + ';color:' + myB.color + ';"></span><span class="bl-txt" style="color:' + myB.color + ';">你 · ' + myB.label + '</span>' + (myShield > 0 ? '<span class="bl-shield">🛡×' + myShield + '</span>' : '') + '</div>';
    html += '<div class="blessing-chip"><span class="bl-dot" style="background:' + oppB.color + ';color:' + oppB.color + ';"></span><span class="bl-txt" style="color:' + oppB.color + ';">敌方 · ' + oppB.label + '</span>' + (oppShield > 0 ? '<span class="bl-shield">🛡×' + oppShield + '</span>' : '') + '</div>';
  }
  topInfo.innerHTML = html;
}

function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}
function updateTimerDisplay() {
  const td = $('timerDisplay');
  if (!td) return;
  td.textContent = formatTime(timerRemaining);
  td.classList.toggle('urgent', timerRemaining <= 10);
}
function updatePauseBtnState() {
  const pb = $('pauseBtn'), pi = $('pauseIcon');
  if (!pb) return;
  const active = gameRunning && !paused;
  pb.classList.toggle('disabled', !active);
  if (pi) {
    if (paused) pi.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    else pi.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  }
}
function updateControlsHint() {
  updatePauseBtnState();
  const ch = $('controlsHint');
  if (!ch) return;
  if (onlineRole === 'host' || onlineRole === 'client' || lanRole) {
    if (isMobile && touchControlMode === 'follow') ch.textContent = '手指拖动屏幕控制球拍 · 联机对战中';
    else ch.textContent = isMobile ? '左侧按钮控制球拍 · 联机对战中' : 'W / S 或 ↑ / ↓ 控制球拍 · 联机对战中';
    return;
  }
  if (timerMode) { ch.textContent = isMobile ? '左右按钮均可控制球拍 · 时间结束分高者胜' : 'W / S 或 ↑ / ↓ 控制球拍 · 时间结束分高者胜'; return; }
  if (gameMode === 'pvp') ch.textContent = isMobile ? '左侧按钮控制左拍 · 右侧按钮控制右拍 · 领先 2 分获胜' : 'W / S 控制左拍 · ↑ / ↓ 控制右拍 · 领先 2 分获胜';
  else ch.textContent = isMobile ? '左右按钮均可控制球拍 · 领先 2 分获胜' : 'W / S 或 ↑ / ↓ 控制球拍 · 领先 2 分获胜';
}
/* ★ 修复：本地 PvP 加护失效 —— getBlessingBySlot 全模式正确返回 */
function getBlessingBySlot(slot) {
  if (gameMode === 'pvp') {
    if (slot === 1) return playerBlessing;
    if (slot === 3) return player2Blessing;
    return 'none';
  }
  if (gameMode === 'ai') {
    if (slot === 1) return playerBlessing;
    if (slot === 3) return aiBlessing;
    return 'none';
  }
  return roomBlessings[slot] || 'none';
}
function getPaddleBySlot(slot) {
  if (slot === 1) return player;
  if (slot === 2) return p2Paddle;
  if (slot === 3) return ai;
  if (slot === 4) return p4Paddle;
  return null;
}
function slotLabel(slot) { return ['—','左上','左下','右上','右下'][slot] || '—'; }
function slotTeam(slot) { return (slot === 1 || slot === 2) ? 'L' : 'R'; }

function checkWin() {
  if (timerMode) return false;
  const cap = winScore + 4;
  if (playerScore >= cap) { endGame('左方获胜！', gameMode !== 'pvp'); return true; }
  if (aiScore >= cap) { endGame(gameMode === 'ai' ? '电脑获胜' : '右方获胜！', gameMode !== 'pvp'); return true; }
  if (playerScore >= winScore && playerScore - aiScore >= 2) { endGame('左方获胜！', gameMode !== 'pvp'); return true; }
  if (aiScore >= winScore && aiScore - playerScore >= 2) { endGame(gameMode === 'ai' ? '电脑获胜' : '右方获胜！', gameMode !== 'pvp'); return true; }
  return false;
}
function resetBall(direction) {
  ballRespawnDelay = 0;
  countdownActive = false;
  ball.size = ball.baseSize; ball.spin = 0;
  isCurvedBall = false; curveTimer = 0; curveChangeTimer = 0; curveMaxTimer = 1;
  activePowerups = []; powerupTimer = 0;
  lastPowerupType = null;
  aiMistakeTimer = 0; aiMistakeType = 'none';
  phosphorTrail = []; floatTexts = []; berserkStack = 0;
  player.height = player.baseHeight;
  ai.height = ai.baseHeight;
  p2Paddle.height = p2Paddle.baseHeight;
  p4Paddle.height = p4Paddle.baseHeight;
  ball.baseSpeed = gBallBaseSpeed * cheatBallSpeedMul;
  ball.initialSpeed = ball.baseSpeed;
  ball.maxSpeed = ball.initialSpeed * 1.8;
  ball.x = LOGICAL_W / 2; ball.y = LOGICAL_H / 2;
  const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
  ball.speedX = Math.cos(angle) * ball.baseSpeed * (direction || 1);
  ball.speedY = Math.sin(angle) * ball.baseSpeed;
  player._aiTargetY = undefined; p2Paddle._aiTargetY = undefined;
  ai._aiTargetY = undefined; p4Paddle._aiTargetY = undefined;
  updateStatusChips();
}
function placePaddlesFour() {
  const W = LOGICAL_W, H = LOGICAL_H, pw = player.width;
  if (teamFormation === 'column') {
    player.x = 30; p2Paddle.x = 30;
    ai.x = W - 30 - pw; p4Paddle.x = W - 30 - pw;
  } else {
    player.x = 30; p2Paddle.x = 30 + pw + 16;
    ai.x = W - 30 - pw; p4Paddle.x = W - 30 - pw - pw - 16;
  }
  player.y = H / 2 - player.height - 12;
  p2Paddle.y = H / 2 + 12;
  ai.y = H / 2 - ai.height - 12;
  p4Paddle.y = H / 2 + 12;
  player.y = clamp(player.y, 0, H - player.height);
  p2Paddle.y = clamp(p2Paddle.y, 0, H - p2Paddle.height);
  ai.y = clamp(ai.y, 0, H - ai.height);
  p4Paddle.y = clamp(p4Paddle.y, 0, H - p4Paddle.height);
}
function resetPositions() {
  recomputeSpeeds();
  if (playerCount === 4) placePaddlesFour();
  else {
    player.x = 30; player.y = LOGICAL_H / 2 - player.height / 2;
    ai.x = Math.max(LOGICAL_W - 30 - ai.width, LOGICAL_W / 2 + 20);
    ai.y = LOGICAL_H / 2 - ai.height / 2;
  }
  resetBall(Math.random() > 0.5 ? 1 : -1);
}
function onRoundStart() {
  roundNumber++;
  updateRoundDisplay();
  playerControlledByAI = false;
  if (gameMode === 'ai' && playerBlessing === 'firstStrike' && (roundNumber % 10 === 1)) playerControlledByAI = true;
  frenzyActiveP1 = ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(1) === 'frenzy' && (roundNumber % 8 === 0));
  frenzyActiveP2 = ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(3) === 'frenzy' && (roundNumber % 8 === 0));
  if (gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') {
    const nerf = isFourPlayerOnline();
    const shieldChance = nerf ? FOUR_NERF.shieldChance : 0.10;
    const shieldMax = nerf ? FOUR_NERF.shieldMax : 3;
    const b1 = gameMode === 'ai' ? playerBlessing : getBlessingBySlot(1);
    const b3 = gameMode === 'ai' ? aiBlessing : getBlessingBySlot(3);
    if (b1 === 'shield' && Math.random() < shieldChance && p1ShieldCount < shieldMax) p1ShieldCount++;
    if (b3 === 'shield' && Math.random() < shieldChance && p2ShieldCount < shieldMax) p2ShieldCount++;
  }
  updateShields();
  updateBlessingDisplay();
}

function spawnPowerup() {
  const types = Object.keys(POWERUPS);
  let weights = types.map(t => { let w = POWERUP_WEIGHTS[t] || 1; if (t === lastPowerupType) w = 0; return w; });
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) { weights = types.map(t => POWERUP_WEIGHTS[t] || 1); total = weights.reduce((a, b) => a + b, 0); }
  let r = Math.random() * total;
  let chosen = types[0];
  for (let i = 0; i < types.length; i++) { r -= weights[i]; if (r <= 0) { chosen = types[i]; break; } }
  lastPowerupType = chosen;
  activePowerups.push({ type: chosen, timer: POWERUPS[chosen].duration, applied:false, maxTimer: POWERUPS[chosen].duration, owner:null });
  AudioEngine.powerup();
  updateStatusChips();
}
function applyPowerupEffect(pu) {
  switch (pu.type) {
    case 'speed': ball.baseSpeed = Math.min(ball.baseSpeed * 1.6, ball.maxSpeed); ball.speedX = ball.speedX > 0 ? ball.baseSpeed : -ball.baseSpeed; break;
    case 'slow': ball.baseSpeed = Math.max(ball.baseSpeed * 0.5, ball.initialSpeed * 0.4); ball.speedX = ball.speedX > 0 ? ball.baseSpeed : -ball.baseSpeed; break;
    case 'big': ball.size = Math.min(ball.baseSize * 2, ball.maxSize); break;
    case 'small': ball.size = ball.baseSize * 0.5; break;
    case 'long': {
      const b1 = gameMode === 'ai' ? playerBlessing : getBlessingBySlot(1);
      const p1HasLongBlessing = (b1 === 'longPaddle' && (gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp'));
      if (!p1HasLongBlessing && Math.random() < 0.5) {
        player.height = Math.min(player.baseHeight * 1.5, LOGICAL_H);
        player.y = clamp(player.y, 0, LOGICAL_H - player.height);
        pu.owner = 'p1';
      } else {
        ai.height = Math.min(ai.baseHeight * 1.5, LOGICAL_H);
        ai.y = clamp(ai.y, 0, LOGICAL_H - ai.height);
        pu.owner = 'p2';
      }
      break;
    }
  }
}
function clearPowerupEffects() {
  ball.baseSpeed = ball.initialSpeed;
  ball.size = ball.baseSize;
  if (!cheatActive) player.height = player.baseHeight;
  ai.height = ai.baseHeight;
  p2Paddle.height = p2Paddle.baseHeight;
  p4Paddle.height = p4Paddle.baseHeight;
  player.y = clamp(player.y, 0, LOGICAL_H - player.height);
  ai.y = clamp(ai.y, 0, LOGICAL_H - ai.height);
  p2Paddle.y = clamp(p2Paddle.y, 0, LOGICAL_H - p2Paddle.height);
  p4Paddle.y = clamp(p4Paddle.y, 0, LOGICAL_H - p4Paddle.height);
  updateStatusChips();
}
function updateStatusChips() {
  let anyVisible = false;
  const c1 = $('chipP1Powerup'), c1l = $('chipP1PowerupLabel'), c1b = $('chipP1PowerupBar');
  const cb = $('chipBerserk'), cbb = $('chipBerserkBar');
  const cc = $('chipCurve'), ccb = $('chipCurveBar');
  const sb = $('statusBar');
  if (activePowerups.length > 0 && c1) {
    const pu = activePowerups[0];
    const info = POWERUPS[pu.type];
    const maxT = pu.maxTimer || info.duration;
    const pct = clamp(pu.timer / maxT, 0, 1) * 100;
    let label = info.label;
    if (pu.type === 'long') { if (pu.owner === 'p1') label = '长拍·我'; else if (pu.owner === 'p2') label = '长拍·敌'; else label = '长拍'; }
    c1.classList.remove('hidden');
    if (c1l) { c1l.textContent = label; c1l.style.color = info.color; }
    if (c1b) { c1b.style.width = pct + '%'; c1b.style.background = info.color; }
    anyVisible = true;
  } else if (c1) c1.classList.add('hidden');
  if (berserkStack > 0 && (gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(1) === 'berserk' && cb) {
    cb.classList.remove('hidden');
    if (cbb) cbb.style.width = (berserkStack / BERSERK_MAX * 100) + '%';
    anyVisible = true;
  } else if (cb) cb.classList.add('hidden');
  if (isCurvedBall && curveMaxTimer > 0 && cc) {
    cc.classList.remove('hidden');
    if (ccb) ccb.style.width = clamp(curveTimer / curveMaxTimer, 0, 1) * 100 + '%';
    anyVisible = true;
  } else if (cc) cc.classList.add('hidden');
  if (sb) sb.classList.toggle('show', anyVisible);
}

function checkPaddle(paddle, isPlayer, slot) {
  const r = ball.size / 2;
  if (ball.x + r < paddle.x || ball.x - r > paddle.x + paddle.width) return false;
  if (ball.y + r < paddle.y || ball.y - r > paddle.y + paddle.height) return false;
  const movingRight = ball.speedX > 0;
  const isLeft = (slot === 1 || slot === 2) || (slot === undefined && isPlayer);
  if (isLeft && movingRight) return false;
  if (!isLeft && !movingRight) return false;
  const ph = paddle.height;
  let hitPos = clamp((ball.y - (paddle.y + ph / 2)) / (ph / 2), -1, 1);
  if (!isLeft && isAiControlled()) {
    const attackMul = { easy: 1.05, normal: 1.25, hard: 1.45, hell: 1.65 }[currentDiff] || 1.25;
    hitPos = clamp(hitPos * attackMul, -1, 1);
  }
  const angle = hitPos * (Math.PI / 3);
  ball.baseSpeed = Math.min(ball.baseSpeed + ball.initialSpeed * 0.05, ball.maxSpeed);
  const dir = isLeft ? 1 : -1;
  const spinIntensity = Math.abs(hitPos);
  const slotBlessing = slot !== undefined ? getBlessingBySlot(slot) : (isLeft ? playerBlessing : (gameMode === 'pvp' ? player2Blessing : aiBlessing));
  let spinThreshold = 0.4;
  if (isLeft && (gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && slotBlessing === 'spin') spinThreshold = 0.4 / 1.4;
  let newSpeedX = Math.cos(angle) * ball.baseSpeed * dir;
  let newSpeedY = Math.sin(angle) * ball.baseSpeed;
  let newSpin = 0;
  if (spinIntensity > spinThreshold) {
    AudioEngine.spinHit();
    const rng = Math.random();
    if (rng < SPIN_CURVE_PROB) { newSpin = hitPos * 1.6 * spinIntensity; newSpeedY *= 1.15; }
    else if (rng < SPIN_CURVE_PROB + SPIN_SPEED_PROB) {
      ball.baseSpeed = Math.min(ball.baseSpeed * 1.2, ball.maxSpeed);
      newSpeedX = Math.cos(angle) * ball.baseSpeed * dir;
      newSpeedY = Math.sin(angle) * ball.baseSpeed;
    }
  } else newSpin = hitPos * 0.5 * spinIntensity;
  if (isLeft && (gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && slotBlessing === 'berserk') {
    const per = 0.07;
    if (berserkStack < BERSERK_MAX) { berserkStack++; AudioEngine.berserk(); }
    const baseFromBerserk = Math.min(ball.initialSpeed * (1 + per * berserkStack), ball.maxSpeed);
    if (baseFromBerserk > ball.baseSpeed) ball.baseSpeed = baseFromBerserk;
    newSpeedX = Math.cos(angle) * ball.baseSpeed * dir;
    newSpeedY = Math.sin(angle) * ball.baseSpeed;
  }
  ball.speedX = newSpeedX; ball.speedY = newSpeedY; ball.spin = newSpin;
  if (isLeft) ball.x = paddle.x + paddle.width + r + 0.5;
  else ball.x = paddle.x - r - 0.5;
  AudioEngine.hit();
  triggerCurveBall(isLeft);
  return true;
}
function triggerCurveBall(fromLeft) {
  if (isCurvedBall) return;
  const d = DIFFICULTY[currentDiff];
  const preset = ONLINE_DIFF_PRESETS[onlineDiff] || ONLINE_DIFF_PRESETS.hard;
  let prob = d.curveProb * debugParams.curveProbMul;
  if (gameMode === 'online' && playerCount === 4) prob *= preset.curveProbMul;
  if (gameMode === 'online') prob *= onlineCurveMul;
  if (gameMode !== 'ai') prob *= 1.15;
  if (fromLeft && frenzyActiveP1) prob *= 1.5;
  if (!fromLeft && frenzyActiveP2) prob *= 1.5;
  if (Math.random() < prob) {
    isCurvedBall = true;
    curveMaxTimer = (200 + Math.floor(Math.random() * 200)) * 0.5;
    curveTimer = curveMaxTimer;
    curveChangeTimer = 0;
    AudioEngine.curveBall();
    updateStatusChips();
  }
}
/* ★ 回合结束：立即交还控制权，避免首发加护延迟一球 */
function handleOutOfBounds() {
  playerControlledByAI = false;
  if (ball.x < 0) {
    berserkStack = 0;
    const wasCurved = isCurvedBall;
    if (wasCurved && gameMode === 'ai' && playerBlessing === 'frenzy' && Math.random() < 0.15) {
      ballRespawnDelay = SERVE_DELAY_FRAMES; nextBallDirection = 1; return;
    }
    if (p1ShieldCount > 0) {
      p1ShieldCount--; updateShields(); updateBlessingDisplay(); AudioEngine.shieldBreak();
      ballRespawnDelay = SERVE_DELAY_FRAMES; nextBallDirection = 1; return;
    }
    let scoreAmount = 1;
    const spearDouble = isFourPlayerOnline() ? FOUR_NERF.spearDouble : 0.06;
    if ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(3) === 'spear' && Math.random() < spearDouble) scoreAmount = 2;
    aiScore += scoreAmount;
    updateScore();
    matchCheck.score();
    if (gameMode === 'ai') AudioEngine.lose(); else AudioEngine.score();
    const gamblerChance = 0.00008;
    if ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(3) === 'gambler' && Math.random() < gamblerChance) {
      endGame('赌神加护触发！对手直接获胜', false); return;
    }
    if (checkWin()) return;
    ballRespawnDelay = SERVE_DELAY_FRAMES; nextBallDirection = 1;
  } else if (ball.x > LOGICAL_W) {
    berserkStack = 0;
    const wasCurved = isCurvedBall;
    if (wasCurved && gameMode === 'ai' && aiBlessing === 'frenzy' && Math.random() < 0.15) {
      ballRespawnDelay = SERVE_DELAY_FRAMES; nextBallDirection = -1; return;
    }
    if (p2ShieldCount > 0) {
      let ignoreShield = false;
      const spearPierce = isFourPlayerOnline() ? FOUR_NERF.spearPierce : 0.5;
      if ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(1) === 'spear' && Math.random() < spearPierce) ignoreShield = true;
      if (!ignoreShield) {
        p2ShieldCount--; updateShields(); updateBlessingDisplay(); AudioEngine.shieldBreak();
        ballRespawnDelay = SERVE_DELAY_FRAMES; nextBallDirection = -1; return;
      }
    }
    let scoreAmount = 1;
    const spearDouble = isFourPlayerOnline() ? FOUR_NERF.spearDouble : 0.06;
    if ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(1) === 'spear' && Math.random() < spearDouble) scoreAmount = 2;
    playerScore += scoreAmount;
    updateScore(); AudioEngine.score();
    matchCheck.score();
    const gamblerChance = 0.00008;
    if ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && getBlessingBySlot(1) === 'gambler' && Math.random() < gamblerChance) {
      endGame('赌神加护触发！直接获胜', true); return;
    }
    if (checkWin()) return;
    ballRespawnDelay = SERVE_DELAY_FRAMES; nextBallDirection = -1;
  }
}
function endTimerGame() {
  gameRunning = false;
  if (animId) cancelAnimationFrame(animId); animId = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (playerScore > aiScore) endGame('左方获胜！', true);
  else if (aiScore > playerScore) endGame(timerOpponent === 'ai' ? '电脑获胜' : '右方获胜！', false);
  else endGame('平局！', true);
}
function endGame(msg, isWin) {
  gameRunning = false; paused = false;
  if (animId) cancelAnimationFrame(animId); animId = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  ballRespawnDelay = 0; countdownActive = false; phosphorTrail = []; berserkStack = 0;
  flushPlayTime();
  const check = matchCheck.finish();
  resultMatch = rankedMatch;
  lbFinishMatch(check);
  if (isWin && msg !== '平局！') AudioEngine.win();
  else if (msg === '平局！') AudioEngine.countdown();
  else AudioEngine.lose();
  const rt = $('resultTitle'), rs = $('resultSub'), rsb = $('resultStartBtn'), rrb = $('resultRoomBtn');
  if (rt) rt.textContent = msg;
  if (rs) {
    if (timerMode) rs.textContent = '最终比分 ' + playerScore + ' : ' + aiScore + ' · 用时 ' + formatTime(timerSeconds);
    else rs.textContent = '最终比分 ' + playerScore + ' : ' + aiScore + ' · 共 ' + roundNumber + ' 回合';
    if (rankedMode()) {
      if (!check.ok) rs.textContent += ' · 本局未通过本机对局检查';
      else if (!accountUser) rs.textContent += ' · 游客战绩仅保存在本机';
      else if (!accountProfile) rs.textContent += ' · 设置账号昵称后可参与全球榜';
      else if (deviceBanned) rs.textContent += ' · 当前账号或设备已被限制参与排行榜';
      else if (!resultMatch) rs.textContent += ' · 全球榜未记录本局';
    }
  }
  if (gameMode === 'online' && onlineRole === 'client') {
    if (rsb) rsb.style.display = 'none';
    if (rs) rs.textContent += ' · 等待主机开始下一局';
  } else if (rsb) rsb.style.display = '';
  if (rrb) rrb.style.display = ((gameMode === 'online' && onlineRole === 'host') || (transportMode === 'lan' && lanRole === 'host')) ? 'block' : 'none';
  showScoreboard(false);
  const td = $('timerDisplay'); if (td) td.classList.remove('show');
  const sb = $('shieldsBox'); if (sb) sb.classList.remove('show');
  const ti = $('topInfo'); if (ti) ti.classList.remove('show');
  const sbe = $('statusBar'); if (sbe) sbe.classList.remove('show');
  const c1 = $('chipP1Powerup'); if (c1) c1.classList.add('hidden');
  const cb = $('chipBerserk'); if (cb) cb.classList.add('hidden');
  const cc = $('chipCurve'); if (cc) cc.classList.add('hidden');
  document.body.classList.remove('show-ctrl');
  updatePauseBtnState();
  navStack = [];
  applyPanel('result');
  const ov = $('overlay'); if (ov) ov.classList.remove('hidden');
  if (onlineRole === 'host' || lanRole === 'host') { const m = JSON.stringify({ t:'end', msg, isWin }); transportSend(m); }
}

function startTimer() {
  timerRemaining = timerSeconds;
  lastTimerSecond = Math.ceil(timerRemaining);
  updateTimerDisplay();
  const td = $('timerDisplay'); if (td) td.classList.add('show');
  if (onlineRole === 'client' || lanRole === 'client') return;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!gameRunning || countdownActive || paused) return;
    timerRemaining = Math.max(0, (Math.round(timerRemaining * 1000) - 100) / 1000);
    const cur = Math.ceil(timerRemaining);
    if (cur !== lastTimerSecond && cur <= 10 && cur > 0) { AudioEngine.timerTick(); lastTimerSecond = cur; }
    updateTimerDisplay();
    if (timerRemaining <= 0) { timerRemaining = 0; updateTimerDisplay(); endTimerGame(); }
  }, 100);
}

function applySqueezeCollision(top, bot) {
  const overlap = (top.y + top.height) - bot.y;
  if (overlap > 0) {
    const newBotY = Math.min(bot.y + overlap, LOGICAL_H - bot.height);
    bot.y = newBotY;
    const still = (top.y + top.height) - bot.y;
    if (still > 0) top.y = Math.max(0, bot.y - top.height);
  }
  if (top.y < 0) top.y = 0;
  if (bot.y + bot.height > LOGICAL_H) bot.y = LOGICAL_H - bot.height;
}
function constrainFourPaddles() {
  const H = LOGICAL_H, mid = H / 2;
  if (teamFormation === 'column') {
    if (teamSqueeze) {
      let a = player, b = p2Paddle;
      if (a.y > b.y) { const t = a; a = b; b = t; }
      applySqueezeCollision(a, b);
      let c = ai, d = p4Paddle;
      if (c.y > d.y) { const t = c; c = d; d = t; }
      applySqueezeCollision(c, d);
    } else {
      player.y = clamp(player.y, 0, mid - player.height);
      p2Paddle.y = clamp(p2Paddle.y, mid, H - p2Paddle.height);
      ai.y = clamp(ai.y, 0, mid - ai.height);
      p4Paddle.y = clamp(p4Paddle.y, mid, H - p4Paddle.height);
    }
  } else {
    player.y = clamp(player.y, 0, H - player.height);
    p2Paddle.y = clamp(p2Paddle.y, 0, H - p2Paddle.height);
    ai.y = clamp(ai.y, 0, H - ai.height);
    p4Paddle.y = clamp(p4Paddle.y, 0, H - p4Paddle.height);
  }
}
function applyTargetY(pad, dt) {
  if (!pad || typeof pad.targetY !== 'number') return;
  const dy = pad.targetY - pad.y;
  const maxStep = pad.speed * 1.6 * dt;
  const step = Math.sign(dy) * Math.min(Math.abs(dy), maxStep);
  pad.y += step;
  if (Math.abs(pad.targetY - pad.y) < 0.6) pad.targetY = null;
}
function applyFollowTouchToLocal(dt) {
  if (touchControlMode !== 'follow') return;
  if (followTouchTargetY == null) return;
  const applyTo = (pad) => {
    const targetY = clamp(followTouchTargetY - pad.height / 2, 0, LOGICAL_H - pad.height);
    const dy = targetY - pad.y;
    const maxStep = pad.speed * 1.5 * dt;
    const step = Math.sign(dy) * Math.min(Math.abs(dy), maxStep);
    pad.y = clamp(pad.y + step, 0, LOGICAL_H - pad.height);
  };
  if (onlineRole === 'client' || lanRole === 'client') { const mp = getPaddleBySlot(mySlot); if (mp) applyTo(mp); return; }
  applyTo(player);
}
function movePaddles(dt) {
  const isClient = (onlineRole === 'client' || lanRole === 'client');
  if (isClient && playerCount === 4) {
    const myPad = getPaddleBySlot(mySlot);
    if (myPad) {
      if (touchControlMode === 'follow' && isMobile) applyFollowTouchToLocal(dt);
      else {
        let up = !!(keys['w'] || keys['W'] || keys['ArrowUp'] || touchState.p1 === -1);
        let down = !!(keys['s'] || keys['S'] || keys['ArrowDown'] || touchState.p1 === 1);
        if (up) myPad.y -= myPad.speed * dt;
        if (down) myPad.y += myPad.speed * dt;
        myPad.y = clamp(myPad.y, 0, LOGICAL_H - myPad.height);
      }
    }
    return;
  }
  if (isClient && playerCount === 2) {
    if (touchControlMode === 'follow' && isMobile) applyFollowTouchToLocal(dt);
    else {
      let up = !!(keys['w'] || keys['W'] || keys['ArrowUp'] || touchState.p1 === -1);
      let down = !!(keys['s'] || keys['S'] || keys['ArrowDown'] || touchState.p1 === 1);
      if (up) ai.y -= ai.speed * dt;
      if (down) ai.y += ai.speed * dt;
      ai.y = clamp(ai.y, 0, LOGICAL_H - ai.height);
    }
    return;
  }
  const p1Up = !!(keys['w'] || keys['W'] || touchState.p1 === -1);
  const p1Down = !!(keys['s'] || keys['S'] || touchState.p1 === 1);
  let up = p1Up, down = p1Down;
  if (gameMode === 'ai' || gameMode === 'online' || isAiControlled()) {
    if (keys['ArrowUp']) up = true;
    if (keys['ArrowDown']) down = true;
  }
  if (playerControlledByAI) updatePlayerAsAI(dt);
  else if (touchControlMode === 'follow' && isMobile) applyFollowTouchToLocal(dt);
  else {
    if (up) player.y -= player.speed * dt;
    if (down) player.y += player.speed * dt;
    player.y = clamp(player.y, 0, LOGICAL_H - player.height);
  }
  if (playerCount === 4) {
    if (slotAiControl[2] || (slotInfo[2] && slotInfo[2].isAI)) updateAISmart(p2Paddle, dt, { slot: 2, isLeft: true, halfMin: LOGICAL_H / 2, halfMax: LOGICAL_H });
    else if (slotInfo[2] && slotInfo[2].clientId && fourPeers[slotInfo[2].clientId]) applyTargetY(p2Paddle, dt);
    else updateAISmart(p2Paddle, dt, { slot: 2, isLeft: true, halfMin: LOGICAL_H / 2, halfMax: LOGICAL_H });
    if (slotAiControl[3] || (slotInfo[3] && slotInfo[3].isAI)) updateAISmart(ai, dt, { slot: 3, isLeft: false, halfMin: 0, halfMax: LOGICAL_H / 2 });
    else if (slotInfo[3] && slotInfo[3].clientId && fourPeers[slotInfo[3].clientId]) applyTargetY(ai, dt);
    else updateAISmart(ai, dt, { slot: 3, isLeft: false, halfMin: 0, halfMax: LOGICAL_H / 2 });
    if (slotAiControl[4] || (slotInfo[4] && slotInfo[4].isAI)) updateAISmart(p4Paddle, dt, { slot: 4, isLeft: false, halfMin: LOGICAL_H / 2, halfMax: LOGICAL_H });
    else if (slotInfo[4] && slotInfo[4].clientId && fourPeers[slotInfo[4].clientId]) applyTargetY(p4Paddle, dt);
    else updateAISmart(p4Paddle, dt, { slot: 4, isLeft: false, halfMin: LOGICAL_H / 2, halfMax: LOGICAL_H });
    constrainFourPaddles();
  } else {
    if (gameMode === 'pvp') {
      const p2Up = !!(keys['ArrowUp'] || touchState.p2 === -1);
      const p2Down = !!(keys['ArrowDown'] || touchState.p2 === 1);
      if (p2Up) ai.y -= ai.speed * dt;
      if (p2Down) ai.y += ai.speed * dt;
      ai.y = clamp(ai.y, 0, LOGICAL_H - ai.height);
    } else if (onlineRole === 'host' || lanRole === 'host') {
      if (remotePaddleY !== null) { const k = 1 - Math.pow(0.7, dt); ai.y += (remotePaddleY - ai.y) * k; ai.y = clamp(ai.y, 0, LOGICAL_H - ai.height); }
    } else if (gameMode === 'ai') updateAISmart(ai, dt, { slot: 3, isLeft: false });
  }
}
function moveBall(dt) {
  const sp = Math.hypot(ball.speedX, ball.speedY);
  if (sp > ball.maxSpeed) { const s = ball.maxSpeed / sp; ball.speedX *= s; ball.speedY *= s; }
  const dx = ball.speedX * dt, dy = ball.speedY * dt;
  const ms = Math.max(ball.size * 0.5, 4);
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / ms));
  const sx = dx / steps, sy = dy / steps;
  const r = ball.size / 2;
  for (let i = 0; i < steps; i++) {
    ball.x += sx; ball.y += sy;
    if (ball.y - r <= 0) { ball.y = r; ball.speedY = Math.abs(ball.speedY); }
    else if (ball.y + r >= LOGICAL_H) { ball.y = LOGICAL_H - r; ball.speedY = -Math.abs(ball.speedY); }
    if (playerCount === 4) {
      if (checkPaddle(player, true, 1)) return;
      if (checkPaddle(p2Paddle, true, 2)) return;
      if (checkPaddle(ai, false, 3)) return;
      if (checkPaddle(p4Paddle, false, 4)) return;
    } else {
      if (checkPaddle(player, true)) return;
      if (checkPaddle(ai, false)) return;
    }
    if (ball.x < 0 || ball.x > LOGICAL_W) { handleOutOfBounds(); return; }
  }
}
function update(dt) {
  if (!gameRunning || paused || countdownActive || onlinePausedByHost) return;
  matchCheck.tick();
  if (onlineRole !== 'client' && lanRole !== 'client') updateFloatTexts(dt);
  if (onlineRole === 'client' || lanRole === 'client') { movePaddles(dt); return; }
  if (ballRespawnDelay > 0) {
    ballRespawnDelay -= dt;
    if (ballRespawnDelay <= 0) { ballRespawnDelay = 0; onRoundStart(); resetBall(nextBallDirection); }
    movePaddles(dt);
    return;
  }
  movePaddles(dt);
  if (Math.abs(ball.spin) > 0.01) {
    ball.speedY += ball.spin * 0.55 * dt;
    ball.spin *= Math.pow(0.978, dt);
    if (Math.abs(ball.spin) <= 0.01) ball.spin = 0;
    ball.speedY = clamp(ball.speedY, -ball.maxSpeed, ball.maxSpeed);
  }
  if (isCurvedBall) {
    curveTimer -= dt; curveChangeTimer -= dt;
    if (curveChangeTimer <= 0) {
      const baseSpd = ball.baseSpeed;
      const dirX = ball.speedX >= 0 ? 1 : -1;
      ball.speedY = (Math.random() - 0.5) * baseSpd * 1.3;
      let hMul = 0.65 + Math.random() * 0.5;
      if (Math.random() < 0.4) hMul *= (Math.random() < 0.5 ? 0.75 : 1.3);
      ball.speedX = dirX * baseSpd * hMul;
      ball.speedX = clamp(ball.speedX, -ball.maxSpeed, ball.maxSpeed);
      ball.speedY = clamp(ball.speedY, -ball.maxSpeed, ball.maxSpeed);
      curveChangeTimer = 8 + Math.floor(Math.random() * 12);
    }
    if (curveTimer <= 0) { isCurvedBall = false; updateStatusChips(); }
  }
  powerupTimer += dt;
  const preset = ONLINE_DIFF_PRESETS[onlineDiff] || ONLINE_DIFF_PRESETS.hard;
  let puProb = POWERUP_BASE_PROB * debugParams.powerupRate;
  if (gameMode === 'online' && playerCount === 4) puProb *= preset.powerupRate;
  if (gameMode === 'online') puProb *= onlinePowerupMul;
  if (gameMode !== 'ai') puProb *= 1.15;
  if (powerupTimer > 100 && activePowerups.length === 0 && Math.random() < puProb * dt) { spawnPowerup(); powerupTimer = 0; }
  for (let i = activePowerups.length - 1; i >= 0; i--) {
    const pu = activePowerups[i];
    if (!pu.applied) { applyPowerupEffect(pu); pu.applied = true; }
    pu.timer -= dt;
    if (pu.timer <= 0) {
      activePowerups.splice(i, 1);
      clearPowerupEffects();
      AudioEngine.powerupEnd();
      activePowerups.forEach(p => { if (p.applied) applyPowerupEffect(p); });
    }
  }
  updateStatusChips();
  moveBall(dt);
  if (renderMode !== 'simple') {
    phosphorTrail.push({ x:ball.x, y:ball.y, size:ball.size });
    if (phosphorTrail.length > MAX_TRAIL) phosphorTrail.shift();
  }
}

const NOISE_TILE_COUNT = 8, NOISE_TILE_SIZE = 128;
let noiseTiles = [], noiseIdx = 0, noiseOffsetX = 0, noiseOffsetY = 0, noiseSwitchCounter = 0;
let noisePattern = null, noisePatternIdx = -1;
(function buildNoiseTiles() {
  for (let t = 0; t < NOISE_TILE_COUNT; t++) {
    const c = document.createElement('canvas');
    c.width = NOISE_TILE_SIZE; c.height = NOISE_TILE_SIZE;
    const cx = c.getContext('2d');
    const img = cx.createImageData(NOISE_TILE_SIZE, NOISE_TILE_SIZE);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255; }
    cx.putImageData(img, 0, 0);
    noiseTiles.push(c);
  }
})();
function getNoisePattern(idx) {
  if (noisePatternIdx === idx && noisePattern) return noisePattern;
  try { noisePattern = ctx.createPattern(noiseTiles[idx], 'repeat'); noisePatternIdx = idx; }
  catch (e) { noisePattern = null; }
  return noisePattern;
}
function drawPaddle(paddle, theme, opts) {
  opts = opts || {};
  const color = opts.color || theme.color;
  const glow = opts.glow || theme.glow;
  if (renderMode === 'simple') { ctx.fillStyle = color; ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height); return; }
  ctx.shadowColor = glow; ctx.shadowBlur = 15;
  ctx.fillStyle = color;
  ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
  ctx.shadowBlur = 0;
  if (opts.firstStrike) {
    ctx.strokeStyle = '#33ff99'; ctx.lineWidth = 2; ctx.setLineDash([4,3]);
    ctx.strokeRect(paddle.x - 2, paddle.y - 2, paddle.width + 4, paddle.height + 4);
    ctx.setLineDash([]);
    ctx.fillStyle = '#33ff99'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('AI', paddle.x + paddle.width/2, paddle.y - 6);
  }
  if (opts.botControl) {
    ctx.strokeStyle = '#ffaa33'; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
    ctx.strokeRect(paddle.x - 3, paddle.y - 3, paddle.width + 6, paddle.height + 6);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffaa33'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('AI', paddle.x + paddle.width/2, paddle.y - 6);
  }
  if (opts.frenzy) {
    ctx.strokeStyle = '#ff44aa'; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6 + Math.sin(performance.now() * 0.012) * 0.4;
    ctx.strokeRect(paddle.x - 3, paddle.y - 3, paddle.width + 6, paddle.height + 6);
    ctx.globalAlpha = 1;
  }
  if (opts.longPaddle) {
    ctx.strokeStyle = '#ffaa44'; ctx.lineWidth = 1.5;
    ctx.strokeRect(paddle.x - 1, paddle.y - 1, paddle.width + 2, paddle.height + 2);
  }
  if (opts.berserk) {
    ctx.strokeStyle = '#ff6622'; ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5 + Math.sin(performance.now() * 0.02) * 0.4;
    ctx.strokeRect(paddle.x - 2, paddle.y - 2, paddle.width + 4, paddle.height + 4);
    ctx.globalAlpha = 1;
  }
  if (opts.shields > 0) {
    const side = opts.side || 'left';
    const baseX = side === 'left' ? paddle.x - 9 : paddle.x + paddle.width + 9;
    for (let i = 0; i < opts.shields; i++) {
      const yy = paddle.y + paddle.height * (i + 1) / (opts.shields + 1);
      ctx.strokeStyle = '#88aaff'; ctx.shadowColor = '#88aaff'; ctx.shadowBlur = 8; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(baseX, yy, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}
function drawServeHint() {
  if (ballRespawnDelay <= 0 || ballRespawnDelay > SERVE_HINT_FRAMES) return;
  const t = getTheme();
  const cx = LOGICAL_W / 2, cy = LOGICAL_H / 2;
  const progress = 1 - (ballRespawnDelay / SERVE_HINT_FRAMES);
  const alpha = 0.35 + 0.65 * progress;
  const dir = nextBallDirection;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = t.color;
  ctx.shadowColor = t.glow;
  ctx.shadowBlur = 20;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  const arrowLen = 50 + 40 * progress;
  ctx.beginPath();
  ctx.moveTo(cx - dir * 15, cy);
  ctx.lineTo(cx + dir * arrowLen, cy);
  ctx.stroke();
  const headBack = cx + dir * (arrowLen - 20);
  ctx.beginPath();
  ctx.moveTo(cx + dir * arrowLen, cy);
  ctx.lineTo(headBack, cy - 14);
  ctx.moveTo(cx + dir * arrowLen, cy);
  ctx.lineTo(headBack, cy + 14);
  ctx.stroke();
  const ringR = 8 + (1 - progress) * 22;
  ctx.globalAlpha = alpha * 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}
function draw() {
  const t = getTheme();
  const W = LOGICAL_W, H = LOGICAL_H;
  const simple = renderMode === 'simple';
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  const shouldDrawEntities = gameRunning || countdownActive || paused;
  if (shouldDrawEntities && !simple) {
    const cinematic = renderMode === 'cinematic';
    if (cinematic) {
      noiseSwitchCounter++;
      if (noiseSwitchCounter >= 2) {
        noiseSwitchCounter = 0;
        noiseIdx = (noiseIdx + 1) % NOISE_TILE_COUNT;
        noiseOffsetX = (Math.random() * NOISE_TILE_SIZE) | 0;
        noiseOffsetY = (Math.random() * NOISE_TILE_SIZE) | 0;
      }
      const tile = noiseTiles[noiseIdx];
      if (tile) {
        const pat = getNoisePattern(noiseIdx);
        if (pat) {
          ctx.save(); ctx.translate(-noiseOffsetX, -noiseOffsetY);
          ctx.globalAlpha = 0.045; ctx.fillStyle = pat;
          ctx.fillRect(0, 0, W + NOISE_TILE_SIZE, H + NOISE_TILE_SIZE);
          ctx.restore(); ctx.globalAlpha = 1;
        }
      }
      const sparkCount = 40 + ((Math.random() * 20) | 0);
      for (let i = 0; i < sparkCount; i++) {
        const px = (Math.random() * W) | 0, py = (Math.random() * H) | 0;
        const isBright = Math.random() < 0.6;
        if (isBright) ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + Math.random() * 0.12).toFixed(3) + ')';
        else ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + Math.random() * 0.25).toFixed(3) + ')';
        ctx.fillRect(px, py, 1, 1);
      }
      const flickerAlpha = 0.012 + Math.random() * 0.02;
      ctx.fillStyle = 'rgba(255,255,255,' + flickerAlpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    } else {
      const tile = noiseTiles[0];
      if (tile) {
        const pat = getNoisePattern(0);
        if (pat) { ctx.save(); ctx.globalAlpha = 0.035; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore(); ctx.globalAlpha = 1; }
      }
    }
  }
  ctx.strokeStyle = t.dim; ctx.lineWidth = 2;
  ctx.setLineDash([10, 15]);
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  if (playerCount === 4) {
    ctx.setLineDash([6, 12]); ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (!shouldDrawEntities) return;
  const b1 = gameMode === 'ai' ? playerBlessing : getBlessingBySlot(1);
  const b3 = gameMode === 'ai' ? aiBlessing : getBlessingBySlot(3);
  const p1IsLong = ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && b1 === 'longPaddle');
  const p2IsLong = ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && b3 === 'longPaddle');
  const p1IsBerserk = ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && b1 === 'berserk' && berserkStack > 0);
  if (playerCount === 4) {
    drawPaddle(player, t, { side:'left', shields: p1ShieldCount, firstStrike: playerControlledByAI, frenzy: frenzyActiveP1, color: FOUR_PADDLE_COLORS[1], longPaddle: getBlessingBySlot(1) === 'longPaddle', botControl: slotAiControl[1] });
    drawPaddle(p2Paddle, t, { side:'left', color: FOUR_PADDLE_COLORS[2], longPaddle: getBlessingBySlot(2) === 'longPaddle', botControl: slotAiControl[2] });
    drawPaddle(ai, t, { side:'right', shields: p2ShieldCount, frenzy: frenzyActiveP2, color: FOUR_PADDLE_COLORS[3], longPaddle: getBlessingBySlot(3) === 'longPaddle', botControl: slotAiControl[3] });
    drawPaddle(p4Paddle, t, { side:'right', color: FOUR_PADDLE_COLORS[4], longPaddle: getBlessingBySlot(4) === 'longPaddle', botControl: slotAiControl[4] });
  } else {
    drawPaddle(player, t, { side:'left', shields: p1ShieldCount, firstStrike: playerControlledByAI, frenzy: frenzyActiveP1, longPaddle: p1IsLong, berserk: p1IsBerserk });
    drawPaddle(ai, t, { side:'right', shields: p2ShieldCount, frenzy: frenzyActiveP2, longPaddle: p2IsLong });
  }
  drawServeHint();
  if (ballRespawnDelay <= 0 && gameRunning && !countdownActive) {
    const r = ball.size / 2;
    if (!simple && phosphorTrail.length > 0) {
      phosphorTrail.forEach((pos, i) => {
        const alpha = ((i + 1) / phosphorTrail.length) * 0.2;
        ctx.fillStyle = t.trail + alpha + ')';
        ctx.beginPath();
        const trailSize = pos.size / 2 * (0.3 + 0.7 * (i / phosphorTrail.length));
        ctx.arc(pos.x, pos.y, trailSize, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    let ballColor = t.color, glowColor = t.glow, glowBlur = 20;
    if (isCurvedBall) { ballColor = '#ffaa33'; glowColor = 'rgba(255, 170, 51, 0.8)'; glowBlur = 35; }
    else if ((gameMode === 'ai' || gameMode === 'online' || gameMode === 'pvp') && b1 === 'berserk' && berserkStack > 0) {
      ballColor = '#ff6622'; glowColor = 'rgba(255, 102, 34, 0.9)'; glowBlur = 28 + berserkStack * 4;
    }
    else if (activePowerups.length > 0) {
      const puColor = POWERUPS[activePowerups[0].type].color;
      ballColor = puColor; glowColor = puColor + 'cc'; glowBlur = 30;
    }
    if (simple) { ctx.fillStyle = ballColor; ctx.beginPath(); ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.shadowColor = glowColor; ctx.shadowBlur = glowBlur;
      ctx.fillStyle = ballColor; ctx.beginPath(); ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (!simple && Math.abs(ball.spin) > 0.1) {
      ctx.strokeStyle = t.dim; ctx.lineWidth = 2;
      ctx.beginPath();
      const arcRadius = ball.size * 0.8;
      const spinDir = ball.spin > 0 ? 1 : -1;
      ctx.arc(ball.x, ball.y, arcRadius, -Math.PI/2, Math.PI/2, spinDir < 0);
      ctx.stroke();
    }
  }
  if (!simple) drawFloatTexts();
}

let lastRenderTime = 0, physAccumulator = 0;
const PHYS_STEP_MS = 1000 / 60;
/* ★ 暂停时继续渲染，让球保持在画面上 */
function gameLoop(ts) {
  if (!gameRunning) { animId = null; physAccumulator = 0; return; }
  if (typeof ts !== 'number') ts = performance.now();
  if (paused) {
    lastFrameTime = ts;
    draw();
    animId = requestAnimationFrame(gameLoop);
    return;
  }
  const frameInterval = 1000 / targetFps;
  if (targetFps === 30 && ts - lastRenderTime < frameInterval - 2) {
    if (gameRunning && !paused) animId = requestAnimationFrame(gameLoop);
    return;
  }
  let deltaMs = ts - lastFrameTime;
  lastFrameTime = ts;
  lastRenderTime = ts;
  if (!isFinite(deltaMs) || deltaMs < 0) deltaMs = PHYS_STEP_MS;
  if (deltaMs > 250) deltaMs = 250;
  stats.frameTimes.push(deltaMs);
  if (stats.frameTimes.length > STATS_WINDOW) stats.frameTimes.shift();
  if (ts - stats.lastSampleTime >= STATS_SAMPLE_MS) {
    stats.lastSampleTime = ts;
    if (stats.frameTimes.length > 0) {
      let sum = 0;
      for (let i = 0; i < stats.frameTimes.length; i++) sum += stats.frameTimes[i];
      stats.avgFrameMs = sum / stats.frameTimes.length;
      stats.fps = stats.avgFrameMs > 0 ? 1000 / stats.avgFrameMs : 0;
    }
    updateStatsDisplay();
  }
  physAccumulator += deltaMs;
  let iter = 0;
  while (gameRunning && physAccumulator >= PHYS_STEP_MS && iter < 8) { update(1.0); physAccumulator -= PHYS_STEP_MS; iter++; }
  if (iter >= 8) physAccumulator = 0;
  draw();
  if (gameRunning && !countdownActive && !onlineRole && !lanRole) {
    playTimeAccum += deltaMs;
    if (playTimeAccum >= 3000) { myStats.playMs += Math.round(playTimeAccum); playTimeAccum = 0; saveMyStats(); lbRenderMyStats(); }
  }
  if (onlineRole === 'host' || lanRole === 'host') { netAccum += deltaMs; if (netAccum >= 33) { netAccum = 0; sendHostState(); } }
  else if (onlineRole === 'client' || lanRole === 'client') { netAccum += deltaMs; if (netAccum >= 33) { netAccum = 0; sendClientInput(); } }
  if (gameRunning && !paused) animId = requestAnimationFrame(gameLoop);
}

function startGame() {
  lastGameControlMode = touchControlMode;
  followTouchTargetY = null;
  paused = false; lastFrameTime = 0; netAccum = 0; lastRenderTime = 0;
  physAccumulator = 0;
  stats.frameTimes = []; stats.lastSampleTime = 0;
  resetCheat();
  const po = $('pauseOverlay'); if (po) po.classList.remove('show');
  const ov = $('overlay'); if (ov) ov.classList.add('hidden');
  navStack = [];
  gameRunning = true;
  layoutAll();
  playerScore = 0; aiScore = 0;
  p1ShieldCount = 0; p2ShieldCount = 0;
  roundNumber = 0;
  playerControlledByAI = false;
  frenzyActiveP1 = false; frenzyActiveP2 = false; berserkStack = 0;
  onlinePausedByHost = false;
  matchCheck.start();
  resultMatch = undefined;
  lbStartMatch();
  if (gameMode === 'ai') aiBlessing = (aiBlessingMode === 'random') ? BLESSING_KEYS[Math.floor(Math.random() * BLESSING_KEYS.length)] : 'none';
  else aiBlessing = 'none';
  updateScore(); updateShields();
  showScoreboard(true);
  updateControlsHint();
  updateStatsDisplay();
  document.body.classList.add('show-ctrl');
  recomputeSpeeds();
  resetPositions();
  gameStartedOnce = true;
  updateBlessingDisplay();
  updateRoundDisplay();
  onRoundStart();
  if (timerMode) {
    const sb = $('shieldsBox'); if (sb) sb.classList.add('timermode');
    startTimer();
  } else {
    const sb = $('shieldsBox'); if (sb) sb.classList.remove('timermode');
    const td = $('timerDisplay'); if (td) td.classList.remove('show');
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
  updatePauseBtnState();
  runCountdown(3);
}
function runCountdown(secs) {
  const total = secs || 3;
  countdownActive = true;
  const co = $('countdownOverlay'); if (co) co.classList.remove('hidden');
  phosphorTrail = [];
  showCountdownTip();
  let count = total;
  const cn = $('countdownNum');
  const restartAnim = () => { if (!cn) return; cn.style.animation = 'none'; void cn.offsetHeight; cn.style.animation = ''; };
  if (cn) { cn.textContent = count; restartAnim(); }
  AudioEngine.countdown();
  lastFrameTime = performance.now();
  if (!animId && gameRunning) animId = requestAnimationFrame(gameLoop);
  const interval = setInterval(() => {
    count--;
    if (count > 0) { if (cn) { cn.textContent = count; restartAnim(); } AudioEngine.countdown(); }
    else if (count === 0) { if (cn) { cn.textContent = 'GO'; restartAnim(); } AudioEngine.countdown(); }
    else {
      clearInterval(interval);
      const co2 = $('countdownOverlay'); if (co2) co2.classList.add('hidden');
      hideCountdownTip();
      countdownActive = false;
      lastFrameTime = performance.now();
      if (!animId && gameRunning) animId = requestAnimationFrame(gameLoop);
    }
  }, 900);
}
function togglePause() {
  if (!gameRunning || countdownActive) return;
  const isOnline = gameMode === 'online';
  const isLan = transportMode === 'lan' && (onlineRole || lanRole);
  if (isOnline || isLan) {
    if (onlineRole === 'host' || lanRole === 'host') {
      paused = !paused;
      onlinePausedByHost = paused;
      if (paused) {
        const po = $('pauseOverlay'); if (po) po.classList.add('show');
        const pt = $('pauseTitle'), ps = $('pauseSub'), qrb = $('quitRoomBtn');
        if (pt) pt.textContent = '已暂停';
        if (ps) ps.textContent = '对手也已冻结 · 继续后重新倒计时';
        if (qrb) qrb.style.display = 'block';
        if (animId) cancelAnimationFrame(animId);
        animId = null;
        transportSend(JSON.stringify({ t: 'pauseState', paused: true }));
      } else {
        const po = $('pauseOverlay'); if (po) po.classList.remove('show');
        lastFrameTime = performance.now();
        lastRenderTime = 0;
        physAccumulator = 0;
        transportSend(JSON.stringify({ t: 'pauseState', paused: false }));
        transportSend(JSON.stringify({ t: 'resumeCountdown', sec: 3 }));
        runCountdown(3);
      }
      updatePauseBtnState();
    } else {
      transportSend(JSON.stringify({ t: 'pauseRequest' }));
      const po = $('pauseOverlay'); if (po) po.classList.add('show');
      const pt = $('pauseTitle'), ps = $('pauseSub'), qrb = $('quitRoomBtn');
      if (pt) pt.textContent = '请求暂停中…';
      if (ps) ps.textContent = '等待主机确认';
      if (qrb) qrb.style.display = 'none';
      updatePauseBtnState();
    }
    return;
  }
  paused = !paused;
  if (paused) {
    const po = $('pauseOverlay'); if (po) po.classList.add('show');
    const pt = $('pauseTitle'), ps = $('pauseSub'), qrb = $('quitRoomBtn');
    if (pt) pt.textContent = '已暂停';
    if (ps) ps.textContent = '按 P 或 ESC 继续';
    if (qrb) qrb.style.display = 'none';
    if (animId) cancelAnimationFrame(animId);
    animId = null;
  } else {
    const po = $('pauseOverlay'); if (po) po.classList.remove('show');
    lastFrameTime = performance.now();
    lastRenderTime = 0;
    physAccumulator = 0;
    runCountdown(3);
  }
  updatePauseBtnState();
}
function resumeGame() { if (paused) togglePause(); }
function quitToRoom() {
  if (gameMode !== 'online' && transportMode !== 'lan') return;
  paused = false; gameRunning = false;
  if (animId) cancelAnimationFrame(animId); animId = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  ballRespawnDelay = 0; countdownActive = false; phosphorTrail = []; berserkStack = 0;
  const co = $('countdownOverlay'); if (co) co.classList.add('hidden');
  matchCheck.cancel();
  const po = $('pauseOverlay'); if (po) po.classList.remove('show');
  showScoreboard(false);
  const td = $('timerDisplay'); if (td) td.classList.remove('show');
  const sb = $('shieldsBox'); if (sb) sb.classList.remove('show'); if (sb) sb.classList.remove('timermode');
  const ti = $('topInfo'); if (ti) ti.classList.remove('show');
  const sbe = $('statusBar'); if (sbe) sbe.classList.remove('show');
  const c1 = $('chipP1Powerup'); if (c1) c1.classList.add('hidden');
  const cb = $('chipBerserk'); if (cb) cb.classList.add('hidden');
  const cc = $('chipCurve'); if (cc) cc.classList.add('hidden');
  document.body.classList.remove('show-ctrl');
  navStack = [];
  applyPanel('room');
  const ov = $('overlay'); if (ov) ov.classList.remove('hidden');
  updateControlsHint();
  updateStatsDisplay();
  updateRoomUI();
  draw();
  transportSend(JSON.stringify({ t: 'backToRoom' }));
}
function quitToMenu() {
  paused = false; gameRunning = false;
  flushPlayTime();
  if (animId) cancelAnimationFrame(animId); animId = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  ballRespawnDelay = 0; countdownActive = false;
  aiMistakeTimer = 0; aiMistakeType = 'none';
  isCurvedBall = false; curveTimer = 0; curveChangeTimer = 0;
  activePowerups = []; powerupTimer = 0;
  floatTexts = []; phosphorTrail = []; berserkStack = 0;
  physAccumulator = 0;
  player._aiTargetY = undefined; p2Paddle._aiTargetY = undefined;
  ai._aiTargetY = undefined; p4Paddle._aiTargetY = undefined;
  const co = $('countdownOverlay'); if (co) co.classList.add('hidden');
  resetCheat(); matchCheck.cancel();
  const po = $('pauseOverlay'); if (po) po.classList.remove('show');
  onlineCleanup();
  if (gameMode === 'online') { gameMode = 'ai'; timerMode = false; playerCount = 2; }
  showScoreboard(false);
  const td = $('timerDisplay'); if (td) td.classList.remove('show');
  const sb = $('shieldsBox'); if (sb) sb.classList.remove('show'); if (sb) sb.classList.remove('timermode');
  const ti = $('topInfo'); if (ti) ti.classList.remove('show');
  const sbe = $('statusBar'); if (sbe) sbe.classList.remove('show');
  const c1 = $('chipP1Powerup'); if (c1) c1.classList.add('hidden');
  const cb = $('chipBerserk'); if (cb) cb.classList.add('hidden');
  const cc = $('chipCurve'); if (cc) cc.classList.add('hidden');
  document.body.classList.remove('show-ctrl');
  const sp = $('scorePlayer'), sa = $('scoreAI');
  if (sp) { sp.textContent = '0'; sp.classList.remove('active'); }
  if (sa) { sa.textContent = '0'; sa.classList.remove('active'); }
  const rsb = $('resultStartBtn'); if (rsb) rsb.style.display = '';
  const rrb = $('resultRoomBtn'); if (rrb) rrb.style.display = 'none';
  updatePauseBtnState();
  navStack = [];
  applyPanel('main');
  const ov = $('overlay'); if (ov) ov.classList.remove('hidden');
  updateControlsHint();
  updateStatsDisplay();
  draw();
}
function resetCheat() { cheatActive = false; cheatBallSpeedMul = 1; cheatSequence = []; updateStatsDisplay(); }/* ============================================================
   PONG-84 · 传输层（多服务器自动探测 · WebRTC · 手动 P2P）
   ============================================================ */

/* ---------- 多路信令服务器 ---------- */

const SIGNALING_SERVERS = [
  { name: 'EMQX 主站',     url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'MQTTX 公共',    url: 'wss://broker.mqttx.io:8084/mqtt' },
  { name: 'Eclipse Paho',  url: 'wss://mqtt.eclipseprojects.io:8083/mqtt' },
  { name: 'HiveMQ 备用',   url: 'wss://broker.hivemq.com:8884/mqtt' }
];
let serverRank = [];
let probing = false;

function probeServer(server, timeoutMs) {
  timeoutMs = timeoutMs || 2500;
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false, c = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { if (c) c.end(true); } catch (e) {}
      resolve(ok ? { latency: Date.now() - start } : null);
    };
    const timer = setTimeout(() => finish(false), timeoutMs + 500);
    try {
      c = mqtt.connect(server.url, {
        clean: true, connectTimeout: timeoutMs, reconnectPeriod: 0,
        clientId: 'pong84_probe_' + Math.random().toString(16).slice(2, 10)
      });
    } catch (e) { clearTimeout(timer); finish(false); return; }
    c.on('connect', () => { clearTimeout(timer); finish(true); });
    c.on('error', () => { clearTimeout(timer); finish(false); });
  });
}
async function probeAllServers() {
  if (probing) return serverRank;
  probing = true;
  updateSignalingBadge('探测中…');
  const results = await Promise.all(SIGNALING_SERVERS.map((s, i) =>
    probeServer(s).then(r => r ? { index: i, name: s.name, url: s.url, latency: r.latency } : null)
  ));
  const ok = results.filter(Boolean).sort((a, b) => a.latency - b.latency);
  serverRank = ok.length ? ok : [{ index: 0, name: SIGNALING_SERVERS[0].name, url: SIGNALING_SERVERS[0].url, latency: -1 }];
  probing = false;
  updateSignalingBadge();
  return serverRank;
}
function getPrimaryServer() {
  return serverRank.length ? serverRank[0]
    : { index: 0, name: SIGNALING_SERVERS[0].name, url: SIGNALING_SERVERS[0].url, latency: -1 };
}
function getServerByIndex(idx) {
  if (idx >= 0 && idx < SIGNALING_SERVERS.length) {
    const s = SIGNALING_SERVERS[idx];
    const r = serverRank.find(x => x.index === idx);
    return { index: idx, name: s.name, url: s.url, latency: r ? r.latency : -1 };
  }
  return getPrimaryServer();
}
function updateSignalingBadge(text) {
  const el = document.getElementById('signalingName');
  if (!el) return;
  if (text) { el.textContent = text; return; }
  if (!serverRank.length) { el.textContent = '探测中…'; return; }
  const p = serverRank[0];
  const lat = p.latency >= 0 ? (' · ' + p.latency + 'ms') : '';
  el.textContent = p.name + lat;
  if (serverRank.length > 1) el.textContent += ' (+' + (serverRank.length - 1) + ' 备用)';
}

/* ---------- 传输层状态 ---------- */
let onlineTransport = 'mqtt';
const TOPIC_PREFIX = 'pong84/v35/';
let mqttClient = null;
let localId = Math.random().toString(36).slice(2, 10);
let rtcPc = null, rtcDc = null, onlineRole = null, currentRoom = null;
let remotePaddleY = null, netAccum = 0, pendingCandidates = [];
let hostBusy = false, connectTimeout = null, helloInterval = null;
let onlineBallSpeed = 1.0, onlineMode = 'normal', onlineTimerSeconds = 60;
let onlineDiff = 'hard', onlineAILevel = 'hard';
let onlinePaddleMul = 1.0, onlinePaddleSpeed = 1.0, onlineCurveMul = 1.0, onlinePowerupMul = 1.0;
let clientReady = false, remoteName = '对手';
let fourPeers = {}, mySlot = 1;
let slotInfo = { 1: null, 2: null, 3: null, 4: null };
let myBlessing = 'none';
let roomBlessings = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };

let lanWs = null, lanConnected = false, lanRole = null, transportMode = 'mqtt';
const LAN_HEARTBEAT_MS = 5000;
let lanHeartbeatTimer = null;

let manualPendingCand = [];

/* ---------- 房间号 / Topic ---------- */
function generateRoomCode() {
  const p = getPrimaryServer();
  const idx = p.index % SIGNALING_SERVERS.length;
  const num = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return String(idx) + num;
}
function parseRoomCodeServer(code) {
  if (!/^[0-9]{6}$/.test(code)) return -1;
  const idx = parseInt(code[0], 10);
  if (idx < 0 || idx >= SIGNALING_SERVERS.length) return -1;
  return idx;
}
function roomTopic(room, side) { return TOPIC_PREFIX + room + '/' + side; }
function clientTopic(room, cid) { return TOPIC_PREFIX + room + '/c/' + cid; }

/* ---------- WebRTC 配置（只 STUN） ---------- */
const RTC_CONFIG_WEB = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
const RTC_CONFIG_LAN = { iceServers: [], iceCandidatePoolSize: 0 };
function rtcConfig() { return onlineTransport === 'lan' ? RTC_CONFIG_LAN : RTC_CONFIG_WEB; }

/* ---------- 顶部状态 ---------- */
function setTopStatus(text, cls) {
  const el = $('onlineInstructionTop');
  if (!el) return;
  el.textContent = text;
  el.style.color = cls === 'ok' ? '#33ff99' : cls === 'warn' ? '#ffaa33' : 'var(--crt-mid)';
}

/* ---------- 传输抽象 ---------- */
function transportSend(msg) {
  if (typeof msg !== 'string') msg = JSON.stringify(msg);
  if (onlineRole === 'host') {
    if (playerCount === 2 && rtcDc && rtcDc.readyState === 'open') { try { rtcDc.send(msg); } catch (e) {} }
    for (const cid in fourPeers) {
      const p = fourPeers[cid];
      if (p.dc && p.dc.readyState === 'open') { try { p.dc.send(msg); } catch (e) {} }
    }
  } else if (onlineRole === 'client' && rtcDc && rtcDc.readyState === 'open') {
    try { rtcDc.send(msg); } catch (e) {}
  }
}

/* ---------- MQTT 信令 ---------- */
function signalSend(target, msg) {
  if (!mqttClient || !mqttClient.connected) return;
  try { mqttClient.publish(roomTopic(currentRoom, target), JSON.stringify(msg), { qos: 1 }); } catch (e) {}
}
function signalSendToClient(cid, msg) {
  if (!mqttClient || !mqttClient.connected) return;
  try { mqttClient.publish(clientTopic(currentRoom, cid), JSON.stringify(msg), { qos: 1 }); } catch (e) {}
}
function handleSignalMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hello') {
    if (onlineRole === 'host' && !hostBusy && playerCount === 2) {
      hostBusy = true;
      const oi = $('onlineInstruction');
      if (oi) oi.textContent = '对方已连接，正在协商…';
      hostStartOffer().catch(() => { if (oi) oi.textContent = '协商失败，请点「重新连接」'; showRetry(); });
    }
  } else if (msg.type === 'offer') {
    if (onlineRole !== 'client' || !rtcPc) return;
    if (rtcPc.signalingState !== 'stable' && rtcPc.signalingState !== 'new') return;
    if (rtcPc.remoteDescription) return;
    rtcPc.setRemoteDescription(msg.sdp)
      .then(() => flushPendingCandidates())
      .then(() => rtcPc.createAnswer())
      .then(answer => rtcPc.setLocalDescription(answer))
      .then(() => {
        signalSend('host', { type: 'answer', sdp: rtcPc.localDescription });
        const oi = $('onlineInstruction');
        if (oi) oi.textContent = '正在建立连接…';
      })
      .catch(() => {
        const oi = $('onlineInstruction');
        if (oi) oi.textContent = '协商失败，请重试';
        showRetry();
      });
  } else if (msg.type === 'answer') {
    if (onlineRole !== 'host' || !rtcPc || rtcPc.remoteDescription) return;
    rtcPc.setRemoteDescription(msg.sdp).then(() => flushPendingCandidates()).catch(() => {});
  } else if (msg.type === 'ice') {
    if (!rtcPc) return;
    if (rtcPc.remoteDescription) rtcPc.addIceCandidate(msg.candidate).catch(() => {});
    else pendingCandidates.push(msg.candidate);
  }
}
async function flushPendingCandidates() {
  if (!rtcPc) return;
  const pending = pendingCandidates; pendingCandidates = [];
  for (const c of pending) { try { await rtcPc.addIceCandidate(c); } catch (e) {} }
}

/* ---------- 4 人模式信令 ---------- */
function handleFourSignal(msg, fromClientId) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hello4') {
    if (onlineRole !== 'host' || playerCount !== 4) return;
    let slot = 0;
    if (msg.prefSlot && [1, 2, 3, 4].includes(msg.prefSlot) && slotInfo[msg.prefSlot] === null) slot = msg.prefSlot;
    if (!slot) { for (let i = 1; i <= 4; i++) if (slotInfo[i] === null) { slot = i; break; } }
    if (!slot) { signalSendToClient(fromClientId, { type: 'full' }); return; }
    const cid = fromClientId;
    slotInfo[slot] = { name: String(msg.name || '玩家').slice(0, 16), ready: false, isAI: false, clientId: cid, connected: false };
    signalSendToClient(cid, { type: 'welcome4', slot: slot, room: currentRoom, hostName: playerName });
    hostStartOfferFor(cid, slot).catch(() => {});
    updateRoomUI();
  } else if (msg.type === 'answer4') {
    const p = fourPeers[fromClientId];
    if (!p || !p.pc || p.pc.remoteDescription) return;
    p.pc.setRemoteDescription(msg.sdp).then(() => {
      for (const c of (p.pending || [])) p.pc.addIceCandidate(c).catch(() => {});
      p.pending = [];
    }).catch(() => {});
  } else if (msg.type === 'ice4') {
    const p = fourPeers[fromClientId];
    if (!p || !p.pc) return;
    if (p.pc.remoteDescription) p.pc.addIceCandidate(msg.candidate).catch(() => {});
    else { p.pending = p.pending || []; p.pending.push(msg.candidate); }
  }
}
async function hostStartOffer() {
  if (rtcPc) { try { rtcPc.close(); } catch (e) {} rtcPc = null; }
  pendingCandidates = [];
  createRtc();
  const dc = rtcPc.createDataChannel('game', { ordered: true });
  setupDataChannel(dc);
  const offer = await rtcPc.createOffer();
  await rtcPc.setLocalDescription(offer);
  signalSend('client', { type: 'offer', sdp: offer });
}
async function hostStartOfferFor(clientId, slot) {
  if (fourPeers[clientId]) { try { fourPeers[clientId].pc && fourPeers[clientId].pc.close(); } catch (e) {} }
  const pc = new RTCPeerConnection(rtcConfig());
  const entry = { pc, dc: null, slot, name: slotInfo[slot] ? slotInfo[slot].name : '玩家', ready: false, pending: [] };
  fourPeers[clientId] = entry;
  pc.onicecandidate = (e) => { if (e.candidate) signalSendToClient(clientId, { type: 'ice4', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'failed' || st === 'closed' || st === 'disconnected') {
      if (slotInfo[slot]) { slotAiControl[slot] = true; slotInfo[slot].connected = false; broadcastRoomState(); updateRoomUI(); }
    }
  };
  const dc = pc.createDataChannel('game', { ordered: true });
  entry.dc = dc;
  setupFourDataChannel(dc, clientId, slot);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signalSendToClient(clientId, { type: 'offer4', sdp: offer });
}

/* ---------- RTCPeerConnection / DataChannel ---------- */
function createRtc() {
  rtcPc = new RTCPeerConnection(rtcConfig());
  rtcPc.onicecandidate = (e) => {
    if (e.candidate) signalSend(onlineRole === 'host' ? 'client' : 'host', { type: 'ice', candidate: e.candidate });
  };
  rtcPc.onconnectionstatechange = () => {
    if (!rtcPc) return;
    const st = rtcPc.connectionState;
    const oi = $('onlineInstruction');
    if (st === 'failed') { if (oi) oi.textContent = '连接失败，请重试'; showRetry(); }
    else if (st === 'disconnected' || st === 'closed') {
      if (gameRunning && playerCount === 2) endGame('连接断开', false);
      if (oi) oi.textContent = '连接已断开';
    }
  };
  return rtcPc;
}
function setupDataChannel(channel) {
  rtcDc = channel;
  channel.onopen = () => {
    hostBusy = false;
    hideRetry();
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
    if (helloInterval) { clearInterval(helloInterval); helloInterval = null; }
    try { channel.send(JSON.stringify({ t: 'name', name: playerName })); } catch (e) {}
    const oi = $('onlineInstruction');
    const pb = $('pauseBtn');
    if (onlineRole === 'host') {
      if (playerCount === 2) {
        slotInfo[2] = { name: remoteName || '对手', ready: false, isAI: false, clientId: 'peer', connected: true };
        broadcastRoomState();
      }
      if (oi) oi.textContent = '对手已加入，等待准备';
      const osb = $('onlineStartBtn'); if (osb) osb.style.display = 'none';
      const crb = $('clientReadyBtn'); if (crb) crb.classList.add('hidden-section');
      if (pb && gameRunning) pb.classList.remove('disabled');
    } else {
      if (playerCount === 2) mySlot = 2;
      if (oi) oi.textContent = '已连接，请点击「准备」';
      const osb = $('onlineStartBtn'); if (osb) osb.style.display = 'none';
      const crb = $('clientReadyBtn'); if (crb) crb.classList.remove('hidden-section');
      if (pb) pb.classList.add('disabled');
    }
    updateRoomUI();
    netAccum = 0; stats.ping = -1;
    startPingLoop(); updateStatsDisplay();
  };
  channel.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'room') {
      if (msg.slotInfo && onlineRole === 'client') {
        if (msg.slotInfo[1]) slotInfo[1] = Object.assign({}, slotInfo[1] || {}, msg.slotInfo[1]);
        if (playerCount === 2 && msg.slotInfo[2]) slotInfo[2] = Object.assign({}, slotInfo[2] || {}, msg.slotInfo[2]);
      }
      if (typeof msg.diff === 'string') onlineDiff = msg.diff;
      if (typeof msg.mode === 'string') onlineMode = msg.mode;
      if (typeof msg.timerSeconds === 'number') onlineTimerSeconds = msg.timerSeconds;
      if (typeof msg.ballSpeed === 'number') onlineBallSpeed = msg.ballSpeed;
      if (typeof msg.winScore === 'number') winScore = msg.winScore;
      if (typeof msg.paddleMul === 'number') onlinePaddleMul = msg.paddleMul;
      if (typeof msg.paddleSpeed === 'number') onlinePaddleSpeed = msg.paddleSpeed;
      if (msg.aiControl) slotAiControl = msg.aiControl;
      updateRoomUI(); syncUI();
      return;
    }
    if (msg.t === 'state') applyRemoteState(msg);
    else if (msg.t === 'start') {
      if (onlineRole === 'client') {
        winScore = msg.winScore || winScore;
        timerMode = !!msg.timerMode;
        timerSeconds = msg.timerSeconds || 60;
        if (typeof msg.ballSpeed === 'number') onlineBallSpeed = msg.ballSpeed;
        if (typeof msg.diff === 'string') currentDiff = msg.diff;
        if (msg.blessings) roomBlessings = msg.blessings;
        if (typeof msg.paddleMul === 'number') onlinePaddleMul = msg.paddleMul;
        if (typeof msg.paddleSpeed === 'number') onlinePaddleSpeed = msg.paddleSpeed;
        if (typeof msg.aiLevel === 'string') onlineAILevel = msg.aiLevel;
        if (typeof msg.curveMul === 'number') onlineCurveMul = msg.curveMul;
        if (typeof msg.powerupMul === 'number') onlinePowerupMul = msg.powerupMul;
        updateControlsHint();
        startGame();
      }
    }
    else if (msg.t === 'input') { if (onlineRole === 'host') remotePaddleY = msg.y; }
    else if (msg.t === 'name') {
      remoteName = String(msg.name || '对手').slice(0, 16);
      if (onlineRole === 'host' && playerCount === 2) {
        if (!slotInfo[2]) slotInfo[2] = { name: remoteName, ready: false, isAI: false, clientId: 'peer', connected: true };
        else slotInfo[2].name = remoteName;
        broadcastRoomState();
      } else if (onlineRole === 'client' && playerCount === 2) {
        if (!slotInfo[1]) slotInfo[1] = { name: remoteName, ready: true, isAI: false, clientId: 'host', connected: true };
        else slotInfo[1].name = remoteName;
      }
      updateRoomUI();
    }
    else if (msg.t === 'ready') {
      if (onlineRole === 'host') {
        clientReady = true;
        if (playerCount === 2 && slotInfo[2]) slotInfo[2].ready = true;
        broadcastRoomState(); updateRoomUI();
      }
    }
    else if (msg.t === 'myBlessing') {
      if (onlineRole === 'host') {
        const slot = (playerCount === 2) ? 2 : (msg.slot || 2);
        roomBlessings[slot] = String(msg.value || 'none');
        broadcastRoomState();
      }
    }
    else if (msg.t === 'pauseRequest') { /* ★ 已禁用，不处理 */ }
    else if (msg.t === 'end') { if (onlineRole === 'client') endGame(msg.msg, msg.isWin); }
    else if (msg.t === 'pauseState') {
      onlinePausedByHost = !!msg.paused;
      if (onlinePausedByHost) {
        paused = true;
        const po = $('pauseOverlay'); if (po) po.classList.add('show');
        const pt = $('pauseTitle'), ps = $('pauseSub'), qrb = $('quitRoomBtn');
        if (pt) pt.textContent = '主机已暂停';
        if (ps) ps.textContent = '等待主机继续…';
        if (qrb) qrb.style.display = 'none';
        if (animId) cancelAnimationFrame(animId); animId = null;
      } else {
        paused = false;
        const po = $('pauseOverlay'); if (po) po.classList.remove('show');
        lastFrameTime = performance.now(); lastRenderTime = 0; physAccumulator = 0;
        if (!animId && gameRunning) animId = requestAnimationFrame(gameLoop);
      }
    }
    else if (msg.t === 'resumeCountdown') { if (gameRunning) runCountdown(msg.sec || 3); }
    else if (msg.t === 'backToRoom') { if (gameRunning) quitToRoom(); }
    else if (msg.t === 'roomClosed') {
      try { onlineCleanup(); } catch (e) {}
      navStack = []; applyPanel('main');
      updateControlsHint(); updateStatsDisplay();
      alert('房主已关闭房间');
    }
    else if (msg.t === 'ping') { try { rtcDc.send(JSON.stringify({ t: 'pong', ts: msg.ts })); } catch (e) {} }
    else if (msg.t === 'pong') { const rtt = Date.now() - msg.ts; if (rtt >= 0 && rtt < 5000) stats.ping = rtt; }
  };
  channel.onclose = () => {
    stopPingLoop(); updateStatsDisplay();
    if (gameRunning && playerCount === 2) endGame('连接断开', false);
  };
  channel.onerror = (e) => console.error('DataChannel error', e);
}
function setupFourDataChannel(dc, clientId, slot) {
  dc.onopen = () => {
    if (slotInfo[slot]) { slotInfo[slot].connected = true; slotAiControl[slot] = false; }
    broadcastRoomState(); updateRoomUI();
  };
  dc.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || typeof msg !== 'object') return;
    handleClientMessage(msg, clientId);
  };
  dc.onclose = () => {
    if (slotInfo[slot]) { slotInfo[slot].connected = false; slotAiControl[slot] = true; }
    delete fourPeers[clientId];
    broadcastRoomState(); updateRoomUI();
  };
}
function handleClientMessage(msg, clientId) {
  let slot = 0;
  for (let s = 1; s <= 4; s++) if (slotInfo[s] && slotInfo[s].clientId === clientId) { slot = s; break; }
  if (!slot) return;
  if (msg.t === 'input') { if (typeof msg.y === 'number') { const pad = getPaddleBySlot(slot); if (pad) pad.targetY = msg.y; } }
  else if (msg.t === 'name') { if (slotInfo[slot]) slotInfo[slot].name = String(msg.name || '玩家').slice(0, 16); broadcastRoomState(); updateRoomUI(); }
  else if (msg.t === 'ready') { if (slotInfo[slot]) slotInfo[slot].ready = true; if (playerCount === 2) clientReady = true; broadcastRoomState(); updateRoomUI(); }
  else if (msg.t === 'myBlessing') { roomBlessings[slot] = String(msg.value || 'none'); broadcastRoomState(); }
  else if (msg.t === 'requestSlot') {
    const want = msg.slot;
    if (want >= 1 && want <= 4 && (slotInfo[want] === null || want === slot)) {
      const cur = slotInfo[slot]; slotInfo[slot] = null; slotInfo[want] = cur;
      if (cur) cur.slot = want;
      broadcastRoomState(); updateRoomUI();
    }
  }
  else if (msg.t === 'pauseRequest') { /* ★ 客户端无暂停权限 */ }
  else if (msg.t === 'leave') { if (slotInfo[slot]) { slotInfo[slot] = null; slotAiControl[slot] = false; broadcastRoomState(); updateRoomUI(); } }
}

/* ---------- 清理 / 重试 ---------- */
function onlineCleanup() {
  if (window._pongHostBeacon) { clearInterval(window._pongHostBeacon); window._pongHostBeacon = null; }
  if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
  if (helloInterval) { clearInterval(helloInterval); helloInterval = null; }
  if (lanHeartbeatTimer) { clearInterval(lanHeartbeatTimer); lanHeartbeatTimer = null; }
  if (lanWs) { try { lanWs.close(); } catch (e) {} lanWs = null; }
  lanConnected = false; lanRole = null;
  stopPingLoop();
  if (rtcDc) { try { rtcDc.close(); } catch (e) {} }
  if (rtcPc) { try { rtcPc.close(); } catch (e) {} }
  for (const cid in fourPeers) {
    const p = fourPeers[cid];
    if (p.dc) { try { p.dc.close(); } catch (e) {} }
    if (p.pc) { try { p.pc.close(); } catch (e) {} }
  }
  if (mqttClient) { try { mqttClient.end(true); } catch (e) {} }
  rtcDc = null; rtcPc = null; mqttClient = null;
  fourPeers = {}; slotInfo = { 1: null, 2: null, 3: null, 4: null }; mySlot = 1;
  onlineRole = null; currentRoom = null; remotePaddleY = null;
  netAccum = 0; pendingCandidates = []; hostBusy = false;
  clientReady = false; remoteName = '对手';
  myBlessing = 'none';
  roomBlessings = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
  slotAiControl = { 1: false, 2: false, 3: false, 4: false };
  onlinePausedByHost = false;
  stats.ping = -1; updateStatsDisplay();
}
function showRetry() { const r = $('onlineRetry'); if (r) r.classList.remove('hidden-section'); }
function hideRetry() { const r = $('onlineRetry'); if (r) r.classList.add('hidden-section'); }
function resetOnlinePanel() { const os = $('onlineStep'); if (os) os.classList.add('hidden-section'); hideRetry(); }

/* ---------- 创建房间 ---------- */
async function createRoom(mode) {
  playerCount = mode;
  clientReady = false; remoteName = '对手';
  slotInfo = { 1: null, 2: null, 3: null, 4: null };
  fourPeers = {}; mySlot = 1;
  slotInfo[1] = { name: playerName, ready: true, isAI: false, clientId: localId, connected: true };
  if (playerCount === 2) slotInfo[2] = null;
  roomBlessings = { 1: myBlessing, 2: 'none', 3: 'none', 4: 'none' };
  slotAiControl = { 1: false, 2: false, 3: false, 4: false };

  const oi = $('onlineInstruction');
  const code = generateRoomCode();
  onlineRole = 'host'; currentRoom = code; hostBusy = false;
  hideRetry();
  if (mqttClient) { try { mqttClient.end(true); } catch (e) {} mqttClient = null; }
  stats.ping = -1; updateStatsDisplay();
  updateRoomUI();
  const os = $('onlineStep'); if (os) os.classList.remove('hidden-section');
  const roomCodeTextEl = $('roomCodeText'); if (roomCodeTextEl) roomCodeTextEl.textContent = code;

  const srv = getPrimaryServer();
  const bar = $('roomStatusBar');
  if (bar) { bar.className = 'room-status-bar wait'; bar.textContent = '⏳ 正在连接 ' + srv.name + ' …'; }

  return new Promise((resolve) => {
    if (typeof mqtt === 'undefined') { if (oi) oi.textContent = 'MQTT 库未加载'; showRetry(); resolve(); return; }
    try {
      mqttClient = mqtt.connect(srv.url, {
        clean: true, connectTimeout: 10000, reconnectPeriod: 0,
        clientId: 'pong84_h_' + code + '_' + Math.random().toString(16).slice(2, 10)
      });
    } catch (e) { if (oi) oi.textContent = '创建失败：' + e.message; showRetry(); resolve(); return; }
    mqttClient.on('connect', () => {
      hideRetry();
      mqttClient.subscribe(roomTopic(code, 'host'), { qos: 1 }, (err) => {
        if (err) { if (oi) oi.textContent = '订阅失败'; showRetry(); resolve(); return; }
        if (oi) oi.textContent = '房间已创建 · ' + srv.name + ' · 把房间号发给对方';
        updateRoomUI();
        resolve();
      });
    });
    mqttClient.on('message', (topic, payload) => {
      let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
      if (playerCount === 4) {
        if (msg.from && (msg.type === 'hello4' || msg.type === 'answer4' || msg.type === 'ice4')) handleFourSignal(msg, msg.from);
      } else {
        if (!msg.from && (msg.type === 'hello' || msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice')) handleSignalMessage(msg);
      }
    });
    mqttClient.on('error', () => { if (oi) oi.textContent = '信令服务器连接失败，可点「重新连接」切换服务器'; showRetry(); });
    mqttClient.on('close', () => { if (oi && onlineRole) oi.textContent = '信令连接已断开'; });
    connectTimeout = setTimeout(() => {
      if (playerCount === 2 && (!rtcDc || rtcDc.readyState !== 'open')) { if (oi) oi.textContent = '等待连接超时，可尝试重新连接'; }
    }, 60000);
  });
}

/* ---------- 加入房间 ---------- */
async function joinRoom(rawCode) {
  const code = (rawCode || '').trim();
  if (!/^[0-9]{6}$/.test(code)) { setTopStatus('请输入 6 位数字房间号', 'warn'); return false; }
  onlineRole = 'client'; currentRoom = code;

  const oi = $('onlineInstruction');
  const os = $('onlineStep'); if (os) os.classList.remove('hidden-section');
  hideRetry();
  pendingCandidates = []; hostBusy = false;
  stats.ping = -1; updateStatsDisplay();
  if (rtcPc) { try { rtcPc.close(); } catch (e) {} rtcPc = null; }
  if (mqttClient) { try { mqttClient.end(true); } catch (e) {} mqttClient = null; }

  rtcPc = new RTCPeerConnection(rtcConfig());
  rtcPc.onicecandidate = (e) => {
    if (!e.candidate) return;
    if (mqttClient && mqttClient.connected) {
      try {
        mqttClient.publish(roomTopic(currentRoom, 'host'), JSON.stringify({ type: 'ice', candidate: e.candidate }), { qos: 1 });
        mqttClient.publish(roomTopic(currentRoom, 'host'), JSON.stringify({ type: 'ice4', from: localId, candidate: e.candidate }), { qos: 1 });
      } catch (err) {}
    }
  };
  rtcPc.ondatachannel = (e) => { if (playerCount === 4) setupFourClientChannel(e.channel); else setupDataChannel(e.channel); };
  rtcPc.onconnectionstatechange = () => {
    if (!rtcPc) return;
    const st = rtcPc.connectionState;
    if (st === 'failed') { if (oi) oi.textContent = '连接失败，请重试'; showRetry(); }
    else if (st === 'disconnected' || st === 'closed') {
      if (gameRunning) endGame('连接断开', false);
      if (oi) oi.textContent = '连接已断开';
    }
  };
  updateRoomUI();

  if (typeof mqtt === 'undefined') { if (oi) oi.textContent = 'MQTT 库未加载'; showRetry(); return true; }
  const srvIdx = parseRoomCodeServer(code);
  const srv = srvIdx >= 0 ? getServerByIndex(srvIdx) : getPrimaryServer();
  if (oi) oi.textContent = '正在连接 ' + srv.name + ' …';
  const bar = $('roomStatusBar');
  if (bar) { bar.className = 'room-status-bar wait'; bar.textContent = '⏳ 正在连接 ' + srv.name + ' …'; }
  try {
    mqttClient = mqtt.connect(srv.url, {
      clean: true, connectTimeout: 10000, reconnectPeriod: 0,
      clientId: 'pong84_c_' + code + '_' + Math.random().toString(16).slice(2, 10)
    });
  } catch (e) { if (oi) oi.textContent = '加入失败：' + e.message; showRetry(); return true; }
  mqttClient.on('connect', () => {
    hideRetry();
    mqttClient.subscribe([clientTopic(code, localId), roomTopic(code, 'client')], { qos: 1 }, (err) => {
      if (err) { if (oi) oi.textContent = '订阅失败'; showRetry(); return; }
      setTimeout(() => startDualModeProbe(), 300);
    });
  });
  mqttClient.on('message', (topic, payload) => {
    let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
    if (helloInterval && (msg.type === 'welcome4' || msg.type === 'offer' || msg.type === 'offer4')) { clearInterval(helloInterval); helloInterval = null; }
    if (msg.type === 'welcome4') {
      if (playerCount !== 4) { playerCount = 4; rtcPc.ondatachannel = (e) => setupFourClientChannel(e.channel); }
      handleFourClientSignal(msg);
    } else if (msg.type === 'offer4') {
      if (playerCount !== 4) { playerCount = 4; rtcPc.ondatachannel = (e) => setupFourClientChannel(e.channel); }
      handleFourClientSignal(msg);
    } else if (msg.type === 'offer') {
      if (playerCount !== 2) { playerCount = 2; rtcPc.ondatachannel = (e) => setupDataChannel(e.channel); }
      handleSignalMessage(msg);
    } else if (msg.type === 'answer' || msg.type === 'ice') handleSignalMessage(msg);
    else if (msg.type === 'answer4' || msg.type === 'ice4') handleFourClientSignal(msg);
    else if (msg.type === 'full') { if (oi) oi.textContent = '房间已满，无法加入'; showRetry(); }
    else if (msg.type === 'kicked') { if (oi) oi.textContent = '你已被主机移出房间'; onlineCleanup(); resetOnlinePanel(); navStack = []; applyPanel('main'); }
  });
  mqttClient.on('error', () => { if (oi) oi.textContent = '信令服务器连接失败'; showRetry(); });
  connectTimeout = setTimeout(() => { if (!rtcDc) { if (oi) oi.textContent = '连接超时'; showRetry(); } }, 60000);
  return true;
}

function startDualModeProbe() {
  if (helloInterval) clearInterval(helloInterval);
  let count = 0;
  const send = () => {
    count++;
    if (hostBusy) return;
    if (mqttClient && mqttClient.connected) {
      try {
        mqttClient.publish(roomTopic(currentRoom, 'host'), JSON.stringify({ type: 'hello' }), { qos: 1 });
        mqttClient.publish(roomTopic(currentRoom, 'host'), JSON.stringify({ type: 'hello4', from: localId, name: playerName, prefSlot: 0 }), { qos: 1 });
      } catch (e) {}
    }
    if (count >= 25) { clearInterval(helloInterval); helloInterval = null; }
  };
  send();
  helloInterval = setInterval(send, 700);
  const oi = $('onlineInstruction');
  if (oi) oi.textContent = '已发送请求，等待主机响应…';
}
function handleFourClientSignal(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'full') { const oi = $('onlineInstruction'); if (oi) oi.textContent = '房间已满，无法加入'; showRetry(); return; }
  if (msg.type === 'kicked') { const oi = $('onlineInstruction'); if (oi) oi.textContent = '你已被主机移出房间'; onlineCleanup(); resetOnlinePanel(); navStack = []; applyPanel('main'); return; }
  if (msg.type === 'welcome4') {
    mySlot = msg.slot;
    if (helloInterval) { clearInterval(helloInterval); helloInterval = null; }
    const oi = $('onlineInstruction');
    if (oi) oi.textContent = '已分配位置：' + slotLabel(mySlot) + '，正在建立连接…';
    updateRoomUI(); return;
  }
  if (msg.type === 'offer4') {
    rtcPc.setRemoteDescription(msg.sdp)
      .then(() => { for (const c of pendingCandidates) rtcPc.addIceCandidate(c).catch(() => {}); pendingCandidates = []; return rtcPc.createAnswer(); })
      .then(ans => rtcPc.setLocalDescription(ans))
      .then(() => { signalSend('host', { type: 'answer4', from: localId, sdp: rtcPc.localDescription }); })
      .catch(() => {});
    return;
  }
  if (msg.type === 'ice4') {
    if (!rtcPc) return;
    if (rtcPc.remoteDescription) rtcPc.addIceCandidate(msg.candidate).catch(() => {});
    else pendingCandidates.push(msg.candidate);
  }
}
function setupFourClientChannel(channel) {
  rtcDc = channel;
  channel.onopen = () => {
    hideRetry();
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
    try { channel.send(JSON.stringify({ t: 'name', name: playerName })); } catch (e) {}
    const oi = $('onlineInstruction'); if (oi) oi.textContent = '已连接，等待主机开始游戏...';
    const pb = $('pauseBtn'); if (pb) pb.classList.add('disabled');
    updateRoomUI();
    netAccum = 0; stats.ping = -1;
    startPingLoop(); updateStatsDisplay();
  };
  channel.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'room') {
      if (msg.slotInfo) {
        slotInfo = msg.slotInfo;
        if (playerCount === 2 && onlineRole === 'client') mySlot = 2;
        for (let s = 1; s <= 4; s++) if (slotInfo[s] && slotInfo[s].clientId === localId) { mySlot = s; break; }
        updateRoomUI();
      }
      if (msg.formation) teamFormation = msg.formation;
      if (typeof msg.squeeze === 'boolean') teamSqueeze = msg.squeeze;
      if (typeof msg.diff === 'string') onlineDiff = msg.diff;
      if (typeof msg.mode === 'string') onlineMode = msg.mode;
      if (typeof msg.timerSeconds === 'number') onlineTimerSeconds = msg.timerSeconds;
      if (typeof msg.ballSpeed === 'number') onlineBallSpeed = msg.ballSpeed;
      if (typeof msg.winScore === 'number') winScore = msg.winScore;
      if (msg.blessings) { roomBlessings = msg.blessings; if (roomBlessings[mySlot]) myBlessing = roomBlessings[mySlot]; updateRoomUI(); }
      if (typeof msg.paddleMul === 'number') onlinePaddleMul = msg.paddleMul;
      if (typeof msg.paddleSpeed === 'number') onlinePaddleSpeed = msg.paddleSpeed;
      if (typeof msg.aiLevel === 'string') onlineAILevel = msg.aiLevel;
      if (typeof msg.curveMul === 'number') onlineCurveMul = msg.curveMul;
      if (typeof msg.powerupMul === 'number') onlinePowerupMul = msg.powerupMul;
      if (msg.aiControl) slotAiControl = msg.aiControl;
      syncUI();
    } else if (msg.t === 'start4') {
      winScore = msg.winScore || winScore;
      timerMode = !!msg.timerMode;
      timerSeconds = msg.timerSeconds || 60;
      if (typeof msg.ballSpeed === 'number') onlineBallSpeed = msg.ballSpeed;
      if (typeof msg.diff === 'string') currentDiff = msg.diff;
      if (msg.formation) teamFormation = msg.formation;
      if (typeof msg.squeeze === 'boolean') teamSqueeze = msg.squeeze;
      if (msg.blessings) roomBlessings = msg.blessings;
      if (typeof msg.paddleMul === 'number') onlinePaddleMul = msg.paddleMul;
      if (typeof msg.paddleSpeed === 'number') onlinePaddleSpeed = msg.paddleSpeed;
      if (typeof msg.aiLevel === 'string') onlineAILevel = msg.aiLevel;
      if (typeof msg.curveMul === 'number') onlineCurveMul = msg.curveMul;
      if (typeof msg.powerupMul === 'number') onlinePowerupMul = msg.powerupMul;
      playerCount = 4;
      startGame();
    } else if (msg.t === 'state4') applyRemoteState4(msg);
    else if (msg.t === 'end') endGame(msg.msg, msg.isWin);
    else if (msg.t === 'pauseState') {
      onlinePausedByHost = !!msg.paused;
      if (onlinePausedByHost) {
        paused = true;
        const po = $('pauseOverlay'); if (po) po.classList.add('show');
        const pt = $('pauseTitle'), ps = $('pauseSub'), qrb = $('quitRoomBtn');
        if (pt) pt.textContent = '主机已暂停';
        if (ps) ps.textContent = '等待主机继续…';
        if (qrb) qrb.style.display = 'none';
        if (animId) cancelAnimationFrame(animId); animId = null;
      } else {
        paused = false;
        const po = $('pauseOverlay'); if (po) po.classList.remove('show');
        lastFrameTime = performance.now(); lastRenderTime = 0; physAccumulator = 0;
        if (!animId && gameRunning) animId = requestAnimationFrame(gameLoop);
      }
    }
    else if (msg.t === 'resumeCountdown') { if (gameRunning) runCountdown(msg.sec || 3); }
    else if (msg.t === 'backToRoom') { if (gameRunning) quitToRoom(); }
    else if (msg.t === 'roomClosed') {
      try { onlineCleanup(); } catch (e) {}
      navStack = []; applyPanel('main');
      updateControlsHint(); updateStatsDisplay();
      alert('房主已关闭房间');
    }
    else if (msg.t === 'ping') { try { channel.send(JSON.stringify({ t: 'pong', ts: msg.ts })); } catch (e) {} }
    else if (msg.t === 'pong') { const rtt = Date.now() - msg.ts; if (rtt >= 0 && rtt < 5000) stats.ping = rtt; }
  };
  channel.onclose = () => {
    stopPingLoop(); updateStatsDisplay();
    if (gameRunning) endGame('连接断开', false);
  };
}

/* ============================================================
   手动 P2P 直连
   ============================================================ */
function encodeManualCode(obj) {
  try {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  } catch (e) { return ''; }
}
function decodeManualCode(str) {
  try {
    const clean = String(str).replace(/\s+/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) { return null; }
}
function manualSetStatus(elId, text, cls) {
  const el = $(elId); if (!el) return;
  el.className = 'room-status-bar' + (cls ? ' ' + cls : '');
  el.textContent = text;
}
function manualCopy(targetId, hintId) {
  const el = $(targetId); if (!el) return;
  const text = (el.value || el.textContent || '').trim();
  if (!text) return;
  const done = (ok) => {
    const h = $(hintId);
    if (h) h.textContent = ok ? '✓ 已复制到剪贴板' : '复制失败，请长按手动选择';
    if (h) setTimeout(() => { h.textContent = h.dataset.orig || ''; }, 2000);
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(false));
  else {
    try { el.removeAttribute('readonly'); el.select(); const ok = document.execCommand('copy'); el.setAttribute('readonly', ''); done(ok); }
    catch (e) { done(false); }
  }
}
function p2pResetState() {
  try { if (rtcDc) rtcDc.close(); } catch (e) {}
  try { if (rtcPc) rtcPc.close(); } catch (e) {}
  rtcDc = null;
  rtcPc = null;
  pendingCandidates = [];
  manualPendingCand = [];
  onlineRole = null;
}
function waitForIceGathering(pc, timeoutMs) {
  return new Promise((resolve) => {
    if (!pc || pc.iceGatheringState === 'complete') { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; try { pc.removeEventListener('icegatheringstatechange', onChange); } catch (e) {} resolve(); };
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
    try { pc.addEventListener('icegatheringstatechange', onChange); } catch (e) {}
    setTimeout(finish, timeoutMs || 2500);
  });
}
async function manualHostGenerateOffer() {
  const codeEl = $('manualOfferCode');
  const statusEl = 'manualHostStatus';
  manualSetStatus(statusEl, '正在生成邀请码…', 'wait');
  onlineTransport = 'mqtt'; transportMode = 'mqtt'; playerCount = 2;
  gameMode = 'online'; timerMode = false;
  p2pResetState();
  rtcPc = new RTCPeerConnection(RTC_CONFIG_WEB);
  rtcPc.onicecandidate = (e) => { if (e.candidate) manualPendingCand.push(e.candidate); };
  rtcPc.onconnectionstatechange = () => {
    const st = rtcPc && rtcPc.connectionState;
    if (st === 'failed') manualSetStatus(statusEl, '连接失败，请重新生成', '');
    else if (st === 'connected') manualSetStatus(statusEl, '✓ P2P 通道已连接', 'ok');
  };
  try {
    const dc = rtcPc.createDataChannel('game', { ordered: true });
    onlineRole = 'host'; mySlot = 1;
    currentRoom = 'P2P-' + localId.slice(0, 4).toUpperCase();
    setupDataChannel(dc);
    const offer = await rtcPc.createOffer();
    await rtcPc.setLocalDescription(offer);
    await waitForIceGathering(rtcPc, 2500);
    const packed = {
      v: 1, type: 'offer',
      sdp: { type: rtcPc.localDescription.type, sdp: rtcPc.localDescription.sdp },
      cand: [],
      name: playerName
    };
    if (codeEl) codeEl.value = encodeManualCode(packed);
    slotInfo = { 1: { name: playerName, ready: true, isAI: false, clientId: localId, connected: true },
                 2: { name: '对手', ready: false, isAI: false, clientId: 'manual-peer', connected: false },
                 3: null, 4: null };
    roomBlessings = { 1: myBlessing, 2: 'none', 3: 'none', 4: 'none' };
    updateRoomUI();
    manualSetStatus(statusEl, '✓ 邀请码已生成，请复制发给朋友', 'ok');
  } catch (e) { manualSetStatus(statusEl, '生成失败：' + (e.message || e), ''); }
}
async function manualHostAcceptAnswer() {
  const inputEl = $('manualAnswerInput');
  const statusEl = 'manualHostStatus';
  if (!inputEl || !rtcPc) { manualSetStatus(statusEl, '请先点击「生成邀请码」', ''); return; }
  const code = inputEl.value.trim();
  if (!code) { manualSetStatus(statusEl, '请粘贴朋友发回的应答码', ''); return; }
  const data = decodeManualCode(code);
  if (!data || data.type !== 'answer') { manualSetStatus(statusEl, '应答码无效', ''); return; }
  if (rtcPc.signalingState !== 'have-local-offer') {
    if (rtcPc.connectionState === 'connected') manualSetStatus(statusEl, '✓ 已连接，无需重复接受', 'ok');
    else manualSetStatus(statusEl, '房主状态异常（' + rtcPc.signalingState + '）：请重新点「生成邀请码」', '');
    return;
  }
  manualSetStatus(statusEl, '正在建立连接…', 'wait');
  try {
    await rtcPc.setRemoteDescription(data.sdp);
    for (const c of (data.cand || [])) { try { await rtcPc.addIceCandidate(c); } catch (e) {} }
    for (const c of manualPendingCand) { try { await rtcPc.addIceCandidate(c); } catch (e) {} }
    if (data.name) { remoteName = String(data.name).slice(0, 16); if (slotInfo[2]) slotInfo[2].name = remoteName; updateRoomUI(); }
    manualSetStatus(statusEl, '✓ 应答已接受，等待通道打开…', 'ok');
  } catch (e) { manualSetStatus(statusEl, '连接失败：' + (e.message || e), ''); }
}
async function manualClientGenerateAnswer() {
  const offerEl = $('manualOfferInput');
  const answerEl = $('manualAnswerCode');
  const statusEl = 'manualClientStatus';
  if (!offerEl) return;
  const code = offerEl.value.trim();
  if (!code) { manualSetStatus(statusEl, '请粘贴房主发来的邀请码', ''); return; }
  const data = decodeManualCode(code);
  if (!data || data.type !== 'offer') { manualSetStatus(statusEl, '邀请码无效', ''); return; }
  manualSetStatus(statusEl, '正在生成应答码…', 'wait');
  onlineTransport = 'mqtt'; transportMode = 'mqtt'; playerCount = 2;
  gameMode = 'online'; timerMode = false;
  p2pResetState();
  rtcPc = new RTCPeerConnection(RTC_CONFIG_WEB);
  rtcPc.onicecandidate = (e) => { if (e.candidate) manualPendingCand.push(e.candidate); };
  rtcPc.ondatachannel = (e) => { setupDataChannel(e.channel); };
  rtcPc.onconnectionstatechange = () => {
    const st = rtcPc && rtcPc.connectionState;
    if (st === 'failed') manualSetStatus(statusEl, '连接失败，请重新生成', '');
    else if (st === 'connected') manualSetStatus(statusEl, '✓ P2P 通道已连接', 'ok');
  };
  try {
    await rtcPc.setRemoteDescription(data.sdp);
    for (const c of (data.cand || [])) { try { await rtcPc.addIceCandidate(c); } catch (e) {} }
    const answer = await rtcPc.createAnswer();
    await rtcPc.setLocalDescription(answer);
    await waitForIceGathering(rtcPc, 2500);
    const packed = {
      v: 1, type: 'answer',
      sdp: { type: rtcPc.localDescription.type, sdp: rtcPc.localDescription.sdp },
      cand: [],
      name: playerName
    };
    if (answerEl) answerEl.value = encodeManualCode(packed);
    onlineRole = 'client'; mySlot = 2; currentRoom = 'P2P-CLIENT';
    slotInfo = { 1: { name: data.name || '房主', ready: true, isAI: false, clientId: 'manual-host', connected: true },
                 2: { name: playerName, ready: false, isAI: false, clientId: localId, connected: true },
                 3: null, 4: null };
    roomBlessings = { 1: 'none', 2: myBlessing, 3: 'none', 4: 'none' };
    updateRoomUI();
    manualSetStatus(statusEl, '✓ 应答码已生成，请复制发回给房主', 'ok');
  } catch (e) { manualSetStatus(statusEl, '生成失败：' + (e.message || e), ''); }
}

/* ============================================================
   状态同步
   ============================================================ */
function broadcastRoomState() {
  if (onlineRole !== 'host') return;
  if (playerCount === 2 && slotInfo[2]) slotInfo[2].ready = !!clientReady;
  transportSend({
    t: 'room',
    slotInfo: { 1: slotInfo[1], 2: slotInfo[2], 3: slotInfo[3], 4: slotInfo[4] },
    formation: teamFormation, squeeze: teamSqueeze,
    diff: onlineDiff, mode: onlineMode, timerSeconds: onlineTimerSeconds,
    ballSpeed: onlineBallSpeed, winScore: winScore,
    blessings: roomBlessings,
    paddleMul: onlinePaddleMul, paddleSpeed: onlinePaddleSpeed,
    aiLevel: onlineAILevel, curveMul: onlineCurveMul, powerupMul: onlinePowerupMul,
    aiControl: slotAiControl
  });
}
function sendHostState() {
  if (playerCount === 4) { sendHostState4(); return; }
  transportSend({
    t: 'state',
    ball: { x: ball.x, y: ball.y, sx: ball.speedX, sy: ball.speedY, sp: ball.spin, sz: ball.size },
    p1: { y: player.y, h: player.height }, p2: { y: ai.y, h: ai.height },
    score: [playerScore, aiScore], streak: [p1ShieldCount, p2ShieldCount],
    powerups: activePowerups.map(p => ({ type: p.type, timer: p.timer, applied: p.applied, maxTimer: p.maxTimer, owner: p.owner })),
    curved: isCurvedBall, timer: timerRemaining, round: roundNumber
  });
}
function sendHostState4() {
  transportSend({
    t: 'state4',
    ball: { x: ball.x, y: ball.y, sx: ball.speedX, sy: ball.speedY, sp: ball.spin, sz: ball.size },
    pads: {
      1: { y: player.y, h: player.height, baseH: player.baseHeight },
      2: { y: p2Paddle.y, h: p2Paddle.height, baseH: p2Paddle.baseHeight },
      3: { y: ai.y, h: ai.height, baseH: ai.baseHeight },
      4: { y: p4Paddle.y, h: p4Paddle.height, baseH: p4Paddle.baseHeight }
    },
    score: [playerScore, aiScore], streak: [p1ShieldCount, p2ShieldCount],
    powerups: activePowerups.map(p => ({ type: p.type, timer: p.timer, applied: p.applied, maxTimer: p.maxTimer, owner: p.owner })),
    curved: isCurvedBall, timer: timerRemaining, round: roundNumber,
    floats: floatTexts.map(f => ({ x: f.x, y: f.y, text: f.text, color: f.color, life: f.life, size: f.size }))
  });
}
function sendClientInput() {
  if (playerCount === 4) { const myPad = getPaddleBySlot(mySlot); if (myPad) transportSend({ t: 'input', y: myPad.y }); }
  else transportSend({ t: 'input', y: ai.y });
}
function applyRemoteState(s) {
  ball.x = s.ball.x; ball.y = s.ball.y;
  ball.speedX = s.ball.sx; ball.speedY = s.ball.sy;
  ball.spin = s.ball.sp; ball.size = s.ball.sz;
  player.y = s.p1.y; player.height = s.p1.h; ai.height = s.p2.h;
  playerScore = s.score[0]; aiScore = s.score[1];
  p1ShieldCount = s.streak[0]; p2ShieldCount = s.streak[1];
  activePowerups = s.powerups || []; isCurvedBall = s.curved;
  if (typeof s.timer === 'number') { timerRemaining = s.timer; updateTimerDisplay(); }
  if (typeof s.round === 'number') { roundNumber = s.round; updateRoundDisplay(); }
  updateScore(); updateShields(); updateStatusChips();
}
function applyRemoteState4(s) {
  ball.x = s.ball.x; ball.y = s.ball.y;
  ball.speedX = s.ball.sx; ball.speedY = s.ball.sy;
  ball.spin = s.ball.sp; ball.size = s.ball.sz;
  if (s.pads) {
    for (const k in s.pads) {
      const pd = getPaddleBySlot(parseInt(k, 10));
      if (pd) { pd.y = s.pads[k].y; pd.height = s.pads[k].h; pd.baseHeight = s.pads[k].baseH; }
    }
  }
  playerScore = s.score[0]; aiScore = s.score[1];
  p1ShieldCount = s.streak[0]; p2ShieldCount = s.streak[1];
  activePowerups = s.powerups || []; isCurvedBall = s.curved;
  if (typeof s.timer === 'number') { timerRemaining = s.timer; updateTimerDisplay(); }
  if (typeof s.round === 'number') { roundNumber = s.round; updateRoundDisplay(); }
  if (Array.isArray(s.floats)) floatTexts = s.floats.map(f => ({ ...f }));
  updateScore(); updateShields(); updateStatusChips();
}

/* ============================================================
   设置
   ============================================================ */
const SETTINGS_KEY = 'pong84.settings.v24';
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') {
      if (s.crtTheme && CRT_THEMES[s.crtTheme]) crtTheme = s.crtTheme;
      if (s.renderMode && ['classic', 'cinematic', 'simple'].includes(s.renderMode)) renderMode = s.renderMode;
      if (s.uiSize && ['large', 'small'].includes(s.uiSize)) uiSize = s.uiSize;
      if (s.targetFps === 30 || s.targetFps === 60) targetFps = s.targetFps;
      if (s.playerBlessing && BLESSINGS[s.playerBlessing]) playerBlessing = s.playerBlessing;
      if (s.player2Blessing && BLESSINGS[s.player2Blessing]) player2Blessing = s.player2Blessing;
      if (s.aiBlessingMode && ['none', 'random'].includes(s.aiBlessingMode)) aiBlessingMode = s.aiBlessingMode;
      if (typeof s.gpuAccel === 'boolean') gpuAccel = s.gpuAccel;
      if (typeof s.sfxEnabled === 'boolean') sfxEnabled = s.sfxEnabled;
      if (typeof s.masterVolume === 'number') masterVolume = clamp(s.masterVolume, 0, 1);
      if (typeof s.autoFullscreen === 'boolean') autoFullscreen = s.autoFullscreen;
      if (typeof s.blurAutoPause === 'boolean') blurAutoPause = s.blurAutoPause;
      if (typeof s.paddleSpeedSetting === 'number' && s.paddleSpeedSetting >= 0.10 && s.paddleSpeedSetting <= 1.20) paddleSpeedSetting = s.paddleSpeedSetting;
      if (s.touchControlMode === 'follow' || s.touchControlMode === 'buttons') touchControlMode = s.touchControlMode;
    }
  } catch (e) {}
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      crtTheme, renderMode, uiSize, targetFps, playerBlessing, player2Blessing, aiBlessingMode,
      gpuAccel, sfxEnabled, masterVolume, autoFullscreen, blurAutoPause, paddleSpeedSetting, touchControlMode
    }));
  } catch (e) {}
}
function applyRenderModeClass() {
  document.body.classList.toggle('simple-mode', renderMode === 'simple');
  document.body.classList.toggle('cinematic-mode', renderMode === 'cinematic');
  if (renderMode === 'simple') phosphorTrail = [];
}
function applyUISizeClass() { document.body.classList.toggle('ui-small', uiSize === 'small'); }
function applyGpuClass() { const el = $('crtScreen'); if (el) el.classList.toggle('gpu-on', gpuAccel); }
function applyTouchModeClass() { document.body.classList.toggle('follow-touch', touchControlMode === 'follow'); }
function updateCSSVariables() {
  const t = getTheme(); const root = document.documentElement;
  root.style.setProperty('--crt-color', t.color);
  root.style.setProperty('--crt-glow', t.glow);
  root.style.setProperty('--crt-bg', t.bg);
  root.style.setProperty('--crt-dim', t.dim);
  root.style.setProperty('--crt-mid', rgbaFromHex(t.color, 0.75));
  root.style.setProperty('--crt-bg-03', rgbaFromHex(t.color, 0.03));
  root.style.setProperty('--crt-bg-04', rgbaFromHex(t.color, 0.04));
  root.style.setProperty('--crt-bg-08', rgbaFromHex(t.color, 0.08));
  root.style.setProperty('--crt-bg-09', rgbaFromHex(t.color, 0.09));
  root.style.setProperty('--crt-bg-11', rgbaFromHex(t.color, 0.11));
  root.style.setProperty('--crt-bg-12', rgbaFromHex(t.color, 0.12));
  root.style.setProperty('--crt-bg-20', rgbaFromHex(t.color, 0.20));
  root.style.setProperty('--crt-bg-22', rgbaFromHex(t.color, 0.22));
}

/* ============================================================
   面板导航
   ============================================================ */
const PANEL_IDS = ['main', 'local', 'ai', 'pvp', 'online', 'online-mode', 'online-join',
                   'online-manual', 'room', 'blessing', 'leaderboard', 'account',
                   'options', 'debug', 'manual', 'result'];
let currentPanel = 'main';
let navStack = [];
function applyPanel(name) {
  PANEL_IDS.forEach(p => { const el = $('panel-' + p); if (el) el.classList.toggle('hidden-section', p !== name); });
  currentPanel = name;
  const bb = $('backBtn');
  if (bb) bb.classList.toggle('hidden-section', navStack.length === 0);
  if (name === 'blessing') renderBlessingPage();
  if (name === 'leaderboard') { void lbConnect(); updateBanBanner(); }
  if (accountChallenge) {
    lbUpdateAccountPanel();
    if (name === 'account') {
      $('lbNameInput').value = (accountProfile?.name || playerName).replace(/^匿名$/, '');
      lbRenderMyStats();
    }
  }
  if (name === 'ai' || name === 'pvp') updateBlessingSummary();
  if (name === 'room') updateRoomUI();
  const ov = $('overlay'); if (ov) ov.scrollTop = 0;
}
function navigate(name) { if (name === currentPanel) return; navStack.push(currentPanel); applyPanel(name); }
function goBack() { if (!navStack.length) return; const prev = navStack.pop(); applyPanel(prev); }

/* ============================================================
   加护页面
   ============================================================ */
let blessingEditTarget = 'p1';
function getBlessingFor(target) {
  if (target === 'p1') return playerBlessing;
  if (target === 'p2') return gameMode === 'ai' ? aiBlessingMode : player2Blessing;
  return 'none';
}
function setBlessingFor(target, key) {
  if (target === 'p1') playerBlessing = key;
  else if (target === 'p2') { if (gameMode === 'ai') aiBlessingMode = (key === 'none') ? 'none' : 'random'; else player2Blessing = key; }
  saveSettings();
}
function renderBlessingPage() {
  const header = $('blessPlayers');
  let opts = [];
  if (gameMode === 'ai') opts = [{ k: 'p1', t: '玩家' }, { k: 'p2', t: '电脑' }];
  else if (gameMode === 'pvp') opts = [{ k: 'p1', t: '玩家1' }, { k: 'p2', t: '玩家2' }];
  else opts = [{ k: 'p1', t: '玩家1' }];
  if (!opts.some(o => o.k === blessingEditTarget)) blessingEditTarget = 'p1';
  if (header) {
    header.innerHTML = '<span class="bh-label">对象</span>' +
      opts.map(o => '<button class="bp-chip' + (o.k === blessingEditTarget ? ' active' : '') + '" data-bp="' + o.k + '">' + o.t + '</button>').join('') +
      '<span class="bh-spacer"></span>';
    header.querySelectorAll('[data-bp]').forEach(b => b.addEventListener('click', () => { blessingEditTarget = b.dataset.bp; renderBlessingPage(); }));
  }
  const cur = getBlessingFor(blessingEditTarget);
  const isRandomAI = (blessingEditTarget === 'p2' && gameMode === 'ai' && aiBlessingMode === 'random');
  const list = $('blessList');
  if (list) {
    list.innerHTML = BLESSING_ORDER.map(k => {
      const b = BLESSINGS[k]; const sel = cur === k;
      return '<button class="bl-tile' + (sel ? ' selected' : '') + '" data-bl="' + k + '">' +
        '<span class="bl-ico" style="color:' + b.color + '">' + b.icon + '</span>' +
        '<span class="bl-label" style="color:' + (sel ? b.color : '#bbb') + '">' + b.label + '</span>' +
        '<span class="bl-tag">' + b.tag + '</span></button>';
    }).join('');
    list.querySelectorAll('[data-bl]').forEach(b => b.addEventListener('click', () => {
      setBlessingFor(blessingEditTarget, b.dataset.bl);
      AudioEngine.init(); AudioEngine.timerTick();
      renderBlessingPage(); updateBlessingSummary();
    }));
  }
  const shown = isRandomAI ? { label: '随机加护', color: '#ff88ff', tag: '随机', desc: '每局开始时从所有加护中随机抽取一个。' } : BLESSINGS[cur];
  const bn = $('bdName'), bt = $('bdTag'), bd = $('bdDesc');
  if (bn) { bn.textContent = shown.label; bn.style.color = shown.color; }
  if (bt) { bt.textContent = shown.tag; bt.style.color = shown.color; }
  if (bd) bd.textContent = shown.desc;
}
function updateBlessingSummary() {
  const el1 = $('aiP1Blessing'), el2 = $('aiP2Blessing');
  if (el1) { el1.textContent = BLESSINGS[playerBlessing].label; el1.style.color = BLESSINGS[playerBlessing].color; }
  if (el2) { const t = aiBlessingMode === 'random' ? '随机' : '无'; el2.textContent = t; el2.style.color = aiBlessingMode === 'random' ? '#ff88ff' : '#888888'; }
  const p1 = $('pvpP1Blessing'), p2 = $('pvpP2Blessing');
  if (p1) { p1.textContent = BLESSINGS[playerBlessing].label; p1.style.color = BLESSINGS[playerBlessing].color; }
  if (p2) { p2.textContent = BLESSINGS[player2Blessing].label; p2.style.color = BLESSINGS[player2Blessing].color; }
}

/* ============================================================
   房间 UI
   ============================================================ */
function updateRoomStatus() {
  const bar = $('roomStatusBar'); if (!bar) return;
  const isHost = onlineRole === 'host';
  const connected = !!(rtcDc && rtcDc.readyState === 'open');
  if (!currentRoom) { bar.className = 'room-status-bar'; bar.textContent = '—'; return; }
  if (isHost) {
    if (playerCount === 2) {
      const cReady = slotInfo[2] && slotInfo[2].ready;
      if (!connected) { bar.className = 'room-status-bar wait'; bar.textContent = '⏳ 等待玩家加入…'; }
      else if (!cReady) { bar.className = 'room-status-bar wait'; bar.textContent = '👤 对手已加入，等待准备'; }
      else { bar.className = 'room-status-bar ok'; bar.textContent = '✓ 双方已准备，可以开始'; }
    } else {
      const humans = [1, 2, 3, 4].filter(s => slotInfo[s] && !slotInfo[s].isAI).length;
      const allReady = [1, 2, 3, 4].every(s => !slotInfo[s] || slotInfo[s].isAI || slotInfo[s].ready);
      if (humans < 2) { bar.className = 'room-status-bar wait'; bar.textContent = '⏳ 等待玩家加入…（空位由 AI 补齐）'; }
      else if (!allReady) { bar.className = 'room-status-bar wait'; bar.textContent = '👤 等待所有玩家准备'; }
      else { bar.className = 'room-status-bar ok'; bar.textContent = '✓ 所有玩家已准备，可以开始'; }
    }
  } else {
    if (!connected) { bar.className = 'room-status-bar wait'; bar.textContent = '⏳ 连接中…'; }
    else {
      const myReady = slotInfo[mySlot] && slotInfo[mySlot].ready;
      if (myReady) { bar.className = 'room-status-bar ok'; bar.textContent = '✓ 已准备，等待主机开始'; }
      else { bar.className = 'room-status-bar wait'; bar.textContent = '👤 请点击下方「准备」按钮'; }
    }
  }
}
function updateRoomUI() {
  if (!currentRoom) return;
  const roomCodeText = $('roomCodeText'); if (roomCodeText) roomCodeText.textContent = currentRoom;
  const connected = !!(rtcDc && rtcDc.readyState === 'open');
  const isHost = onlineRole === 'host';
  const roomPlayerList = $('roomPlayerList'), onlineStartBtn = $('onlineStartBtn'),
        clientReadyBtn = $('clientReadyBtn'), roomSettingsTab = $('roomSettingsTab'),
        slotPickerWrap = $('slotPickerWrap');

  if (playerCount === 2) {
    const myName = lbEscapeHtml(playerName || '匿名');
    if (isHost) {
      const cReady = slotInfo[2] && slotInfo[2].ready;
      const remoteN = (slotInfo[2] && slotInfo[2].name) || remoteName || '对手';
      if (roomPlayerList) {
        roomPlayerList.innerHTML =
          '<div class="pl-row"><span class="pl-slot">1</span><span class="pl-tag host">主机</span><span class="pl-name">' + myName + ' (我)</span><span class="pl-ready">已准备</span></div>' +
          (connected
            ? '<div class="pl-row"><span class="pl-slot">2</span><span class="pl-tag">玩家</span><span class="pl-name">' + lbEscapeHtml(remoteN) + '</span>' + (cReady ? '<span class="pl-ready">已准备</span>' : '<span class="pl-ready no">未准备</span>') + '</div>'
            : '<div class="pl-row empty">等待玩家加入…</div>');
      }
      if (onlineStartBtn) onlineStartBtn.style.display = (connected && cReady) ? 'block' : 'none';
      if (clientReadyBtn) clientReadyBtn.classList.add('hidden-section');
      if (roomSettingsTab) roomSettingsTab.classList.remove('hidden-section');
    } else {
      const remoteN = (slotInfo[1] && slotInfo[1].name) || remoteName || '主机';
      const myReady = slotInfo[2] && slotInfo[2].ready;
      if (roomPlayerList) {
        roomPlayerList.innerHTML =
          '<div class="pl-row"><span class="pl-slot">1</span><span class="pl-tag host">主机</span><span class="pl-name">' + lbEscapeHtml(remoteN) + '</span><span class="pl-ready">已准备</span></div>' +
          '<div class="pl-row"><span class="pl-slot">2</span><span class="pl-tag">玩家</span><span class="pl-name">' + myName + ' (我)</span>' + (myReady ? '<span class="pl-ready">已准备</span>' : '<span class="pl-ready no">未准备</span>') + '</div>';
      }
      if (onlineStartBtn) onlineStartBtn.style.display = 'none';
      if (clientReadyBtn) {
        clientReadyBtn.classList.remove('hidden-section');
        if (myReady) { clientReadyBtn.textContent = '已准备，等待主机开始'; clientReadyBtn.disabled = true; }
        else { clientReadyBtn.textContent = '准备'; clientReadyBtn.disabled = false; }
      }
      if (roomSettingsTab) roomSettingsTab.classList.add('hidden-section');
    }
    if (slotPickerWrap) slotPickerWrap.classList.add('hidden-section');
  } else {
    let html = '';
    for (let s = 1; s <= 4; s++) {
      const info = slotInfo[s];
      const team = slotTeam(s);
      const teamCls = team === 'L' ? 'teamL' : 'teamR';
      const posLabel = slotLabel(s);
      if (!info) {
        html += '<div class="pl-row"><span class="pl-slot">' + s + '</span><span class="pl-tag ai">空位</span><span class="pl-name" style="color:#666;">AI 补齐</span></div>';
      } else {
        const isMe = (isHost && s === 1) || (!isHost && s === mySlot);
        const tag = s === 1 ? '<span class="pl-tag host">主机</span>' : '<span class="pl-tag ' + teamCls + '">' + posLabel + '</span>';
        let readyTag;
        if (info.isAI) readyTag = '<span class="pl-tag ai">AI</span>';
        else if (slotAiControl[s]) readyTag = '<span class="pl-tag bot">离线托管</span>';
        else readyTag = (info.ready ? '<span class="pl-ready">已准备</span>' : '<span class="pl-ready no">未准备</span>');
        const kickBtn = (isHost && !isMe && !info.isAI) ? '<button class="pl-kick" data-kick-slot="' + s + '">踢出</button>' : '';
        html += '<div class="pl-row"><span class="pl-slot">' + s + '</span>' + tag +
          '<span class="pl-name">' + lbEscapeHtml(info.name || '玩家') + (isMe ? ' (我)' : '') + '</span>' +
          readyTag + kickBtn + '</div>';
      }
    }
    if (roomPlayerList) {
      roomPlayerList.innerHTML = html;
      roomPlayerList.querySelectorAll('[data-kick-slot]').forEach(b => b.addEventListener('click', () => kickSlot(parseInt(b.dataset.kickSlot, 10))));
    }
    const sp = $('slotPicker');
    if (!isHost && slotPickerWrap && sp) {
      slotPickerWrap.classList.remove('hidden-section');
      let sph = '';
      for (let s = 1; s <= 4; s++) {
        const taken = slotInfo[s] !== null && s !== mySlot;
        const sel = s === mySlot;
        const team = slotTeam(s);
        const teamCls = team === 'L' ? 'slot-teamL' : 'slot-teamR';
        const teamLabel = team === 'L' ? '红队' : '蓝队';
        sph += '<button class="slot-btn' + (sel ? ' selected' : '') + (taken ? ' taken' : '') + '" data-slot="' + s + '">' +
          '<span class="' + teamCls + '">' + teamLabel + '</span><span class="slot-pos">' + slotLabel(s) + '</span></button>';
      }
      sp.innerHTML = sph;
      sp.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => requestSlotChange(parseInt(b.dataset.slot, 10))));
    } else if (slotPickerWrap) slotPickerWrap.classList.add('hidden-section');

    let readyCount = 0, humanCount = 0;
    for (let s = 1; s <= 4; s++) {
      const info = slotInfo[s];
      if (info && !info.isAI) { humanCount++; if (s === 1 || info.ready) readyCount++; }
    }
    const canStart = isHost && humanCount >= 1 && readyCount === humanCount;
    if (onlineStartBtn) onlineStartBtn.style.display = canStart ? 'block' : 'none';
    if (clientReadyBtn) clientReadyBtn.classList.toggle('hidden-section', isHost);
    if (!isHost && clientReadyBtn) {
      const myInfo = slotInfo[mySlot];
      if (myInfo && myInfo.ready) { clientReadyBtn.textContent = '已准备，等待主机开始'; clientReadyBtn.disabled = true; }
      else { clientReadyBtn.textContent = '准备'; clientReadyBtn.disabled = false; }
    }
    if (roomSettingsTab) roomSettingsTab.classList.toggle('hidden-section', !isHost);
  }

  const bp = $('roomBlessingPicker');
  if (bp) {
    bp.innerHTML = BLESSING_ORDER.map(k => {
      const b = BLESSINGS[k];
      const sel = myBlessing === k;
      return '<button class="opt-btn' + (sel ? ' selected' : '') + '" data-rbless="' + k + '">' + b.label + '</button>';
    }).join('');
    bp.querySelectorAll('[data-rbless]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        myBlessing = btn.dataset.rbless;
        bp.querySelectorAll('[data-rbless]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        if (onlineRole === 'client' && rtcDc && rtcDc.readyState === 'open') { try { rtcDc.send(JSON.stringify({ t: 'myBlessing', value: myBlessing })); } catch (e) {} }
        else if (onlineRole === 'host') { roomBlessings[mySlot] = myBlessing; broadcastRoomState(); }
      });
    });
    if (!isHost && playerCount === 2) {
      const myReady = slotInfo[2] && slotInfo[2].ready;
      bp.querySelectorAll('[data-rbless]').forEach(b => { b.disabled = !!myReady; b.style.opacity = myReady ? '0.45' : ''; b.style.pointerEvents = myReady ? 'none' : ''; });
    }
  }

  const opm = $('onlinePaddleMul'), opmv = $('onlinePaddleMulVal');
  if (opm) { opm.value = onlinePaddleMul; if (opmv) opmv.textContent = onlinePaddleMul.toFixed(2) + 'x'; opm.disabled = !isHost; }
  const ops = $('onlinePaddleSpeed'), opsv = $('onlinePaddleSpeedVal');
  if (ops) { ops.value = onlinePaddleSpeed; if (opsv) opsv.textContent = onlinePaddleSpeed.toFixed(2) + 'x'; ops.disabled = !isHost; }
  const ocm = $('onlineCurveMul'), ocmv = $('onlineCurveMulVal');
  if (ocm) { ocm.value = onlineCurveMul; if (ocmv) ocmv.textContent = onlineCurveMul.toFixed(2) + 'x'; ocm.disabled = !isHost; }
  const opum = $('onlinePowerupMul'), opumv = $('onlinePowerupMulVal');
  if (opum) { opum.value = onlinePowerupMul; if (opumv) opumv.textContent = onlinePowerupMul.toFixed(2) + 'x'; opum.disabled = !isHost; }

  const scoreLabel = $('onlineScoreLabel'), scoreBlock = $('onlineScoreBlock'),
        timeLabel = $('onlineTimeLabel'), timeBlock = $('onlineTimeBlock');
  if (scoreLabel && scoreBlock && timeLabel && timeBlock) {
    scoreLabel.style.opacity = onlineMode === 'timer' ? '.4' : '1';
    scoreBlock.style.opacity = onlineMode === 'timer' ? '.4' : '1';
    timeLabel.style.opacity = onlineMode === 'normal' ? '.4' : '1';
    timeBlock.style.opacity = onlineMode === 'normal' ? '.4' : '1';
    scoreBlock.style.pointerEvents = onlineMode === 'timer' ? 'none' : '';
    timeBlock.style.pointerEvents = onlineMode === 'normal' ? 'none' : '';
  }
  updateRoomStatus();
}
function kickSlot(slot) {
  const isHost = onlineRole === 'host';
  if (!isHost || !slotInfo[slot]) return;
  const info = slotInfo[slot]; const cid = info.clientId;
  if (cid && fourPeers[cid]) {
    try { fourPeers[cid].dc && fourPeers[cid].dc.close(); } catch (e) {}
    try { fourPeers[cid].pc && fourPeers[cid].pc.close(); } catch (e) {}
    delete fourPeers[cid];
  }
  if (cid) signalSendToClient(cid, { type: 'kicked' });
  slotInfo[slot] = null; slotAiControl[slot] = false;
  broadcastRoomState(); updateRoomUI();
}
function requestSlotChange(slot) {
  if (onlineRole !== 'client') return;
  if (slot < 1 || slot > 4) return;
  if (slotInfo[slot] !== null && slot !== mySlot) return;
  transportSend(JSON.stringify({ t: 'requestSlot', slot }));
  mySlot = slot; updateRoomUI();
}

function syncUI() {
  document.querySelectorAll('[data-opt-diff]').forEach(b => b.classList.toggle('selected', b.dataset.optDiff === currentDiff));
  document.querySelectorAll('[data-opt-score]').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.optScore, 10) === winScore));
  document.querySelectorAll('[data-opt-time]').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.optTime, 10) === timerSeconds));
  document.querySelectorAll('[data-opt-theme]').forEach(b => b.classList.toggle('selected', b.dataset.optTheme === crtTheme));
  document.querySelectorAll('[data-opt-render]').forEach(b => b.classList.toggle('selected', b.dataset.optRender === renderMode));
  document.querySelectorAll('[data-opt-uisize]').forEach(b => b.classList.toggle('selected', b.dataset.optUisize === uiSize));
  document.querySelectorAll('[data-opt-fps]').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.optFps, 10) === targetFps));
  document.querySelectorAll('[data-opt-omode]').forEach(b => b.classList.toggle('selected', b.dataset.optOmode === onlineMode));
  document.querySelectorAll('[data-opt-otime]').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.optOtime, 10) === onlineTimerSeconds));
  document.querySelectorAll('[data-opt-oailevel]').forEach(b => b.classList.toggle('selected', b.dataset.optOailevel === onlineAILevel));
  document.querySelectorAll('[data-opt-aimode]').forEach(b => b.classList.toggle('selected', (b.dataset.optAimode === 'timer') === timerMode));
  document.querySelectorAll('[data-opt-sfx]').forEach(b => b.classList.toggle('selected', (b.dataset.optSfx === 'on') === sfxEnabled));
  document.querySelectorAll('[data-opt-gpu]').forEach(b => b.classList.toggle('selected', (b.dataset.optGpu === 'on') === gpuAccel));
  document.querySelectorAll('[data-opt-autofs]').forEach(b => b.classList.toggle('selected', (b.dataset.optAutofs === 'on') === autoFullscreen));
  document.querySelectorAll('[data-opt-blurpause]').forEach(b => b.classList.toggle('selected', (b.dataset.optBlurpause === 'on') === blurAutoPause));
  document.querySelectorAll('[data-opt-form]').forEach(b => b.classList.toggle('selected', b.dataset.optForm === teamFormation));
  document.querySelectorAll('[data-opt-squeeze]').forEach(b => b.classList.toggle('selected', (b.dataset.optSqueeze === 'on') === teamSqueeze));
  document.querySelectorAll('[data-opt-touchmode]').forEach(b => b.classList.toggle('selected', b.dataset.optTouchmode === touchControlMode));
  const ov = $('optVolume'), ovv = $('optVolumeVal');
  if (ov) { ov.value = Math.round(masterVolume * 100); if (ovv) ovv.textContent = Math.round(masterVolume * 100) + '%'; }
  const ops = $('optPaddleSpeed'), opsv = $('optPaddleSpeedVal');
  if (ops) { ops.value = Math.round(paddleSpeedSetting * 100); if (opsv) opsv.textContent = Math.round(paddleSpeedSetting * 100) + '%'; }
  const scoreBlock = $('aiScoreBlock'), timeBlock = $('aiTimeBlock');
  if (scoreBlock) scoreBlock.classList.toggle('hidden-section', timerMode);
  if (timeBlock) timeBlock.classList.toggle('hidden-section', !timerMode);
}

/* ★ 触屏跟随：支持鼠标 mousemove（电脑端无需按住） */
function setupFollowTouch() {
  const container = $('gameContainer');
  if (!container) return;

  const setTargetFromEvent = (e) => {
    if (touchControlMode !== 'follow') return;
    if (!gameRunning) return;
    const rect = canvas.getBoundingClientRect();
    const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    if (clientY == null) return;
    const rel = (clientY - rect.top) / rect.height;
    followTouchTargetY = clamp(rel * LOGICAL_H, 0, LOGICAL_H);
  };

  // 触摸
  container.addEventListener('touchstart', (e) => { if (touchControlMode === 'follow') { e.preventDefault(); setTargetFromEvent(e); } }, { passive: false });
  container.addEventListener('touchmove', (e) => { if (touchControlMode === 'follow') { e.preventDefault(); setTargetFromEvent(e); } }, { passive: false });

  // 鼠标：移动即跟随，无需按住
  container.addEventListener('mousemove', (e) => {
    if (touchControlMode === 'follow') setTargetFromEvent(e);
  });
  // 触控笔等保留 pointermove
  container.addEventListener('pointermove', (e) => {
    if (touchControlMode === 'follow' && e.pointerType === 'mouse') {
      setTargetFromEvent(e);
    } else if (touchControlMode === 'follow' && e.buttons) {
      setTargetFromEvent(e);
    }
  });
}

/* 检索房间 */
async function doSearchRoom() {
  const code = ($('joinCodeInput').value || '').trim();
  const st = $('joinStatus'); if (!st) return;
  if (!/^[0-9]{6}$/.test(code)) { st.className = 'room-status-bar'; st.textContent = '请输入 6 位数字房间号'; return; }
  st.className = 'room-status-bar wait'; st.textContent = '正在连接房间 ' + code + ' …';
  const ok = await joinRoom(code);
  if (ok) {
    st.className = 'room-status-bar ok'; st.textContent = '✓ 已发起连接';
    setTimeout(() => { navStack = navStack.filter(x => x !== 'online-join'); navigate('room'); }, 400);
  } else {
    st.className = 'room-status-bar'; st.textContent = '连接失败，请重试';
  }
}
function copyRoomCode() {
  const rct = $('roomCodeText'); if (!rct) return;
  const code = (rct.textContent || '').trim();
  const finish = (ok) => {
    const h = $('roomCodeHint');
    if (!h) return;
    if (ok) { h.textContent = '✓ 已复制到剪贴板'; setTimeout(() => { h.textContent = '把房间号发给对方'; }, 1800); }
    else h.textContent = '自动复制失败，请手动选择';
  };
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(code).then(() => finish(true)).catch(() => finish(false)); }
  else {
    try {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      finish(ok);
    } catch (e) { finish(false); }
  }
}
function showCountdownTip() {
  const ct = $('countdownTip'); if (!ct) return;
  const TIPS = [
    '击球位置偏离中心越远，旋转越强',
    '先达到目标分且领先 2 分才能获胜',
    '封顶分 = 目标分 +4',
    '盾牌加护可叠加到 3 个护盾',
    '狂暴加护会让你越打越快',
    '四人模式每位玩家可选独立加护',
    '同列互挤时全场拍速减半',
    '触屏跟随模式：手指/鼠标拖动屏幕控制球拍',
    '联机掉线会自动切换为 AI 托管',
    '房间号第一位表示使用的信令服务器编号',
    '手动 P2P 支持微信/QQ 交换邀请码',
    '按键模式积分 ×3，触屏模式积分 ×1'
  ];
  ct.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  ct.classList.add('show');
}
function hideCountdownTip() { const ct = $('countdownTip'); if (ct) ct.classList.remove('show'); }

/* ============================================================
   键盘 / 触屏输入
   ============================================================ */
const keys = Object.create(null);
const touchState = { p1: 0, p2: 0 };
function initInput() {
  window.addEventListener('keydown', e => { if (gameRunning) keys[e.key] = true; });
  window.addEventListener('keyup', e => { keys[e.key] = false; });
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.target === document.body) e.preventDefault();
    if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && gameRunning) { e.preventDefault(); togglePause(); return; }
    if (e.key === 'Escape' && !gameRunning && navStack.length > 0) { e.preventDefault(); goBack(); return; }
    if (onlineRole !== null || lanRole !== null) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    cheatSequence.push(e.key);
    if (cheatSequence.length > KONAMI_CODE.length) cheatSequence.shift();
    if (cheatSequence.length === KONAMI_CODE.length && cheatSequence.every((k, i) => k === KONAMI_CODE[i])) {
      cheatSequence = []; cheatActive = !cheatActive;
      if (cheatActive) { cheatBallSpeedMul = 2.5; player.height = LOGICAL_H; player.y = 0; }
      else { cheatBallSpeedMul = 1; recomputeSpeeds(); }
      updateStatsDisplay();
    }
  });
  document.querySelectorAll('.ctrl-btn').forEach(btn => {
    const kind = btn.dataset.ctrl;
    let baseTarget = 'p1', val = 0;
    if (kind === 'p1up') { baseTarget = 'p1'; val = -1; }
    else if (kind === 'p1down') { baseTarget = 'p1'; val = 1; }
    else if (kind === 'p2up') { baseTarget = 'p2'; val = -1; }
    else if (kind === 'p2down') { baseTarget = 'p2'; val = 1; }
    const resolveTarget = () => {
      const rightUsedByP2 = (gameRunning && gameMode === 'pvp' && !onlineRole && !lanRole);
      if (kind.startsWith('p2') && !rightUsedByP2) return 'p1';
      return baseTarget;
    };
    const press = (e) => { e.preventDefault(); touchState[resolveTarget()] = val; btn.classList.add('pressed'); AudioEngine.init(); };
    const release = (e) => { if (e && e.cancelable) e.preventDefault(); touchState[resolveTarget()] = 0; btn.classList.remove('pressed'); };
    btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    btn.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    btn.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });
}

/* ============================================================
   事件绑定
   ============================================================ */
function bindAllEvents() {
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dest = btn.dataset.goto;
      if (dest !== 'online' && dest !== 'online-mode' && dest !== 'online-join' && dest !== 'online-manual' && dest !== 'room') {
        if (onlineRole || mqttClient || rtcPc || lanRole) onlineCleanup();
      }
      if (dest === 'ai') { gameMode = 'ai'; timerMode = false; playerCount = 2; onlineCleanup(); resetCheat(); }
      if (dest === 'pvp') { gameMode = 'pvp'; timerMode = false; playerCount = 2; onlineCleanup(); resetCheat(); }
      if (dest === 'online') { gameMode = 'online'; timerMode = false; resetOnlinePanel(); }
      navigate(dest);
    });
  });
  const bb = $('backBtn'); if (bb) bb.addEventListener('click', goBack);

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      const parent = t.parentElement; if (!parent) return;
      const root = parent.parentElement || parent;
      parent.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const key = t.dataset.roomtab || t.dataset.opttab || t.dataset.mantab || t.dataset.lbtab || t.dataset.manualtab;
      const cls = t.dataset.roomtab ? 'roomTab-' : t.dataset.opttab ? 'optTab-' : t.dataset.mantab ? 'manTab-' : t.dataset.lbtab ? 'lbTab-' : t.dataset.manualtab ? 'manualTab-' : '';
      root.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const target = $(cls + key); if (target) target.classList.add('active');
    });
  });

  document.querySelectorAll('[data-rset]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('[data-rset]').forEach(x => x.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.rset-pane').forEach(p => p.classList.remove('active'));
      const pane = document.querySelector('[data-rsetpane="' + item.dataset.rset + '"]');
      if (pane) pane.classList.add('active');
    });
  });

  document.querySelectorAll('[data-opt-diff]').forEach(btn => btn.addEventListener('click', () => { currentDiff = btn.dataset.optDiff; syncUI(); }));
  document.querySelectorAll('[data-opt-score]').forEach(btn => btn.addEventListener('click', () => {
    winScore = parseInt(btn.dataset.optScore, 10);
    document.querySelectorAll('.score-input').forEach(i => { i.value = ''; });
    syncUI(); updateControlsHint();
    if (onlineRole === 'host') broadcastRoomState();
  }));
  document.querySelectorAll('.score-input').forEach(inp => {
    if (inp.id === 'onlineSpeedCustom') return;
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 6);
      const v = parseInt(inp.value, 10);
      if (v && v >= 1) {
        winScore = Math.min(v, 99);
        document.querySelectorAll('[data-opt-score]').forEach(b => b.classList.remove('selected'));
        updateControlsHint();
      }
    });
  });
  const aiCfg = $('_aiCfg');
  if (aiCfg) aiCfg.addEventListener('input', () => {
    aiCfg.value = aiCfg.value.replace(/[^0-9]/g, '').slice(0, 6);
    const raw = aiCfg.value.trim(); if (!raw) return;
    const v = parseInt(raw, 10);
    if (v && v >= 1) { winScore = Math.min(v, 99); document.querySelectorAll('[data-opt-score]').forEach(b => b.classList.remove('selected')); updateControlsHint(); }
  });
  document.querySelectorAll('[data-opt-time]').forEach(btn => btn.addEventListener('click', () => { timerSeconds = parseInt(btn.dataset.optTime, 10); syncUI(); }));
  document.querySelectorAll('[data-opt-aimode]').forEach(btn => btn.addEventListener('click', () => { timerMode = btn.dataset.optAimode === 'timer'; syncUI(); }));
  document.querySelectorAll('[data-opt-theme]').forEach(btn => btn.addEventListener('click', () => { crtTheme = btn.dataset.optTheme; updateCSSVariables(); syncUI(); saveSettings(); draw(); }));
  document.querySelectorAll('[data-opt-render]').forEach(btn => btn.addEventListener('click', () => { renderMode = btn.dataset.optRender; applyRenderModeClass(); syncUI(); saveSettings(); draw(); }));
  document.querySelectorAll('[data-opt-uisize]').forEach(btn => btn.addEventListener('click', () => { uiSize = btn.dataset.optUisize; applyUISizeClass(); syncUI(); saveSettings(); setTimeout(layoutAll, 60); }));
  document.querySelectorAll('[data-opt-fps]').forEach(btn => btn.addEventListener('click', () => { targetFps = parseInt(btn.dataset.optFps, 10); syncUI(); saveSettings(); }));
  document.querySelectorAll('[data-opt-sfx]').forEach(btn => btn.addEventListener('click', () => { sfxEnabled = btn.dataset.optSfx === 'on'; syncUI(); saveSettings(); if (sfxEnabled) { AudioEngine.init(); AudioEngine.countdown(); } }));
  document.querySelectorAll('[data-opt-gpu]').forEach(btn => btn.addEventListener('click', () => { gpuAccel = btn.dataset.optGpu === 'on'; applyGpuClass(); syncUI(); saveSettings(); }));
  document.querySelectorAll('[data-opt-autofs]').forEach(btn => btn.addEventListener('click', () => { autoFullscreen = btn.dataset.optAutofs === 'on'; syncUI(); saveSettings(); }));
  document.querySelectorAll('[data-opt-blurpause]').forEach(btn => btn.addEventListener('click', () => { blurAutoPause = btn.dataset.optBlurpause === 'on'; syncUI(); saveSettings(); }));
  document.querySelectorAll('[data-opt-touchmode]').forEach(btn => btn.addEventListener('click', () => {
    touchControlMode = btn.dataset.optTouchmode;
    applyTouchModeClass(); syncUI(); saveSettings();
    if (touchControlMode === 'follow') followTouchTargetY = null;
    setTimeout(layoutAll, 50);
  }));
  const ov = $('optVolume');
  if (ov) ov.addEventListener('input', () => {
    masterVolume = clamp(parseInt(ov.value, 10) / 100, 0, 1);
    const v = $('optVolumeVal'); if (v) v.textContent = Math.round(masterVolume * 100) + '%';
    saveSettings();
  });
  const ops = $('optPaddleSpeed');
  if (ops) ops.addEventListener('input', () => {
    paddleSpeedSetting = clamp(parseInt(ops.value, 10) / 100, 0.10, 1.20);
    const v = $('optPaddleSpeedVal'); if (v) v.textContent = Math.round(paddleSpeedSetting * 100) + '%';
    saveSettings(); recomputeSpeeds();
  });
  const bts = $('btnTestSound'); if (bts) bts.addEventListener('click', () => { AudioEngine.init(); AudioEngine.win(); });
  const bcl = $('btnClearLocal');
  if (bcl) bcl.addEventListener('click', () => {
    if (!confirm('确定清除本机缓存数据？（昵称、战绩、设置都会被重置）')) return;
    try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(LB_NAME_KEY); localStorage.removeItem(LB_MY_STATS_KEY); } catch (e) {}
    location.reload();
  });

  document.querySelectorAll('[data-opt-transport]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-opt-transport]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      transportMode = btn.dataset.optTransport;
      const sub = $('joinSubHint'), inp = $('joinCodeInput'), lbl = $('joinInputLabel');
      if (transportMode === 'lan') {
        if (sub) sub.textContent = '输入房主的虚拟局域网 IP:端口';
        if (inp) { inp.placeholder = '10.126.126.1:8080'; inp.maxLength = 21; inp.inputMode = 'text'; inp.value = ''; }
        if (lbl) lbl.textContent = '房主地址';
        setTopStatus('虚拟局域网模式 · 需房主运行 pong84-host', 'warn');
      } else {
        if (sub) sub.textContent = '输入房主发来的 6 位房间号';
        if (inp) { inp.placeholder = '000000'; inp.maxLength = 6; inp.inputMode = 'numeric'; inp.value = ''; }
        if (lbl) lbl.textContent = '房间号';
        setTopStatus('公共服务器模式 · 开箱即用', 'ok');
      }
      onlineCleanup();
    });
  });

  document.querySelectorAll('[data-opt-omode]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-opt-omode]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    onlineMode = btn.dataset.optOmode; syncUI(); updateRoomUI();
    if (onlineRole === 'host') broadcastRoomState();
  }));
  document.querySelectorAll('[data-opt-oailevel]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-opt-oailevel]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    onlineAILevel = btn.dataset.optOailevel;
    if (onlineRole === 'host') broadcastRoomState();
  }));
  document.querySelectorAll('[data-opt-otime]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-opt-otime]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    onlineTimerSeconds = parseInt(btn.dataset.optOtime, 10);
    if (onlineRole === 'host') broadcastRoomState();
  }));
  document.querySelectorAll('[data-opt-obspeed]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-opt-obspeed]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    onlineBallSpeed = parseFloat(btn.dataset.optObspeed);
    const sc = $('onlineSpeedCustom'); if (sc) sc.value = '';
    if (onlineRole === 'host') broadcastRoomState();
  }));
  const sc = $('onlineSpeedCustom');
  if (sc) sc.addEventListener('input', () => {
    const v = parseFloat(sc.value);
    if (v && v >= 0.3 && v <= 3) {
      onlineBallSpeed = v;
      document.querySelectorAll('[data-opt-obspeed]').forEach(b => b.classList.remove('selected'));
      if (onlineRole === 'host') broadcastRoomState();
    }
  });
  const opm = $('onlinePaddleMul');
  if (opm) opm.addEventListener('input', () => {
    onlinePaddleMul = parseFloat(opm.value);
    const v = $('onlinePaddleMulVal'); if (v) v.textContent = onlinePaddleMul.toFixed(2) + 'x';
    if (onlineRole === 'host') broadcastRoomState();
  });
  const opsp = $('onlinePaddleSpeed');
  if (opsp) opsp.addEventListener('input', () => {
    onlinePaddleSpeed = parseFloat(opsp.value);
    const v = $('onlinePaddleSpeedVal'); if (v) v.textContent = onlinePaddleSpeed.toFixed(2) + 'x';
    if (onlineRole === 'host') broadcastRoomState();
  });
  const ocm = $('onlineCurveMul');
  if (ocm) ocm.addEventListener('input', () => {
    onlineCurveMul = parseFloat(ocm.value);
    const v = $('onlineCurveMulVal'); if (v) v.textContent = onlineCurveMul.toFixed(2) + 'x';
    if (onlineRole === 'host') broadcastRoomState();
  });
  const opum = $('onlinePowerupMul');
  if (opum) opum.addEventListener('input', () => {
    onlinePowerupMul = parseFloat(opum.value);
    const v = $('onlinePowerupMulVal'); if (v) v.textContent = onlinePowerupMul.toFixed(2) + 'x';
    if (onlineRole === 'host') broadcastRoomState();
  });
  document.querySelectorAll('[data-opt-form]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-opt-form]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    teamFormation = btn.dataset.optForm; recomputeSpeeds();
    if (onlineRole === 'host') broadcastRoomState();
  }));
  document.querySelectorAll('[data-opt-squeeze]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-opt-squeeze]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    teamSqueeze = btn.dataset.optSqueeze === 'on'; recomputeSpeeds();
    if (onlineRole === 'host') broadcastRoomState();
  }));

  document.querySelectorAll('[data-online-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = parseInt(btn.dataset.onlineMode, 10);
      navStack = navStack.filter(x => x !== 'online-mode');
      navigate('room');
      createRoom(mode).catch(() => {});
    });
  });
  const bc = $('btnCreate');
  if (bc) bc.addEventListener('click', () => { AudioEngine.init(); navigate('online-mode'); });
  const bj = $('btnJoin');
  if (bj) bj.addEventListener('click', () => {
    AudioEngine.init(); navigate('online-join');
    const inp = $('joinCodeInput'); if (inp) { inp.value = ''; setTimeout(() => { try { inp.focus(); } catch (e) {} }, 100); }
    const st = $('joinStatus'); if (st) { st.className = 'room-status-bar'; st.textContent = '等待输入房间号'; }
    setTopStatus('', '');
  });
  const bmp = $('btnManualP2P');
  if (bmp) bmp.addEventListener('click', () => {
    try { AudioEngine.init(); } catch (e) {}
    try { onlineCleanup(); } catch (e) {}
    onlineTransport = 'mqtt';
    transportMode = 'mqtt';
    navStack = ['online'];
    applyPanel('online-manual');
    const oh = $('manualOfferCode');   if (oh) oh.value = '';
    const oa = $('manualAnswerInput'); if (oa) oa.value = '';
    const oi2 = $('manualOfferInput'); if (oi2) oi2.value = '';
    const ac = $('manualAnswerCode');  if (ac) ac.value = '';
    manualSetStatus('manualHostStatus', '等待生成邀请码', '');
    manualSetStatus('manualClientStatus', '等待输入邀请码', '');
  });

  const bs = $('btnSearchRoom'); if (bs) bs.addEventListener('click', () => doSearchRoom());
  const jci = $('joinCodeInput');
  if (jci) {
    jci.addEventListener('input', () => {
      if (transportMode === 'mqtt') jci.value = jci.value.replace(/[^0-9]/g, '').slice(0, 6);
      else jci.value = jci.value.replace(/\s/g, '').slice(0, 21);
    });
    jci.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearchRoom(); } });
  }
  const bcc = $('btnCopyCode'); if (bcc) bcc.addEventListener('click', copyRoomCode);
  const rct = $('roomCodeText'); if (rct) rct.addEventListener('dblclick', copyRoomCode);

  const crb = $('clientReadyBtn');
  if (crb) crb.addEventListener('click', () => {
    transportSend(JSON.stringify({ t: 'ready' }));
    crb.textContent = '已准备，等待主机开始'; crb.disabled = true;
    if (playerCount === 2 && slotInfo[2]) slotInfo[2].ready = true;
    if (playerCount === 4 && slotInfo[mySlot]) slotInfo[mySlot].ready = true;
    updateRoomUI();
  });
  const brs = $('btnRetrySignal');
  if (brs) brs.addEventListener('click', () => {
    hideRetry();
    if (onlineRole === 'host') createRoom(playerCount);
    else if (onlineRole === 'client') { const c = currentRoom; joinRoom(c); }
    else resetOnlinePanel();
  });

  document.querySelectorAll('[data-start]').forEach(btn => btn.addEventListener('click', () => {
    AudioEngine.init();
    const isHost = onlineRole === 'host';
    if (gameMode === 'online') {
      if (isHost) {
        if (playerCount === 2) {
          transportSend(JSON.stringify({
            t: 'start', winScore,
            timerMode: onlineMode === 'timer', timerSeconds: onlineTimerSeconds,
            ballSpeed: onlineBallSpeed, diff: onlineDiff, blessings: roomBlessings,
            paddleMul: onlinePaddleMul, paddleSpeed: onlinePaddleSpeed,
            aiLevel: onlineAILevel, curveMul: onlineCurveMul, powerupMul: onlinePowerupMul
          }));
        } else {
          transportSend(JSON.stringify({
            t: 'start4', winScore,
            timerMode: onlineMode === 'timer', timerSeconds: onlineTimerSeconds,
            ballSpeed: onlineBallSpeed, diff: onlineDiff,
            formation: teamFormation, squeeze: teamSqueeze, blessings: roomBlessings,
            paddleMul: onlinePaddleMul, paddleSpeed: onlinePaddleSpeed,
            aiLevel: onlineAILevel, curveMul: onlineCurveMul, powerupMul: onlinePowerupMul
          }));
          for (let s = 2; s <= 4; s++) {
            if (slotInfo[s] === null) slotInfo[s] = { name: 'AI ' + s, ready: true, isAI: true, clientId: null, connected: false };
          }
        }
      } else return;
    }
    if (autoFullscreen && isMobile && !isFullscreen()) requestFullscreen();
    startGame();
  }));

  const DEBUG_SLIDERS = [
    { id: 'dbgBallSpeed', key: 'ballSpeedMul', fmt: v => v.toFixed(2) + 'x' },
    { id: 'dbgPaddleSpeed', key: 'paddleSpeedMul', fmt: v => v.toFixed(2) + 'x' },
    { id: 'dbgAISpeed', key: 'aiSpeedMul', fmt: v => v.toFixed(2) + 'x' },
    { id: 'dbgBallSize', key: 'ballSizeMul', fmt: v => v.toFixed(2) + 'x' },
    { id: 'dbgPaddleH', key: 'paddleHeightMul', fmt: v => v.toFixed(2) + 'x' },
    { id: 'dbgPowerupRate', key: 'powerupRate', fmt: v => v.toFixed(2) + 'x' },
    { id: 'dbgCurveProb', key: 'curveProbMul', fmt: v => v.toFixed(2) + 'x' }
  ];
  DEBUG_SLIDERS.forEach(cfg => {
    const slider = $(cfg.id), label = $(cfg.id + 'Val');
    if (!slider) return;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      debugParams[cfg.key] = v;
      if (label) label.textContent = cfg.fmt(v);
      recomputeSpeeds(); updateStatsDisplay();
      if (!gameRunning) draw();
    });
    if (label) label.textContent = cfg.fmt(parseFloat(slider.value));
  });
  const dbgReset = $('dbgReset');
  if (dbgReset) dbgReset.addEventListener('click', () => {
    Object.assign(debugParams, DEFAULT_DEBUG);
    DEBUG_SLIDERS.forEach(cfg => {
      const slider = $(cfg.id), label = $(cfg.id + 'Val');
      if (!slider) return;
      slider.value = DEFAULT_DEBUG[cfg.key];
      if (label) label.textContent = cfg.fmt(DEFAULT_DEBUG[cfg.key]);
    });
    recomputeSpeeds(); updateStatsDisplay();
  });

  const pb = $('pauseBtn'); if (pb) pb.addEventListener('click', togglePause);
  const rb = $('resumeBtn'); if (rb) rb.addEventListener('click', resumeGame);
  const qrb = $('quitRoomBtn'); if (qrb) qrb.addEventListener('click', quitToRoom);
  const qb = $('quitBtn'); if (qb) qb.addEventListener('click', quitToMenu);
  const rrb = $('resultRoomBtn'); if (rrb) rrb.addEventListener('click', quitToRoom);
  const bcr = $('btnCloseRoom');
  if (bcr) bcr.addEventListener('click', () => {
    const isHost = onlineRole === 'host';
    if (!currentRoom) { navStack = []; applyPanel('main'); return; }
    const tip = isHost ? '确定关闭房间？所有玩家将被断开。' : '确定离开房间？';
    if (!confirm(tip)) return;
    if (isHost) { try { transportSend(JSON.stringify({ t: 'roomClosed' })); } catch (e) {} }
    else { try { transportSend(JSON.stringify({ t: 'leave' })); } catch (e) {} }
    setTimeout(() => {
      try { onlineCleanup(); } catch (e) {}
      navStack = []; applyPanel('main');
      updateControlsHint(); updateStatsDisplay(); showScoreboard(false);
      const ti = $('topInfo'); if (ti) ti.classList.remove('show');
      const sbe = $('statusBar'); if (sbe) sbe.classList.remove('show');
    }, 60);
  });
  const fsb = $('fsBtn'); if (fsb) fsb.addEventListener('click', toggleFullscreen);

  const mgo = $('manualGenOffer');       if (mgo) mgo.addEventListener('click', manualHostGenerateOffer);
  const mca = $('manualAcceptAnswer');   if (mca) mca.addEventListener('click', manualHostAcceptAnswer);
  const mco = $('manualCopyOffer');      if (mco) mco.addEventListener('click', () => manualCopy('manualOfferCode', 'manualHostStatus'));
  const mga = $('manualGenAnswer');      if (mga) mga.addEventListener('click', manualClientGenerateAnswer);
  const mcaa = $('manualCopyAnswer');    if (mcaa) mcaa.addEventListener('click', () => manualCopy('manualAnswerCode', 'manualClientStatus'));

  const hintSetup = [
    ['manualCopyOffer', 'manualHostStatus', '把邀请码发给朋友（微信/QQ 均可）'],
    ['manualCopyAnswer', 'manualClientStatus', '把应答码发回给房主，房主粘贴并点「接受应答码」即可连接']
  ];
  hintSetup.forEach(([btnId, statusId, orig]) => {
    const b = $(btnId);
    if (b) b.addEventListener('click', () => {
      const st = $(statusId);
      if (st) { st.dataset.orig = orig; setTimeout(() => { st.textContent = orig; st.className = 'room-status-bar'; }, 2200); }
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && blurAutoPause && gameRunning && !paused && !countdownActive && !onlineRole && !lanRole) togglePause();
  });
  window.addEventListener('blur', () => {
    for (const key of Object.keys(keys)) delete keys[key];
    touchState.p1 = 0;
    touchState.p2 = 0;
    document.querySelectorAll('.ctrl-btn.pressed').forEach(button => button.classList.remove('pressed'));
    if (blurAutoPause && gameRunning && !paused && !countdownActive && !onlineRole && !lanRole) togglePause();
  });
  window.addEventListener('beforeunload', () => {
    try { flushPlayTime(); } catch (e) {}
    try { onlineCleanup(); } catch (e) {}
  });
  window.addEventListener('resize', () => { checkOrientation(); layoutAll(); });
  window.addEventListener('orientationchange', () => {
    checkOrientation();
    setTimeout(layoutAll, 100);
    setTimeout(layoutAll, 350);
  });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
    updateFsIcon();
    setTimeout(layoutAll, 100);
    setTimeout(layoutAll, 350);
  }));
}

/* ============================================================
   初始化
   ============================================================ */
function init() {
  loadSettings(); loadMyStats();
  /* ★ 设备码持久化：刷新不变 */
  DEVICE_ID = getOrCreateDeviceId();
  updateCSSVariables(); applyRenderModeClass(); applyUISizeClass(); applyGpuClass(); applyTouchModeClass();
  updateNicknameDisplay(); lbRenderAll(); syncUI(); updateStatsDisplay();
  checkOrientation(); layoutAll(); applyPanel('main'); updateControlsHint();
  document.body.classList.remove('show-ctrl');
  recomputeSpeeds();
  player.x = 30; player.y = LOGICAL_H / 2 - player.height / 2;
  ai.x = LOGICAL_W - 30 - ai.width; ai.y = LOGICAL_H / 2 - ai.height / 2;
  p2Paddle.x = 30; p2Paddle.y = LOGICAL_H / 2 + 12;
  p4Paddle.x = LOGICAL_W - 30 - p4Paddle.width; p4Paddle.y = LOGICAL_H / 2 + 12;
  ball.x = LOGICAL_W / 2; ball.y = LOGICAL_H / 2;
  draw();
  initInput(); setupFollowTouch(); bindAllEvents(); lbBindAccount(); updateFsIcon();

  /* 后台探测信令服务器（不阻塞） */
  updateSignalingBadge('探测中…');
  probeAllServers().catch(() => {});

  requestAnimationFrame(() => { layoutAll(); syncUI(); draw(); });

}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
