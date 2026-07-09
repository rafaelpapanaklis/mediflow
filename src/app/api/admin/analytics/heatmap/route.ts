// Heatmap de clicks por página (owner). Devuelve puntos normalizados + ranking
// de elementos más clickeados + lista de rutas con clicks para el selector.

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import { parseAnalyticsFilters, eventWhere } from "@/lib/analytics/query";
import type { HeatmapResponse, HeatPoint, HeatElement, HeatmapPathOption } from "@/lib/analytics/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_POINTS = 8000;

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filters = parseAnalyticsFilters(url.searchParams);
  const requestedPath = url.searchParams.get("path");

  try {
    // Rutas con clicks (para el selector). groupBy path sobre eventos click.
    const pathRows = await prismaAdmin.analyticsEvent.groupBy({
      by: ["path"],
      where: eventWhere(filters, { type: "click" }),
      _count: { _all: true },
    });
    const paths: HeatmapPathOption[] = pathRows
      .map((r) => ({ path: r.path, clicks: r._count?._all ?? 0 }))
      .filter((p) => p.clicks > 0)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 100);

    const path = requestedPath || (paths[0]?.path ?? "/");

    const clicks = await prismaAdmin.analyticsEvent.findMany({
      where: eventWhere(filters, { type: "click", path }),
      select: { x: true, y: true, docH: true, vw: true, selector: true, text: true },
      take: MAX_POINTS,
      orderBy: { createdAt: "desc" },
    });

    const points: HeatPoint[] = [];
    const elements = new Map<string, { count: number; text: string | null }>();
    clicks.forEach((c) => {
      if (c.x != null && c.y != null) {
        points.push({ x: c.x, y: c.y, docH: c.docH ?? 0, vw: c.vw ?? 0 });
      }
      const sel = c.selector || "(desconocido)";
      let el = elements.get(sel);
      if (!el) {
        el = { count: 0, text: c.text ?? null };
        elements.set(sel, el);
      }
      el.count += 1;
      if (!el.text && c.text) el.text = c.text;
    });

    const elementRows: HeatElement[] = Array.from(elements.entries())
      .map(([selector, v]) => ({ selector, text: v.text, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40);

    const total = await prismaAdmin.analyticsEvent.count({ where: eventWhere(filters, { type: "click", path }) });

    const body: HeatmapResponse = { path, points, elements: elementRows, total, paths };
    return NextResponse.json(body);
  } catch (e) {
    console.error("[admin/analytics/heatmap] failed:", e);
    return NextResponse.json({ error: "Error al calcular heatmap" }, { status: 500 });
  }
}
