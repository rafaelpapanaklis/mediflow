import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  DetallesAlPasarSinColumnaError,
  guardarDetallesAlPasar,
  leerDetallesAlPasar,
} from "@/lib/agenda-nueva/detalles-al-pasar.server";

export const dynamic = "force-dynamic";

/**
 * /api/agenda/detalles-al-pasar — el interruptor «Mostrar detalles al pasar el mouse» de la Agenda nueva
 * (decisión de Rafael, 28-oct-2026). Es una preferencia de CADA persona, no de la clínica:
 *
 *     GET  (agenda.view)  → { encendida }
 *     PUT  (agenda.view)  ← { encendida: boolean } → { encendida, filas }  (409 si no tocó ni su fila)
 *
 * Solo toca las filas de quien llama (las suyas en cada sede; ver `guardarDetallesAlPasar`). Sin
 * sql/agenda-detalles-al-pasar.sql el GET dice encendida y el PUT contesta 503 (la pantalla lo deja cambiado
 * solo en esta pestaña). La agenda recibe la preferencia en la SSR (page.tsx): el GET queda para quien la
 * monte sin ella.
 */

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;
  const encendida = await leerDetallesAlPasar(session.clinic.id, session.user.id);
  return NextResponse.json({ encendida }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;

  let body: { encendida?: unknown } = {};
  try {
    const crudo = await req.json();
    if (crudo && typeof crudo === "object") body = crudo as { encendida?: unknown };
  } catch {
    body = {};
  }
  if (typeof body.encendida !== "boolean") {
    return NextResponse.json({ error: "encendida debe ser true o false" }, { status: 400 });
  }
  let filas: number;
  try {
    filas = await guardarDetallesAlPasar(session.clinic.id, session.user.id, body.encendida);
  } catch (err) {
    if (err instanceof DetallesAlPasarSinColumnaError) {
      return NextResponse.json({ error: "SQL_PENDIENTE" }, { status: 503 });
    }
    throw err;
  }
  // Ni su propia fila: no se guardó (la pantalla avisa en vez de decir «Se guarda en tu cuenta»).
  if (filas === 0) return NextResponse.json({ error: "NO_GUARDADO" }, { status: 409 });
  return NextResponse.json({ encendida: body.encendida, filas });
}
