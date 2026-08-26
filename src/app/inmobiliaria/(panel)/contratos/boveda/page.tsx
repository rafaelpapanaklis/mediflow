export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/contratos/boveda — el expediente.
//
// Trae lo FIRMADO, incluidos los ARCHIVADOS: archivar saca del tablero de
// trabajo, no del expediente. Por eso esta es la única pantalla que pide
// `includeArchived`.
//
// Los nombres de las personas se resuelven AQUÍ y no en el DTO del
// listado: ContractRowDTO viaja en una tabla de cientos de filas y meterle
// un nombre que solo usa esta pantalla sería engordar todas las demás.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import type { Dictionary } from "@/i18n/t";
import { prisma } from "@/lib/prisma";
import { ContractTablesMissingError, listContracts } from "@/lib/realty/contracts";
import { VaultClient } from "@/components/realty/contracts/vault-client";
import type { ContractRowDTO } from "@/components/realty/contracts/shared";
import { TablesMissing, contractsGateDenied, gateContractScreen } from "../_gate";

export const metadata: Metadata = { title: "Bóveda de contratos — DaleControl Inmuebles" };

export default async function Page() {
  const gate = await gateContractScreen();
  if (contractsGateDenied(gate)) return gate.screen;
  const { ctx, dict } = gate;

  let firmados: ContractRowDTO[] = [];
  try {
    const todos = await listContracts(ctx, { includeArchived: true });
    // FIRMADO y ARCHIVADO. Un archivado puede no estar firmado (se archiva
    // un borrador que ya no va a ninguna parte), pero sigue siendo parte
    // del expediente y esconderlo aquí lo haría desaparecer del producto.
    firmados = todos.filter((c) => c.status === "FIRMADO" || c.status === "ARCHIVADO");
  } catch (e) {
    if (e instanceof ContractTablesMissingError) {
      return <TablesMissing texto={(dict.errores as Dictionary).sinTablas as string} />;
    }
    throw e;
  }

  const contactIds = Array.from(
    new Set(firmados.map((c) => c.contactId).filter((v): v is string => !!v)),
  );
  const contactos = contactIds.length
    ? await prisma.realtyContact.findMany({
        // accountId en el WHERE aunque los ids salgan de filas de esta misma
        // cuenta: es la regla del vertical y no se hace excepción por
        // "aquí no puede pasar".
        where: { id: { in: contactIds }, accountId: ctx.accountId },
        select: { id: true, name: true },
      })
    : [];
  const contactNames: Record<string, string> = {};
  for (const c of contactos) contactNames[c.id] = c.name;

  return (
    <VaultClient
      dict={dict}
      contracts={firmados}
      contactNames={contactNames}
      timeZone={ctx.account.timezone || "America/Mexico_City"}
    />
  );
}
