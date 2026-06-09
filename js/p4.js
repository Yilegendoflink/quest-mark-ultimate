// p4.js — 双段（两轮）真假魔法机制：每回合先单一魔法(记真假)，再冰雷叠加(同真规则)。
import { generateP4Round } from './mechanic.js';
import { isSafe } from './geometry.js';
import { renderScene } from './render.js';
import { loadSettings, saveSettings } from './settings.js';
import { I18N, LANGS } from './i18n.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
canvas.width = 720;
canvas.height = 720;
const arena = { cx: 360, cy: 360, R: 300 };

const BALL_SPEED = 1.6;

const el = {
  hud: document.getElementById('hud'),
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  status: document.getElementById('status'),
  countdownFill: document.getElementById('countdown-fill'),
  btnStart: document.getElementById('btn-start'),
  btnRestart: document.getElementById('btn-restart'),
  timeSeg: document.getElementById('time-seg'),
  setLearn: document.getElementById('set-learn'),
  modal: document.getElementById('result-modal'),
  resultScore: document.getElementById('result-score'),
  resultComment: document.getElementById('result-comment'),
  resultClose: document.getElementById('result-close'),
  langSwitch: document.getElementById('lang-switch'),
};

const TIME_OPTIONS = [10, 5, 3, 'extreme'];
const EXTREME_START = 5;
const EXTREME_DECAY = 0.9;
const EXTREME_FLOOR = 0.5;
const AUTO_NEXT_MS = 800;  // 整回合成功后自动下一回合
const WAVE_GAP_MS = 700;   // 第一段过关后进入第二段的间隔

let settings = loadSettings();
if (!TIME_OPTIONS.includes(settings.resolveTime)) settings.resolveTime = 5;
if (!LANGS.includes(settings.lang)) settings.lang = 'zh';

const t = (key) => I18N[settings.lang][key];
let bossImg = null;
let arenaImg = null;

const BOSS_SRC = 'assets/png/凯夫卡.png';
const ARENA_SRC = 'assets/png/门神.png';

const game = {
  state: 'idle', // idle | wave1 | wave1done | wave2 | resolved
  p4: null,      // generateP4Round 结果
  wave: 1,       // 当前段 1|2（结算时用于决定渲染哪段）
  showStart: 0,
  roundTime: EXTREME_START,
  curTime: EXTREME_START,
  click: null,
  correct: false,
  score: 0,
  autoTimer: null,
  gapTimer: null,
  statusKey: 'statusIdle',
  statusCls: '',
  statusArgs: [],
  btnKey: 'start',
  lastTierKey: null,
};

const isExtreme = () => settings.resolveTime === 'extreme';

function cancelTimers() {
  if (game.autoTimer) { clearTimeout(game.autoTimer); game.autoTimer = null; }
  if (game.gapTimer) { clearTimeout(game.gapTimer); game.gapTimer = null; }
}

// ---------- 计分 / HUD ----------
function updateHud() {
  el.score.textContent = game.score;
  el.best.textContent = settings.bestStreakP4;
  el.hud.style.display = isExtreme() ? 'flex' : 'none';
}

function setStatus(key, cls, ...args) {
  game.statusKey = key;
  game.statusCls = cls;
  game.statusArgs = args;
  applyStatus();
}
function applyStatus() {
  const v = I18N[settings.lang][game.statusKey];
  el.status.textContent = typeof v === 'function' ? v(...game.statusArgs) : v;
  el.status.className = 'status' + (game.statusCls ? ' ' + game.statusCls : '');
}
function setBtn(key) {
  game.btnKey = key;
  el.btnStart.textContent = t(key);
}

// ---------- 绝境结束弹窗 ----------
const TIERS = [
  { max: 5, cls: 'tier-green', key: 'green' },
  { max: 10, cls: 'tier-blue', key: 'blue' },
  { max: 30, cls: 'tier-purple', key: 'purple' },
  { max: Infinity, cls: 'tier-orange', key: 'orange' },
];
function tierFor(score) { return TIERS.find((x) => score <= x.max); }

function showResult(score) {
  const tier = tierFor(score);
  game.lastTierKey = tier.key;
  el.resultScore.textContent = score;
  el.resultScore.className = 'modal-score ' + tier.cls;
  el.resultComment.textContent = I18N[settings.lang].comments[tier.key];
  el.modal.classList.remove('hidden');
}
function hideResult() {
  el.modal.classList.add('hidden');
  game.lastTierKey = null;
}

// ---------- 回合流程（两段） ----------
function startRound(continueRun = false) {
  cancelTimers();
  if (isExtreme()) {
    if (!continueRun) { game.curTime = EXTREME_START; game.score = 0; }
    game.roundTime = Math.max(game.curTime, EXTREME_FLOOR);
  } else {
    game.roundTime = settings.resolveTime;
  }
  game.p4 = generateP4Round(arena);
  game.wave = 1;
  game.state = 'wave1';
  game.showStart = performance.now();
  game.click = null;
  setStatus('p4Wave1', 'go');
  setBtn('next');
  updateHud();
}

function enterWave2() {
  game.gapTimer = null;
  game.wave = 2;
  game.state = 'wave2';
  game.showStart = performance.now();
  game.click = null;
  setStatus('p4Wave2', 'go');
}

// 第一段判定：单属性安全（inactive 属性已在 round 中性化）。
function resolveWave1(pt) {
  const ok = pt ? isSafe(pt, game.p4.wave1.round, arena) : false;
  game.click = pt;
  game.correct = ok;
  el.countdownFill.style.width = '0%';
  if (ok) {
    game.state = 'wave1done';            // 短暂高亮第一段结果，再进第二段
    game.gapTimer = setTimeout(enterWave2, WAVE_GAP_MS);
  } else {
    finishRound(false, !!pt);            // 第一段错 → 整回合失败
  }
}

// 第二段判定：冰雷叠加（有效真假）。
function resolveWave2(pt) {
  const ok = pt ? isSafe(pt, game.p4.wave2.round, arena) : false;
  game.click = pt;
  game.correct = ok;
  el.countdownFill.style.width = '0%';
  finishRound(ok, !!pt);
}

// 整回合结算。
function finishRound(ok, byClick) {
  cancelTimers();
  game.state = 'resolved';
  if (isExtreme()) {
    if (ok) {
      game.score++;
      if (game.score > settings.bestStreakP4) {
        settings.bestStreakP4 = game.score;
        saveSettings(settings);
      }
      game.curTime = Math.max(game.curTime * EXTREME_DECAY, EXTREME_FLOOR);
      setStatus('statusWin', 'ok', game.score, game.curTime.toFixed(1));
      game.autoTimer = setTimeout(() => startRound(true), AUTO_NEXT_MS);
    } else {
      setStatus('statusFail', 'bad', settings.bestStreakP4);
      showResult(game.score);
      game.score = 0;
      setBtn('retry');
    }
  } else if (ok) {
    setStatus('statusCorrect', 'ok');
    setBtn('next');
  } else {
    setStatus(byClick ? 'statusWrong' : 'statusTimeout', 'bad');
    setBtn('next');
  }
  updateHud();
}

function restart() {
  cancelTimers();
  hideResult();
  game.score = 0;
  game.curTime = EXTREME_START;
  game.state = 'idle';
  game.p4 = null;
  game.wave = 1;
  game.click = null;
  setStatus('statusIdle', '');
  setBtn('start');
  el.countdownFill.style.width = '0%';
  updateHud();
}

// ---------- 输入 ----------
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

canvas.addEventListener('pointerdown', (e) => {
  switch (game.state) {
    case 'idle': startRound(); break;
    case 'wave1': resolveWave1(canvasPoint(e)); break;
    case 'wave2': resolveWave2(canvasPoint(e)); break;
    case 'wave1done': break; // 过渡中，忽略
    case 'resolved':
      if (game.autoTimer) return;
      startRound();
      break;
  }
});

el.btnStart.addEventListener('click', () => {
  if (game.state === 'wave1' || game.state === 'wave2' || game.state === 'wave1done' || game.autoTimer) return;
  startRound();
});
el.btnRestart.addEventListener('click', restart);

el.resultClose.addEventListener('click', hideResult);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) hideResult(); });

// ---------- BOSS / 场地素材 ----------
function keyOutBlack(img) {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  try {
    const data = c.getImageData(0, 0, cv.width, cv.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.max(d[i], d[i + 1], d[i + 2]);
      let a = (lum - 24) / 36;
      if (a < 0) a = 0;
      if (a > 1) a = 1;
      d[i + 3] = Math.round(d[i + 3] * a);
    }
    c.putImageData(data, 0, 0);
  } catch { /* 同源不会触发 */ }
  return cv;
}
function loadBoss() {
  const img = new Image();
  img.onload = () => { bossImg = keyOutBlack(img); };
  img.onerror = () => { bossImg = null; };
  img.src = encodeURI(BOSS_SRC);
}
function loadArena() {
  const img = new Image();
  img.onload = () => { arenaImg = img; };
  img.onerror = () => { arenaImg = null; };
  img.src = encodeURI(ARENA_SRC);
}

// ---------- 设置 / 本地化 ----------
function syncSettingsUi() {
  for (const btn of el.timeSeg.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', btn.dataset.time === String(settings.resolveTime));
  }
  el.setLearn.classList.toggle('active', settings.learnMode);
  el.setLearn.querySelector('.toggle-state').textContent = settings.learnMode ? t('on') : t('off');
}

function applyLang() {
  const d = I18N[settings.lang];
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const v = d[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  });
  document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : settings.lang;
  applyStatus();
  setBtn(game.btnKey);
  syncSettingsUi();
  if (!el.modal.classList.contains('hidden') && game.lastTierKey) {
    el.resultComment.textContent = d.comments[game.lastTierKey];
  }
  for (const b of el.langSwitch.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.lang === settings.lang);
  }
}

el.langSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  settings.lang = btn.dataset.lang;
  saveSettings(settings);
  applyLang();
});

el.timeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const val = btn.dataset.time;
  settings.resolveTime = val === 'extreme' ? 'extreme' : Number(val);
  saveSettings(settings);
  syncSettingsUi();
  restart();
});
el.setLearn.addEventListener('click', () => {
  settings.learnMode = !settings.learnMode;
  saveSettings(settings);
  syncSettingsUi();
});

// ---------- 渲染场景（按当前段决定可见性/环显示） ----------
function buildScene(now) {
  const base = {
    angle: (now / 1000) * BALL_SPEED,
    time: now,
    click: game.click,
    correct: game.correct,
    bossImg,
    arenaImg,
    learn: settings.learnMode,
    learnLabels: I18N[settings.lang].learn,
  };
  if (!game.p4) return { ...base, state: 'idle', round: null };

  const resolvedView = game.state === 'resolved' || game.state === 'wave1done';
  const renderState = resolvedView ? 'resolved' : 'showing';

  if (game.wave === 1) {
    const w = game.p4.wave1;
    const ice = w.attr === 'ice';
    return {
      ...base,
      state: renderState,
      round: w.round,
      iceVisible: ice,
      thunderVisible: !ice,
      ringIceVisible: ice,
      ringThunderVisible: !ice,
    };
  }
  // 第二段：危险/预兆用有效真假 round；两环显示原始值（同真规则由玩家心算）。
  const w = game.p4.wave2;
  return {
    ...base,
    state: renderState,
    round: w.round,
    ringIceTrue: w.iceDisplayTrue,
    ringThunderTrue: w.thunderDisplayTrue,
  };
}

function loop(now) {
  if (game.state === 'wave1' || game.state === 'wave2') {
    const elapsed = (now - game.showStart) / 1000;
    const remaining = Math.max(0, game.roundTime - elapsed);
    el.countdownFill.style.width = (remaining / game.roundTime) * 100 + '%';
    if (elapsed >= game.roundTime) {
      if (game.state === 'wave1') resolveWave1(null);
      else resolveWave2(null);
    }
  }
  renderScene(ctx, arena, buildScene(now));
  requestAnimationFrame(loop);
}

// ---------- 启动 ----------
loadBoss();
loadArena();
restart();
applyLang();
requestAnimationFrame(loop);
