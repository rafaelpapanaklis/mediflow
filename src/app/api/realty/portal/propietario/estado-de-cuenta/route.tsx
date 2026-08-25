import { createElement } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { persistentRateLimit } from "@/lib/failban";
import {
  civilDate,
  formatCivilDate,
  formatMoney,
  formatPeriodMonth,
  getOwnerScope,
  isPeriodMonth,
  loadOwnerStatement,
  periodMonthOf,
  portalUnauthorized,
} from "@/lib/realty/portal-auth";
import { EstadoCuentaPdf } from "@/components/realty/portal/estado-cuenta-pdf";
import { portalT } from "@/components/realty/portal/portal-i18n";

/**
 * GET /api/realty/portal/propietario/estado-de-cuenta?mes=YYYY-MM
 *
 * El corte del mes en PDF: lo cobrado, lo retenido por administración, los
 * gastos y cuánto se le depositó.
 *
 * 🔴 `mes` es lo ÚNICO que llega del navegador, y solo elige un intervalo
 * de fechas: los inmuebles salen del cerco de la sesión, nunca de la URL.
 * Un mes mal escrito devuelve 400; no hay forma de que ese parámetro
 * apunte a la cartera de otro.
 *
 * Los números los arma buildOwnerStatement (puro, en portal-core), así que
 * la pantalla y el PDF NO pueden dar cifras distintas: es el mismo cálculo.
 */

export const runtime = "nodejs"; // @react-pdf/renderer no corre en edge
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const limited = await persistentRateLimit(req, {
    limit: 30,
    windowSec: 600,
    scope: "realty-portal-estado",
  });
  if (limited) return limited;

  const scope = await getOwnerScope();
  if (!scope) return portalUnauthorized();

  const pedido = new URL(req.url).searchParams.get("mes");
  const mes = pedido ?? periodMonthOf(new Date(), scope.account.timezone);
  if (!isPeriodMonth(mes)) {
    return NextResponse.json({ error: "Mes inválido. Usa el formato YYYY-MM." }, { status: 400 });
  }

  try {
    const data = await loadOwnerStatement(scope, mes);
    if (!data) {
      return NextResponse.json({ error: "Mes inválido. Usa el formato YYYY-MM." }, { status: 400 });
    }

    const t = portalT();
    const tz = scope.account.timezone;
    const money = (n: number) => formatMoney(n, data.currency);

    const element = createElement(EstadoCuentaPdf, {
      inmobiliaria: scope.account.name,
      propietario: scope.personName,
      mesLabel: formatPeriodMonth(mes),
      generadoEn: formatCivilDate(civilDate(new Date(), tz), { withYear: true }),
      cobrado: money(data.statement.cobrado),
      retenido: money(data.statement.retenido),
      gastos: money(data.statement.gastos),
      depositado: money(data.statement.depositado),
      sinComisionPactada: data.statement.sinComisionPactada,
      // Solo los inmuebles con movimiento: una lista de veinte casas en
      // ceros no informa, estorba.
      filas: data.statement.porInmueble
        .filter((p) => p.cobrado !== 0 || p.gastos !== 0)
        .map((p) => ({
          inmueble: data.propertyTitles[p.propertyId] ?? "",
          cobrado: money(p.cobrado),
          retenido: money(p.retenido),
          gastos: money(p.gastos),
          depositado: money(p.depositado),
        })),
      detalleGastos: data.expenses.map((g) => ({
        fecha: formatCivilDate(civilDate(new Date(g.paidAt), tz)),
        inmueble: data.propertyTitles[g.propertyId] ?? "",
        tipo: t(`estado.gasto${g.kind}`),
        nota: g.note ?? "",
        monto: money(g.amount),
      })),
      mantenimientos: data.maintenances.map((m) => ({
        fecha: formatCivilDate(civilDate(new Date(m.createdAt), tz)),
        inmueble: m.propertyTitle,
        descripcion: m.description.slice(0, 90),
        estado: t(`fallas.estado${m.status}`),
        costo: m.cost === null ? "—" : money(m.cost),
      })),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="estado-de-cuenta-${mes}.pdf"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[realty/portal/estado-de-cuenta] error:", err);
    return NextResponse.json(
      { error: "No pudimos preparar tu estado de cuenta." },
      { status: 500 },
    );
  }
}
