// settings.js — 配置读写与持久化（localStorage）。
const KEY = 'jyxlw-settings-v1';

const DEFAULTS = {
  lang: 'zh',       // 界面语言 zh | ja | en
  resolveTime: 5,   // 解题秒数
  learnMode: false,  // 学习模式：直接显示真/假标签
  memoryGame: false, // p4 两轮之间插入记忆小游戏
  roundsP4: 2,       // p4 每回合魔法段数：2 或 3
  bestStreak: 0,     // 单段(主页)最佳连击
  bestStreakP4: 0,   // 双段(p4)最佳连击
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* localStorage 不可用时静默忽略 */
  }
}
