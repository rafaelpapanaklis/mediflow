import type { Metadata } from "next";
import { AdminSoporteClient } from "./soporte-admin-client";

// La protección server-side la da src/app/admin/layout.tsx (isAdminAuthed);
// los datos llegan vía /api/admin/support/* que re-valida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soporte — Admin DaleControl" };

export default function AdminSoportePage() {
  return <AdminSoporteClient />;
}
