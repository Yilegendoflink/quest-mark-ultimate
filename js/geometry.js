// geometry.js — 坐标映射与真假魔法的危险/安全判定（纯函数）
//
// arena: { cx, cy, R }  —— 圆心像素坐标与半径(px)，R 映射 12y。
// round: { iceSet:[象限...], slant:±1, thunderSet:[band...], iceTrue, thunderTrue }

export const QUADRANTS = ['TL', 'TR', 'BL', 'BR'];

/** 屏幕坐标的象限：top=较小 y。 */
export function quadrant(pt, arena) {
  const dx = pt.x - arena.cx;
  const dy = pt.y - arena.cy;
  if (dx < 0 && dy < 0) return 'TL';
  if (dx >= 0 && dy < 0) return 'TR';
  if (dx < 0 && dy >= 0) return 'BL';
  return 'BR';
}

/** 斜 45° 法向量（单位向量）。slant=+1 → (1,1)/√2；slant=-1 → (1,-1)/√2。 */
export function normalFor(slant) {
  const s = 1 / Math.SQRT2;
  return { nx: s, ny: slant >= 0 ? s : -s };
}

/** 把点投影到法向轴，等分 4 个带，返回 band 索引 0..3。 */
export function band(pt, slant, arena) {
  const { nx, ny } = normalFor(slant);
  const dx = pt.x - arena.cx;
  const dy = pt.y - arena.cy;
  const p = dx * nx + dy * ny;          // p ∈ [-R, R]
  const bandW = arena.R / 2;
  let idx = Math.floor((p + arena.R) / bandW);
  if (idx < 0) idx = 0;
  if (idx > 3) idx = 3;
  return idx;
}

export function insideArena(pt, arena) {
  const dx = pt.x - arena.cx;
  const dy = pt.y - arena.cy;
  return dx * dx + dy * dy <= arena.R * arena.R;
}

/** 冰预兆是否覆盖该点。 */
export function iceTelegraphed(pt, round, arena) {
  return round.iceSet.includes(quadrant(pt, arena));
}

/** 雷预兆是否覆盖该点。 */
export function thunderTelegraphed(pt, round, arena) {
  return round.thunderSet.includes(band(pt, round.slant, arena));
}

// 真(white): 预兆区危险；假(red/?): 反转 —— 预兆区安全、非预兆区危险。
export function iceDanger(pt, round, arena) {
  const tel = iceTelegraphed(pt, round, arena);
  return round.iceTrue ? tel : !tel;
}

export function thunderDanger(pt, round, arena) {
  const tel = thunderTelegraphed(pt, round, arena);
  return round.thunderTrue ? tel : !tel;
}

export function isSafe(pt, round, arena) {
  return (
    insideArena(pt, arena) &&
    !iceDanger(pt, round, arena) &&
    !thunderDanger(pt, round, arena)
  );
}

/** 网格采样估算安全区占场地的比例（用于出题校验）。 */
export function safeAreaRatio(round, arena, step = 6) {
  let inside = 0;
  let safe = 0;
  for (let y = arena.cy - arena.R; y <= arena.cy + arena.R; y += step) {
    for (let x = arena.cx - arena.R; x <= arena.cx + arena.R; x += step) {
      const pt = { x, y };
      if (!insideArena(pt, arena)) continue;
      inside++;
      if (isSafe(pt, round, arena)) safe++;
    }
  }
  return inside === 0 ? 0 : safe / inside;
}
