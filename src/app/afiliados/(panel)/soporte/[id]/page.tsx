export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { TicketAfiliadoClient } from "./ticket-client";

export const metadata: Metadata = { title: "Ticket de soporte — Afiliados DaleControl" };

/**
 * /afiliados/soporte/[id] — conversación del ticket.
 *
 * El id de la URL NO se usa aquí para leer nada: el hilo lo pide el cliente a
 * /api/afiliados/soporte/[id], que filtra por el affiliateId de la SESIÓN y
 * responde 404 si el ticket es de otro afiliado.
 */
export default async function AffiliateTicketPage({ params }: { params: { id: string } }) {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  return <TicketAfiliadoClient ticketId={params.id} />;
}
