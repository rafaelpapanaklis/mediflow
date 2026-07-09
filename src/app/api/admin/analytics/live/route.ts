// Visitantes en vivo (owner). Sesiones activas en la ventana LIVE_WINDOW_MS.
// Se consulta por polling desde el panel (cada ~5s). Sin realtime público:
// la ubicación jamás sale del servidor (admin-gated).

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { LIVE_WINDOW_MS } from "@/lib/analytics/constants";
import type { LiveResponse, LiveVisitor } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const since = new Date(Date.now() - LIVE_WINDOW_MS);
    const rows = await prismaAdmin.analyticsSession.findMany({
      where: { identityType: { not: "admin" }, lastSeenAt: { gte: since } },
      orderBy: { lastSeenAt: "desc" },
      take: 500,
      select: {
        id: true,
        surface: true,
        identityType: true,
        clinicId: true,
        email: true,
        displayName: true,
        entryPath: true,
        exitPath: true,
        country: true,
        city: true,
        latitude: true,
        longitude: true,
        device: true,
        browser: true,
        referrerType: true,
        pageviews: true,
        startedAt: true,
        lastSeenAt: true,
      },
    });

    // Nombres de clínica actuales (join manual).
    const clinicIds = Array.from(new Set(rows.map((r) => r.clinicId).filter((id): id is string => !!id)));
    const clinicMap = new Map<string, string>();
    if (clinicIds.length > 0) {
      const clinics = await prismaAdmin.clinic.findMany({
        where: { id: { in: clinicIds } },
        select: { id: true, name: true },
      });
      clinics.forEach((c) => clinicMap.set(c.id, c.name));
    }

    const visitors: LiveVisitor[] = rows.map((r) => ({
      sid: r.id,
      surface: r.surface,
      identityType: r.identityType,
      clinicName: r.clinicId ? clinicMap.get(r.clinicId) ?? r.displayName ?? "Clínica" : r.displayName,
      email: r.email,
      path: r.exitPath || r.entryPath || "/",
      country: r.country,
      city: r.city,
      lat: r.latitude,
      lng: r.longitude,
      device: r.device,
      browser: r.browser,
      referrerType: r.referrerType,
      pageviews: r.pageviews,
      startedAt: r.startedAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    }));

    const byCountry = new Map<string, number>();
    visitors.forEach((v) => {
      const c = v.country || "??";
      byCountry.set(c, (byCountry.get(c) || 0) + 1);
    });
    const countByCountry = Array.from(byCountry.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const body: LiveResponse = {
      visitors,
      count: visitors.length,
      countByCountry,
      windowMinutes: Math.round(LIVE_WINDOW_MS / 60000),
      windowSeconds: Math.round(LIVE_WINDOW_MS / 1000),
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error("[admin/analytics/live] failed:", e);
    return NextResponse.json({ error: "Error al cargar visitantes en vivo" }, { status: 500 });
  }
}
