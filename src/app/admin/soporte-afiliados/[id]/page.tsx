import type { Metadata } from "next";
import { AdminAffiliateTicketClient } from "./ticket-afiliado-admin-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket de afiliado — Admin DaleControl" };

export default async function AdminAffiliateTicketPage(props: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const params = await props.params;
  return <AdminAffiliateTicketClient ticketId={params.id} />;
}
