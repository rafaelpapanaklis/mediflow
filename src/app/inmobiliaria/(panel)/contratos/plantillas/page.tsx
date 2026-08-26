export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/contratos/plantillas — el editor por cuenta.
//
// Segmento ESTÁTICO que convive con [id] (dinámico). Next resuelve lo
// estático primero, así que "plantillas" nunca se confunde con el id de un
// contrato — y además ningún id se llama así: los genera newId() y
// empiezan por "c" + base36.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import type { Dictionary } from "@/i18n/t";
import {
  ContractTablesMissingError,
  listTemplates,
  type ContractTemplateDTO,
} from "@/lib/realty/contracts";
import { TemplatesClient } from "@/components/realty/contracts/templates-client";
import { TablesMissing, gateContractScreen } from "../_gate";

export const metadata: Metadata = { title: "Plantillas de contrato — DaleControl Inmuebles" };

export default async function Page() {
  const gate = await gateContractScreen();
  if (!gate.ok) return gate.screen;
  const { ctx, dict } = gate;

  let templates: ContractTemplateDTO[] = [];
  try {
    templates = await listTemplates(ctx.accountId);
  } catch (e) {
    if (e instanceof ContractTablesMissingError) {
      return <TablesMissing texto={(dict.errores as Dictionary).sinTablas as string} />;
    }
    throw e;
  }

  return <TemplatesClient dict={dict} templates={templates} />;
}
