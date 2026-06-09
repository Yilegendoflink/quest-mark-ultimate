// render.js — 全部 Canvas 绘制：场地、BOSS、预兆填充、双环+旋转球、结果高亮。
import {
  normalFor,
  isSafe,
  iceDanger,
  thunderDanger,
  insideArena,
} from './geometry.js';

const COLORS = {
  bg: '#0d1020',
  arena: '#161a2e',
  arenaEdge: '#3a4170',
  teleIce: 'rgba(150,60,210,0.6)',     // 冰预兆填充：紫 60%
  teleThunder: 'rgba(150,60,210,0.8)', // 雷预兆填充：紫 80%
  teleGold: '#ffcf45',           // 描边金
  teleRed: '#ff3030',            // 描边红
  danger: 'rgba(230,60,60,0.32)',    // 真实危险（结算）
  safe: 'rgba(70,220,120,0.34)',     // 真实安全（结算）
  iceRing: '#6fb7ff',
  thunderRing: '#c187ff',
  ballTrue: '#ffffff',
  ballFalse: '#ff4d4d',
};

/** 裁剪到场地圆内执行 fn。 */
function clipArena(ctx, arena, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(arena.cx, arena.cy, arena.R, 0, Math.PI * 2);
  ctx.clip();
  fn();
  ctx.restore();
}

function drawArena(ctx, arena, arenaImg) {
  clipArena(ctx, arena, () => {
    if (arenaImg && arenaImg.width) {
      // 贴图覆盖圆的外接正方形（门神.png 已是居中圆形平台）
      const d = arena.R * 2;
      ctx.drawImage(arenaImg, arena.cx - arena.R, arena.cy - arena.R, d, d);
    } else {
      ctx.fillStyle = COLORS.arena;
      ctx.fillRect(arena.cx - arena.R, arena.cy - arena.R, arena.R * 2, arena.R * 2);
    }
  });

  ctx.strokeStyle = COLORS.arenaEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(arena.cx, arena.cy, arena.R, 0, Math.PI * 2);
  ctx.stroke();
}

// 象限扇形（与圆相交后是 90° 扇形）的角度范围。
const QUADRANT_ARC = {
  TR: [-Math.PI / 2, 0],
  BR: [0, Math.PI / 2],
  BL: [Math.PI / 2, Math.PI],
  TL: [Math.PI, Math.PI * 1.5],
};

function traceQuadrant(ctx, arena, q) {
  const [a, b] = QUADRANT_ARC[q];
  ctx.moveTo(arena.cx, arena.cy);
  ctx.arc(arena.cx, arena.cy, arena.R, a, b);
  ctx.closePath();
}

/** 勾勒 band 与圆相交区域的轮廓（两条弦 + 两段圆弧，用折线近似）。 */
function traceBand(ctx, arena, slant, idx) {
  const { nx, ny } = normalFor(slant);
  const tx = -ny;
  const ty = nx; // 切向
  const R = arena.R;
  const bandW = R / 2;
  const p0 = -R + idx * bandW;
  const p1 = p0 + bandW;
  const abs = (u, v) => ({ x: arena.cx + u * nx + v * tx, y: arena.cy + u * ny + v * ty });
  const yEdge = (u) => Math.sqrt(Math.max(0, R * R - u * u));
  const N = 24;

  let pt = abs(p0, yEdge(p0));
  ctx.moveTo(pt.x, pt.y);
  for (let i = 1; i <= N; i++) { // 上缘弧 u: p0→p1
    const u = p0 + (p1 - p0) * (i / N);
    pt = abs(u, yEdge(u));
    ctx.lineTo(pt.x, pt.y);
  }
  for (let i = 0; i <= N; i++) { // 下缘弧 u: p1→p0
    const u = p1 - (p1 - p0) * (i / N);
    pt = abs(u, -yEdge(u));
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.closePath();
}

/** 半透明紫填充 + 金/红交替虚线描边（沿轮廓流动）。 */
function fillStrokeTelegraph(ctx, traceFn, time, fillColor) {
  ctx.beginPath();
  traceFn(ctx);
  ctx.fillStyle = fillColor;
  ctx.fill();

  const dash = 16;
  const offset = (time * 0.05) % (dash * 2);
  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = -offset;
  ctx.strokeStyle = COLORS.teleGold;
  ctx.beginPath();
  traceFn(ctx);
  ctx.stroke();
  ctx.lineDashOffset = -offset + dash; // 错位填红，金红交替
  ctx.strokeStyle = COLORS.teleRed;
  ctx.beginPath();
  traceFn(ctx);
  ctx.stroke();
  ctx.restore();
}

function drawIceTelegraph(ctx, arena, iceSet, time) {
  for (const q of iceSet) fillStrokeTelegraph(ctx, (c) => traceQuadrant(c, arena, q), time, COLORS.teleIce);
}

function drawThunderTelegraph(ctx, arena, slant, thunderSet, time) {
  for (const b of thunderSet) fillStrokeTelegraph(ctx, (c) => traceBand(c, arena, slant, b), time, COLORS.teleThunder);
}

const BOSS_H = 0.56; // BOSS 高度占 R 的比例（放大一圈）

function drawBoss(ctx, arena, bossImg) {
  const h = arena.R * BOSS_H;
  if (bossImg && bossImg.width) {
    const w = h * (bossImg.width / bossImg.height);
    ctx.drawImage(bossImg, arena.cx - w / 2, arena.cy - h / 2, w, h);
  } else {
    const r = h * 0.45;
    ctx.fillStyle = '#2a3050';
    ctx.strokeStyle = '#6b74a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(arena.cx, arena.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#aab0d8';
    ctx.font = `bold ${Math.round(r * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BOSS', arena.cx, arena.cy);
  }
}

const TILT = 0.5; // 30° 俯视角：椭圆短/长轴比 = sin30° = 0.5

/** 画一个 30° 俯视的旋转环（椭圆）：两个相对的球，状态一致。isTrue→白球；否则红球带 ?。 */
function drawRing(ctx, center, ringColor, isTrue, angle) {
  const ringR = 28;
  const ringRy = ringR * TILT;
  const ballR = 11;

  // 椭圆环
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, ringR, ringRy, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 两个球沿椭圆运动，按前后深度排序与缩放，营造俯视立体感
  const balls = [angle, angle + Math.PI].map((a) => {
    const depth = (Math.sin(a) + 1) / 2; // 0=后(上) .. 1=前(下)
    return {
      x: center.x + Math.cos(a) * ringR,
      y: center.y + Math.sin(a) * ringRy,
      r: ballR * (0.78 + 0.32 * depth),
    };
  });
  balls.sort((p, q) => p.y - q.y); // 后面的先画

  for (const b of balls) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = isTrue ? COLORS.ballTrue : COLORS.ballFalse;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    if (!isTrue) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(b.r * 1.3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', b.x, b.y + 1);
    }
  }
}

function drawRings(ctx, arena, round, angle, learn, labels) {
  const halfH = (arena.R * BOSS_H) / 2;
  // 环与头/脚重叠：落在精灵上下端内侧
  const head = { x: arena.cx, y: arena.cy - halfH * 0.62 }; // 头顶=雷(紫)
  const foot = { x: arena.cx, y: arena.cy + halfH * 0.78 }; // 脚底=冰(蓝)
  drawRing(ctx, head, COLORS.thunderRing, round.thunderTrue, angle);
  drawRing(ctx, foot, COLORS.iceRing, round.iceTrue, -angle);

  if (learn && labels) {
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.thunderRing;
    ctx.fillText(round.thunderTrue ? labels.thunderT : labels.thunderF, head.x, head.y - 40);
    ctx.fillStyle = COLORS.iceRing;
    ctx.fillText(round.iceTrue ? labels.iceT : labels.iceF, foot.x, foot.y + 40);
  }
}

/** 结算：采样填充真实安全(绿)/危险(红)。 */
function drawResolution(ctx, arena, round, step = 7) {
  clipArena(ctx, arena, () => {
    for (let y = arena.cy - arena.R; y <= arena.cy + arena.R; y += step) {
      for (let x = arena.cx - arena.R; x <= arena.cx + arena.R; x += step) {
        const pt = { x, y };
        if (!insideArena(pt, arena)) continue;
        const danger = iceDanger(pt, round, arena) || thunderDanger(pt, round, arena);
        ctx.fillStyle = danger ? COLORS.danger : COLORS.safe;
        ctx.fillRect(x, y, step, step);
      }
    }
  });
}

function drawClickMarker(ctx, click, correct) {
  ctx.strokeStyle = correct ? '#5cff9a' : '#ff5c5c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(click.x, click.y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(click.x - 7, click.y - 7);
  ctx.lineTo(click.x + 7, click.y + 7);
  ctx.moveTo(click.x + 7, click.y - 7);
  ctx.lineTo(click.x - 7, click.y + 7);
  ctx.stroke();
}

/**
 * 主绘制入口。
 * @param scene { state, round, angle, time, click, correct, bossImg, arenaImg, learn, learnLabels }
 */
export function renderScene(ctx, arena, scene) {
  const { round } = scene;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawArena(ctx, arena, scene.arenaImg);

  if (!round) {
    drawBoss(ctx, arena, scene.bossImg);
    return;
  }

  // 预兆填充（showing 与 resolved 都显示）
  drawIceTelegraph(ctx, arena, round.iceSet, scene.time);
  drawThunderTelegraph(ctx, arena, round.slant, round.thunderSet, scene.time);

  if (scene.state === 'resolved') {
    drawResolution(ctx, arena, round);
  }

  drawBoss(ctx, arena, scene.bossImg);
  drawRings(ctx, arena, round, scene.angle, scene.learn, scene.learnLabels);

  if (scene.state === 'resolved' && scene.click) {
    drawClickMarker(ctx, scene.click, scene.correct);
  }
}
