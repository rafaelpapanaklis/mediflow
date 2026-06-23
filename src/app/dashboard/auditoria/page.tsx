export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { AuditoriaClient } from "./auditoria-client";

// Bitácora de la clínica. SOLO ADMIN/dueño — recepción/doctor no.
export default async function DashboardAuditoriaPage() {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.isAdmin) redirect("/dashboard");
  return <AuditoriaClient />;
}
