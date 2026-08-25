import type { Metadata } from "next";
import { AdminBarberSoporteClient } from "./soporte-client";

// Ruta HERMANA estática de /admin/barberias/[id]: en el App Router el
// segmento estático gana al dinámico, así que "soporte" nunca se resuelve
// como id de barbería.
//
// El guard lo pone src/app/admin/layout.tsx; los datos llegan por
// /api/admin/barberias/soporte, que revalida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soporte de barberías — Admin DaleControl" };

export default function AdminBarberSoportePage({
  searchParams,
}: {
  searchParams?: { barbershopId?: string };
}) {
  // Se lee aquí (server) y no con useSearchParams para no obligar a envolver
  // el cliente en un <Suspense> sólo por el filtro de entrada.
  return <AdminBarberSoporteClient initialBarbershopId={searchParams?.barbershopId ?? ""} />;
}
