// ═══════════════════════════════════════════════════════════════════════════
// Las FILAS «por doctor» completas (ws1-t2, auditoría de uso C-09 y C-10).
// Parte PURA: sin Prisma ni red (src/lib/dinero/__tests__/por-doctor.test.ts).
//
// `ingresosPorDoctorDelPeriodo` (ingresos.server.ts) reparte TODO el ingreso
// del periodo: cada doctor y, con la clave `null`, lo que no es de nadie. La
// suma es el ingreso por construcción. Pero cada pantalla pintaba solo SU
// lista de personas (Inicio: los doctores activos; Analítica y la nómina: los
// activos con rol de doctor o administrador) y perdía en silencio:
//   · la fila «Sin doctor» (cobros cuya factura y cita no tienen doctor);
//   · el dinero de quien ya no está en esa lista (un doctor dado de baja, o
//     una factura a nombre de alguien con otro rol).
// Así la Analítica decía «la misma cifra que Finanzas» y sumaba $1,750 menos.
// Aquí se decide qué filas faltan, para que las tres pantallas sumen lo mismo
// que «Por doctor» de Finanzas.
// ═══════════════════════════════════════════════════════════════════════════

import type { IngresoDeDoctor } from "./ingresos";

/** Id de la fila «Sin doctor» (el mismo que usa «Por doctor» de Finanzas). */
export const ID_SIN_DOCTOR = "sin-doctor";

/** Nombre de la fila «Sin doctor» (el mismo que usa «Por doctor» de Finanzas). */
export const NOMBRE_SIN_DOCTOR = "Sin doctor";

const aCentavos = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100);

/**
 * Las personas con ingreso en el periodo que NO están en la lista que la
 * pantalla ya pinta: hay que leerlas y añadirlas, o su dinero desaparece.
 * Sin la clave `null` (esa es la fila «Sin doctor»). Orden estable.
 */
export function idsConIngresoFueraDeLista(
  idsDeLaLista: Iterable<string>,
  porDoctor: ReadonlyMap<string | null, IngresoDeDoctor>,
): string[] {
  const enLista = new Set(idsDeLaLista);
  const fuera: string[] = [];
  for (const [id, v] of porDoctor) {
    if (id === null || enLista.has(id)) continue;
    if (aCentavos(v.total) === 0 && aCentavos(v.orto) === 0) continue;
    fuera.push(id);
  }
  return fuera.sort();
}

/**
 * Lo de la fila «Sin doctor», o `null` si no hay nada que enseñar. Un neto
 * negativo (un reembolso sin doctor) también se enseña: si no, la suma de la
 * lista no daría el ingreso.
 */
export function ingresoSinDoctor(porDoctor: ReadonlyMap<string | null, IngresoDeDoctor>): IngresoDeDoctor | null {
  const v = porDoctor.get(null);
  if (!v || aCentavos(v.total) === 0) return null;
  return { total: v.total, orto: v.orto };
}

/** Suma en pesos (en centavos por dentro) de una lista de importes. */
export function sumaDeIngresos(importes: Iterable<number>): number {
  let c = 0;
  for (const n of importes) c += aCentavos(n);
  return c / 100;
}
