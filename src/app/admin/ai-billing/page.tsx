export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { AiBillingClient } from "./ai-billing-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const metadata: Metadata = { title: "Tesorería IA — Admin DaleControl" };

// Auth = sesión en BD vía isAdminAuthed(): el middleware sólo comprueba que la
// cookie admin_token esté presente sobre /admin/*; la validación real la hacen
// el layout de /admin y cada ruta de /api/admin/*.
export default async function AdminAiBillingPage() {
  await requireAdminPage();
  return <AiBillingClient />;
}
