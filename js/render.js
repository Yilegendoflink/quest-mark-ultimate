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
  grid: 'rgba(255,255,255,0.06)',
  ice: 'rgba(90,170,255,0.28)',      // 冰预兆填充（蓝）
  iceEdge: 'rgba(120,190,255,0.7)',
  thunder: 'rgba(180,110,255,0.26)', // 雷预兆填充（紫）
  thunderEdge: 'rgba(200,140,255,0.7)',
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

function drawArena(ctx, arena, showGrid, slant) {
  ctx.fillStyle = COLORS.arena;
  ctx.beginPath();
  ctx.arc(arena.cx, arena.cy, arena.R, 0, Math.PI * 2);
  ctx.fill();

  if (showGrid) {
    clipArena(ctx, arena, () => {
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      // 象限十字
      ctx.beginPath();
      ctx.moveTo(arena.cx - arena.R, arena.cy);
      ctx.lineTo(arena.cx + arena.R, arena.cy);
      ctx.moveTo(arena.cx, arena.cy - arena.R);
      ctx.lineTo(arena.cx, arena.cy + arena.R);
      ctx.stroke();
      // 当前 slant 的条带分隔线
      drawBandLines(ctx, arena, slant);
    });
  }

  ctx.strokeStyle = COLORS.arenaEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(arena.cx, arena.cy, arena.R, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBandLines(ctx, arena, slant) {
  const { nx, ny } = normalFor(slant);
  const theta = Math.atan2(ny, nx);
  ctx.save();
  ctx.translate(arena.cx, arena.cy);
  ctx.rotate(theta); // 旋转后新 x 轴对齐法向，p 即新 x 坐标
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const p = -arena.R + i * (arena.R / 2);
    ctx.moveTo(p, -arena.R);
    ctx.lineTo(p, arena.R);
  }
  ctx.stroke();
  ctx.restore();
}

/** 填充某个轴对齐象限（裁剪在圆内）。 */
function fillQuadrant(ctx, arena, q) {
  const { cx, cy, R } = arena;
  const x = q === 'TR' || q === 'BR' ? cx : cx - R;
  const y = q === 'BL' || q === 'BR' ? cy : cy - R;
  ctx.fillRect(x, y, R, R);
}

function drawIceTelegraph(ctx, arena, iceSet) {
  clipArena(ctx, arena, () => {
    ctx.fillStyle = COLORS.ice;
    for (const q of iceSet) fillQuadrant(ctx, arena, q);
  });
}

/** 填充某个 band（旋转坐标系后是一条竖直矩形带）。 */
function fillBand(ctx, arena, slant, idx) {
  const { nx, ny } = normalFor(slant);
  const theta = Math.atan2(ny, nx);
  const bandW = arena.R / 2;
  const p0 = -arena.R + idx * bandW;
  ctx.save();
  ctx.translate(arena.cx, arena.cy);
  ctx.rotate(theta);
  ctx.fillRect(p0, -arena.R, bandW, arena.R * 2);
  ctx.restore();
}

function drawThunderTelegraph(ctx, arena, slant, thunderSet) {
  clipArena(ctx, arena, () => {
    ctx.fillStyle = COLORS.thunder;
    for (const b of thunderSet) fillBand(ctx, arena, slant, b);
  });
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

function drawRings(ctx, arena, round, angle, learn) {
  const halfH = (arena.R * BOSS_H) / 2;
  // 环与头/脚重叠：落在精灵上下端内侧
  const head = { x: arena.cx, y: arena.cy - halfH * 0.62 }; // 头顶=雷(紫)
  const foot = { x: arena.cx, y: arena.cy + halfH * 0.78 }; // 脚底=冰(蓝)
  drawRing(ctx, head, COLORS.thunderRing, round.thunderTrue, angle);
  drawRing(ctx, foot, COLORS.iceRing, round.iceTrue, -angle);

  if (learn) {
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.thunderRing;
    ctx.fillText(round.thunderTrue ? '雷·真' : '雷·假', head.x, head.y - 40);
    ctx.fillStyle = COLORS.iceRing;
    ctx.fillText(round.iceTrue ? '冰·真' : '冰·假', foot.x, foot.y + 40);
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
 * @param scene { state, round, angle, click, correct, bossImg, showGrid, learn }
 */
export function renderScene(ctx, arena, scene) {
  const { round } = scene;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawArena(ctx, arena, scene.showGrid, round ? round.slant : 1);

  if (!round) {
    drawBoss(ctx, arena, scene.bossImg);
    return;
  }

  // 预兆填充（showing 与 resolved 都显示）
  drawIceTelegraph(ctx, arena, round.iceSet);
  drawThunderTelegraph(ctx, arena, round.slant, round.thunderSet);

  if (scene.state === 'resolved') {
    drawResolution(ctx, arena, round);
  }

  drawBoss(ctx, arena, scene.bossImg);
  drawRings(ctx, arena, round, scene.angle, scene.learn);

  if (scene.state === 'resolved' && scene.click) {
    drawClickMarker(ctx, scene.click, scene.correct);
  }
}
