import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBarbershopDetailForAdmin } from "@/lib/barber/admin";
import { AdminBarbershopDetailClient } from "./barbershop-detail-client";

// El guard lo pone src/app/admin/layout.tsx (sesión admin en BD). Esta página
// sólo se renderiza cuando ese layout ya resolvió "ok"; las acciones pasan
// además por PATCH /api/admin/barberias/[id], que revalida por su cuenta.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Barbería — Admin DaleControl" };

export default async function AdminBarbershopDetailPage({ params }: { params: { id: string } }) {
  const detail = await getBarbershopDetailForAdmin(params.id);
  if (!detail) notFound();
  return <AdminBarbershopDetailClient detail={detail} />;
}
