// «Pagado por adelantado» de «Estado de cuenta» (Resumen, lateral y Facturación de la ficha).
//
// v16 (revisión t5 de la v15, m1): desde la v15 la cifra suma también el adelanto de las notas con
// cuotas, que NO está en «Además, $X por hacer». Por eso:
//  · se pinta en su propia línea, después de «cuotas que aún no vencen» (no parece parte de «Además…»);
//  · con Debe > 0 dice lo mismo que la tarjeta, «Además, $Y ya están pagados por adelantado sobre lo
//    hecho» (`planTratamiento.cobro.tambienAdelantoCuotas`). Así no se lee como que el paciente va
//    adelantado mientras debe mensualidades vencidas.

import { fmtMXNdec } from "@/lib/format";

type T = (clave: string, vars?: Record<string, string | number>) => string;

export function textoPagadoPorAdelantado(t: T, monto: number, debe: number): string {
  return t(debe > 0.005 ? "planTratamiento.cobro.tambienAdelantoCuotas" : "patients.sideCards.pagadoDeLoPorHacer", {
    monto: fmtMXNdec(monto),
  });
}
