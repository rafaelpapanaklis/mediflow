export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { cargarClientes } from "./datos";
import { ClientesClient } from "./clientes-client";

export const metadata: Metadata = { title: "Clientes — Admin DaleControl" };

/**
 * /admin/clientes — el CRM de la plataforma, al nivel de CLIENTE (la cuenta
 * dueña), no de clínica. Las consultas viven en ./datos y el cálculo en
 * ./cartera; aquí sólo se enchufan.
 */
export default async function AdminClientesPage() {
  const { clientes, planPrices, ahoraISO } = await cargarClientes();
  return <ClientesClient clientes={clientes} planPrices={planPrices} ahoraISO={ahoraISO} />;
}
