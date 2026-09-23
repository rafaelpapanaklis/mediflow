// POST /api/paciente/payments/mercadopago — el link (y QR) de Mercado Pago con
// el que el paciente paga el saldo de SU factura desde el portal (ws1-t2).
//
// Body: { invoiceId: string }
//   → 200 { url, monto, venceA }
//   | 400 { error, code } | 401 | 404 { error, code } | 409 { error, code } | 429 | 502 { error, code }
//
// El link es EL MISMO que la recepción manda por WhatsApp o correo: sale de
// `obtenerLinkDeFactura` (src/lib/factura-mp/), que lo guarda en
// invoice_payment_links, lo reutiliza si ya hay uno vigente por el mismo saldo,
// y lo concilia el webhook que ya existe (`?ref=factura:<linkId>`). Aquí no se
// crea ni un camino nuevo del dinero: solo se deja que el PACIENTE lo pida.
//
// SEGURIDAD (el criterio de /api/paciente/payments/checkout, literal):
//   · La factura se busca SIEMPRE filtrando por los patientId de la sesión
//     (ctx.links) — jamás se confía en ids del cliente. Además, la pareja
//     (patientId, clinicId) de la factura tiene que ser la de un vínculo, y el
//     expediente no puede estar borrado (la lista de pagos tampoco lo enseña).
//   · El monto SIEMPRE se lee en el servidor: Invoice.balance para decidir si
//     se ofrece, y el saldo total − pagado bajo candado dentro de
//     `obtenerLinkDeFactura` para el cobro. El cliente no manda montos: el body
//     solo trae invoiceId y todo lo demás se ignora.
//   · Solo estados PENDING|PARTIAL|OVERDUE con saldo > 0.
//   · Cobra la cuenta de Mercado Pago de la clínica DE LA FACTURA; si no tiene,
//     o la clínica APAGÓ el pago en línea del portal (Configuración → Anticipos),
//     409 y la pantalla dice «Paga en tu clínica». El interruptor se vuelve a
//     mirar DESPUÉS de crear el link: si lo apagaron justo en medio, el link
//     recién nacido se cierra y no se entrega.
//   · La URL que se devuelve tiene que ser de Mercado Pago (`esUrlDeMercadoPago`):
//     de ella sale el QR.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { PAYABLE_STATUSES, MIN_ONLINE_AMOUNT_MXN } from "@/lib/patient-portal/online-payment";
import { obtenerLinkDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarLinksDelPortal, cobroMpEnPortal } from "@/lib/patient-portal/pago-mercadopago.server";
import {
  esUrlDeMercadoPago,
  textoErrorPortal,
  type ErrorPagoPortal,
  type LinkDePagoPortal,
} from "@/lib/patient-portal/pago-mercadopago";

export const dynamic = "force-dynamic";

function error(code: ErrorPagoPortal, status: number) {
  return NextResponse.json({ error: textoErrorPortal(code), code }, { status });
}

export async function POST(req: NextRequest) {
  // Cada POST puede crear una preferencia en MP: barato de abusar.
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const patientIds = ctx.links.map((l) => l.patientId);
    if (patientIds.length === 0) return error("no_encontrada", 404);

    const body = await req.json().catch(() => null);
    const invoiceId = body?.invoiceId;
    if (typeof invoiceId !== "string" || !invoiceId) return error("peticion", 400);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        patientId: { in: patientIds },
        // La clínica de la factura es la del vínculo de ESE expediente.
        OR: ctx.links.map((l) => ({ patientId: l.patientId, clinicId: l.clinicId })),
        status: { in: PAYABLE_STATUSES as any },
        patient: { deletedAt: null },
      },
      select: { id: true, balance: true, clinicId: true },
    });
    // 404 también cubre facturas de otros pacientes o ya pagadas/canceladas
    // — sin enumeración de estados ajenos.
    if (!invoice || !invoice.clinicId) return error("no_encontrada", 404);
    if (!(invoice.balance > 0)) return error("sin_saldo", 400);
    if (invoice.balance < MIN_ONLINE_AMOUNT_MXN) return error("bajo_minimo", 400);

    // clinicId de la factura ya validada contra la sesión, nunca del cliente.
    if (!(await cobroMpEnPortal(invoice.clinicId))) return error("sin_mp", 409);
    const r = await obtenerLinkDeFactura({ clinicId: invoice.clinicId, invoiceId: invoice.id, userId: null });
    if (!r.ok || !r.link) {
      switch (r.error) {
        case "sin_mp":
          return error("sin_mp", 409);
        case "no_encontrada":
          return error("no_encontrada", 404);
        case "bajo_minimo":
          return error("bajo_minimo", 400);
        case "estado":
        case "sin_saldo":
          // La cobraron (o la cancelaron) entre la lectura de arriba y el candado.
          return error("sin_saldo", 409);
        default:
          return error("mp_fallo", 502);
      }
    }
    if (!(await cobroMpEnPortal(invoice.clinicId))) {
      // Lo apagaron mientras se creaba: el link del portal no sobrevive.
      await cerrarLinksDelPortal({ clinicId: invoice.clinicId, invoiceId: invoice.id });
      return error("sin_mp", 409);
    }
    if (!esUrlDeMercadoPago(r.link.url)) {
      console.error(`[paciente/payments/mercadopago] Mercado Pago devolvió una URL inesperada para la factura ${invoice.id}`);
      return error("mp_fallo", 502);
    }

    const link: LinkDePagoPortal = { url: r.link.url, monto: r.link.monto, venceA: r.link.venceA };
    return NextResponse.json(link);
  } catch (err) {
    console.error("[paciente/payments/mercadopago] error:", err);
    return error("mp_fallo", 500);
  }
}
