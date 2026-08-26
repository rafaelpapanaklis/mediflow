// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/screening/sweep → preguntarle al proveedor si ya está
//
// HOY NO HACE NADA, Y ESO ES CORRECTO: el único proveedor registrado es el
// MANUAL (`automated: false`), y a una persona no se le consulta por API.
// El barrido se salta los no automatizados a propósito — gastar una vuelta
// para nada ensucia los registros y hace creer que algo se intentó.
//
// Existe AHORA, vacío, porque el día que haya convenio con Liv, Moradauno,
// Multiburó o Inquilino Seguro, enchufarlos es escribir el adaptador y
// registrarlo: ni esta ruta, ni el panel, ni la base cambian. Si la ruta no
// existiera, ese día habría que acordarse de crearla — y nadie se acuerda.
//
// DOS PUERTAS, como los otros barridos del área:
//   · Con `Authorization: Bearer $CRON_SECRET` → todas las cuentas.
//   · Con sesión de inmuebles → solo la de quien llama.
// El accountId NUNCA sale del body.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_SCREENING_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
  realtyGrowthCronAuthorized,
} from "@/lib/realty/bot/gate";
import { sweepScreeningResults } from "@/lib/realty/screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (realtyGrowthCronAuthorized(req)) {
    const updated = await sweepScreeningResults();
    return NextResponse.json({ ok: true, scope: "todas", updated });
  }

  const gate = await openRealtyGrowthGate({
    permission: "leases.manage",
    feature: REALTY_SCREENING_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const updated = await sweepScreeningResults(gate.ctx.accountId);
  return NextResponse.json({ ok: true, scope: "cuenta", updated });
}
