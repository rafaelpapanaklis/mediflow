import type { Metadata } from "next";
import { AdminBarberTicketClient } from "./ticket-client";
import { requireAdminPage } from "@/lib/admin-page-guard";

// Guard: src/app/admin/layout.tsx. Los datos y la respuesta pasan por
// /api/admin/barberias/soporte/[id]*, que revalida la cookie admin.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket de barbería — Admin DaleControl" };

export default async function AdminBarberTicketPage(props: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const params = await props.params;
  return <AdminBarberTicketClient ticketId={params.id} />;
}
