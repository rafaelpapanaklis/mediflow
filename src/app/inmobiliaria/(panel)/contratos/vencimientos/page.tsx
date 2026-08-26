export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/contratos/vencimientos — 30 / 60 / 90 días.
//
// Se baja la ventana MÁS ANCHA (90) de una sola vez y el navegador recorta
// las otras dos. Cambiar de pestaña no merece un viaje a la base para
// traer un subconjunto de lo que ya está en pantalla.
//
// 🔴 LOS DATOS DE T4 Y T1 SE LEEN, NO SE COPIAN. expiringBoard consulta
// RealtyLease.endsAt y RealtyExclusive.endsAt tal cual. Lo único propio de
// este módulo es saber cuáles de esas rentas y exclusivas YA tienen su
// contrato generado — que es justo lo que sus pantallas no pueden saber.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import type { Dictionary } from "@/i18n/t";
import { ContractTablesMissingError, expiringBoard, type ExpiringBoard } from "@/lib/realty/contracts";
import { ExpiringClient } from "@/components/realty/contracts/expiring-client";
import { TablesMissing, gateContractScreen } from "../_gate";

export const metadata: Metadata = { title: "Vencimientos — DaleControl Inmuebles" };

export default async function Page() {
  const gate = await gateContractScreen();
  if (!gate.ok) return gate.screen;
  const { ctx, dict } = gate;

  let board: ExpiringBoard = { contracts: [], leasesSinContrato: [], exclusivasSinContrato: [] };
  try {
    board = await expiringBoard(ctx, 90);
  } catch (e) {
    if (e instanceof ContractTablesMissingError) {
      return <TablesMissing texto={(dict.errores as Dictionary).sinTablas as string} />;
    }
    throw e;
  }

  return (
    <ExpiringClient
      dict={dict}
      contracts={board.contracts}
      leases={board.leasesSinContrato}
      exclusives={board.exclusivasSinContrato}
      timeZone={ctx.account.timezone || "America/Mexico_City"}
    />
  );
}
