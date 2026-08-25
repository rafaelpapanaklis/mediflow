import { createElement } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { persistentRateLimit } from "@/lib/failban";
import {
  civilDate,
  formatCivilDate,
  formatMoney,
  formatPeriodMonth,
  getTenantScope,
  loadTenantReceipt,
  portalUnauthorized,
} from "@/lib/realty/portal-auth";
import { ReciboPdf } from "@/components/realty/portal/recibo-pdf";
import { portalT } from "@/components/realty/portal/portal-i18n";

/**
 * GET /api/realty/portal/inquilino/recibo/[id] — el recibo de UN pago.
 *
 * 🔴 ES UN RECIBO, NO UNA FACTURA. Este vertical no timbra CFDI. El PDF
 * lo dice en el pie y ninguna pantalla del portal usa la palabra "factura".
 *
 * 🔴 El id de la URL NO se consulta a secas: loadTenantReceipt lo busca
 * con accountId + los contratos del cerco de la sesión. El pago de otro
 * inquilino devuelve 404, igual que un id inventado — sin oráculo de
 * existencia.
 *
 * PDF de verdad y no una página para imprimir: en un celular, "Ctrl+P" no
 * existe. Un application/pdf abre el visor del sistema con su botón de
 * guardar y de compartir, que es lo que la persona necesita.
 */

export const runtime = "nodejs"; // @react-pdf/renderer no corre en edge
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_ESTA = "Ese recibo no está disponible.";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = await persistentRateLimit(req, {
    limit: 30,
    windowSec: 600,
    scope: "realty-portal-recibo",
  });
  if (limited) return limited;

  const scope = await getTenantScope();
  if (!scope) return portalUnauthorized();

  try {
    const pago = await loadTenantReceipt(scope, params.id);
    if (!pago) return NextResponse.json({ error: NO_ESTA }, { status: 404 });

    const t = portalT();
    const tz = scope.account.timezone;
    const fechaCivil = civilDate(pago.paidAt, tz);

    const element = createElement(ReciboPdf, {
      folio: pago.id.slice(-8).toUpperCase(),
      fecha: formatCivilDate(fechaCivil, { withYear: true }),
      monto: formatMoney(pago.amount, pago.currency),
      metodo: t(`pagos.metodo${pago.method}`),
      referencia: pago.reference,
      concepto: pago.periodMonth
        ? t("pagos.periodo", { mes: formatPeriodMonth(pago.periodMonth) })
        : t("contrato.title"),
      inmuebleTitulo: pago.propertyTitle,
      inmuebleDireccion: pago.propertyAddress,
      inquilino: scope.personName,
      inmobiliaria: scope.account.name,
      inmobiliariaContacto: scope.account.phone ?? scope.account.email,
      generadoEn: formatCivilDate(civilDate(new Date(), tz), { withYear: true }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="recibo-${fechaCivil}-${pago.id.slice(-8)}.pdf"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[realty/portal/recibo] error:", err);
    return NextResponse.json({ error: NO_ESTA }, { status: 500 });
  }
}
