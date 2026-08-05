import type { Metadata } from "next";
import { AdminAffiliateTicketClient } from "./ticket-afiliado-admin-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket de afiliado — Admin DaleControl" };

export default function AdminAffiliateTicketPage({ params }: { params: { id: string } }) {
  return <AdminAffiliateTicketClient ticketId={params.id} />;
}
