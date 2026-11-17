import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBarbershopDetailForAdmin } from "@/lib/barber/admin";
import { cargarPagosBarberia } from "@/lib/barber/admin-pagos";
import { cargarOrigenBarberia } from "@/lib/barber/admin-origen";
import { AdminBarbershopDetailClient } from "./barbershop-detail-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

// El guard lo pone src/app/admin/layout.tsx (sesión admin en BD). Esta página
// sólo se renderiza cuando ese layout ya resolvió "ok"; las acciones pasan
// además por PATCH /api/admin/barberias/[id], que revalida por su cuenta.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Barbería — Admin DaleControl" };

export default async function AdminBarbershopDetailPage(props: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const params = await props.params;
  // Los cobros a DaleControl (ws6-t1) van EN PARALELO con la ficha: no suman
  // tiempo de espera. Si fallan, la ficha se ve igual y el bloque lo dice.
  const [detail, pagos, origen] = await Promise.all([
    getBarbershopDetailForAdmin(params.id),
    cargarPagosBarberia(params.id).catch((e) => {
      console.error("[admin/barberias/:id] cobros no disponibles:", e);
      return null;
    }),
    // De dónde llegó (socio que la refirió), también en paralelo.
    cargarOrigenBarberia(params.id).catch((e) => {
      console.error("[admin/barberias/:id] origen no disponible:", e);
      return null;
    }),
  ]);
  if (!detail) notFound();
  return <AdminBarbershopDetailClient detail={detail} pagos={pagos} origen={origen} />;
}
