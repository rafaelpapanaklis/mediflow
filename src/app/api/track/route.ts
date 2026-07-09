// Ingesta de analítica de primera parte. Fuera del matcher del middleware
// (no empieza por /admin|/dashboard|/proveedores) → sin refresh de Supabase.
// CSRF ligero propio (Origin same-origin) + cap de tamaño + drop de bots.
// SIEMPRE responde 204: jamás debe romper la navegación.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaAdmin } from "@/lib/prisma-admin";
import { readGeo } from "@/lib/analytics/geo";
import { parseUserAgent } from "@/lib/analytics/ua";
import { classifyReferrer } from "@/lib/analytics/referrer";
import { resolveIdentity } from "@/lib/analytics/identity";
import { surfaceFromPath, MAX_BATCH } from "@/lib/analytics/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EventSchema = z
  .object({
    type: z.enum(["pageview", "click", "scroll", "custom", "rage_click"]),
    path: z.string().min(1).max(512),
    t: z.number().optional(),
    title: z.string().max(300).optional(),
    referrer: z.string().max(1024).optional(),
    name: z.string().max(80).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    vw: z.number().int().optional(),
    vh: z.number().int().optional(),
    docH: z.number().int().optional(),
    scrollPct: z.number().optional(),
    selector: z.string().max(200).optional(),
    text: z.string().max(160).optional(),
    durationMs: z.number().optional(),
  })
  .strip();

const PayloadSchema = z.object({
  sid: z.string().min(6).max(80),
  vid: z.string().min(6).max(80),
  events: z.array(EventSchema).min(1).max(MAX_BATCH),
  screenW: z.number().int().optional(),
  screenH: z.number().int().optional(),
  language: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
  referrer: z.string().max(1024).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  gclid: z.string().max(300).optional(),
});

type Payload = z.infer<typeof PayloadSchema>;

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  // CSRF ligero: sólo aceptar POST del mismo origen (el tracker siempre es same-origin).
  // Si Origin está ausente (algunos POST same-origin lo omiten) se permite; si está
  // presente y no coincide con el host, se descarta (forced-post cross-site).
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host")) return NO_CONTENT();
    } catch {
      return NO_CONTENT();
    }
  }

  let payload: Payload;
  try {
    const raw = await req.text();
    if (!raw || raw.length > 64_000) return NO_CONTENT(); // cap de tamaño del payload
    payload = PayloadSchema.parse(JSON.parse(raw));
  } catch {
    return NO_CONTENT(); // payload inválido → silenciar
  }

  try {
    await ingest(req, payload);
  } catch (e) {
    console.error("[track] ingest failed:", e);
  }
  return NO_CONTENT();
}

async function ingest(req: NextRequest, p: Payload): Promise<void> {
  const pvEvents = p.events.filter((e) => e.type === "pageview");
  const firstPath = pvEvents.length ? pvEvents[0].path : p.events[0].path;
  const surface = surfaceFromPath(firstPath);
  if (surface === "admin") return; // no se rastrea el panel del owner

  const now = new Date();
  const geo = readGeo(req);
  const ua = parseUserAgent(req.headers.get("user-agent"));
  if (ua.device === "bot") return; // no rastrear bots que ejecutan JS (Lighthouse, headless, scrapers)
  const selfHost = req.headers.get("host");
  const ref = classifyReferrer({
    referrer: p.referrer,
    selfHost,
    utmMedium: p.utmMedium,
    utmSource: p.utmSource,
    gclid: p.gclid,
  });

  const pvCount = pvEvents.length;
  const clickCount = p.events.filter((e) => e.type === "click").length;
  const lastPvPath = pvEvents.length ? pvEvents[pvEvents.length - 1].path : null;
  const batchMaxScroll = p.events.reduce((m, e) => Math.max(m, e.scrollPct || 0), 0);

  const existing = await prismaAdmin.analyticsSession.findUnique({
    where: { id: p.sid },
    select: {
      id: true,
      startedAt: true,
      pageviews: true,
      identityType: true,
      clinicId: true,
      maxScroll: true,
    },
  });

  // Identidad: sólo al crear o mientras siga anónima (evita getUser en cada batch).
  let identity = null as Awaited<ReturnType<typeof resolveIdentity>> | null;
  if (!existing || existing.identityType === "anonymous") {
    identity = await resolveIdentity();
  }

  // El owner (admin de plataforma) no se rastrea en NINGUNA superficie: ni sesión
  // ni eventos (heatmap/páginas). Evita contaminar las métricas con uso propio.
  if (identity?.identityType === "admin") return;

  const identityPatch =
    identity && identity.identityType !== "anonymous"
      ? {
          identityType: identity.identityType,
          clinicId: identity.clinicId,
          userId: identity.userId,
          patientAccountId: identity.patientAccountId,
          email: identity.email,
          displayName: identity.displayName,
          role: identity.role,
          plan: identity.plan,
        }
      : {};

  if (!existing) {
    try {
      await prismaAdmin.analyticsSession.create({
        data: {
          id: p.sid,
          visitorId: p.vid,
          surface,
          clinicId: identity?.clinicId ?? null,
          userId: identity?.userId ?? null,
          patientAccountId: identity?.patientAccountId ?? null,
          identityType: identity?.identityType ?? "anonymous",
          email: identity?.email ?? null,
          displayName: identity?.displayName ?? null,
          role: identity?.role ?? null,
          plan: identity?.plan ?? null,
          entryPath: firstPath,
          exitPath: lastPvPath ?? firstPath,
          referrer: p.referrer ?? null,
          referrerHost: ref.host,
          referrerType: ref.type,
          utmSource: p.utmSource ?? null,
          utmMedium: p.utmMedium ?? null,
          utmCampaign: p.utmCampaign ?? null,
          utmTerm: p.utmTerm ?? null,
          utmContent: p.utmContent ?? null,
          gclid: p.gclid ?? null,
          country: geo.country,
          region: geo.region,
          city: geo.city,
          latitude: geo.latitude,
          longitude: geo.longitude,
          ip: geo.ip,
          device: ua.device,
          browser: ua.browser,
          os: ua.os,
          screenW: p.screenW ?? null,
          screenH: p.screenH ?? null,
          language: p.language ?? null,
          timezone: p.timezone ?? null,
          pageviews: pvCount,
          clicks: clickCount,
          maxScroll: batchMaxScroll,
          durationMs: 0,
          isBounce: pvCount <= 1,
          startedAt: now,
          lastSeenAt: now,
        },
      });
    } catch (err: any) {
      // Carrera: otro batch del mismo sid creó la fila (unique P2002). En vez de
      // perder este batch, caemos a un update incremental idempotente.
      if (err?.code === "P2002") {
        await prismaAdmin.analyticsSession.update({
          where: { id: p.sid },
          data: {
            lastSeenAt: now,
            ...(lastPvPath ? { exitPath: lastPvPath } : {}),
            pageviews: { increment: pvCount },
            clicks: { increment: clickCount },
            ...identityPatch,
          },
        });
      } else {
        throw err;
      }
    }
  } else {
    const totalPv = existing.pageviews + pvCount;
    const dur = Math.max(0, now.getTime() - existing.startedAt.getTime());
    await prismaAdmin.analyticsSession.update({
      where: { id: p.sid },
      data: {
        lastSeenAt: now,
        ...(lastPvPath ? { exitPath: lastPvPath } : {}),
        pageviews: { increment: pvCount },
        clicks: { increment: clickCount },
        durationMs: dur,
        maxScroll: Math.max(existing.maxScroll, batchMaxScroll),
        isBounce: totalPv <= 1,
        ...identityPatch,
      },
    });
  }

  const clinicIdForEvents = identity?.clinicId ?? existing?.clinicId ?? null;
  await prismaAdmin.analyticsEvent.createMany({
    data: p.events.map((e) => ({
      sessionId: p.sid,
      visitorId: p.vid,
      clinicId: clinicIdForEvents,
      surface,
      type: e.type,
      path: e.path,
      title: e.title ?? null,
      referrer: e.referrer ?? null,
      name: e.name ?? null,
      x: e.x ?? null,
      y: e.y ?? null,
      vw: e.vw ?? null,
      vh: e.vh ?? null,
      docH: e.docH ?? null,
      scrollPct: e.scrollPct ?? null,
      selector: e.selector ?? null,
      text: e.text ?? null,
      durationMs: e.durationMs ?? null,
      createdAt: now,
    })),
  });
}
