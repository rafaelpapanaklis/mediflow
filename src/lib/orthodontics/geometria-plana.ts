// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026).
// Geometría plana pura, compartida por cefalometría (H1/H3/H4) y análisis
// facial en fotos (H5). Coordenadas en px de imagen (el signo del eje Y no
// importa: solo se usan productos punto/cruz, que son consistentes en
// cualquier convención de ejes). Sin dependencias de React ni Prisma.

export interface Point2D {
  x: number;
  y: number;
}

export function vector(a: Point2D, b: Point2D): Point2D {
  return { x: b.x - a.x, y: b.y - a.y };
}

export function length(v: Point2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function distance(a: Point2D, b: Point2D): number {
  return length(vector(a, b));
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

/** Ángulo en grados (0-180) en el vértice `v`, entre los rayos v→p1 y v→p2. */
export function angleAtVertex(v: Point2D, p1: Point2D, p2: Point2D): number {
  const v1 = vector(v, p1);
  const v2 = vector(v, p2);
  const denom = length(v1) * length(v2);
  if (denom === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, dot(v1, v2) / denom));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Ángulo agudo/obtuso (0-180°) entre dos rectas definidas por sus extremos,
 * sin exigir que se toquen (p. ej. plano de Frankfort vs plano mandibular).
 */
export function angleBetweenLines(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): number {
  const v1 = vector(a1, a2);
  const v2 = vector(b1, b2);
  const denom = length(v1) * length(v2);
  if (denom === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, dot(v1, v2) / denom));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Distancia perpendicular con signo de `p` a la recta a→b. El signo indica
 * de qué lado cae `p` (positivo = izquierda de a→b en el sentido del
 * vector), útil para desviaciones de línea media o labios respecto a la
 * línea E sin perder la dirección.
 */
export function signedDistanceToLine(p: Point2D, a: Point2D, b: Point2D): number {
  const ab = vector(a, b);
  const abLen = length(ab);
  if (abLen === 0) return NaN;
  const ap = vector(a, p);
  return cross(ab, ap) / abLen;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convierte una distancia en px a mm usando una calibración px/mm. */
export function pxToMm(px: number, pixelsPerMm: number): number | null {
  if (!pixelsPerMm || pixelsPerMm <= 0) return null;
  return round2(px / pixelsPerMm);
}

/** Rota un vector 90° (perpendicular en el plano). */
function rotate90(v: Point2D): Point2D {
  return { x: -v.y, y: v.x };
}

/**
 * Distancia perpendicular con signo de `p` a la recta que PASA por
 * `through` y es perpendicular a la recta `refA→refB`.
 *
 * Construye esta recta-perpendicular sin necesitar un segundo punto real
 * marcado por el doctor — sirve para "N-perpendicular" de McNamara: la
 * vertical que pasa por Nasion, perpendicular al plano de Frankfort
 * (Or→Po), usada como referencia porque el trazado manual no tiene una
 * vertical verdadera (foto de perfil erguido) disponible.
 */
export function signedDistanceToPerpendicularLine(
  p: Point2D,
  through: Point2D,
  refA: Point2D,
  refB: Point2D,
): number {
  const dir = rotate90(vector(refA, refB));
  if (length(dir) === 0) return NaN;
  const b = { x: through.x + dir.x, y: through.y + dir.y };
  return signedDistanceToLine(p, through, b);
}
