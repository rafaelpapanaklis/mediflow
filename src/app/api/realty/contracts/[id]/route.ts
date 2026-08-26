// ═══════════════════════════════════════════════════════════════════════
// GET    /api/realty/contracts/[id] → el contrato con partes y evidencia
// PATCH  /api/realty/contracts/[id] → editar (solo BORRADOR) o mover de
//                                     estado con `action`
// DELETE /api/realty/contracts/[id] → SOLO borradores
//
// 🔴 EL 404 ES EL MISMO PARA "NO EXISTE" Y PARA "ES DE OTRA CUENTA". Todas
// las consultas llevan el accountId de la sesión en el WHERE, así que un
// contrato ajeno se comporta exactamente igual que uno inventado: no hay
// forma de averiguar si existe probando ids.
//
// 🔴 LO QUE ESTA RUTA **NO** HACE: editar un contrato ya firmado. Y no es
// un `if` de aquí — es el `"sealedAt" IS NULL` que va dentro del WHERE de
// cada UPDATE en contracts.ts. Si esta ruta se equivocara, la base seguiría
// diciendo que no.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  archiveContract,
  deleteDraft,
  getContract,
  setParties,
  updateContractBody,
  voidContract,
} from "@/lib/realty/contracts";
import { contractsApiError, gateContracts, readJson } from "../_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;
  try {
    const contract = await getContract(gate.ctx, params.id);
    if (!contract) {
      return NextResponse.json({ error: "No encontramos ese contrato." }, { status: 404 });
    }
    return NextResponse.json({ contract });
  } catch (e) {
    return contractsApiError(e, "detail");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  const body = await readJson(req);
  const action = typeof body.action === "string" ? body.action : "editar";

  try {
    if (action === "editar") {
      await updateContractBody(
        gate.ctx,
        params.id,
        typeof body.body === "string" ? body.body : "",
        typeof body.title === "string" ? body.title : null,
      );
    } else if (action === "partes") {
      const raw = Array.isArray(body.parties) ? body.parties : [];
      await setParties(
        gate.ctx,
        params.id,
        raw.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            role: typeof o.role === "string" ? o.role : "",
            name: typeof o.name === "string" ? o.name : "",
            email: typeof o.email === "string" ? o.email : null,
            phone: typeof o.phone === "string" ? o.phone : null,
            mustSign: o.mustSign !== false,
          };
        }),
      );
    } else if (action === "archivar") {
      await archiveContract(gate.ctx, params.id, true);
    } else if (action === "desarchivar") {
      await archiveContract(gate.ctx, params.id, false);
    } else if (action === "anular") {
      await voidContract(gate.ctx, params.id, typeof body.reason === "string" ? body.reason : "");
    } else {
      return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
    }

    const contract = await getContract(gate.ctx, params.id);
    return NextResponse.json({ contract });
  } catch (e) {
    return contractsApiError(e, `patch:${action}`);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;
  try {
    await deleteDraft(gate.ctx, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return contractsApiError(e, "delete");
  }
}
