// ─────────────────────────────────────────────────────────────────────────────
// A1 — Parser layout → mundo. Función PURA (sin three). Convierte el layout del
// editor 2.5D en un WorldModel listo para construir en 3D.
//
// TODO(A1): implementar parseLayoutToWorld según este brief.
//
// ENTRADA: { elements (ya saneados), metadata, chairs (Resources id/name/color),
//   category, clinicName }.
//
// PASOS:
// 1) Grid: cols/rows desde metadata.gridSize ?? {DEFAULT_GRID_COLS,ROWS}. Clamp a
//    [1, 200] por seguridad (datos legacy).
// 2) Por cada element: footprintFor(type, rotation) → {baseCols, baseRows, cols,
//    rows}. center = { x: col + cols/2, z: row + rows/2 }. rotationRad =
//    rotationToRadians(rotation). Flags: isWall=isWallType, isDoor=isDoorType,
//    isWindow=isWindowType, isChair=isChairType. blocks = isWall || (mobiliario:
//    NO wall/door/window). Puertas y ventanas NO bloquean (se atraviesan / son
//    huecos). Empuja a WorldElement[].
//    - Descarta elementos fuera de toda la grilla (col/row negativos enormes):
//      acéptalos si intersectan [0,cols]×[0,rows]; si no, ignóralos.
// 3) Ocupación blocked[row][col] (matriz rows×cols de false): por cada element
//    con blocks=true, marca todas las celdas de su rectángulo [col,col+cols) ×
//    [row,row+rows) que caigan dentro de la grilla. Las puertas, además, deben
//    "perforar" el muro: NO se marca su rectángulo (ya blocks=false). Resultado:
//    se puede cruzar por las puertas.
// 4) bounds: bounding box de TODOS los elements (min col/row, max col+cols /
//    row+rows) + 1 celda de margen, clamp a [0,cols]×[0,rows]. Si no hay
//    elements → isEmpty=true y bounds = grilla completa.
// 5) chairs (WorldChairAnchor[]): por cada element con isChair && resourceId,
//    busca en input.chairs el Resource (name/color); name = resource?.name ??
//    element.name ?? "Sillón"; color = resource?.color ?? null. center/rotation
//    como el element. (Sillones sin resourceId se ignoran como ancla viva pero
//    SÍ se dibujan como mueble por el builder.)
// 6) spawn: si hay alguna puerta (DOOR_TYPES), spawnear ~1.2m hacia el interior
//    desde su centro (hacia el centro de bounds), angle mirando al interior. Si
//    no hay puerta, usar el centro de bounds buscando una celda NO bloqueada
//    cercana (espiral simple); angle = 0. Garantiza que spawn NO cae en celda
//    bloqueada (si cae, empuja a la celda libre más cercana).
// 7) isEmpty = elements.length === 0.
//
// Robustez: NUNCA lanzar. Cualquier dato raro se ignora. tsconfig no-strict.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_GRID_COLS,
  DEFAULT_GRID_ROWS,
  footprintFor,
  isChairType,
  isDoorType,
  isWallType,
  isWindowType,
  rotationToRadians,
  type LayoutElement,
  type LayoutMetadata,
  type Rotation,
  type WorldChairAnchor,
  type WorldElement,
  type WorldModel,
} from "./world-types";

export interface ParseInput {
  elements: LayoutElement[];
  metadata: LayoutMetadata | null;
  chairs: { id: string; name: string; color: string | null }[];
  category: string;
  clinicName: string;
}

/** Entero finito acotado a [lo, hi]; cualquier dato raro cae a `fallback`. */
function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Normaliza una rotación legacy al set {0,90,180,270}. */
function normalizeRotation(rotation: unknown): Rotation {
  const n = Math.round(Number(rotation));
  if (!Number.isFinite(n)) return 0;
  const r = (((n % 360) + 360) % 360) as number;
  if (r === 90) return 90;
  if (r === 180) return 180;
  if (r === 270) return 270;
  return 0;
}

export function parseLayoutToWorld(input: ParseInput): WorldModel {
  // ── 0) Saneo defensivo de la entrada ──────────────────────────────────────
  const rawElements: LayoutElement[] = Array.isArray(input?.elements) ? input.elements : [];
  const chairResources = Array.isArray(input?.chairs) ? input.chairs : [];
  const category = typeof input?.category === "string" ? input.category : "";
  const clinicName = typeof input?.clinicName === "string" ? input.clinicName : "";

  // ── 1) Grid ───────────────────────────────────────────────────────────────
  const gridSize = input?.metadata?.gridSize;
  const cols = clampInt(gridSize?.cols, 1, 200, DEFAULT_GRID_COLS);
  const rows = clampInt(gridSize?.rows, 1, 200, DEFAULT_GRID_ROWS);

  // ── 2) Elementos → WorldElement[] ─────────────────────────────────────────
  const elements: WorldElement[] = [];
  for (const el of rawElements) {
    if (!el || typeof el.type !== "string") continue;
    const type = el.type;
    const rotation = normalizeRotation(el.rotation);
    // col/row pueden ser legacy raros; los aceptamos como números finitos
    // (sin clamp todavía: necesitamos saber si intersectan la grilla).
    const col = Math.round(Number(el.col));
    const row = Math.round(Number(el.row));
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;

    const fp = footprintFor(type, rotation); // ya hace el swap en 90/270
    const elCols = fp.cols > 0 ? fp.cols : 1;
    const elRows = fp.rows > 0 ? fp.rows : 1;

    // Descartar elementos que NO intersectan [0,cols]×[0,rows].
    const intersects =
      col < cols && col + elCols > 0 && row < rows && row + elRows > 0;
    if (!intersects) continue;

    const isWall = isWallType(type);
    const isDoor = isDoorType(type);
    const isWindow = isWindowType(type);
    const isChair = isChairType(type);
    // Bloquean: muros y mobiliario (todo lo que NO sea muro/puerta/ventana).
    // Puertas y ventanas se atraviesan / son huecos → NO bloquean.
    const blocks = isWall || (!isDoor && !isWindow);

    const idNum = Number(el.id);
    elements.push({
      id: Number.isFinite(idNum) ? idNum : 0,
      type,
      name: el.name ?? null,
      resourceId: el.resourceId ?? null,
      rotation,
      rotationRad: rotationToRadians(rotation),
      col,
      row,
      baseCols: fp.baseCols,
      baseRows: fp.baseRows,
      cols: elCols,
      rows: elRows,
      center: { x: col + elCols / 2, z: row + elRows / 2 },
      isWall,
      isDoor,
      isWindow,
      isChair,
      blocks,
    });
  }

  // ── 3) Ocupación blocked[row][col] ────────────────────────────────────────
  const blocked: boolean[][] = Array.from({ length: rows }, () =>
    Array<boolean>(cols).fill(false),
  );
  for (const e of elements) {
    if (!e.blocks) continue; // puertas/ventanas no marcan → se cruzan
    const c0 = Math.max(0, e.col);
    const r0 = Math.max(0, e.row);
    const c1 = Math.min(cols, e.col + e.cols);
    const r1 = Math.min(rows, e.row + e.rows);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) blocked[r][c] = true;
    }
  }

  // ── 4) bounds: bbox de TODOS los elements + 1 celda de margen ─────────────
  const isEmpty = elements.length === 0;
  let bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  if (isEmpty) {
    bounds = { minX: 0, maxX: cols, minZ: 0, maxZ: rows };
  } else {
    let minCol = Infinity;
    let minRow = Infinity;
    let maxCol = -Infinity;
    let maxRow = -Infinity;
    for (const e of elements) {
      if (e.col < minCol) minCol = e.col;
      if (e.row < minRow) minRow = e.row;
      if (e.col + e.cols > maxCol) maxCol = e.col + e.cols;
      if (e.row + e.rows > maxRow) maxRow = e.row + e.rows;
    }
    bounds = {
      minX: Math.max(0, minCol - 1),
      maxX: Math.min(cols, maxCol + 1),
      minZ: Math.max(0, minRow - 1),
      maxZ: Math.min(rows, maxRow + 1),
    };
  }

  // ── 5) chairs (WorldChairAnchor[]) ────────────────────────────────────────
  const resourceById = new Map<string, { id: string; name: string; color: string | null }>();
  for (const r of chairResources) {
    if (r && typeof r.id === "string") resourceById.set(r.id, r);
  }
  const chairs: WorldChairAnchor[] = [];
  for (const e of elements) {
    if (!e.isChair || !e.resourceId) continue; // sillón sin resource: solo mueble
    const resource = resourceById.get(e.resourceId);
    chairs.push({
      elementId: e.id,
      resourceId: e.resourceId,
      name: resource?.name ?? e.name ?? "Sillón",
      color: resource?.color ?? null,
      center: e.center,
      rotation: e.rotation,
      rotationRad: e.rotationRad,
    });
  }

  // ── 6) spawn ──────────────────────────────────────────────────────────────
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  /** ¿La celda (col,row) está dentro de la grilla y libre? */
  const isFreeCell = (c: number, r: number): boolean => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    return !blocked[r][c];
  };

  /** Celda libre más cercana a (cx,cz) por búsqueda en espiral; null si ninguna. */
  const nearestFreeCell = (cx: number, cz: number): { c: number; r: number } | null => {
    const sc = clampInt(Math.floor(cx), 0, cols - 1, 0);
    const sr = clampInt(Math.floor(cz), 0, rows - 1, 0);
    if (isFreeCell(sc, sr)) return { c: sc, r: sr };
    const maxRadius = Math.max(cols, rows);
    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          // solo el anillo exterior de este radio
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const c = sc + dc;
          const r = sr + dr;
          if (isFreeCell(c, r)) return { c, r };
        }
      }
    }
    return null;
  };

  let spawn: { x: number; z: number; angle: number };
  const door = elements.find((e) => e.isDoor);
  if (door) {
    // Vector desde la puerta hacia el interior (centro de bounds).
    let dx = centerX - door.center.x;
    let dz = centerZ - door.center.z;
    let len = Math.hypot(dx, dz);
    if (!Number.isFinite(len) || len < 1e-6) {
      // Puerta justo en el centro: empuja según su orientación (eje corto).
      // wall_h/puerta horizontal ocupa más en X → entra por Z; y viceversa.
      dx = e_short_axis_x(door);
      dz = e_short_axis_z(door);
      len = Math.hypot(dx, dz) || 1;
    }
    const ux = dx / len;
    const uz = dz / len;
    let sx = door.center.x + ux * 1.2;
    let sz = door.center.z + uz * 1.2;
    // angle = yaw de cámara para MIRAR hacia el interior. El orquestador hace
    // camera.rotation.y = spawn.angle (orden YXZ) y la cámara apunta a -Z por
    // defecto, así que su dirección de vista es (-sin yaw, 0, -cos yaw). Para
    // que esa dirección iguale el vector interior (ux, uz) hay que resolver
    // -sin=ux, -cos=uz → yaw = atan2(-ux, -uz). (No es atan2(x,z): eso miraría
    // hacia AFUERA, contra el muro/puerta.)
    const angle = Math.atan2(-ux, -uz);
    // Garantizar celda libre.
    if (!isFreeCell(Math.floor(sx), Math.floor(sz))) {
      const free = nearestFreeCell(sx, sz) ?? nearestFreeCell(centerX, centerZ);
      if (free) {
        sx = free.c + 0.5;
        sz = free.r + 0.5;
      }
    }
    spawn = { x: sx, z: sz, angle };
  } else {
    const free = nearestFreeCell(centerX, centerZ);
    if (free) {
      spawn = { x: free.c + 0.5, z: free.r + 0.5, angle: 0 };
    } else {
      // Todo bloqueado o grilla vacía: cae al centro de bounds.
      spawn = { x: centerX, z: centerZ, angle: 0 };
    }
  }

  return {
    clinicName,
    category,
    cols,
    rows,
    bounds,
    elements,
    chairs,
    blocked,
    spawn,
    isEmpty,
  };
}

/** Eje corto en X de un elemento (1 si es "alto"/vertical, 0 si es "ancho"). */
function e_short_axis_x(e: WorldElement): number {
  return e.cols <= e.rows ? 0 : 1;
}
/** Eje corto en Z de un elemento (1 si es "ancho"/horizontal, 0 si "alto"). */
function e_short_axis_z(e: WorldElement): number {
  return e.rows < e.cols ? 0 : 1;
}
