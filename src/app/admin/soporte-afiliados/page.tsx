import type { Metadata } from "next";
import { AdminSoporteAfiliadosClient } from "./soporte-afiliados-client";

// La protección server-side la da src/app/admin/layout.tsx (getAdminSessionResult);
// los datos llegan vía /api/admin/affiliate-support/* que re-valida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soporte afiliados — Admin DaleControl" };

export default function AdminSoporteAfiliadosPage() {
  return <AdminSoporteAfiliadosClient />;
}
