"use client";

// «Qué cuenta» (ws1-t2, F9 de la auditoría BEVADENT: «cifras de dinero que no coinciden entre
// pantallas… pedimos explicar qué cuenta cada pantalla, por ejemplo si incluye lo migrado»).
//
// Una línea corta bajo cada indicador de dinero de Finanzas, Reportes, CRM y Costos y Margen:
// periodo, cobrado o facturado, y si entra lo migrado de otro sistema. Los textos viven en
// `queCuenta.*` (es/en) para que las cuatro pantallas digan lo mismo con las mismas palabras.
// No pone estilo propio: hereda el de la pista de cada tarjeta.

import { useT } from "@/i18n/i18n-provider";

export type ClaveQueCuenta =
  | "ingresosPeriodo" | "ingresosPeriodoConReembolsos" | "gastosPeriodo" | "utilidad" | "utilidadConMargen"
  | "efectivo" | "porDoctor" | "porCobrar" | "vencido" | "ortoCobrado" | "ortoVencido"
  | "reportesIngresos" | "reportesTicket" | "reportesConDeuda"
  | "crmLtv" | "crmCobrado" | "crmSaldo"
  | "costosIngresos" | "costosCostos" | "costosMargen";

/** El texto plano (para los componentes que solo aceptan `string`, como las tarjetas de Analítica). */
export function useQueCuenta() {
  const t = useT();
  return (clave: ClaveQueCuenta, vars?: Record<string, string | number>) =>
    `${t("queCuenta.titulo")}: ${t(`queCuenta.${clave}`, vars)}`;
}

/** La línea con el rótulo en negrita. */
export function QueCuenta({ clave, vars }: { clave: ClaveQueCuenta; vars?: Record<string, string | number> }) {
  const t = useT();
  return (
    <span data-que-cuenta={clave}>
      <strong>{t("queCuenta.titulo")}:</strong> {t(`queCuenta.${clave}`, vars)}
    </span>
  );
}
