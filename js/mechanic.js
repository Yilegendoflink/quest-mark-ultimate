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

// 单属性 round：把另一属性中性化（空集 + true）使其危险恒为 false，
// 从而 isSafe/safeAreaRatio 退化为只看该属性。
function makeIceRound(displayTrue) {
  return { iceSet: pick(ICE_PAIRS).slice(), slant: 1, thunderSet: [], iceTrue: displayTrue, thunderTrue: true };
}
function makeThunderRound(displayTrue) {
  return { iceSet: [], slant: coin() ? 1 : -1, thunderSet: pick(THUNDER_PAIRS).slice(), iceTrue: true, thunderTrue: displayTrue };
}

/**
 * p4 双段机制出题。
 * 第一轮：单一属性(冰或雷)，随机真假；第二轮：冰雷皆出，对第一轮属性套用同真规则
 * （effective = 上轮真假 === 本轮该环显示真假），另一属性按显示值。
 * 两轮安全区均校验非空。
 * @returns {{
 *   wave1:{ attr:'ice'|'thunder', round, displayTrue },
 *   wave2:{ round, iceDisplayTrue, thunderDisplayTrue }
 * }}
 */
export function generateP4Round(arena, minSafeRatio = 0.05) {
  let last;
  for (let i = 0; i < 80; i++) {
    const attr = coin() ? 'ice' : 'thunder';
    const wave1True = coin();
    const wave1Round = attr === 'ice' ? makeIceRound(wave1True) : makeThunderRound(wave1True);

    const iceSet = pick(ICE_PAIRS).slice();
    const slant = coin() ? 1 : -1;
    const thunderSet = pick(THUNDER_PAIRS).slice();
    const iceDisplayTrue = coin();
    const thunderDisplayTrue = coin();
    // 同真规则：对第一轮属性 (上轮 === 本轮显示)，另一属性 = 显示值。
    const iceEffTrue = attr === 'ice' ? wave1True === iceDisplayTrue : iceDisplayTrue;
    const thunderEffTrue = attr === 'thunder' ? wave1True === thunderDisplayTrue : thunderDisplayTrue;
    const wave2Round = { iceSet, slant, thunderSet, iceTrue: iceEffTrue, thunderTrue: thunderEffTrue };

    last = {
      wave1: { attr, round: wave1Round, displayTrue: wave1True },
      wave2: { round: wave2Round, iceDisplayTrue, thunderDisplayTrue },
    };
    if (
      safeAreaRatio(wave1Round, arena) >= minSafeRatio &&
      safeAreaRatio(wave2Round, arena) >= minSafeRatio
    ) {
      return last;
    }
  }
  return last;
}
