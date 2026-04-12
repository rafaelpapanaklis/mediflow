export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ProceduresClient } from "./procedures-client";

export default async function ProceduresPage() {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") redirect("/dashboard");

  const procedures = await prisma.procedureCatalog.findMany({
    where: { clinicId: user.clinicId },
    orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  return <ProceduresClient initialProcedures={procedures as any} />;
}
