export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getClientesList } from "@/lib/admin/clientes";
import { ClientesClient } from "./clientes-client";

export const metadata: Metadata = { title: "Clientes — Admin DaleControl" };

export default async function AdminClientesPage() {
  const clientes = await getClientesList();
  return <ClientesClient clientes={clientes} />;
}
