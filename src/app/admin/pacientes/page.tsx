export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPacientesPage } from "@/lib/admin/pacientes";
import { PacientesClient } from "./pacientes-client";

export const metadata: Metadata = { title: "Pacientes — Admin DaleControl" };

// Base de datos GLOBAL de pacientes (todas las clínicas), agrupada por persona.
// El guard SUPER_ADMIN se aplica en el layout de /admin (src/app/admin/layout.tsx).
export default async function AdminPacientesPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const search = (searchParams.q || "").trim();
  const page = Math.max(1, parseInt(searchParams.page || "1", 10) || 1);
  const data = await getPacientesPage({ search, page, pageSize: 25 });
  return <PacientesClient data={data} />;
}
