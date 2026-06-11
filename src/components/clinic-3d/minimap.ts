// ─────────────────────────────────────────────────────────────────────────────
// A7 (parte 1/2) — Dibujo del minimapa (canvas 2D puro, sin three). Función pura
// que el HUD invoca en su rAF con el último frame. La OTRA parte de A7 es editar
// Clinic3DHud.tsx (crosshair, contadores, el <canvas> del minimapa + toggle M).
//
// TODO(A7): implementar drawMinimap según este brief.
//
// drawMinimap(ctx, world, frame, size):
//   - Limpia (ctx.clearRect) y dibuja fondo redondeado oscuro semitransparente.
//   - Proyecta mundo→minimapa: escala = (size - 2*pad) / max(anchoBounds,
//     altoBounds) usando world.bounds; centra. helper p(x,z) → {mx,my} con
//     mx = pad + (x - bounds.minX)*scale, my = pad + (z - bounds.minZ)*scale
//     (z hacia abajo, top-down). Mantén proporción (mismo scale en ambos ejes).
//   - MUROS: recorre world.elements con isWall; por cada celda ocupada del muro
//     pinta un rect pequeño gris (≈scale px). (O dibuja la caja del footprint.)
//   - SILLONES: frame.chairs → punto/círculo coloreado por estado
//     (STATUS_RING_COLOR[status]).
//   - OTROS USUARIOS: frame.players → puntos del color del jugador.
//   - TÚ: en (frame.px, frame.pz) dibuja una FLECHA orientada por frame.yaw
//     (triángulo apuntando en la dirección de vista; recuerda: la cámara mira a
//     -Z, así que el "frente" en el plano es (-sin yaw, -cos yaw)). Color
//     destacado (blanco/acento).
//   - Borde sutil. NUNCA lances (datos raros → omite ese ítem). Usa .forEach.
//
// Mantén el coste bajo: esto corre en rAF. size típico 150-180 px.
// ─────────────────────────────────────────────────────────────────────────────

import { STATUS_RING_COLOR, type MinimapFrame, type WorldModel } from "./world-types";

// Rectángulo redondeado (compat: algunos canvas no traen ctx.roundRect).
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: WorldModel,
  frame: MinimapFrame,
  size: number,
): void {
  ctx.clearRect(0, 0, size, size);

  // ── Fondo redondeado oscuro semitransparente + borde sutil ─────────────────
  const radius = Math.max(8, size * 0.08);
  roundRectPath(ctx, 0.5, 0.5, size - 1, size - 1, radius);
  ctx.fillStyle = "rgba(11,13,17,0.78)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();

  // Clip al fondo para que nada se salga de las esquinas redondeadas.
  ctx.save();
  roundRectPath(ctx, 0.5, 0.5, size - 1, size - 1, radius);
  ctx.clip();

  // ── Proyección mundo→minimapa (mismo scale en ambos ejes, centrada) ────────
  const bounds = world?.bounds;
  const minX = bounds?.minX ?? 0;
  const maxX = bounds?.maxX ?? 1;
  const minZ = bounds?.minZ ?? 0;
  const maxZ = bounds?.maxZ ?? 1;
  const spanX = Math.max(1e-3, maxX - minX);
  const spanZ = Math.max(1e-3, maxZ - minZ);
  const pad = Math.max(6, size * 0.07);
  const inner = size - 2 * pad;
  const scale = inner / Math.max(spanX, spanZ);
  // Centrado: reparte el sobrante del eje menor.
  const offX = pad + (inner - spanX * scale) / 2;
  const offY = pad + (inner - spanZ * scale) / 2;
  const p = (x: number, z: number): { mx: number; my: number } => ({
    mx: offX + (x - minX) * scale,
    my: offY + (z - minZ) * scale, // z hacia abajo (top-down)
  });

  // ── MUROS: un rect gris por cada celda ocupada del muro ────────────────────
  const cell = Math.max(1, scale);
  ctx.fillStyle = "rgba(148,163,184,0.55)";
  const elements = Array.isArray(world?.elements) ? world.elements : [];
  elements.forEach((el) => {
    if (!el || !el.isWall) return;
    const cols = Math.max(1, el.cols || 1);
    const rows = Math.max(1, el.rows || 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { mx, my } = p(el.col + c, el.row + r);
        // +0.5 alinea la celda con su centro; el rect cubre 1 celda.
        ctx.fillRect(mx, my, cell + 0.5, cell + 0.5);
      }
    }
  });

  // ── SILLONES: círculo coloreado por estado ─────────────────────────────────
  const chairR = Math.max(1.8, scale * 0.4);
  const chairs = Array.isArray(frame?.chairs) ? frame.chairs : [];
  chairs.forEach((ch) => {
    if (!ch) return;
    const { mx, my } = p(ch.x, ch.z);
    ctx.fillStyle = STATUS_RING_COLOR[ch.status] ?? "#94a3b8";
    ctx.beginPath();
    ctx.arc(mx, my, chairR, 0, Math.PI * 2);
    ctx.fill();
  });

  // ── OTROS USUARIOS: punto del color del jugador ────────────────────────────
  const playerR = Math.max(1.6, scale * 0.32);
  const players = Array.isArray(frame?.players) ? frame.players : [];
  players.forEach((pl) => {
    if (!pl) return;
    const { mx, my } = p(pl.x, pl.z);
    ctx.fillStyle = pl.color || "#e5e7eb";
    ctx.beginPath();
    ctx.arc(mx, my, playerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.stroke();
  });

  // ── TÚ: flecha orientada por yaw (cámara mira a -Z → frente=(-sin,-cos)) ────
  if (frame && Number.isFinite(frame.px) && Number.isFinite(frame.pz)) {
    const { mx, my } = p(frame.px, frame.pz);
    const yaw = Number.isFinite(frame.yaw) ? frame.yaw : 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    // Perpendicular para los vértices traseros.
    const sx = -fz;
    const sz = fx;
    const len = Math.max(5, scale * 0.85);     // largo de la flecha
    const wid = Math.max(3, scale * 0.5);      // semi-ancho de la base
    const tipX = mx + fx * len;
    const tipY = my + fz * len;
    const baseX = mx - fx * len * 0.45;
    const baseY = my - fz * len * 0.45;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + sx * wid, baseY + sz * wid);
    ctx.lineTo(baseX - sx * wid, baseY - sz * wid);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();
  }

  ctx.restore();
}
