export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/contratos/[id] — el contrato.
//
// El accountId sale de la sesión y va en el WHERE de getContract, así que
// un contrato de otra cuenta se comporta EXACTAMENTE igual que uno
// inventado: no encontrado. No hay forma de averiguar si existe probando
// ids en la barra de direcciones.
//
// La zona horaria de la cuenta viaja al cliente porque el servidor corre
// en UTC: una evidencia fechada seis horas adelante contradice la pantalla
// que la persona acaba de ver.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import type { Dictionary } from "@/i18n/t";
import { ContractTablesMissingError, getContract } from "@/lib/realty/contracts";
import { ContractDetailClient } from "@/components/realty/contracts/contract-detail-client";
import { TablesMissing, contractsGateDenied, gateContractScreen } from "../_gate";

export const metadata: Metadata = { title: "Contrato — DaleControl Inmuebles" };

export default async function Page({ params }: { params: { id: string } }) {
  const gate = await gateContractScreen();
  if (contractsGateDenied(gate)) return gate.screen;
  const { ctx, dict } = gate;

  let contract = null;
  try {
    contract = await getContract(ctx, params.id);
  } catch (e) {
    if (e instanceof ContractTablesMissingError) {
      return <TablesMissing texto={(dict.errores as Dictionary).sinTablas as string} />;
    }
    throw e;
  }

  if (!contract) {
    return <TablesMissing texto={(dict.detalle as Dictionary).noEncontrado as string} />;
  }

  return (
    <ContractDetailClient
      dict={dict}
      contract={contract}
      timeZone={ctx.account.timezone || "America/Mexico_City"}
    />
  );
}
