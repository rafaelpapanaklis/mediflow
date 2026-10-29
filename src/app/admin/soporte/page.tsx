import type { Metadata } from "next";
import { AdminSoporteClient } from "./soporte-admin-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

// La protección server-side la da src/app/admin/layout.tsx (isAdminAuthed);
// los datos llegan vía /api/admin/support/* que re-valida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soporte — Admin DaleControl" };

export default async function AdminSoportePage() {
  await requireAdminPage();
  return <AdminSoporteClient />;
}
