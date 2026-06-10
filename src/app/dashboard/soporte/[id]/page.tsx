import type { Metadata } from "next";
import { TicketClient } from "./ticket-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket de soporte — DaleControl" };

export default function TicketPage({ params }: { params: { id: string } }) {
  return <TicketClient ticketId={params.id} />;
}
