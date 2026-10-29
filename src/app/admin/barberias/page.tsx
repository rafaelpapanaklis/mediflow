import type { Metadata } from "next";
import { AdminBarberiasClient } from "./barberias-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

// La protección server-side la da src/app/admin/layout.tsx (getAdminSessionResult);
// los datos llegan por /api/admin/barberias/*, que revalida la cookie admin en
// cada petición con el MISMO guard que el resto del panel.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Barberías — Admin DaleControl" };

export default async function AdminBarberiasPage() {
  await requireAdminPage();
  return <AdminBarberiasClient />;
}
