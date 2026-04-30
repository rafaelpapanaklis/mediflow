import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { BugAuditClient } from "./bug-audit-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Auditoría de bugs · MediFlow" };

export default async function BugAuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") {
    // Solo SUPER_ADMIN puede ver esta página. Cualquier otro rol → /dashboard.
    redirect("/dashboard");
  }
  return <BugAuditClient />;
}
