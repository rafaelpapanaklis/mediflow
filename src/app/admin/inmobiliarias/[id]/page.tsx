export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getRealtyAccountDetailForAdmin } from "@/lib/realty/admin";
import { AdminRealtyAccountDetailClient } from "./account-detail-client";

/**
 * Ficha de UNA inmobiliaria. Aquí sí se lee desde el server component
 * (la capa de datos vive en src/lib/realty/admin.ts): el listado va por API
 * porque filtra en vivo, la ficha no.
 */
export default async function AdminRealtyAccountPage({
  params,
}: {
  params: { id: string };
}) {
  const detail = await getRealtyAccountDetailForAdmin(params.id);
  if (!detail) notFound();
  return <AdminRealtyAccountDetailClient detail={detail} />;
}
