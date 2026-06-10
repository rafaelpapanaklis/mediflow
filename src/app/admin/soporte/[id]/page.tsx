import type { Metadata } from "next";
import { AdminTicketClient } from "./ticket-admin-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket — Admin DaleControl" };

export default function AdminTicketPage({ params }: { params: { id: string } }) {
  return <AdminTicketClient ticketId={params.id} />;
}
