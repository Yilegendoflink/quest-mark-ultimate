// main.js — 启动、游戏状态机、事件、计分/连击、设置绑定。
import { generateRound } from './mechanic.js';
import { isSafe } from './geometry.js';
import { renderScene } from './render.js';
import { loadSettings, saveSettings } from './settings.js';
import { I18N, LANGS } from './i18n.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// 固定内部分辨率；CSS 负责自适应缩放。720px → R=300px 映射 12y。
canvas.width = 720;
canvas.height = 720;
const arena = { cx: 360, cy: 360, R: 300 };

const BALL_SPEED = 1.6; // 球旋转角速度 (rad/s)

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

const TIME_OPTIONS = [10, 5, 3, 'extreme']; // 绝境=随次递减
const EXTREME_START = 5;    // 绝境初始反应时间(s)
const EXTREME_DECAY = 0.9;  // 每次成功后 -10%
const EXTREME_FLOOR = 0.5;  // 反应时间下限
const AUTO_NEXT_MS = 800;   // 绝境成功后自动下一题延时

let settings = loadSettings();
if (!TIME_OPTIONS.includes(settings.resolveTime)) settings.resolveTime = 5;
if (!LANGS.includes(settings.lang)) settings.lang = 'zh';

const t = (key) => I18N[settings.lang][key]; // 取当前语言文案
let bossImg = null; // 处理后的 BOSS 精灵（已抠掉黑底的离屏 canvas）
let arenaImg = null; // 场地背景贴图

const BOSS_SRC = 'assets/png/凯夫卡.png';
const ARENA_SRC = 'assets/png/门神.png';

const game = {
  state: 'idle', // idle | showing | resolved
  round: null,
  showStart: 0,
  roundTime: EXTREME_START, // 本轮反应时间(s)
  curTime: EXTREME_START,   // 绝境当前反应时间(随成功递减)
  click: null,
  correct: false,
  score: 0,
  autoTimer: null,
  statusKey: 'statusIdle', // 当前状态文案 key
  statusCls: '',
  statusArgs: [],
  btnKey: 'start',         // 主按钮文案 key
  lastTierKey: null,       // 弹窗当前档位（用于切换语言时刷新评语）
};

const isExtreme = () => settings.resolveTime === 'extreme';

function cancelAuto() {
  if (game.autoTimer) {
    clearTimeout(game.autoTimer);
    game.autoTimer = null;
  }
}

// ---------- 计分 / HUD ----------
function updateHud() {
  el.score.textContent = game.score;
  el.best.textContent = settings.bestStreak;
  el.hud.style.display = isExtreme() ? 'flex' : 'none'; // 得分/最佳仅绝境显示
}

// 记录状态 key+参数后套用当前语言。
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
function tierFor(score) {
  return TIERS.find((x) => score <= x.max);
}

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

// ---------- 回合流程 ----------
// continueRun=true 表示绝境连胜继续（沿用递减后的时间）；false 为全新开始。
function startRound(continueRun = false) {
  cancelAuto();
  if (isExtreme()) {
    if (!continueRun) {
      game.curTime = EXTREME_START;
      game.score = 0;
    }
    game.roundTime = Math.max(game.curTime, EXTREME_FLOOR);
  } else {
    game.roundTime = settings.resolveTime;
  }
  game.round = generateRound(arena);
  game.state = 'showing';
  game.showStart = performance.now();
  game.click = null;
  setStatus('statusJudge', 'go');
  setBtn('next');
  updateHud();
}

function resolve(pt) {
  cancelAuto();
  const ok = pt ? isSafe(pt, game.round, arena) : false;
  game.state = 'resolved';
  game.click = pt;
  game.correct = ok;
  el.countdownFill.style.width = '0%';

  if (isExtreme()) {
    if (ok) {
      game.score++;
      if (game.score > settings.bestStreak) {
        settings.bestStreak = game.score;
        saveSettings(settings);
      }
      game.curTime = Math.max(game.curTime * EXTREME_DECAY, EXTREME_FLOOR);
      setStatus('statusWin', 'ok', game.score, game.curTime.toFixed(1));
      game.autoTimer = setTimeout(() => startRound(true), AUTO_NEXT_MS);
    } else {
      setStatus('statusFail', 'bad', settings.bestStreak);
      showResult(game.score); // 弹窗展示最终连击（重置前）
      game.score = 0;
      setBtn('retry');
    }
  } else if (ok) {
    setStatus('statusCorrect', 'ok');
    setBtn('next');
  } else {
    setStatus(pt ? 'statusWrong' : 'statusTimeout', 'bad');
    setBtn('next');
  }
  updateHud();
}

function restart() {
  cancelAuto();
  hideResult();
  game.score = 0;
  game.curTime = EXTREME_START;
  game.state = 'idle';
  game.round = null;
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
  if (game.state === 'idle') {
    startRound();
  } else if (game.state === 'showing') {
    resolve(canvasPoint(e));
  } else if (game.state === 'resolved') {
    if (game.autoTimer) return; // 绝境自动下一题进行中，忽略点击
    startRound();
  }
});

el.btnStart.addEventListener('click', () => {
  if (game.state === 'showing' || game.autoTimer) return;
  startRound();
});
el.btnRestart.addEventListener('click', restart);

el.resultClose.addEventListener('click', hideResult);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) hideResult(); });

// ---------- BOSS 形象（固定素材，抠掉黑底） ----------
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
      let a = (lum - 24) / 36; // <24 全透明，>60 不透明
      if (a < 0) a = 0;
      if (a > 1) a = 1;
      d[i + 3] = Math.round(d[i + 3] * a);
    }
    c.putImageData(data, 0, 0);
  } catch {
    /* 跨域取像素失败时退回原图（同源应不会触发） */
  }
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

// 套用当前语言：静态文案 + 动态文案 + 弹窗 + 切换按钮高亮。
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
  restart(); // 切换难度时重置当前回合
});
el.setLearn.addEventListener('click', () => {
  settings.learnMode = !settings.learnMode;
  saveSettings(settings);
  syncSettingsUi();
});

// ---------- 渲染循环 ----------
function loop(now) {
  // 倒计时
  if (game.state === 'showing') {
    const elapsed = (now - game.showStart) / 1000;
    const remaining = Math.max(0, game.roundTime - elapsed);
    el.countdownFill.style.width = (remaining / game.roundTime) * 100 + '%';
    if (elapsed >= game.roundTime) resolve(null);
  }

  renderScene(ctx, arena, {
    state: game.state,
    round: game.round,
    angle: (now / 1000) * BALL_SPEED,
    time: now,
    click: game.click,
    correct: game.correct,
    bossImg,
    arenaImg,
    learn: settings.learnMode,
    learnLabels: I18N[settings.lang].learn,
  });

  requestAnimationFrame(loop);
}

// ---------- 启动 ----------
loadBoss();
loadArena();
restart();
applyLang(); // 套用语言（含 syncSettingsUi）
requestAnimationFrame(loop);
