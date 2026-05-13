import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { loadResourceSchedule } from "@/lib/agenda/resource-schedule.server";
import type { ResourceScheduleResponse, WeekScheduleDTO } from "@/lib/agenda/types";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const WindowSchema = z
  .object({
    startTime: z.string().regex(TIME_RE, "startTime must be HH:MM"),
    endTime: z.string().regex(TIME_RE, "endTime must be HH:MM"),
  })
  .refine((w) => w.startTime < w.endTime, {
    message: "startTime must be < endTime",
  });

const DaySchema = z.array(WindowSchema).max(4).refine(
  (windows) => {
    // No overlap between windows of the same day. Sort by start, check pairs.
    const sorted = [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.startTime < sorted[i - 1]!.endTime) return false;
    }
    return true;
  },
  { message: "windows overlap within the same day" },
);

const PutSchema = z.object({
  schedule: z
    .object({
      days: z.object({
        0: DaySchema,
        1: DaySchema,
        2: DaySchema,
        3: DaySchema,
        4: DaySchema,
        5: DaySchema,
        6: DaySchema,
      }),
    })
    .nullable(),
});

async function ensureResourceInClinic(
  resourceId: string,
  clinicId: string,
): Promise<{ id: string } | null> {
  return prisma.resource.findFirst({
    where: { id: resourceId, clinicId },
    select: { id: true },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "resources.view");
  if (denied) return denied;

  const params = await ctx.params;
  const exists = await ensureResourceInClinic(params.id, session.clinic.id);
  if (!exists) {
    return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
  }

  const schedule = await loadResourceSchedule(params.id);
  const body: ResourceScheduleResponse = {
    resourceId: params.id,
    alwaysOpen: schedule === null,
    schedule,
  };
  return NextResponse.json(body);
}

export async function PUT(
  req: Request,
  ctx: { params: { id: string } | Promise<{ id: string }> },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "resources.edit");
  if (denied) return denied;

  const params = await ctx.params;
  const exists = await ensureResourceInClinic(params.id, session.clinic.id);
  if (!exists) {
    return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { schedule } = parsed.data;
  const flatRows: Array<{
    resourceId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }> = [];

  if (schedule !== null) {
    for (let day = 0; day <= 6; day++) {
      const windows = schedule.days[day as 0 | 1 | 2 | 3 | 4 | 5 | 6];
      for (const w of windows) {
        flatRows.push({
          resourceId: params.id,
          dayOfWeek: day,
          startTime: w.startTime,
          endTime: w.endTime,
        });
      }
    }
  }

  await prisma.$transaction([
    prisma.resourceSchedule.deleteMany({ where: { resourceId: params.id } }),
    ...(flatRows.length > 0
      ? [prisma.resourceSchedule.createMany({ data: flatRows })]
      : []),
  ]);

  // Reload to return canonical state (matches GET shape).
  const reloaded = await loadResourceSchedule(params.id);
  const responseBody: ResourceScheduleResponse = {
    resourceId: params.id,
    alwaysOpen: reloaded === null,
    schedule: reloaded as WeekScheduleDTO | null,
  };
  return NextResponse.json(responseBody);
}
