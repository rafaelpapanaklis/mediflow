import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { sendEduConsentWhatsapp, sendEduReceiptWhatsapp } from "@/lib/edu/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/pacientes/[id]/whatsapp — manda un DOCUMENTO al
 * paciente por WhatsApp.
 *
 *   { kind: "CONSENTIMIENTO", consentId }  → la carta, con su liga para firmar
 *   { kind: "RECIBO",         chargeId }   → el resumen del cobro
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL PERMISO DE LA PUERTA ES "pacientes.view" Y NO ES EL ÚNICO CANDADO,
 * y aquí está toda la decisión de permisos de la ola:
 *
 * MANDAR NO ES CONFIGURAR. "whatsapp.manage" —que solo tiene la dirección—
 * abre la conexión y enciende los avisos de TODA la escuela. Exigirlo
 * también para mandarle un documento a un paciente dejaría a caja sin poder
 * entregar un recibo en el mostrador y al alumno sin poder mandarle la carta
 * al paciente que tiene en el sillón, que es justo para lo que sirve.
 *
 * Así que cada documento se cierra con el permiso DEL DOCUMENTO:
 *   · CONSENTIMIENTO → "consentimientos.view". La carta se imprime, se
 *     entrega y se recoge firmada; la ven los cuatro roles (Ola 3B) y los
 *     cuatro pueden mandarla.
 *   · RECIBO         → "caja.view" MÁS el alcance de "charges", que para
 *     DOCENTE y ALUMNO devuelve el `where` que no trae ni una fila (lo
 *     comprueba sendEduReceiptWhatsapp). Dos cerraduras, como en la Ola 5:
 *     encenderle "caja.view" a un alumno por error sigue sin dejarle mandar
 *     un peso.
 *
 * Y en los dos casos, el PACIENTE se busca dentro del alcance de
 * "patients": uno que no le toca da 404, igual que uno que no existe.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 institutionId de getEduContext(), JAMÁS del cuerpo ni de la ruta. El
 * `[id]` del paciente sí viene de la ruta — y por eso se vuelve a buscar
 * dentro del alcance en vez de creerle.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const kind = typeof body.kind === "string" ? body.kind : "";
    const permUser = { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride };

    if (kind === "CONSENTIMIENTO") {
      if (!hasEduPermission(permUser, "consentimientos.view")) {
        return NextResponse.json(
          { error: "Tu cuenta no tiene el permiso consentimientos.view." },
          { status: 403 },
        );
      }
      const res = await sendEduConsentWhatsapp(g.ctx, String(body.consentId ?? ""), params.id);
      // 200 aunque WhatsApp lo rechace: la constancia SÍ se escribió y la
      // pantalla necesita pintarla con su motivo. Un 500 borraría de la
      // vista justo la fila que explica qué pasó.
      return NextResponse.json(res);
    }

    if (kind === "RECIBO") {
      if (!hasEduPermission(permUser, "caja.view")) {
        return NextResponse.json(
          { error: "Tu cuenta no tiene el permiso caja.view." },
          { status: 403 },
        );
      }
      const res = await sendEduReceiptWhatsapp(g.ctx, String(body.chargeId ?? ""), params.id);
      return NextResponse.json(res);
    }

    return NextResponse.json(
      { error: "Di qué quieres mandar: una carta de consentimiento o un recibo." },
      { status: 400 },
    );
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/pacientes/${params.id}/whatsapp`);
  }
}
