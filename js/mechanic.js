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
 * p4 多段机制出题。
 * 充能段(charges)：每段单一属性(冰或雷)、随机真假。
 *   - rounds=2：1 段，属性随机；
 *   - rounds=3：2 段，固定一冰一雷、顺序随机。
 * 放出段(final)：冰雷皆出；对“出现过充能段”的属性套用同真规则
 *   （effective = 该属性充能段真假 === 放出段该环显示真假），未充能属性按显示值。
 * 各段安全区均校验非空。
 * @returns {{
 *   charges: Array<{ attr:'ice'|'thunder', round, displayTrue }>,
 *   final: { round, iceDisplayTrue, thunderDisplayTrue }
 * }}
 */
export function generateP4Round(arena, rounds = 2, minSafeRatio = 0.05) {
  let last;
  for (let i = 0; i < 100; i++) {
    const chargeAttrs = rounds >= 3
      ? (coin() ? ['ice', 'thunder'] : ['thunder', 'ice'])
      : [coin() ? 'ice' : 'thunder'];
    const charges = chargeAttrs.map((attr) => {
      const displayTrue = coin();
      const round = attr === 'ice' ? makeIceRound(displayTrue) : makeThunderRound(displayTrue);
      return { attr, round, displayTrue };
    });

    const iceSet = pick(ICE_PAIRS).slice();
    const slant = coin() ? 1 : -1;
    const thunderSet = pick(THUNDER_PAIRS).slice();
    const iceDisplayTrue = coin();
    const thunderDisplayTrue = coin();
    const iceCharge = charges.find((c) => c.attr === 'ice');
    const thunderCharge = charges.find((c) => c.attr === 'thunder');
    const iceEffTrue = iceCharge ? iceCharge.displayTrue === iceDisplayTrue : iceDisplayTrue;
    const thunderEffTrue = thunderCharge ? thunderCharge.displayTrue === thunderDisplayTrue : thunderDisplayTrue;
    const finalRound = { iceSet, slant, thunderSet, iceTrue: iceEffTrue, thunderTrue: thunderEffTrue };

    last = { charges, final: { round: finalRound, iceDisplayTrue, thunderDisplayTrue } };
    const chargesOk = charges.every((c) => safeAreaRatio(c.round, arena) >= minSafeRatio);
    if (chargesOk && safeAreaRatio(finalRound, arena) >= minSafeRatio) return last;
  }
  return last;
}
