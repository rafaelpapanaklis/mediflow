import type { Metadata } from "next";
import { AdminAffiliateTicketClient } from "./ticket-afiliado-admin-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket de afiliado — Admin DaleControl" };

export default async function AdminAffiliateTicketPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <AdminAffiliateTicketClient ticketId={params.id} />;
}
