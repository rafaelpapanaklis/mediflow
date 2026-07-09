// Endpoint agregado del panel de analítica del owner.
// ?section=overview|sources|geo|pages|identified  (+ from,to,surface,clinicId)
// Guard admin en cada request. Lecturas cross-clínica → prismaAdmin.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prismaAdmin } from "@/lib/prisma-admin";
import {
  parseAnalyticsFilters,
  sessionWhere,
  eventWhere,
  pickBucket,
  bucketKeyOf,
  eachBucket,
  round,
  pct,
} from "@/lib/analytics/query";
import type {
  AnalyticsFilters,
  OverviewResponse,
  SourcesResponse,
  GeoResponse,
  PagesResponse,
  IdentifiedResponse,
  SourceRow,
  CountSlice,
  TimeseriesPoint,
} from "@/lib/analytics/types";
import { LIVE_WINDOW_MS } from "@/lib/analytics/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAKE_SESSIONS = 100_000;
const TAKE_EVENTS = 150_000;

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const section = url.searchParams.get("section") || "overview";
  const filters = parseAnalyticsFilters(url.searchParams);

  try {
    switch (section) {
      case "overview":
        return NextResponse.json(await overview(filters));
      case "sources":
        return NextResponse.json(await sources(filters));
      case "geo":
        return NextResponse.json(await geo(filters));
      case "pages":
        return NextResponse.json(await pages(filters));
      case "identified":
        return NextResponse.json(await identified(filters));
      default:
        return NextResponse.json({ error: "Sección desconocida" }, { status: 400 });
    }
  } catch (e) {
    console.error(`[admin/analytics] section=${section} failed:`, e);
    return NextResponse.json({ error: "Error al calcular analítica" }, { status: 500 });
  }
}

/* ================================ OVERVIEW =================================== */
async function overview(f: AnalyticsFilters): Promise<OverviewResponse> {
  const where = sessionWhere(f);
  const now = Date.now();

  // Únicos y recurrentes en SQL (COUNT DISTINCT + EXISTS) — sin materializar ids
  // en Node ni tope artificial. Fragmentos condicionales por surface/clinic.
  const surfS = f.surface ? Prisma.sql`AND s."surface" = ${f.surface}` : Prisma.empty;
  const clinS = f.clinicId ? Prisma.sql`AND s."clinicId" = ${f.clinicId}` : Prisma.empty;
  const surfP = f.surface ? Prisma.sql`AND p."surface" = ${f.surface}` : Prisma.empty;
  const clinP = f.clinicId ? Prisma.sql`AND p."clinicId" = ${f.clinicId}` : Prisma.empty;

  const [visits, agg, bounceCount, identifiedCount, urRows] = await Promise.all([
    prismaAdmin.analyticsSession.count({ where }),
    prismaAdmin.analyticsSession.aggregate({
      where,
      _sum: { pageviews: true, clicks: true },
      _avg: { durationMs: true },
    }),
    prismaAdmin.analyticsSession.count({ where: { ...where, isBounce: true } }),
    prismaAdmin.analyticsSession.count({ where: { ...where, identityType: { notIn: ["anonymous", "admin"] } } }),
    prismaAdmin.$queryRaw<{ unique: number; returning: number }[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT s."visitorId")::int AS "unique",
        COUNT(DISTINCT s."visitorId") FILTER (WHERE EXISTS (
          SELECT 1 FROM analytics_sessions p
          WHERE p."visitorId" = s."visitorId"
            AND p."startedAt" < ${f.from}
            AND p."identityType" <> 'admin' AND p."device" <> 'bot'
            ${surfP} ${clinP}
        ))::int AS "returning"
      FROM analytics_sessions s
      WHERE s."startedAt" >= ${f.from} AND s."startedAt" <= ${f.to}
        AND s."identityType" <> 'admin' AND s."device" <> 'bot'
        ${surfS} ${clinS}
    `),
  ]);

  const [deviceRows, browserRows, osRows, liveNow, seriesRows] = await Promise.all([
    prismaAdmin.analyticsSession.groupBy({ by: ["device"], where, _count: { _all: true } }),
    prismaAdmin.analyticsSession.groupBy({ by: ["browser"], where, _count: { _all: true } }),
    prismaAdmin.analyticsSession.groupBy({ by: ["os"], where, _count: { _all: true } }),
    prismaAdmin.analyticsSession.count({
      where: {
        identityType: { not: "admin" },
        lastSeenAt: { gte: new Date(now - LIVE_WINDOW_MS) },
        ...(f.surface ? { surface: f.surface } : {}),
        ...(f.clinicId ? { clinicId: f.clinicId } : {}),
      },
    }),
    prismaAdmin.analyticsSession.findMany({
      where,
      select: { startedAt: true, visitorId: true, pageviews: true },
      take: TAKE_SESSIONS,
    }),
  ]);

  // Nuevos vs recurrentes (recurrente = visitante con sesión previa a `from`).
  const uniqueVisitors = Number(urRows[0]?.unique ?? 0);
  const returningVisitors = Number(urRows[0]?.returning ?? 0);
  const newVisitors = Math.max(0, uniqueVisitors - returningVisitors);

  const pageviews = agg._sum.pageviews ?? 0;
  const clicks = agg._sum.clicks ?? 0;

  // Serie temporal
  const bucket = pickBucket(f.from, f.to);
  const buckets = eachBucket(f.from, f.to, bucket);
  const map = new Map<string, { visits: number; pageviews: number; visitors: Set<string> }>();
  buckets.forEach((b) => map.set(b, { visits: 0, pageviews: 0, visitors: new Set() }));
  seriesRows.forEach((s) => {
    const key = bucketKeyOf(s.startedAt, bucket);
    const slot = map.get(key);
    if (slot) {
      slot.visits += 1;
      slot.pageviews += s.pageviews;
      slot.visitors.add(s.visitorId);
    }
  });
  const timeseries: TimeseriesPoint[] = buckets.map((b) => {
    const slot = map.get(b)!;
    return { bucket: b, visits: slot.visits, visitors: slot.visitors.size, pageviews: slot.pageviews };
  });

  return {
    kpis: {
      visits,
      uniqueVisitors,
      pageviews,
      bounceRate: pct(bounceCount, visits),
      avgDurationMs: Math.round(agg._avg.durationMs ?? 0),
      pagesPerVisit: visits ? round(pageviews / visits, 1) : 0,
      clicks,
      newVisitors,
      returningVisitors,
      identifiedVisits: identifiedCount,
      liveNow,
    },
    bucket,
    timeseries,
    devices: toSlices(deviceRows, "device"),
    browsers: toSlices(browserRows, "browser"),
    os: toSlices(osRows, "os"),
  };
}

function toSlices(rows: any[], key: string): CountSlice[] {
  return rows
    .map((r) => ({ key: (r[key] as string) || "Desconocido", count: r._count?._all ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

/* ================================= SOURCES ================================== */
async function sources(f: AnalyticsFilters): Promise<SourcesResponse> {
  const rows = await prismaAdmin.analyticsSession.findMany({
    where: sessionWhere(f),
    select: {
      visitorId: true,
      isBounce: true,
      referrerType: true,
      referrerHost: true,
      utmSource: true,
      utmCampaign: true,
      entryPath: true,
    },
    take: TAKE_SESSIONS,
  });

  return {
    referrerTypes: aggregateSource(rows, (r) => r.referrerType || "direct"),
    referrers: aggregateSource(rows, (r) => r.referrerHost).slice(0, 25),
    utmSources: aggregateSource(rows, (r) => r.utmSource).slice(0, 25),
    utmCampaigns: aggregateSource(rows, (r) => r.utmCampaign).slice(0, 25),
    entryPages: aggregateSource(rows, (r) => r.entryPath).slice(0, 25),
  };
}

type SourceRowInput = {
  visitorId: string;
  isBounce: boolean;
  referrerType: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  entryPath: string | null;
};

function aggregateSource(rows: SourceRowInput[], keyFn: (r: SourceRowInput) => string | null): SourceRow[] {
  const map = new Map<string, { visits: number; bounce: number; visitors: Set<string> }>();
  rows.forEach((r) => {
    const key = keyFn(r);
    if (!key) return;
    let slot = map.get(key);
    if (!slot) {
      slot = { visits: 0, bounce: 0, visitors: new Set() };
      map.set(key, slot);
    }
    slot.visits += 1;
    if (r.isBounce) slot.bounce += 1;
    slot.visitors.add(r.visitorId);
  });
  const out: SourceRow[] = [];
  map.forEach((v, key) => {
    out.push({ key, visits: v.visits, visitors: v.visitors.size, bounceRate: pct(v.bounce, v.visits) });
  });
  return out.sort((a, b) => b.visits - a.visits);
}

/* =================================== GEO ==================================== */
async function geo(f: AnalyticsFilters): Promise<GeoResponse> {
  const rows = await prismaAdmin.analyticsSession.findMany({
    where: sessionWhere(f),
    select: {
      visitorId: true,
      country: true,
      region: true,
      city: true,
      latitude: true,
      longitude: true,
    },
    take: TAKE_SESSIONS,
  });

  const countries = new Map<string, { visits: number; visitors: Set<string> }>();
  const cities = new Map<
    string,
    { country: string | null; region: string | null; city: string | null; lat: number | null; lng: number | null; visits: number; visitors: Set<string> }
  >();

  rows.forEach((r) => {
    const c = r.country || null;
    if (c) {
      let cs = countries.get(c);
      if (!cs) {
        cs = { visits: 0, visitors: new Set() };
        countries.set(c, cs);
      }
      cs.visits += 1;
      cs.visitors.add(r.visitorId);
    }
    if (r.city || r.latitude != null) {
      const key = `${r.country || "?"}|${r.region || ""}|${r.city || ""}`;
      let ct = cities.get(key);
      if (!ct) {
        ct = { country: r.country, region: r.region, city: r.city, lat: r.latitude, lng: r.longitude, visits: 0, visitors: new Set() };
        cities.set(key, ct);
      }
      if (ct.lat == null && r.latitude != null) {
        ct.lat = r.latitude;
        ct.lng = r.longitude;
      }
      ct.visits += 1;
      ct.visitors.add(r.visitorId);
    }
  });

  const countryRows = Array.from(countries.entries())
    .map(([country, v]) => ({ country, visits: v.visits, visitors: v.visitors.size }))
    .sort((a, b) => b.visits - a.visits);

  const cityRows = Array.from(cities.values())
    .map((v) => ({ country: v.country, region: v.region, city: v.city, lat: v.lat, lng: v.lng, visits: v.visits, visitors: v.visitors.size }))
    .sort((a, b) => b.visits - a.visits);

  return {
    countries: countryRows,
    cities: cityRows.slice(0, 100),
    points: cityRows.filter((c) => c.lat != null && c.lng != null).slice(0, 300),
  };
}

/* ================================== PAGES =================================== */
async function pages(f: AnalyticsFilters): Promise<PagesResponse> {
  const [pvEvents, timeRows, sessRows] = await Promise.all([
    prismaAdmin.analyticsEvent.findMany({
      where: eventWhere(f, { type: "pageview" }),
      select: { path: true, visitorId: true },
      take: TAKE_EVENTS,
    }),
    prismaAdmin.analyticsEvent.groupBy({
      by: ["path"],
      where: eventWhere(f, { type: "custom", name: "page_time" }),
      _avg: { durationMs: true },
    }),
    prismaAdmin.analyticsSession.findMany({
      where: sessionWhere(f),
      select: { entryPath: true, exitPath: true, isBounce: true },
      take: TAKE_SESSIONS,
    }),
  ]);

  const durByPath = new Map<string, number>();
  timeRows.forEach((r) => durByPath.set(r.path, Math.round(r._avg.durationMs ?? 0)));

  const pv = new Map<string, { pageviews: number; visitors: Set<string> }>();
  pvEvents.forEach((e) => {
    let slot = pv.get(e.path);
    if (!slot) {
      slot = { pageviews: 0, visitors: new Set() };
      pv.set(e.path, slot);
    }
    slot.pageviews += 1;
    slot.visitors.add(e.visitorId);
  });

  const entries = new Map<string, number>();
  const exits = new Map<string, number>();
  const bounceByPath = new Map<string, { bounce: number; total: number }>();
  sessRows.forEach((s) => {
    if (s.entryPath) {
      entries.set(s.entryPath, (entries.get(s.entryPath) || 0) + 1);
      let b = bounceByPath.get(s.entryPath);
      if (!b) {
        b = { bounce: 0, total: 0 };
        bounceByPath.set(s.entryPath, b);
      }
      b.total += 1;
      if (s.isBounce) b.bounce += 1;
    }
    if (s.exitPath) exits.set(s.exitPath, (exits.get(s.exitPath) || 0) + 1);
  });

  const rows = Array.from(pv.entries()).map(([path, v]) => {
    const b = bounceByPath.get(path);
    return {
      path,
      pageviews: v.pageviews,
      visitors: v.visitors.size,
      avgDurationMs: durByPath.get(path) ?? 0,
      entries: entries.get(path) ?? 0,
      exits: exits.get(path) ?? 0,
      bounceRate: b ? pct(b.bounce, b.total) : 0,
    };
  });

  rows.sort((a, b) => b.pageviews - a.pageviews);
  return { pages: rows.slice(0, 100) };
}

/* =============================== IDENTIFIED ================================= */
async function identified(f: AnalyticsFilters): Promise<IdentifiedResponse> {
  const rows = await prismaAdmin.analyticsSession.findMany({
    where: { ...sessionWhere(f), identityType: { notIn: ["anonymous", "admin"] } },
    select: {
      clinicId: true,
      userId: true,
      email: true,
      identityType: true,
      surface: true,
      pageviews: true,
      lastSeenAt: true,
      displayName: true,
      plan: true,
    },
    take: TAKE_SESSIONS,
  });

  const groups = new Map<
    string,
    {
      clinicId: string | null;
      identityType: string;
      plan: string | null;
      fallbackName: string | null;
      visits: number;
      pageviews: number;
      lastSeenAt: Date;
      publicVisits: number;
      dashboardVisits: number;
      users: Set<string>;
      emails: Set<string>;
    }
  >();

  rows.forEach((r) => {
    const key = r.clinicId || `__noclinic__${r.identityType}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        clinicId: r.clinicId,
        identityType: r.identityType,
        plan: r.plan,
        fallbackName: r.displayName,
        visits: 0,
        pageviews: 0,
        lastSeenAt: r.lastSeenAt,
        publicVisits: 0,
        dashboardVisits: 0,
        users: new Set(),
        emails: new Set(),
      };
      groups.set(key, g);
    }
    g.visits += 1;
    g.pageviews += r.pageviews;
    if (r.lastSeenAt > g.lastSeenAt) g.lastSeenAt = r.lastSeenAt;
    if (r.surface === "public") g.publicVisits += 1;
    if (r.surface === "dashboard") g.dashboardVisits += 1;
    if (r.userId) g.users.add(r.userId);
    if (r.email) g.emails.add(r.email);
    if (!g.plan && r.plan) g.plan = r.plan;
  });

  // Nombres de clínica actuales (join manual; sin FK en el modelo).
  const clinicIds = Array.from(groups.values())
    .map((g) => g.clinicId)
    .filter((id): id is string => !!id);
  const clinicMap = new Map<string, { name: string; plan: string }>();
  if (clinicIds.length > 0) {
    const clinics = await prismaAdmin.clinic.findMany({
      where: { id: { in: clinicIds } },
      select: { id: true, name: true, plan: true },
    });
    clinics.forEach((c) => clinicMap.set(c.id, { name: c.name, plan: c.plan as unknown as string }));
  }

  const list = Array.from(groups.values()).map((g) => {
    const clinic = g.clinicId ? clinicMap.get(g.clinicId) : undefined;
    return {
      clinicId: g.clinicId,
      clinicName: clinic?.name ?? (g.clinicId ? "Clínica eliminada" : g.fallbackName ?? (g.identityType === "patient" ? "Paciente sin clínica" : "Sin clínica")),
      plan: clinic?.plan ?? g.plan ?? null,
      identityType: g.identityType,
      visits: g.visits,
      pageviews: g.pageviews,
      lastSeenAt: g.lastSeenAt.toISOString(),
      publicVisits: g.publicVisits,
      dashboardVisits: g.dashboardVisits,
      distinctUsers: g.users.size,
      emails: Array.from(g.emails).slice(0, 5),
    };
  });

  list.sort((a, b) => b.visits - a.visits);

  return {
    clinics: list,
    totalIdentifiedVisits: list.reduce((s, r) => s + r.visits, 0),
    totalIdentifiedClinics: list.filter((r) => r.clinicId).length,
  };
}
