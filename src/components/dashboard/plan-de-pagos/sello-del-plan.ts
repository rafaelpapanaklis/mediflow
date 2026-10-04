// El sello del bloque «Plan de pagos» (auditoría de uso, C-73).
//
// La factura del plan MF-1132 decía a la vez «Falta el enganche» y «Al corriente»: el enganche aún no vencía,
// así que nada estaba vencido, pero leído junto a «Falta el enganche» parecía una contradicción. Mientras lo
// que sigue es el ENGANCHE (y no está vencido), el sello dice «Enganche por cobrar · vence <día>», no
// «Al corriente». Lo demás no cambia. PURO.

import { useLocale } from "@/i18n/i18n-provider";

export type Sello = "vencido" | "sinFechas" | "enganchePendiente" | "alCorriente" | "pagado";

export function selloDelPlan(e: {
  vencidas: number;
  conFechas: boolean;
  cuotaActual: { esEnganche: boolean } | null;
}): Sello {
  if (e.vencidas > 0) return "vencido";
  if (e.cuotaActual === null) return "pagado";
  if (!e.conFechas) return "sinFechas";
  if (e.cuotaActual.esEnganche) return "enganchePendiente";
  return "alCorriente";
}

const es = {
  enganchePendiente: "Enganche por cobrar",
  vence: (fecha: string) => `vence ${fecha}`,
};
const en: typeof es = {
  enganchePendiente: "Down payment due",
  vence: (fecha: string) => `due ${fecha}`,
};

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosSello(): typeof es {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return locale === "en" ? en : es;
}
