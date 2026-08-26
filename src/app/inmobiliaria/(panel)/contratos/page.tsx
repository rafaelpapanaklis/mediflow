export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/contratos — el tablero del módulo.
//
// El listado y las listas del alta se bajan AQUÍ (servidor) y no por API:
// son de la misma cuenta y la pantalla no puede quedarse esperando dos
// fetch antes de enseñar nada. Es el mismo criterio de /inmobiliaria/rentas.
//
// ⚠️ La sección no tiene item en el sidebar: REALTY_NAV_ITEMS vive en
// src/lib/realty/types.ts, que esta terminal no toca. Se llega por URL y
// desde las pantallas de Rentas. Queda anotado en el reporte.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import type { Dictionary } from "@/i18n/t";
import {
  ContractTablesMissingError,
  contractSources,
  listContracts,
} from "@/lib/realty/contracts";
import { ContractsClient } from "@/components/realty/contracts/contracts-client";
import type { ContractRowDTO } from "@/components/realty/contracts/shared";
import type { ContractSources } from "@/components/realty/contracts/new-contract-form";
import { TablesMissing, contractsGateDenied, gateContractScreen } from "./_gate";

export const metadata: Metadata = { title: "Contratos — DaleControl Inmuebles" };

export default async function Page() {
  const gate = await gateContractScreen();
  if (contractsGateDenied(gate)) return gate.screen;
  const { ctx, dict } = gate;

  let contracts: ContractRowDTO[] = [];
  let sources: ContractSources = { leases: [], exclusives: [], deals: [], properties: [] };
  try {
    // En paralelo: son dos consultas independientes y la segunda (las listas
    // del formulario) no depende de la primera.
    [contracts, sources] = await Promise.all([
      // includeArchived porque el tablero TIENE pestaña de archivados y sin
      // esto siempre saldría vacía: listContracts los excluye EN LA BASE
      // salvo que se pidan. El cliente ya los trata aparte —no suman en
      // "todos" ni en los KPI de trabajo vivo—, que es lo correcto:
      // archivar saca del tablero, no del producto.
      listContracts(ctx, { includeArchived: true }),
      contractSources(ctx),
    ]);
  } catch (e) {
    if (e instanceof ContractTablesMissingError) {
      return <TablesMissing texto={(dict.errores as Dictionary).sinTablas as string} />;
    }
    throw e;
  }

  return <ContractsClient dict={dict} contracts={contracts} sources={sources} canEdit />;
}
