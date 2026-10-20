import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { estadoEntranteParaPantalla, sincronizarCalendarioEntrante } from "@/lib/google/entrante.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Si la última sincronización fue hace menos que esto, abrir la agenda no la repite. */
const MIN_ENTRE_SYNCS_MS = 60_000;

// GET  → estado para la agenda: ¿la clínica tiene Google → agenda? ¿hay que reconectar?
// POST → lo mismo, pero antes sincroniza (la agenda lo llama al abrirse: así
//        panel.108, que no corre crons, también se pone al día). WS1-T9.
export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;
  return NextResponse.json(await estadoEntranteParaPantalla(session.clinic.id), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;

  const antes = await estadoEntranteParaPantalla(session.clinic.id);
  let sincronizado = false;
  const reciente = !!antes.ultimoIntento && Date.now() - new Date(antes.ultimoIntento).getTime() < MIN_ENTRE_SYNCS_MS;
  if (antes.encendida && antes.conectada && !reciente) {
    const r = await sincronizarCalendarioEntrante(session.clinic.id, { presupuestoMs: 20_000 });
    sincronizado = r.estado === "ok" && (r.creados + r.actualizados + r.retirados > 0);
  }
  const despues = sincronizado || !reciente ? await estadoEntranteParaPantalla(session.clinic.id) : antes;
  return NextResponse.json({ ...despues, cambios: sincronizado }, { headers: { "Cache-Control": "no-store" } });
}
