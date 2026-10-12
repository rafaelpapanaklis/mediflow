import type { Metadata } from "next";
import { AdminTicketClient } from "./ticket-admin-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket — Admin DaleControl" };

export default async function AdminTicketPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <AdminTicketClient ticketId={params.id} />;
}
