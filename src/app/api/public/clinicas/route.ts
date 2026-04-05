import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/public/clinicas?q=dental&city=merida&service=ortodoncia
// No auth required — public search endpoint
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q       = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const city    = searchParams.get("city")?.trim().toLowerCase() ?? "";
  const service = searchParams.get("service")?.trim().toLowerCase() ?? "";

  const clinics = await prisma.clinic.findMany({
    where: {
      isPublic: true, // Only show public clinics
      ...(city ? {
        city: { contains: city, mode: "insensitive" },
      } : {}),
      ...(q ? {
        OR: [
          { name:      { contains: q, mode: "insensitive" } },
          { specialty: { contains: q, mode: "insensitive" } },
          { city:      { contains: q, mode: "insensitive" } },
          { description:{ contains: q, mode: "insensitive" } },
        ],
      } : {}),
    },
    select: {
      id:          true,
      name:        true,
      slug:        true,
      specialty:   true,
      city:        true,
      address:     true,
      phone:       true,
      logoUrl:     true,
      description: true,
      schedules: {
        where:  { enabled: true },
        select: { dayOfWeek: true, openTime: true, closeTime: true },
      },
      users: {
        where:  { isActive: true, role: { in: ["DOCTOR","ADMIN"] } },
        select: {
          id:        true,
          firstName: true,
          lastName:  true,
          specialty: true,
          color:     true,
          services:  true,
        },
      },
    },
    orderBy: { name: "asc" },
    take: 50,
  });

  // If searching by service, filter clinics that have at least one doctor
  // whose services array includes that service (case-insensitive)
  let filtered = clinics;
  if (service) {
    filtered = clinics.filter(c =>
      c.users.some(u =>
        u.services.some(s => s.toLowerCase().includes(service))
      )
    ).map(c => ({
      ...c,
      // Only show doctors that offer this service
      users: c.users.filter(u =>
        u.services.some(s => s.toLowerCase().includes(service))
      ),
    }));
  }

  // Return safe public data only
  return NextResponse.json(filtered.map(c => ({
    id:          c.id,
    name:        c.name,
    slug:        c.slug,
    specialty:   c.specialty,
    city:        c.city,
    address:     c.address,
    phone:       c.phone,
    logoUrl:     c.logoUrl,
    description: c.description,
    doctorCount: c.users.length,
    doctors:     c.users.map(u => ({
      id:        u.id,
      name:      `Dr/a. ${u.firstName} ${u.lastName}`,
      specialty: u.specialty,
      color:     u.color,
      services:  u.services,
    })),
    openDays: c.schedules.map(s => s.dayOfWeek),
  })));
}
