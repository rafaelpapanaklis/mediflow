export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { BugAuditClient } from "./bug-audit-client";

export const metadata: Metadata = { title: "Auditoría de bugs · Admin MediFlow" };

/**
 * Panel de auditoría de bugs — zona /admin/* (platform owner).
 * Auth la enforcea el middleware vía cookie `admin_token` comparada con
 * `ADMIN_SECRET_TOKEN`. No requiere getCurrentUser/Supabase aquí.
 */
export default function BugAuditPage() {
  return <BugAuditClient />;
}
