export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { InboxClient } from "./inbox-client";

export const metadata: Metadata = { title: "Inbox — DaleControl" };

export default async function InboxPage() {
  // key por clínica: el Inbox carga hilos client-side (fetch al montar +
  // polling /api/inbox/since) que NO se re-disparan al cambiar de sede; sin
  // re-montar mostraría/mezclaría hilos y PHI de la clínica anterior.
  const user = await getCurrentUser();
  return <InboxClient key={user.clinicId} />;
}
