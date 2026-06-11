// ─────────────────────────────────────────────────────────────────────────────
// MI CLÍNICA 3D — CONTRATO ÚNICO (sin three, sin "use client").
// Fuente de verdad compartida por el parser, los builders, los controles, la
// capa viva, el HUD, el orquestador y la API /api/clinic-layout/3d-state.
//
// El mundo 3D se construye a partir del MISMO layout que el editor 2.5D
// (Mi Clínica Visual). Convención (top-down → 3D, IGNORAMOS la proyección
// isométrica de pantalla): 1 celda de grilla = 1 metro; world.x = col,
// world.z = row; rotación del elemento = rotación en Y en pasos de 90°.
//
// Este archivo NO importa three (lo consume la API server-side) — solo tipos,
// constantes, paletas y helpers de footprint que leen el catálogo real.
// ─────────────────────────────────────────────────────────────────────────────

import { getElementTypesForClinic } from "@/lib/floor-plan/elements";
import type {
  LayoutElement,
  LayoutMetadata,
  Rotation,
  ChairStatus,
} from "@/lib/floor-plan/element-types";

export type { LayoutElement, LayoutMetadata, Rotation, ChairStatus };

// ── Constantes del mundo ─────────────────────────────────────────────────────
export const CELL = 1;             // 1 celda = 1 metro
export const WALL_HEIGHT = 2.6;    // altura de muro (m)
export const WALL_THICKNESS = 0.12;
export const EYE_HEIGHT = 1.6;     // altura de ojos del jugador (m)
export const PLAYER_RADIUS = 0.3;  // radio de la cápsula del jugador (m)
export const WALK_SPEED = 4;       // m/s
export const SLOW_SPEED = 1.8;     // m/s con Shift
export const POLL_MS = 20_000;     // refresco de estado vivo

export const DEFAULT_GRID_COLS = 32;
export const DEFAULT_GRID_ROWS = 24;

// ── Clasificación de tipos (keys estables del catálogo) ──────────────────────
export const WALL_TYPES: ReadonlySet<string> = new Set(["wall_h", "wall_v"]);
export const DOOR_TYPES: ReadonlySet<string> = new Set(["puerta", "puerta_bano"]);
export const WINDOW_TYPES: ReadonlySet<string> = new Set(["ventana"]);

export function isWallType(type: string): boolean {
  return WALL_TYPES.has(type);
}
export function isDoorType(type: string): boolean {
  return DOOR_TYPES.has(type);
}
export function isWindowType(type: string): boolean {
  return WINDOW_TYPES.has(type);
}

// ── Footprints desde el catálogo real (sin drift) ────────────────────────────
interface CatalogInfo {
  w: number;
  h: number;
  label: string;
  isChair: boolean;
}
let _catalog: Map<string, CatalogInfo> | null = null;
function catalog(): Map<string, CatalogInfo> {
  if (_catalog) return _catalog;
  const m = new Map<string, CatalogInfo>();
  try {
    for (const t of getElementTypesForClinic("DENTAL")) {
      m.set(t.key, { w: t.w, h: t.h, label: t.label, isChair: !!t.isChair });
    }
  } catch {
    /* si el catálogo falla, los tipos caen a 1×1 genérico (nunca crashea) */
  }
  _catalog = m;
  return m;
}

/** Info del catálogo para un type; null si es desconocido (legacy/nuevo). */
export function getCatalogInfo(type: string): CatalogInfo | null {
  return catalog().get(type) ?? null;
}

export function isChairType(type: string): boolean {
  return getCatalogInfo(type)?.isChair ?? type === "sillon";
}

/** Label legible del tipo (para placas de cajas genéricas/desconocidas). */
export function typeLabel(type: string): string {
  return getCatalogInfo(type)?.label ?? type;
}

/**
 * Footprint de un elemento. `baseCols/baseRows` = catálogo sin rotar (cómo se
 * DIBUJA la malla: X=baseCols, Z=baseRows). `cols/rows` = celdas OCUPADAS tras
 * rotar (para colisión/ocupación: en 90°/270° se intercambian). Tipo
 * desconocido → 1×1. El centro de la malla coincide con el centro del
 * rectángulo ocupado, así una malla base rotada 90° calza con la ocupación.
 */
export function footprintFor(type: string, rotation: Rotation): {
  baseCols: number;
  baseRows: number;
  cols: number;
  rows: number;
} {
  const info = getCatalogInfo(type);
  const baseCols = info?.w ?? 1;
  const baseRows = info?.h ?? 1;
  const swap = rotation === 90 || rotation === 270;
  return {
    baseCols,
    baseRows,
    cols: swap ? baseRows : baseCols,
    rows: swap ? baseCols : baseRows,
  };
}

/** Rotación en radianes alrededor de Y (negativa: grilla horaria → three). */
export function rotationToRadians(rotation: Rotation): number {
  return (-rotation * Math.PI) / 180;
}

// ── Modelo de mundo (salida del parser, entrada de los builders) ─────────────

/** Un elemento ya colocado en coordenadas de mundo. */
export interface WorldElement {
  id: number;
  type: string;
  name: string | null;
  resourceId: string | null;
  rotation: Rotation;
  rotationRad: number;
  /** Celda origen (esquina) en grilla. */
  col: number;
  row: number;
  /** Footprint sin rotar (para dibujar la malla). */
  baseCols: number;
  baseRows: number;
  /** Footprint ocupado tras rotar (para colisión). */
  cols: number;
  rows: number;
  /** Centro del footprint en mundo (x = eje col, z = eje row), y=0 en el piso. */
  center: { x: number; z: number };
  isWall: boolean;
  isDoor: boolean;
  isWindow: boolean;
  isChair: boolean;
  /** Si bloquea el paso (muros y mobiliario sí; puertas/ventanas no). */
  blocks: boolean;
}

/** Ancla de un sillón vivo (avatares + anillo + placa van aquí). */
export interface WorldChairAnchor {
  elementId: number;
  resourceId: string;
  name: string;
  color: string | null;
  center: { x: number; z: number };
  rotation: Rotation;
  rotationRad: number;
}

export interface WorldModel {
  clinicName: string;
  category: string;
  cols: number;
  rows: number;
  /** Límites caminables en mundo (bounding box de lo construido + margen). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  elements: WorldElement[];
  chairs: WorldChairAnchor[];
  /** Ocupación para colisión: blocked[row][col] = true → celda bloqueada. */
  blocked: boolean[][];
  /** Punto de aparición: en la puerta principal si existe; si no, borde libre. */
  spawn: { x: number; z: number; angle: number };
  /** true si no hay nada que renderizar (mostrar "diseña tu clínica primero"). */
  isEmpty: boolean;
}

// ── Estado vivo (payload de la API + consumo de la capa viva) ────────────────

export type ChairLiveStatus = ChairStatus; // "libre" | "proximo" | "ocupado"

export interface Chair3DState {
  elementId: number | null;
  resourceId: string;
  name: string;
  color: string | null;
  status: ChairLiveStatus;
  patientName?: string | null;
  doctorName?: string | null;
  /** ID del paciente de la cita activa (v2: click→expediente). Solo si ocupado. */
  patientId?: string | null;
  appointmentEndsAt?: string | null; // ISO
  /** v3 — Inicio de la cita activa (para la barra de progreso). Solo si ocupado. */
  appointmentStartsAt?: string | null; // ISO
}

export interface Clinic3DStatePayload {
  clinicName: string;
  category: string;
  layout: { elements: LayoutElement[]; metadata: LayoutMetadata | null };
  chairs: Chair3DState[];
  /** v2 — Identidad del usuario de la sesión (para presence multijugador). */
  viewer?: { name: string; role: string };
  /** v2 — Nombre de canal Realtime por clínica = `c3d:<hmac>`. null = sin multijugador. */
  presenceChannel?: string | null;
  /** v3 — Pacientes en sala de espera (citas CHECKED_IN), en orden de llegada. */
  waiting?: WaitingPatient[];
}

// ── Paleta por categoría de clínica (tonos claros tipo clínica real) ─────────

export interface WorldPalette {
  floorA: string;     // tile A
  floorB: string;     // tile B (damero sutil)
  wall: string;       // muro
  baseboard: string;  // zócalo
  ceiling: string;
  accent: string;     // acento (puertas, detalles)
  fog: string;        // color de niebla/fondo
}

const CLINICAL: WorldPalette = {
  floorA: "#eef2f6",
  floorB: "#e3e9ef",
  wall: "#f6f8fa",
  baseboard: "#c9d2db",
  ceiling: "#fafbfc",
  accent: "#7c3aed",
  fog: "#dfe6ee",
};

/** Overrides por categoría; el resto usa CLINICAL. */
export const WORLD_PALETTE: Record<string, WorldPalette> = {
  DENTAL: { ...CLINICAL, accent: "#2563eb", fog: "#dde7f1" },
  AESTHETIC_MEDICINE: { ...CLINICAL, floorA: "#f7f1f4", floorB: "#efe6ec", accent: "#db2777", fog: "#ecdfe7" },
  BEAUTY_CENTER: { ...CLINICAL, floorA: "#f8f2ef", floorB: "#efe5df", accent: "#e11d48", fog: "#ece0d9" },
  SPA: { ...CLINICAL, floorA: "#eef4f1", floorB: "#e0ebe5", accent: "#0d9488", fog: "#dcebe4" },
  HAIR_SALON: { ...CLINICAL, accent: "#9333ea", fog: "#e6e0ee" },
  PSYCHOLOGY: { ...CLINICAL, floorA: "#f1f0f7", floorB: "#e6e4f1", accent: "#6d28d9", fog: "#e3e0ef" },
  PHYSIOTHERAPY: { ...CLINICAL, floorA: "#eef3f7", floorB: "#e1ebf1", accent: "#0284c7", fog: "#dce8f1" },
  NUTRITION: { ...CLINICAL, floorA: "#f0f5ee", floorB: "#e4ede0", accent: "#16a34a", fog: "#e1ebdc" },
};

export function getPalette(category: string): WorldPalette {
  return WORLD_PALETTE[category] ?? CLINICAL;
}

export const STATUS_RING_COLOR: Record<ChairLiveStatus, string> = {
  libre: "#10B981",
  proximo: "#F59E0B",
  ocupado: "#EF4444",
};

// ═════════════════════════════════════════════════════════════════════════════
// V2 — MULTIJUGADOR, INTERACCIÓN, DÍA/NOCHE, MINIMAPA (contrato compartido).
// ═════════════════════════════════════════════════════════════════════════════

// ── Multijugador (Supabase Realtime presence + broadcast) ────────────────────
export const POS_HZ = 10;            // máx broadcasts de posición por segundo
export const POS_MIN_MOVE = 0.05;    // m: umbral de movimiento para re-enviar
export const POS_MIN_YAW = 0.03;     // rad: umbral de giro para re-enviar
export const LERP_MS = 150;          // suavizado de avatares remotos
export const REMOTE_TIMEOUT_MS = 15_000; // sin señal → quitar avatar

/** Metadata de presencia que cada quien publica al entrar. */
export interface PresenceMeta {
  name: string;
  color: string;
}

/** Carga del broadcast "pos" (10 Hz, solo si cambió). */
export interface PosBroadcast {
  x: number;
  z: number;
  yaw: number;
}

/** Estado de un jugador remoto que consume la capa de avatares remotos. */
export interface RemotePlayerState {
  id: string;       // presence key (estable por sesión)
  name: string;
  color: string;
  x: number;
  z: number;
  yaw: number;
  t: number;        // timestamp del último update (para timeout/interp)
}

// ── Interacción (raycast click→expediente) ───────────────────────────────────
export const INTERACT_RANGE = 6;     // m: alcance para apuntar a un avatar

// ── Puertas animadas (juice visual; la celda puerta ya no colisiona) ─────────
export const DOOR_OPEN_DIST = 1.5;   // m: alguien cerca → abre
export const DOOR_OPEN_ANGLE = (80 * Math.PI) / 180; // 80° de apertura
export const DOOR_ANIM_SPEED = 4;    // rad/s del lerp de apertura

// ── Día / noche (por hora local; cae a valores cálidos de juego casual) ──────
export const NIGHT_START_HOUR = 19;
export const NIGHT_END_HOUR = 7;
export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

// ── Minimapa (datos por frame que el orquestador escribe y el HUD dibuja) ────
export interface MinimapFrame {
  px: number;
  pz: number;
  yaw: number;
  players: { x: number; z: number; color: string }[];
  chairs: { x: number; z: number; status: ChairLiveStatus }[];
}

// ── Color estable derivado del nombre (mismo color para todos los que te ven) ─
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** Hash determinista nombre → color HSL agradable (saturación/brillo fijos). */
export function colorFromName(name: string): string {
  const s = (name || "?").trim() || "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 62, 56);
}

// ═════════════════════════════════════════════════════════════════════════════
// V3 — INTERACCIÓN: sala de espera viva + llamado animado, barras de progreso,
// click en sillón vacío → agendar. Contrato compartido (sin three). Lo consumen
// waiting-layer, pathfinding, progress-bars, interaction, live-layer, el HUD, el
// orquestador y la API /api/clinic-layout/3d-state.
// ═════════════════════════════════════════════════════════════════════════════

// ── Sala de espera viva ──────────────────────────────────────────────────────
/** Plazas por tipo de mueble de espera (keys REALES del catálogo dental). */
export const WAITING_SEAT_CAPACITY: Record<string, number> = {
  silla_espera: 1, // 1×1, una plaza
  banca: 3,        // 3×1, "Banca 3P"
};
/** Nº de plazas de un tipo de mueble (0 si no es mueble de espera). */
export function seatCapacityFor(type: string): number {
  return WAITING_SEAT_CAPACITY[type] ?? 0;
}
/** ¿El tipo es mobiliario de sala de espera (tiene plazas)? */
export function isWaitingSeatType(type: string): boolean {
  return seatCapacityFor(type) > 0;
}

/** Un paciente en sala de espera (cita CHECKED_IN) — entrada del payload de la API. */
export interface WaitingPatient {
  appointmentId: string;
  patientName: string;
  /** resourceId del sillón destino si la cita lo tiene; null si aún no asignado. */
  resourceId: string | null;
}

// ── Llamado animado (el paciente se levanta y camina del asiento al sillón) ───
export const AVATAR_WALK_SPEED = 1.2;    // m/s del paciente caminando
export const WALKER_FADE_MS = 400;       // ms de fade-in/out del walker
export const WALKER_ARRIVE_DIST = 0.4;   // m: umbral de "llegó" al destino
export const WALK_BOB_HZ = 1.9;          // ciclos/s del balanceo de piernas/brazos

// ── Barras de progreso sobre sillones ocupados ───────────────────────────────
export const PROGRESS_BAR_WIDTH = 1.2;   // m de ancho del billboard (discreto)
export const PROGRESS_BAR_HEIGHT = 0.14; // m de alto de la barra
export const PROGRESS_BAR_Y = 2.5;       // alto flotante (sobre la placa a 2.1 m)
export const PROGRESS_OVERTIME_HZ = 1.2; // pulsos/s cuando se pasó del fin
export const PROGRESS_FILL = "#38bdf8";       // sky-400: avance normal
export const PROGRESS_FILL_NEAR = "#f59e0b";  // ámbar: >80% del tiempo
export const PROGRESS_FILL_OVER = "#ef4444";  // rojo: sobretiempo (pulsa)

// ── Agendar (click en sillón vacío → modal de nueva cita preseleccionado) ────
export const AGENDA_PATH = "/dashboard/appointments";
/** URL de la agenda con el modal de nueva cita abierto y el sillón preseleccionado. */
export function agendaNewApptUrl(resourceId: string): string {
  return `${AGENDA_PATH}?new=1&resourceId=${encodeURIComponent(resourceId)}`;
}
