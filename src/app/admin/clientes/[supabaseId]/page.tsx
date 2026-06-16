export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getClienteDetalle } from "@/lib/admin/clientes";
import { ClienteDetalleClient } from "./cliente-detalle-client";

export const metadata: Metadata = { title: "Detalle de cliente — Admin DaleControl" };

export default async function AdminClienteDetallePage({ params }: { params: { supabaseId: string } }) {
  const cliente = await getClienteDetalle(params.supabaseId);
  if (!cliente) notFound();
  return <ClienteDetalleClient cliente={cliente} />;
}
