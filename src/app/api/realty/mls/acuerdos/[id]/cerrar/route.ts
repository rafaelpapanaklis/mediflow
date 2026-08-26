import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeAgreementIntoDeal } from "@/lib/realty/mls";
import { setDealSplits } from "@/app/api/realty/deals/service";
import { RealtyAdminError } from "@/lib/realty/team";
import { gateMls, mlsApiError, mlsBadRequest, mlsNotFound, readJson } from "../../../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — contra qué operaciones se puede cerrar ESTE acuerdo.
 *
 * El motor exige que el deal sea de mi cuenta Y del mismo inmueble, así que
 * la pantalla necesita saber cuáles cumplen antes de pedir el cierre. Sin
 * esto la única forma de acertar sería escribir un id a mano.
 *
 * Solo devuelve deals de MI cuenta. El `propertyId` no viene del navegador:
 * sale del acuerdo, y el acuerdo solo se lee si soy una de las dos partes.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const acuerdo = await prisma.realtyMlsAgreement.findFirst({
      where: { id: (params.id ?? "").trim(), listingAccountId: gate.ctx.accountId },
      select: { propertyId: true },
    });
    // Quien COLOCA no cierra (el deal vive en la cuenta de quien capta), así
    // que para él la lista está vacía y el 404 sería mentira: el acuerdo sí
    // existe, simplemente no es él quien lo cierra.
    if (!acuerdo) return NextResponse.json({ operaciones: [] });

    const deals = await prisma.realtyDeal.findMany({
      where: { accountId: gate.ctx.accountId, propertyId: acuerdo.propertyId },
      orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        kind: true,
        status: true,
        amount: true,
        commissionAmount: true,
        closedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      operaciones: deals.map((d) => ({
        id: d.id,
        tipo: d.kind,
        status: d.status,
        monto: Number(d.amount),
        comision: Number(d.commissionAmount),
        // `closedAt` puede ser null en una operación en proceso: la pantalla
        // pinta la fecha de alta para que la lista no salga con huecos.
        fecha: (d.closedAt ?? d.createdAt).toISOString(),
      })),
    });
  } catch (e) {
    return mlsApiError("acuerdos/[id]/cerrar:GET", e);
  }
}

/**
 * POST /api/realty/mls/acuerdos/[id]/cerrar — la costura con T8.
 *
 * ═══ 🔴 LA BOLSA NO CALCULA DINERO ═════════════════════════════════════
 * El único motor de comisiones del vertical es `computeSplits`
 * (src/lib/realty/commissions.ts) y el único sitio que escribe el reparto
 * es `setDealSplits` (api/realty/deals/service.ts). Esta ruta NO inventa
 * un reparto paralelo: toma el porcentaje que las dos partes ya pactaron,
 * lo convierte en la fila EXTERNO que el modelo de T8 YA tiene —`party:
 * "EXTERNO"` + `externalName`— y se la entrega a SU función.
 *
 * ═══ POR QUÉ SE LEEN LAS PARTES QUE YA HAY ═════════════════════════════
 * `setDealSplits` REEMPLAZA el reparto entero (borra y recrea). Mandarle
 * solo mi fila borraría al captador, al colocador y a la oficina. Así que
 * se leen las que ya existen, se les añade la del colega y se manda el
 * conjunto COMPLETO. Ese es el contrato de esa función y no se negocia.
 *
 * ═══ EL NOMBRE DEL EXTERNO NO LO TECLEA NADIE ══════════════════════════
 * T8 agrupa a los externos del recibo por `ext:${nombre.toLowerCase()}` y
 * "pagar todo" hace match EXACTO. Por eso el nombre sale siempre de
 * `RealtyAccount.name` de la contraparte (lo pone el motor, en
 * `closeAgreementIntoDeal`) y jamás de un campo escrito a mano: dos
 * grafías del mismo colega serían dos beneficiarios distintos.
 *
 * ═══ QUÉ PASA SI EL REPARTO NO ADMITE LA FILA ══════════════════════════
 * Puede fallar por tres motivos legítimos: ya hay partes PAGADAS (T8
 * responde 409 y con razón — cambiar un reparto cobrado es rehacer el
 * pasado), el total se pasaría de la comisión, o quien cierra no tiene
 * `commissions.manage`.
 *
 * En los tres casos el acuerdo SE QUEDA CERRADO —porque de verdad se
 * cerró— y la respuesta lo dice con todas sus letras: `splitAplicado:
 * false`, el motivo, y la fila exacta para agregarla a mano. Mentir aquí
 * con un "listo" sería que alguien descubriera dentro de un mes que a su
 * colega nunca se le apuntó su parte.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // `properties.edit` y no `commissions.manage`: cerrar la colaboración es
  // un acto sobre MI inventario. Si además tiene permiso de comisiones, el
  // reparto se actualiza solo; si no, se cierra igual y la respuesta dice
  // qué falta. Un asesor sin permiso de dinero no debe quedarse sin poder
  // cerrar el trato que él mismo trabajó.
  const gate = await gateMls("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
    if (!dealId) return mlsBadRequest("Falta la operación.", "MISSING_DEAL");

    const res = await closeAgreementIntoDeal(gate.ctx, params.id, dealId);
    if (!res.ok || !res.split) {
      switch (res.reason) {
        case "forbidden":
          return NextResponse.json(
            {
              error: "Cierra quien tiene el inmueble: la operación vive en su cuenta.",
              code: "FORBIDDEN",
            },
            { status: 403 },
          );
        case "not_accepted":
          return NextResponse.json(
            {
              error: "Ese acuerdo todavía no está aceptado por las dos partes.",
              code: "NOT_ACCEPTED",
            },
            { status: 409 },
          );
        case "bad_deal":
          return mlsBadRequest(
            "Esa operación no es tuya o no es de este inmueble.",
            "BAD_DEAL",
          );
        default:
          return mlsNotFound();
      }
    }

    // ── El reparto: las partes que ya hay, más la del colega ──
    const existentes = await prisma.realtyCommissionSplit.findMany({
      where: { dealId, accountId: gate.ctx.accountId },
      select: {
        realtyUserId: true,
        externalName: true,
        party: true,
        pct: true,
      },
      orderBy: { id: "asc" },
    });

    // Si el colega ya está en el reparto no se duplica. Se compara con la
    // MISMA llave que usa T8 para agrupar externos en el recibo: party
    // EXTERNO + nombre en minúsculas.
    const yaEsta = existentes.some(
      (s) =>
        s.party === "EXTERNO" &&
        (s.externalName ?? "").trim().toLowerCase() ===
          res.split!.externalName.trim().toLowerCase(),
    );

    if (yaEsta) {
      return NextResponse.json({
        ok: true,
        splitAplicado: true,
        yaEstaba: true,
        split: res.split,
      });
    }

    const filas = [
      ...existentes.map((s) => ({
        party: s.party,
        realtyUserId: s.realtyUserId,
        externalName: s.externalName,
        // Las partes que ya existen se re-mandan SIEMPRE en PCT, que es el
        // modo en que quedaron guardadas (T8 guarda pct y amount de las
        // dos). Re-mandarlas en AMOUNT las congelaría en pesos y el día que
        // cambie la comisión del deal dejarían de cuadrar.
        mode: "PCT" as const,
        pct: Number(s.pct),
      })),
      res.split,
    ];

    try {
      await setDealSplits(gate.ctx, dealId, filas);
      return NextResponse.json({ ok: true, splitAplicado: true, split: res.split });
    } catch (e) {
      // El acuerdo YA está cerrado y así se queda: de verdad se cerró. Lo
      // que no se pudo es tocar el reparto, y eso se dice tal cual, con la
      // fila lista para copiarla a mano.
      const motivo =
        e instanceof RealtyAdminError
          ? e.message
          : "No se pudo actualizar el reparto de la comisión.";
      console.warn("[api/realty/mls/acuerdos/cerrar] el split no entró:", motivo);
      return NextResponse.json({
        ok: true,
        splitAplicado: false,
        motivo,
        split: res.split,
      });
    }
  } catch (e) {
    return mlsApiError("acuerdos/[id]/cerrar:POST", e);
  }
}
