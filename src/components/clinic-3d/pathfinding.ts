// ─────────────────────────────────────────────────────────────────────────────
// V3 — A2 — Pathfinding sobre la grilla de ocupación del mundo (BFS). Función
// PURA (sin three). La usa waiting-layer para que un paciente "llamado" camine
// del asiento de espera hasta su sillón evitando muros y mobiliario; las celdas
// de PUERTA NO bloquean (el parser ya las dejó blocks=false → blocked[r][c]=false).
//
// TODO(A2): implementar findPath según este brief (reemplaza el stub recto).
//
// ENTRADA: world (WorldModel: cols/rows/blocked), from {x,z}, to {x,z} en MUNDO
//   (x = eje col, z = eje row; 1 celda = 1 m; centro de celda = entero+0.5).
//
// PASOS:
// 1) Celda de un punto = { c: floor(x), r: floor(z) }. La grilla es
//    blocked[r][c] (rows×cols). Walkable(c,r) = dentro de [0,cols)×[0,rows) &&
//    !blocked[r][c].
// 2) Endpoints bloqueados: el asiento (origen) y el sillón (destino) SON
//    mobiliario → su celda está bloqueada. Snapea cada endpoint a la celda
//    WALKABLE más cercana por búsqueda en espiral (mismo patrón que
//    nearestFreeCell del layout-parser). Si no hay ninguna walkable cerca de
//    alguno → return null.
// 3) BFS 4-vecinos (N/S/E/O) desde la celda walkable del origen hasta la del
//    destino, guardando el predecesor de cada celda visitada. (4-vecinos basta y
//    evita cortar esquinas de muros; sin diagonales.) Si no se alcanza el
//    destino → return null. Cota de seguridad: nunca visites más de cols*rows
//    celdas (la grilla está acotada a 200×200).
// 4) Reconstruye la ruta de celdas destino→origen y voltéala. Conviértela a
//    waypoints en el CENTRO de cada celda (c+0.5, r+0.5).
// 5) Suaviza esquinas con "string-pulling" por línea de vista: recorre los
//    waypoints y descarta los intermedios mientras el segmento entre el último
//    fijado y el siguiente candidato esté libre (supercover/DDA de celdas:
//    muestrea el segmento y verifica que toda celda tocada sea walkable). Esto
//    convierte el zig-zag de la grilla en tramos diagonales naturales.
// 6) Antepón el punto `from` EXACTO (el asiento real) y añade el `to` EXACTO (el
//    centro del sillón) como primer y último waypoint, para que el walker
//    arranque sentado y termine justo en el sillón aunque sus celdas estén
//    bloqueadas. Colapsa waypoints casi idénticos (dist < 1e-3).
//
// Robustez: NUNCA lanzar. from/to inválidos o world raro → return null (el
// caller hace fade-out/fade-in directo). tsconfig no-strict: NADA de for...of
// sobre Map/Set (usa índices/Array). Aquí los bucles son sobre arrays/números:
// ok usar for clásico.
// ─────────────────────────────────────────────────────────────────────────────

import type { WorldModel } from "./world-types";

export interface PathPoint {
  x: number;
  z: number;
}

export interface GridPath {
  /** Waypoints en mundo, del origen (asiento) al destino (sillón), suavizados. */
  points: PathPoint[];
}

/** Celda de un punto de mundo: c = floor(x) (eje col), r = floor(z) (eje row). */
interface Cell {
  c: number;
  r: number;
}

/** ¿La celda (c,r) está dentro de la grilla y NO bloqueada? blocked[r][c]. */
function isWalkable(blocked: boolean[][], cols: number, rows: number, c: number, r: number): boolean {
  if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
  const rowArr = blocked[r];
  if (!rowArr) return false;
  return rowArr[c] !== true;
}

/**
 * Celda walkable más cercana a (cx,cz) por búsqueda en espiral; null si ninguna.
 * Mismo patrón de anillos que `nearestFreeCell` del layout-parser (solo el
 * anillo exterior de cada radio: max(|dr|,|dc|) === radius).
 */
function nearestWalkableCell(
  blocked: boolean[][],
  cols: number,
  rows: number,
  cx: number,
  cz: number,
): Cell | null {
  // Clamp del centro de búsqueda a la grilla [0,cols-1]×[0,rows-1].
  let sc = Math.floor(cx);
  let sr = Math.floor(cz);
  if (!Number.isFinite(sc)) sc = 0;
  if (!Number.isFinite(sr)) sr = 0;
  if (sc < 0) sc = 0;
  else if (sc > cols - 1) sc = cols - 1;
  if (sr < 0) sr = 0;
  else if (sr > rows - 1) sr = rows - 1;

  if (isWalkable(blocked, cols, rows, sc, sr)) return { c: sc, r: sr };
  const maxRadius = Math.max(cols, rows);
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        // solo el anillo exterior de este radio
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const c = sc + dc;
        const r = sr + dr;
        if (isWalkable(blocked, cols, rows, c, r)) return { c, r };
      }
    }
  }
  return null;
}

/**
 * ¿El segmento (x0,z0)→(x1,z1) toca SOLO celdas walkable? Supercover/DDA: avanza
 * celda a celda sobre la grilla (cruza también las celdas que el segmento roza
 * en diagonal), y verifica cada celda tocada. Devuelve false en cuanto pisa una
 * celda bloqueada o fuera de la grilla.
 */
function segmentWalkable(
  blocked: boolean[][],
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  let c = Math.floor(x0);
  let r = Math.floor(z0);
  const cEnd = Math.floor(x1);
  const rEnd = Math.floor(z1);

  const dx = x1 - x0;
  const dz = z1 - z0;
  const stepC = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepR = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Distancia paramétrica (en t∈[0,1]) entre cruces de líneas de grilla.
  const tDeltaC = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaR = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  // t del primer cruce de borde de celda en cada eje.
  let tMaxC: number;
  if (dx > 0) tMaxC = (Math.floor(x0) + 1 - x0) / dx;
  else if (dx < 0) tMaxC = (x0 - Math.floor(x0)) / -dx;
  else tMaxC = Infinity;

  let tMaxR: number;
  if (dz > 0) tMaxR = (Math.floor(z0) + 1 - z0) / dz;
  else if (dz < 0) tMaxR = (z0 - Math.floor(z0)) / -dz;
  else tMaxR = Infinity;

  if (!isWalkable(blocked, cols, rows, c, r)) return false;

  // Cota dura por si datos raros producen un bucle largo: nº de celdas que el
  // segmento puede tocar ≤ |Δc| + |Δr| + 1; le damos margen y techo global.
  const maxSteps = Math.abs(cEnd - c) + Math.abs(rEnd - r) + 2;
  let guard = 0;
  const guardCap = cols * rows + cols + rows + 8;

  while ((c !== cEnd || r !== rEnd) && guard < maxSteps && guard < guardCap) {
    guard++;
    if (tMaxC < tMaxR) {
      tMaxC += tDeltaC;
      c += stepC;
    } else if (tMaxR < tMaxC) {
      tMaxR += tDeltaR;
      r += stepR;
    } else {
      // Cruce por una esquina exacta: avanza ambos ejes (supercover toca las
      // dos celdas ortogonales adyacentes a la esquina; verificarlas evita
      // "rozar" la esquina de un muro).
      if (
        !isWalkable(blocked, cols, rows, c + stepC, r) ||
        !isWalkable(blocked, cols, rows, c, r + stepR)
      ) {
        return false;
      }
      tMaxC += tDeltaC;
      tMaxR += tDeltaR;
      c += stepC;
      r += stepR;
    }
    if (!isWalkable(blocked, cols, rows, c, r)) return false;
  }
  return true;
}

/**
 * Ruta caminable de `from` a `to` sobre world.blocked, o null si no hay ruta
 * (el caller hará fade directo). Implementación A2: snap de endpoints bloqueados
 * a la celda walkable más cercana (espiral), BFS 4-vecinos sobre la grilla,
 * reconstrucción de la ruta, string-pulling por línea de vista (DDA) y anteponer
 * `from`/`to` exactos. PURA (sin three). NUNCA lanza: dato raro → null.
 */
export function findPath(world: WorldModel, from: PathPoint, to: PathPoint): GridPath | null {
  if (!world || !from || !to) return null;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.z)) return null;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return null;

  const cols = world.cols;
  const rows = world.rows;
  const blocked = world.blocked;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
  if (!Array.isArray(blocked) || blocked.length === 0) return null;

  // ── 1) Snap de endpoints (asiento y sillón son mobiliario → celda bloqueada).
  const startCell = nearestWalkableCell(blocked, cols, rows, from.x, from.z);
  const goalCell = nearestWalkableCell(blocked, cols, rows, to.x, to.z);
  if (!startCell || !goalCell) return null;

  // ── 2) BFS 4-vecinos (N/S/E/O) con cola numérica (array + cabeza), sin
  // iteradores. Índice de celda = r * cols + c. prev guarda el predecesor.
  const total = cols * rows;
  const startIdx = startCell.r * cols + startCell.c;
  const goalIdx = goalCell.r * cols + goalCell.c;

  if (startIdx === goalIdx) {
    // Mismo nodo: ruta directa asiento→sillón (sin waypoints intermedios).
    const pts: PathPoint[] = [];
    pushPoint(pts, from.x, from.z);
    pushPoint(pts, to.x, to.z);
    return { points: pts };
  }

  const prev = new Int32Array(total).fill(-1);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let visited = 0;

  queue[tail++] = startIdx;
  seen[startIdx] = 1;

  let found = false;
  // Vecinos: dc/dr en N/S/E/O.
  const ndc = [1, -1, 0, 0];
  const ndr = [0, 0, 1, -1];

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goalIdx) {
      found = true;
      break;
    }
    // Cota de seguridad: nunca visitar más de cols*rows celdas.
    if (++visited > total) break;

    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    for (let k = 0; k < 4; k++) {
      const nc = cc + ndc[k];
      const nr = cr + ndr[k];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const row = blocked[nr];
      if (!row || row[nc] === true) continue; // fuera o bloqueada
      const nIdx = nr * cols + nc;
      if (seen[nIdx]) continue;
      seen[nIdx] = 1;
      prev[nIdx] = cur;
      queue[tail++] = nIdx;
    }
  }

  if (!found) return null;

  // ── 3) Reconstruir la ruta destino→origen y voltearla a centros de celda.
  const cellPath: PathPoint[] = [];
  let node = goalIdx;
  let safety = 0;
  while (node !== -1 && safety <= total) {
    const nc = node % cols;
    const nr = (node - nc) / cols;
    cellPath.push({ x: nc + 0.5, z: nr + 0.5 }); // centro de celda
    if (node === startIdx) break;
    node = prev[node];
    safety++;
  }
  cellPath.reverse(); // ahora origen → destino

  // ── 4) String-pulling por línea de vista: conserva un waypoint solo si el
  // tramo recto desde el último fijado hasta el siguiente candidato no es libre.
  const smoothed: PathPoint[] = [];
  if (cellPath.length > 0) {
    smoothed.push(cellPath[0]);
    let anchor = 0; // índice en cellPath del último punto conservado
    for (let i = 1; i < cellPath.length; i++) {
      // ¿Sigue siendo visible el siguiente desde el ancla? Si el siguiente (i+1)
      // YA no es visible desde el ancla, hay que fijar i (no podemos saltarlo).
      const next = i + 1;
      if (
        next >= cellPath.length ||
        !segmentWalkable(
          blocked,
          cols,
          rows,
          cellPath[anchor].x,
          cellPath[anchor].z,
          cellPath[next].x,
          cellPath[next].z,
        )
      ) {
        smoothed.push(cellPath[i]);
        anchor = i;
      }
      // si next sí es visible desde el ancla, saltamos i (no se conserva).
    }
  }

  // ── 5) Antepón `from` exacto y añade `to` exacto; colapsa casi-duplicados.
  const points: PathPoint[] = [];
  pushPoint(points, from.x, from.z);
  for (let i = 0; i < smoothed.length; i++) pushPoint(points, smoothed[i].x, smoothed[i].z);
  pushPoint(points, to.x, to.z);

  if (points.length === 0) return null;
  if (points.length === 1) {
    // Origen y destino colapsaron a un solo punto: duplica para que el walker
    // tenga un segmento trivial (arranca y termina en el mismo sitio).
    points.push({ x: points[0].x, z: points[0].z });
  }

  return { points };
}

/** Empuja (x,z) salvo que coincida casi exactamente con el último (dist < 1e-3). */
function pushPoint(arr: PathPoint[], x: number, z: number): void {
  if (arr.length > 0) {
    const last = arr[arr.length - 1];
    const dx = last.x - x;
    const dz = last.z - z;
    if (dx * dx + dz * dz < 1e-6) return; // (1e-3)^2
  }
  arr.push({ x, z });
}
