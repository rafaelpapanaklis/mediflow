import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
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
