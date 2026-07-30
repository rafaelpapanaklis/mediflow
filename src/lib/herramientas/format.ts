// ─────────────────────────────────────────────────────────────────────────────
// Formateo y parseo para las herramientas públicas.
//
// Módulo puro (sin "use server" ni React): lo importan los componentes cliente
// de /herramientas y también sirve en server components. Todo en es-MX y MXN.
//
// Los formatters se crean una vez a nivel de módulo — construir un
// Intl.NumberFormat en cada tecleo es caro y aquí los resultados se recalculan
// en vivo con cada cambio de input.
// ─────────────────────────────────────────────────────────────────────────────

const MXN_0 = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const MXN_2 = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM_0 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const NUM_1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** $1,234 — pesos sin centavos (el default: en un tablero los centavos estorban). */
export function mxn(value: number): string {
  return MXN_0.format(safe(value));
}

/** $1,234.56 — para márgenes por tratamiento, donde los centavos sí importan. */
export function mxn2(value: number): string {
  return MXN_2.format(safe(value));
}

/** 1,234 — enteros (citas, tratamientos). */
export function num(value: number): string {
  return NUM_0.format(safe(value));
}

/** 1,2 — un decimal (equivalentes por semana o por día). */
export function num1(value: number): string {
  return NUM_1.format(safe(value));
}

/**
 * Parsea lo que el usuario teclea. Los inputs guardan STRING (no number) para
 * que se pueda borrar el campo sin que quede un "0" pegajoso; el cálculo usa
 * este parseo, que tolera comas de miles, espacios y el signo de pesos.
 */
export function parseNum(raw: string, fallback = 0): number {
  if (raw == null) return fallback;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/** Igual que parseNum pero nunca negativo — ningún input de estas herramientas lo admite. */
export function parsePositive(raw: string, fallback = 0): number {
  return Math.max(0, parseNum(raw, fallback));
}

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
