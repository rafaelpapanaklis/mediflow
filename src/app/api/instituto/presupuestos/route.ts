import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { createEduQuote, listEduQuotes } from "@/lib/edu/presupuestos";

export const dynamic = "force-dynamic";

/**
 * LOS PRESUPUESTOS (fila 26 del informe ws2-t1).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTO ES DINERO, Y EL DINERO SE REPARTE AL REVÉS QUE TODO LO DEMÁS.
 *
 * PERMISOS: `caja.view` para leer, `caja.charge` para armar. ALCANCE: el
 * del DINERO (recurso "charges"), que solo devuelve `all` (caja y
 * dirección) o `none` (docente y alumno). El alumno que PROPONE el
 * tratamiento no ve el presupuesto, igual que no ve el cobro ni el saldo —
 * «un residente que puede consultar cuánto pagó su paciente sabe cuánto
 * vale su propia lista de espera» (visibility.ts).
 *
 * 🔴 LOS TOTALES LOS CALCULA EL SERVIDOR. Lo que manda el cliente son
 * cantidades y precios unitarios; un total que llega del navegador es un
 * total que el navegador puede cambiar.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET ?patientId=… — los presupuestos de un paciente. */
export async function GET(request: Request) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;
  try {
    const patientId = new URL(request.url).searchParams.get("patientId") ?? "";
    return NextResponse.json({ rows: await listEduQuotes(g.ctx, patientId) });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/presupuestos");
  }
}

/**
 * POST — crea un presupuesto con sus partidas.
 *
 * 🔴 Y ACEPTA `caseId` **y** `treatmentPlanId`: un presupuesto puede nacer
 * de un caso o de un plan de tratamiento, que es como lo pide el
 * comparativo con el dental. El servidor comprueba que los dos sean de ESE
 * paciente y, con un plan y sin partidas, siembra una con el nombre del
 * plan y su importe.
 *
 * ⚠️ El BOTÓN para eso no vive en esta ola: **caja no ve casos** (la línea
 * del contrato de la Ola 2, en visibility.ts), así que la pantalla de
 * Presupuestos no puede ofrecer un selector de casos. Tiene que salir de
 * la pantalla del caso y de la del plan, y las dos son de otra casilla.
 * Lo que aquí queda es la puerta, abierta y probada.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await createEduQuote(g.ctx, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/presupuestos");
  }
}
