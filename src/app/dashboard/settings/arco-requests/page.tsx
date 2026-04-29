export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ArcoRequestsClient } from "./arco-requests-client";

export default async function ArcoRequestsPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    redirect("/dashboard");
  }

  // Solicitudes scoped a la clínica
  const clinicRequests = await prisma.arcoRequest.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Solicitudes anónimas (clinicId NULL) — solo SUPER_ADMIN.
  const anonymousRequests = user.role === "SUPER_ADMIN"
    ? await prisma.arcoRequest.findMany({
        where: { clinicId: null },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <ArcoRequestsClient
      clinicRequests={clinicRequests.map(serialize)}
      anonymousRequests={anonymousRequests.map(serialize)}
      isSuperAdmin={user.role === "SUPER_ADMIN"}
    />
  );
}

function serialize<T extends { createdAt: Date; resolvedAt: Date | null }>(r: T) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}
