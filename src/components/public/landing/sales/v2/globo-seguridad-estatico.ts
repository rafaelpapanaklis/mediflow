/**
 * Globo ESTÁTICO de la franja de seguridad (11-oct-2026, ws1-t10).
 *
 * El mismo cuadro que pinta el motor del canvas con «reducir movimiento»
 * (globo-seguridad-motor.ts, `quieto`: México de frente, ángulo 100°), pero
 * como SVG: la tierra firme en cinco capas de profundidad, los arcos entre
 * ciudades y los puntos de las ciudades. Sin pulsos ni latidos.
 *
 * Para qué: en Safari de iPad/iPhone (WebKit táctil) la franja no monta el
 * canvas ni anima nada —ahí parpadeaba al hacer scroll—, y en su lugar muestra
 * esta imagen (`public/landing/seguridad/globo.svg`, generada con
 * `npx tsx scripts/landing-globo-estatico.ts`). La prueba
 * __tests__/globo-seguridad-estatico.test.ts comprueba que el archivo
 * publicado es exactamente lo que genera esta función.
 *
 * Misma caja que el SVG del mar (franja-seguridad.tsx): 240 × 240, disco de
 * radio 100 en (120, 120); la imagen se coloca con `inset: 0` sobre el globo
 * igual que el canvas.
 */
import { ANGULO_QUIETO, ARCOS, INCLINACION, NODOS, RAD, arco, puntosDeTierra, vector } from "./globo-seguridad-motor";

const CAJA = 240;
const CENTRO = CAJA / 2;
const RADIO = 100;
/** Unidades de la caja por px CSS cuando el globo mide 292 px (escritorio). */
const UNIDAD = CAJA / 292;

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

export function svgGloboEstatico(): string {
  const tierra = puntosDeTierra();
  const total = tierra.length / 3;
  const giro = ANGULO_QUIETO;
  const cg = Math.cos(giro);
  const sg = Math.sin(giro);
  const ct = Math.cos(INCLINACION);
  const st = Math.sin(INCLINACION);
  const proyectar = (x: number, y: number, z: number) => {
    const x1 = x * cg + z * sg;
    const z1 = -x * sg + z * cg;
    return { sx: CENTRO + x1 * RADIO, sy: CENTRO - (y * ct - z1 * st) * RADIO, z2: y * st + z1 * ct, x1, y2: y * ct - z1 * st };
  };

  // ── Tierra firme: cinco capas, de atrás hacia delante (como el canvas) ──
  const radio = Math.max(0.8, RADIO * 0.0125);
  const capas: string[] = [];
  for (let capa = 0; capa < 5; capa++) {
    const desde = capa / 5;
    const hasta = desde + 0.2;
    const alfa = 0.3 + 0.7 * (desde + 0.1);
    const r = radio * (0.72 + 0.28 * (desde + 0.1));
    let d = "";
    for (let i = 0; i < total; i++) {
      const p = proyectar(tierra[i * 3], tierra[i * 3 + 1], tierra[i * 3 + 2]);
      if (p.z2 <= desde || p.z2 > hasta) continue;
      d += `M${n1(p.sx)} ${n1(p.sy)}h.01`;
    }
    if (d) capas.push(`<path d="${d}" stroke="url(#dcsg-tinta)" stroke-width="${n2(r * 2)}" opacity="${n2(alfa)}"/>`);
  }

  // ── Arcos entre ciudades (solo los tramos que miran hacia acá) ──
  const nodos = NODOS.map(([lat, lon]) => vector(lat, lon));
  let arcos = "";
  for (const [a, b] of ARCOS) {
    const p = arco(nodos[a], nodos[b]);
    let abierto = false;
    for (let i = 0; i * 3 < p.length; i++) {
      const q = proyectar(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      const visible = q.z2 > 0 || q.x1 * q.x1 + q.y2 * q.y2 > 1;
      if (!visible) { abierto = false; continue; }
      arcos += `${abierto ? "L" : "M"}${n1(q.sx)} ${n1(q.sy)}`;
      abierto = true;
    }
  }

  // ── Ciudades: punto fijo (sin latido) ──
  let ciudades = "";
  nodos.forEach(([x, y, z], n) => {
    const p = proyectar(x, y, z);
    if (p.z2 <= 0.05) return;
    const casa = n === 0;
    const visible = Math.min(1, p.z2 * 3);
    ciudades += `<circle cx="${n1(p.sx)}" cy="${n1(p.sy)}" r="${n2((casa ? 2.8 : 1.9) * UNIDAD)}" fill="#fff" fill-opacity="${n2(visible)}"/>`;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CAJA} ${CAJA}" width="${CAJA}" height="${CAJA}" fill="none">` +
    `<defs><linearGradient id="dcsg-tinta" x1="0.1" y1="0.1" x2="0.9" y2="0.9">` +
    `<stop offset="0" stop-color="#a5d0ff"/><stop offset="0.55" stop-color="#bfc8ff"/><stop offset="1" stop-color="#cdb8ff"/>` +
    `</linearGradient></defs>` +
    `<g stroke-linecap="round">${capas.join("")}</g>` +
    `<path d="${arcos}" stroke="#93c5fd" stroke-opacity="0.42" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g>${ciudades}</g>` +
    `</svg>\n`
  );
}

/** Ruta pública de la imagen (la referencia globo-seguridad-vivo.tsx). */
export const RUTA_GLOBO_ESTATICO = "/landing/seguridad/globo.svg";

/** Pequeño chequeo: cuántos puntos de tierra, arcos y ciudades lleva el SVG. */
export function resumenGloboEstatico(svg: string): { puntos: number; capas: number; ciudades: number; bytes: number } {
  return {
    puntos: (svg.match(/h\.01/g) || []).length,
    capas: (svg.match(/stroke="url\(#dcsg-tinta\)"/g) || []).length,
    ciudades: (svg.match(/<circle /g) || []).length,
    bytes: Buffer.byteLength(svg, "utf8"),
  };
}
