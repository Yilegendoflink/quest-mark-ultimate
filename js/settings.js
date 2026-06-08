// settings.js — 配置读写与持久化（localStorage）。
const KEY = 'jyxlw-settings-v1';

const DEFAULTS = {
  resolveTime: 5,   // 解题秒数
  learnMode: false, // 学习模式：直接显示真/假标签
  showGrid: true,   // 辅助线
  bestStreak: 0,
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
