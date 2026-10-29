import type { Metadata } from "next";
import { AdminTicketClient } from "./ticket-admin-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket — Admin DaleControl" };

export default async function AdminTicketPage(props: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const params = await props.params;
  return <AdminTicketClient ticketId={params.id} />;
}
