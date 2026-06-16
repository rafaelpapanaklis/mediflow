// Resumen del módulo Marketing (WS-MKT-T6). Server component: calcula los
// KPIs y los próximos posts directamente desde prisma (los 3 modelos son de
// foundation, SQL aplicado) para que la portada funcione aunque T3/T4 aún no
// hayan publicado sus rutas API. Todo va envuelto en try/catch: si las tablas
// no estuvieran migradas, la portada degrada a ceros y estados vacíos amables.

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MarketingOverviewClient, type OverviewData } from "./overview-client";

export const metadata: Metadata = { title: "Marketing — DaleControl" };

export default async function MarketingOverviewPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let data: OverviewData = {
    scheduled: 0,
    publishedThisMonth: 0,
    drafts: 0,
    failed: 0,
    connectedAccounts: 0,
    upcoming: [],
  };

  try {
    const [scheduled, publishedThisMonth, drafts, failed, connectedAccounts, upcoming] =
      await Promise.all([
        prisma.marketingPost.count({ where: { clinicId, status: "SCHEDULED" } }),
        prisma.marketingPost.count({
          where: { clinicId, status: "PUBLISHED", publishedAt: { gte: firstOfMonth } },
        }),
        prisma.marketingPost.count({ where: { clinicId, status: "DRAFT" } }),
        prisma.marketingPost.count({ where: { clinicId, status: "FAILED" } }),
        prisma.socialAccount.count({ where: { clinicId, connected: true } }),
        prisma.marketingPost.findMany({
          where: { clinicId, status: "SCHEDULED", scheduledFor: { gte: now } },
          orderBy: { scheduledFor: "asc" },
          take: 5,
          select: { id: true, channel: true, caption: true, scheduledFor: true },
        }),
      ]);

    data = {
      scheduled,
      publishedThisMonth,
      drafts,
      failed,
      connectedAccounts,
      upcoming: upcoming.map((p) => ({
        id: p.id,
        channel: p.channel,
        caption: p.caption,
        scheduledFor: p.scheduledFor ? p.scheduledFor.toISOString() : null,
      })),
    };
  } catch (e) {
    // Tablas de marketing aún sin migrar u otro fallo de DB → portada vacía.
    console.error("[marketing/overview] fallo al cargar KPIs", e);
  }

  return <MarketingOverviewClient data={data} />;
}
