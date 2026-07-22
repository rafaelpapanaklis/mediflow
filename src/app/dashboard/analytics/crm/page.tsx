export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { CrmClient } from "./crm-client";

export const metadata: Metadata = { title: "CRM — Analytics" };

export default async function CrmPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return (
      <div style={{ padding: 32, color: "var(--text-3)", fontSize: 13 }}>
        Solo administradores pueden ver el CRM.
      </div>
    );
  }
  return <CrmClient key={user.clinicId} />;
}
