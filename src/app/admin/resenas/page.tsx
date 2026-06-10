import type { Metadata } from "next";
import { AdminResenasClient } from "./AdminResenasClient";

// La protección server-side la da src/app/admin/layout.tsx (isAdminAuthed);
// los datos llegan vía /api/admin/reviews que re-valida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseñas — Admin DaleControl" };

export default function AdminResenasPage() {
  return <AdminResenasClient />;
}
