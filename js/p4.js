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
  roundsSeg: document.getElementById('rounds-seg'),
  setLearn: document.getElementById('set-learn'),
  setMemory: document.getElementById('set-memory'),
  memModal: document.getElementById('memory-modal'),
  memStage: document.getElementById('mem-stage'),
  memQuestion: document.getElementById('mem-question'),
  memOptions: document.getElementById('mem-options'),
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

// 记忆小游戏
const PEOPLE_SRC = 'assets/gif/laughingKefka.gif';
const MEM_PERSON_W = 42;    // 小人宽(px)
const MEM_SPEED = 150;      // 匀速移动速度(px/s)
const MEM_SPACING = 68;     // 队列间距(px)
const MEM_PAUSE = 500;      // 进/出之间停顿(ms)

let settings = loadSettings();
if (!TIME_OPTIONS.includes(settings.resolveTime)) settings.resolveTime = 5;
if (!LANGS.includes(settings.lang)) settings.lang = 'zh';
if (![2, 3].includes(settings.roundsP4)) settings.roundsP4 = 2;

const t = (key) => I18N[settings.lang][key];
let bossImg = null;
let arenaImg = null;

const BOSS_SRC = 'assets/png/凯夫卡.png';
const ARENA_SRC = 'assets/png/门神.png';

const game = {
  state: 'idle', // idle | wave | wavedone | memory | resolved
  p4: null,      // generateP4Round 结果
  waves: [],     // 本回合各段渲染描述（charges... + final）
  waveIndex: 0,  // 当前段索引
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
  memToken: 0,        // 记忆小游戏中止令牌
  memAnswer: null,    // 当前正确人数
  memAsking: false,   // 是否已进入提问阶段（切语言时刷新提问）
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

// ---------- 回合流程（多段：充能段… + 放出段） ----------
// 把 generateP4Round 结果展开为各段渲染描述。
function buildWaves(p4) {
  const waves = p4.charges.map((c) => {
    const ice = c.attr === 'ice';
    return {
      kind: 'charge', round: c.round,
      iceVisible: ice, thunderVisible: !ice,
      ringIceVisible: ice, ringThunderVisible: !ice,
    };
  });
  waves.push({
    kind: 'final', round: p4.final.round,
    iceVisible: true, thunderVisible: true,
    ringIceVisible: true, ringThunderVisible: true,
    ringIceTrue: p4.final.iceDisplayTrue,     // 环显示原始值（同真规则由玩家心算）
    ringThunderTrue: p4.final.thunderDisplayTrue,
  });
  return waves;
}

function startRound(continueRun = false) {
  cancelTimers();
  if (isExtreme()) {
    if (!continueRun) { game.curTime = EXTREME_START; game.score = 0; }
    game.roundTime = Math.max(game.curTime, EXTREME_FLOOR);
  } else {
    game.roundTime = settings.resolveTime;
  }
  game.p4 = generateP4Round(arena, settings.roundsP4);
  game.waves = buildWaves(game.p4);
  game.waveIndex = 0;
  showWave();
  setBtn('next');
  updateHud();
}

// 展示当前段。
function showWave() {
  const w = game.waves[game.waveIndex];
  game.state = 'wave';
  game.showStart = performance.now();
  game.click = null;
  setStatus(w.kind === 'final' ? 'p4Wave2' : 'p4Wave1', 'go');
}

function advanceWave() {
  game.gapTimer = null;
  game.waveIndex++;
  showWave();
}

// 当前段判定。最后一段(放出)判定整回合；其余段答对则（可选记忆小游戏后）进入下一段。
function resolveWave(pt) {
  const w = game.waves[game.waveIndex];
  const ok = pt ? isSafe(pt, w.round, arena) : false;
  game.click = pt;
  game.correct = ok;
  el.countdownFill.style.width = '0%';

  if (!ok) { finishRound(false, !!pt); return; }
  if (game.waveIndex === game.waves.length - 1) { finishRound(true, !!pt); return; }

  game.state = 'wavedone';                 // 短暂高亮本段结果
  // 记忆小游戏只在“放出段之前”的那个间隙出现（即最后一段之前）。
  // 2 轮：充能→记忆→放出；3 轮：充能→充能→记忆→放出（第一二段之间不出现）。
  const nextIsFinal = game.waveIndex === game.waves.length - 2;
  game.gapTimer = setTimeout(() => {
    game.gapTimer = null;
    if (settings.memoryGame && nextIsFinal) startMemoryGame();
    else advanceWave();
  }, WAVE_GAP_MS);
}

// ---------- 记忆小游戏（两轮之间） ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// 小人 = 容器(移动) + 后备指示物 + gif。gif 未加载/失败时显示指示物，保证可见可数。
function spawnPerson(x) {
  const person = document.createElement('div');
  person.className = 'mem-person';
  person.style.left = x + 'px';
  const fallback = document.createElement('div');
  fallback.className = 'mem-fallback';
  const img = document.createElement('img');
  img.className = 'mem-sprite';
  img.alt = '';
  img.onload = () => { fallback.style.display = 'none'; }; // 成功加载后隐藏指示物
  img.onerror = () => { img.style.display = 'none'; };     // 加载失败则仅留指示物
  img.src = encodeURI(PEOPLE_SRC);
  person.append(fallback, img);
  el.memStage.appendChild(person);
  return person;
}

// 匀速直线平移（CSS linear transition；duration = 距离/速度 → 各人同速）。
function moveLinear(img, x, durMs) {
  img.style.transition = `left ${durMs}ms linear`;
  img.style.left = x + 'px';
}

async function startMemoryGame() {
  const x = randInt(3, 7);   // 4..7
  const y = randInt(1, x);   // 1..x
  game.memAnswer = x - y;
  game.state = 'memory';
  game.memAsking = false;
  const token = ++game.memToken;
  const aborted = () => token !== game.memToken;

  el.memQuestion.textContent = '';
  el.memOptions.innerHTML = '';
  el.memStage.querySelectorAll('.mem-person').forEach((n) => n.remove());
  el.memModal.classList.remove('hidden');

  const W = el.memStage.clientWidth || 500;
  const houseX = W / 2;
  const pw = MEM_PERSON_W;
  const doorLeft = houseX - pw / 2;   // 小人正对门口时的 left
  const offLeft = -pw - 10;           // 走出左侧
  const v = MEM_SPEED;

  // Phase A：x 人从窗体右边缘陆续进入，整队同速向左进入房子（到门口被房子遮挡并移除）
  const enterFront = W;               // 队首起点＝右边缘（从边缘出现，而非中间凭空出现）
  const enterImgs = [];
  for (let i = 0; i < x; i++) enterImgs.push(spawnPerson(enterFront + i * MEM_SPACING));
  void el.memStage.offsetWidth;       // 强制回流，确保从初始位置开始过渡
  let enterDur = 0;
  enterImgs.forEach((img, i) => {
    const dist = enterFront + i * MEM_SPACING - doorLeft;
    const dur = (dist / v) * 1000;     // 同速 → 保持间距，依次到达
    enterDur = Math.max(enterDur, dur);
    moveLinear(img, doorLeft, dur);
    setTimeout(() => img.remove(), dur);
  });
  await sleep(enterDur + 80);
  if (aborted()) return;
  await sleep(MEM_PAUSE);
  if (aborted()) return;

  // Phase B：y 人从房子门口（初始被遮挡）错峰、同速向左走出
  const exitDur = ((doorLeft - offLeft) / v) * 1000;
  const exitImgs = [];
  for (let i = 0; i < y; i++) exitImgs.push(spawnPerson(doorLeft));
  void el.memStage.offsetWidth;
  let lastEnd = 0;
  exitImgs.forEach((img, i) => {
    const startT = i * (MEM_SPACING / v) * 1000;
    lastEnd = Math.max(lastEnd, startT + exitDur);
    setTimeout(() => { if (!aborted()) moveLinear(img, offLeft, exitDur); }, startT);
    setTimeout(() => img.remove(), startT + exitDur);
  });
  await sleep(lastEnd + 80);
  if (aborted()) return;

  // Phase C：提问 + 三个相邻数字按钮
  game.memAsking = true;
  el.memQuestion.textContent = t('memQuestion');
  buildMemOptions(game.memAnswer);
}

function buildMemOptions(answer) {
  let lo = answer - randInt(0, 2);
  if (lo < 0) lo = 0;
  if (lo > answer) lo = answer; // 保证含正确答案
  const opts = [lo, lo + 1, lo + 2];
  el.memOptions.innerHTML = '';
  for (const v of opts) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = v;
    b.addEventListener('click', () => onMemAnswer(v));
    el.memOptions.appendChild(b);
  }
}

function onMemAnswer(val) {
  const correct = val === game.memAnswer;
  closeMemory();
  if (correct) advanceWave();
  else finishRound(false, false, 'memFail');
}

function closeMemory() {
  game.memToken++;             // 中止任何进行中的动画
  game.memAsking = false;
  el.memModal.classList.add('hidden');
  el.memStage.querySelectorAll('.mem-person').forEach((n) => n.remove());
  el.memOptions.innerHTML = '';
}

// 整回合结算。failKey：非绝境失败时替代默认的 statusWrong/timeout（如记忆小游戏答错）。
function finishRound(ok, byClick, failKey) {
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
    setStatus(failKey || (byClick ? 'statusWrong' : 'statusTimeout'), 'bad');
    setBtn('next');
  }
  updateHud();
}

function restart() {
  cancelTimers();
  hideResult();
  closeMemory();
  game.score = 0;
  game.curTime = EXTREME_START;
  game.state = 'idle';
  game.p4 = null;
  game.waves = [];
  game.waveIndex = 0;
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
    case 'wave': resolveWave(canvasPoint(e)); break;
    case 'wavedone': break; // 过渡中，忽略
    case 'memory': break;   // 记忆小游戏进行中，忽略场地点击
    case 'resolved':
      if (game.autoTimer) return;
      startRound();
      break;
  }
});

el.btnStart.addEventListener('click', () => {
  if (['wave', 'wavedone', 'memory'].includes(game.state) || game.autoTimer) return;
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
  for (const btn of el.roundsSeg.querySelectorAll('.seg-btn')) {
    btn.classList.toggle('active', Number(btn.dataset.rounds) === settings.roundsP4);
  }
  el.setLearn.classList.toggle('active', settings.learnMode);
  el.setLearn.querySelector('.toggle-state').textContent = settings.learnMode ? t('on') : t('off');
  el.setMemory.classList.toggle('active', settings.memoryGame);
  el.setMemory.querySelector('.toggle-state').textContent = settings.memoryGame ? t('on') : t('off');
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
  if (game.memAsking) el.memQuestion.textContent = d.memQuestion; // 提问中切语言即时更新
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
el.roundsSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  settings.roundsP4 = Number(btn.dataset.rounds);
  saveSettings(settings);
  syncSettingsUi();
  restart(); // 段数变化 → 重置当前回合
});
el.setLearn.addEventListener('click', () => {
  settings.learnMode = !settings.learnMode;
  saveSettings(settings);
  syncSettingsUi();
});
el.setMemory.addEventListener('click', () => {
  settings.memoryGame = !settings.memoryGame;
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
  if (!game.p4 || !game.waves.length) return { ...base, state: 'idle', round: null };

  const resolvedView = game.state === 'resolved' || game.state === 'wavedone';
  const w = game.waves[game.waveIndex];
  return {
    ...base,
    state: resolvedView ? 'resolved' : 'showing',
    round: w.round,
    iceVisible: w.iceVisible,
    thunderVisible: w.thunderVisible,
    ringIceVisible: w.ringIceVisible,
    ringThunderVisible: w.ringThunderVisible,
    ringIceTrue: w.ringIceTrue,        // charge 段为 undefined → 渲染回退到 round 真假
    ringThunderTrue: w.ringThunderTrue,
  };
}

function loop(now) {
  if (game.state === 'wave') {
    const elapsed = (now - game.showStart) / 1000;
    const remaining = Math.max(0, game.roundTime - elapsed);
    el.countdownFill.style.width = (remaining / game.roundTime) * 100 + '%';
    if (elapsed >= game.roundTime) resolveWave(null);
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
