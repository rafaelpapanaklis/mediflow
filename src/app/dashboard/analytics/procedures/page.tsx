export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { ProceduresClient } from "./procedures-client";

export const metadata: Metadata = { title: "Procedimientos — Analytics" };

export default async function ProceduresPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.proceduresPage.adminOnly")}</div>;
  }
  return <ProceduresClient />;
}
