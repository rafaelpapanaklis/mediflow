import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
 * GET /api/dashboard/sidebar-counts
 * Counts agregados consumidos por el sidebar:
 *  - inboxUnread: threads en estado UNREAD
 *  - messagesUnread: chats WhatsApp standalone (legacy)
 *  - clinicalDrafts: notas SOAP en borrador
 *  - xraysUnanalyzed: rx pendientes de análisis IA
 *
 * Tolerante a tablas faltantes (P2021 / 42P01) para no romper el sidebar
 * cuando una migración aún no se aplicó.
 */
export async function GET() {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) {
      return NextResponse.json(
        { messagesUnread: 0, clinicalDrafts: 0, xraysUnanalyzed: 0, inboxUnread: 0 },
        { status: 200 },
      );
    }
    const clinicId = dbUser.clinicId;

    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "P2021" || code === "42P01") return fallback;
        throw err;
      }
    };

    const [inboxUnread, clinicalDrafts] = await Promise.all([
      safe(
        () =>
          prisma.inboxThread.count({
            where: { clinicId, status: "UNREAD" },
          }),
        0,
      ),
      safe(
        () =>
          prisma.medicalRecord.count({
            where: {
              clinicId,
              specialtyData: { path: ["status"], equals: "DRAFT" },
            },
          }),
        0,
      ),
    ]);

    return NextResponse.json({
      messagesUnread: 0, // legacy (chat WhatsApp standalone)
      clinicalDrafts,
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
