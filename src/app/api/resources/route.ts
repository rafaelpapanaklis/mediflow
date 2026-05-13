/**
 * @deprecated 2026-05-06: This endpoint manages the legacy `ResourceBooking` model
 * (free-text strings, no relation to `Appointment.resourceId`). Use
 * `/api/agenda/resources/**` for typed CHAIR/ROOM/EQUIPMENT Resources.
 * Kept functional only for `/dashboard/resource-bookings` (URL-only, not in sidebar).
 * If `SELECT COUNT(*) FROM "resource_bookings"` returns 0 in prod, drop in next migration.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "date query param is required (YYYY-MM-DD)" }, { status: 400 });
  }

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const bookings = await prisma.resourceBooking.findMany({
    where: {
      clinicId: ctx.clinicId,
      startTime: { gte: dayStart },
      endTime: { lte: dayEnd },
    },
    orderBy: { startTime: "asc" },
  });

  // Group by resourceName
  const grouped: Record<string, typeof bookings> = {};
  for (const b of bookings) {
    if (!grouped[b.resourceName]) grouped[b.resourceName] = [];
    grouped[b.resourceName].push(b);
  }

  return NextResponse.json(grouped);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { resourceType, resourceName, startTime, endTime, appointmentId } = body;

  if (!resourceType || !resourceName || !startTime || !endTime) {
    return NextResponse.json(
      { error: "resourceType, resourceName, startTime, and endTime are required" },
      { status: 400 }
    );
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  // Validate no overlap on same resource
  const overlap = await prisma.resourceBooking.findFirst({
    where: {
      clinicId: ctx.clinicId,
      resourceName,
      startTime: { lt: end },
      endTime: { gt: start },
    },
  });
  if (overlap) {
    return NextResponse.json(
      { error: "Resource already booked for this time slot" },
      { status: 409 }
    );
  }

  const booking = await prisma.resourceBooking.create({
    data: {
      clinicId: ctx.clinicId,
      resourceType,
      resourceName,
      startTime: start,
      endTime: end,
      appointmentId: appointmentId ?? null,
    },
  });

  return NextResponse.json(booking, { status: 201 });
}
