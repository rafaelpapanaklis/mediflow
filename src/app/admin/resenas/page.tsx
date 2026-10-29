import type { Metadata } from "next";
import { AdminResenasClient } from "./AdminResenasClient";
import { requireAdminPage } from "@/lib/admin-page-guard";

// La protección server-side la da src/app/admin/layout.tsx (isAdminAuthed);
// los datos llegan vía /api/admin/reviews que re-valida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseñas — Admin DaleControl" };

export default async function AdminResenasPage() {
  await requireAdminPage();
  return <AdminResenasClient />;
}
