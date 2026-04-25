export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PatientsClient } from "./patients-client";

const PAGE_SIZE = 50;

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: { search?: string; page?: string; status?: string };
}) {
  const user   = await getCurrentUser();
  const search = searchParams.search?.trim() ?? "";
  const page   = Math.max(1, parseInt(searchParams.page ?? "1"));
  const skip   = (page - 1) * PAGE_SIZE;
  const statusFilter = searchParams.status ?? "all";

  const statusWhere = statusFilter === "active"   ? { status: "ACTIVE" as const }
                     : statusFilter === "inactive" ? { status: "INACTIVE" as const }
                     : statusFilter === "archived" ? { status: "ARCHIVED" as const }
                     : { status: { not: "ARCHIVED" as const } };

  const where = {
    clinicId: user.clinicId,
    ...statusWhere,
    ...(search ? {
      OR: [
        { firstName:     { contains: search, mode: "insensitive" as const } },
        { lastName:      { contains: search, mode: "insensitive" as const } },
        { phone:         { contains: search } },
        { patientNumber: { contains: search } },
      ],
    } : {}),
  };

  const [patients, total, activeCount] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        patientNumber: true,
        phone: true,
        email: true,
        gender: true,
        dob: true,
        status: true,
        createdAt: true,
        tags: true,
        _count: { select: { appointments: true, records: true } },
        appointments: {
          orderBy: { startsAt: "desc" },
          take: 1,
          select: { startsAt: true, status: true },
        },
      },
    }),
    prisma.patient.count({ where }),
    prisma.patient.count({ where: { clinicId: user.clinicId, status: "ACTIVE" } }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <PatientsClient
      patients={patients as any}
      total={total}
      activeCount={activeCount}
      page={page}
      totalPages={totalPages}
      search={search}
      statusFilter={statusFilter}
    />
  );
}
