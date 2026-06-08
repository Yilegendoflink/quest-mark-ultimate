// mechanic.js — 出题：随机生成一轮真假魔法配置，并校验存在可点击的安全区。
import { safeAreaRatio } from './geometry.js';

const ICE_PAIRS = [
  ['TL', 'BR'],
  ['TR', 'BL'],
];

// 雷只可能是隔一相间的两带 {0,2} 或 {1,3}（不含 {0,3} 这种两侧外带）。
const THUNDER_PAIRS = [
  [0, 2],
  [1, 3],
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function coin() {
  return Math.random() < 0.5;
}

/**
 * 生成一轮机制。会重试直到安全区比例达到 minSafeRatio，保证可点击。
 * @returns {{iceSet,slant,thunderSet,iceTrue,thunderTrue}}
 */
export function generateRound(arena, minSafeRatio = 0.05) {
  let round;
  for (let i = 0; i < 60; i++) {
    round = {
      iceSet: pick(ICE_PAIRS).slice(),
      slant: coin() ? 1 : -1,
      thunderSet: pick(THUNDER_PAIRS).slice(),
      iceTrue: coin(),
      thunderTrue: coin(),
    };
    if (safeAreaRatio(round, arena) >= minSafeRatio) return round;
  }
  // 极少数情况下兜底返回最后一次（理论上不会到这里）。
  return round;
}
