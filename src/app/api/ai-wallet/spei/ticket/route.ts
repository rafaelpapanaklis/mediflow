import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { createTicket } from "@/lib/support/service";
import { SupportError } from "@/lib/support/types";
import { redactarSolicitudSpei } from "@/lib/ai-wallet/spei-solicitud";
import { montoSpeiValido, SPEI_MAX_CENTS, SPEI_MIN_CENTS } from "@/lib/ai-wallet/spei-montos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-wallet/spei/ticket   { amountCents }
 *
 * Primer paso de una recarga de saldo IA por SPEI: abre un ticket de soporte
 * (categoría Facturación) con el asunto y el mensaje ya redactados, para que
 * el equipo de DaleControl le pase a la clínica los datos para transferir.
 *
 * No es otro sistema de tickets: delega en `createTicket()`, el mismo de
 * `POST /api/support/tickets` (sanitiza, guarda y avisa a soporte por correo).
 * Lo único que añade es REDACTAR en el servidor: el nombre de la clínica sale
 * de la sesión y el monto se valida con los mismos topes que el comprobante.
 *
 * No toca dinero: no crea recargas, no toca el monedero.
 * clinicId SIEMPRE de la sesión, jamás del body. Solo administradores, como
 * el resto de la tarjeta «Recargar saldo».
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const amountCents = montoSpeiValido(body?.amountCents);
  if (amountCents === null) {
    return NextResponse.json(
      {
        error: `Monto invalido. Debe estar entre $${SPEI_MIN_CENTS / 100} y $${SPEI_MAX_CENTS / 100} MXN.`,
        code: "MONTO_INVALIDO",
      },
      { status: 400 },
    );
  }

  const persona = `${ctx.user?.firstName ?? ""} ${ctx.user?.lastName ?? ""}`.trim();
  const { subject, body: mensaje } = redactarSolicitudSpei({
    clinica: ctx.clinic?.name ?? "",
    persona,
    amountCents,
    locale: ctx.clinic?.locale,
  });

  try {
    const ticket = await createTicket({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      userName: persona,
      subject,
      category: "FACTURACION",
      priority: "NORMAL",
      body: mensaje,
    });
    return NextResponse.json(
      { ticket: { id: ticket.id, folioLabel: ticket.folioLabel }, amountCents },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof SupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[ai-wallet/spei/ticket] error:", err);
    return NextResponse.json({ error: "No se pudo abrir el ticket" }, { status: 500 });
  }
}
