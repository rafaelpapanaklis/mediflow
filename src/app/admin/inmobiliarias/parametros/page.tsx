export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /admin/inmobiliarias/parametros — la tabla de la que salen TODAS las
// cifras fiscales de las calculadoras del vertical inmuebles.
//
// Sin guard propio: /admin/layout.tsx no renderiza children sin sesión de
// administrador. Las MUTACIONES sí verifican por su cuenta (ver actions.ts),
// porque una server action se alcanza sin pasar por ningún layout.
//
// realty_calc_params no tiene accountId: son parámetros de PLATAFORMA que
// comparten todas las cuentas. Por eso se editan aquí y no en el panel del
// cliente.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { getCalcParamRowsConId } from "@/lib/realty/calc/params";
import { kindsSinAnio } from "@/lib/realty/calc/catalog";
import { seedResumen, SEED_YEAR } from "@/lib/realty/calc/seed";
import { ParametrosClient } from "./parametros-client";

export const metadata: Metadata = { title: "Parámetros de calculadoras — Admin DaleControl" };

export default async function Page() {
  const rows = await getCalcParamRowsConId();
  const anioActual = new Date().getFullYear();
  return (
    <ParametrosClient
      initial={rows}
      anioActual={anioActual}
      kindsSinAnio={kindsSinAnio(rows, anioActual)}
      resumenSemilla={seedResumen()}
      anioSemilla={SEED_YEAR}
    />
  );
}
