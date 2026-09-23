import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { cachedByKey, claveDeClinica } from "@/lib/route-cache";

export const dynamic = "force-dynamic";

// El menú de TODAS las pantallas pide esto al cargar y cada 60 s. El conteo
// es por clínica, no por usuario, así que varias pestañas/usuarios de la misma
// clínica comparten el resultado dentro de la ventana sin filtrar nada entre
// ellos.
//
// CUÁNTO PUEDE ENVEJECER (ws1-t1): como mucho 30 s para quien no tocó nada,
// que es la mitad del sondeo del menú. Quien SÍ lo cambió —leer, archivar o
// posponer un hilo en Mensajes— pide la siguiente lectura con `?fresco=1`
// (ver @/lib/armazon/refrescar), así que su insignia baja en el acto aunque la
// petición caiga en otra instancia.
const CACHE_TTL_MS = 30_000;

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí (Supabase + prisma a
// mano), pero pasando por los gates de 2FA y de plan vencido que la copia se
// saltaba. ctx.user es la fila User con permissionsOverride normalizado, así
// que sirve tal cual para denyIfMissingPermission.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

/**
 * GET /api/dashboard/sidebar-counts[?fresco=1]
 * Counts agregados consumidos por el sidebar:
 *  - inboxUnread: threads en estado UNREAD — la ÚNICA que pinta un menú hoy
 *    (countKey de sidebar-nav.ts; el menú de dos niveles usa las mismas).
 *  - messagesUnread: chats WhatsApp standalone (legacy), siempre 0.
 *  - clinicalDrafts: siempre 0. Era un conteo JSON sobre TODAS las notas
 *    clínicas de la clínica (specialtyData.status = DRAFT) en cada sondeo, y
 *    ningún menú lo enseña (ws1-t1). La clave sigue en la respuesta para no
 *    romper el contrato; si un día se pinta, se vuelve a contar.
 *  - xraysUnanalyzed: futuro (lógica de análisis IA), siempre 0.
 *
 * Tolerante a tablas faltantes (P2021 / 42P01) para no romper el sidebar
 * cuando una migración aún no se aplicó.
 */
export async function GET(req?: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) {
      return NextResponse.json(
        { messagesUnread: 0, clinicalDrafts: 0, xraysUnanalyzed: 0, inboxUnread: 0 },
        { status: 200 },
      );
    }
    const clinicId: string = dbUser.clinicId;
    const fresco = req?.nextUrl?.searchParams.get("fresco") === "1";

    const inboxUnread = await cachedByKey(
      claveDeClinica("sidebar-counts", clinicId),
      CACHE_TTL_MS,
      async () => {
        try {
          return await prisma.inboxThread.count({ where: { clinicId, status: "UNREAD" } });
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === "P2021" || code === "42P01") return 0;
          throw err;
        }
      },
      { fresco },
    );

    return NextResponse.json({
      messagesUnread: 0, // legacy (chat WhatsApp standalone)
      clinicalDrafts: 0, // no lo pinta ningún menú: ver arriba
      xraysUnanalyzed: 0, // futuro (lógica de análisis IA)
      inboxUnread,
    });
  } catch (err) {
    console.error("[GET /api/dashboard/sidebar-counts]", err);
    return NextResponse.json(
      { messagesUnread: 0, clinicalDrafts: 0, xraysUnanalyzed: 0, inboxUnread: 0 },
      { status: 200 },
    );
  }
}
