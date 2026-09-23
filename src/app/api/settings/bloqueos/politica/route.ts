import { NextResponse, type NextRequest } from "next/server";
import { hasPermission } from "@/lib/auth/permissions";
import {
  contextoDeBloqueos,
  cuerpoJson,
  extractAuditMeta,
} from "@/lib/agenda-bloqueos/ruta.server";
import { puedeAgendarEncima } from "@/lib/agenda-bloqueos/core";
import {
  guardarRecepcionPuedeAgendar,
  leerRecepcionPuedeAgendar,
  PoliticaSinTablaError,
} from "@/lib/agenda-bloqueos/politica.server";

export const dynamic = "force-dynamic";

/**
 * /api/settings/bloqueos/politica — «¿Recepción puede agendar sobre un día
 * bloqueado?» (WS1-T5).
 *
 * El contrato lo fijó la pantalla (`components/dashboard/bloqueos/politica.ts`)
 * y esta ruta lo cumple letra por letra:
 *
 *     GET  (agenda.view)    → { recepcionPuedeAgendar, puedoAgendarEncima }
 *     PUT  (settings.edit)  ← { recepcionPuedeAgendar: boolean }  → lo mismo
 *     errores: { error: "CODIGO", mensaje: "frase" }
 *
 * 🔴 Antes no existía, y «politica» caía en `[id]/route.ts`, que lo tomaba por
 * el id de un bloqueo: la tarjeta salía con «No se pudo leer este ajuste».
 * Un segmento estático gana a `[id]` en el App Router.
 */

function usuarioDe(session: { user: { role: string; permissionsOverride?: string[] | null } }) {
  return {
    role: session.user.role,
    permissionsOverride: session.user.permissionsOverride ?? [],
  };
}

/**
 * GET — el ajuste de la clínica y lo que vale para quien pregunta. Lo pide
 * también la ventana de confirmar antes de agendar sobre un bloqueo, por eso
 * basta con `agenda.view`: es un sí/no de la clínica, no un dato sensible.
 */
export async function GET() {
  const r = await contextoDeBloqueos({ soloLectura: true });
  if (r instanceof NextResponse) return r;

  const recepcionPuedeAgendar = await leerRecepcionPuedeAgendar(r.ctx.clinicId);
  return NextResponse.json({
    recepcionPuedeAgendar,
    puedoAgendarEncima: puedeAgendarEncima(
      recepcionPuedeAgendar,
      hasPermission(usuarioDe(r.session), "settings.edit"),
    ),
  });
}

/**
 * PUT — cambia el ajuste. Solo quien puede editar la configuración de la
 * clínica: el servidor lo rechaza aunque la pantalla esconda la tarjeta.
 */
export async function PUT(req: NextRequest) {
  const r = await contextoDeBloqueos({ soloLectura: true });
  if (r instanceof NextResponse) return r;

  const usuario = usuarioDe(r.session);
  if (!hasPermission(usuario, "settings.edit")) {
    return NextResponse.json(
      {
        error: "SIN_PERMISO",
        mensaje: "Solo quien puede editar la configuración de la clínica cambia este ajuste.",
      },
      { status: 403 },
    );
  }

  const body = await cuerpoJson(req);
  if (typeof body.recepcionPuedeAgendar !== "boolean") {
    return NextResponse.json(
      { error: "VALOR_INVALIDO", mensaje: "Elige «Sí» o «No» para guardar el ajuste." },
      { status: 400 },
    );
  }

  try {
    const recepcionPuedeAgendar = await guardarRecepcionPuedeAgendar(
      { clinicId: r.ctx.clinicId, userId: r.ctx.userId },
      body.recepcionPuedeAgendar,
      extractAuditMeta(req),
    );
    return NextResponse.json({
      recepcionPuedeAgendar,
      // Quien llega aquí tiene `settings.edit`: con «Sí» o con «No», puede.
      puedoAgendarEncima: puedeAgendarEncima(recepcionPuedeAgendar, true),
    });
  } catch (err) {
    if (err instanceof PoliticaSinTablaError) {
      return NextResponse.json({ error: "SQL_PENDIENTE", mensaje: err.message }, { status: 503 });
    }
    throw err;
  }
}
