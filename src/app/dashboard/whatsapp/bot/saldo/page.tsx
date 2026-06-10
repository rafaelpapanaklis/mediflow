export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { SaldoClient } from "./saldo-client";

export const metadata: Metadata = { title: "Saldo de IA — DaleControl" };

export default async function AiWalletSaldoPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "whatsapp.view");
  return <SaldoClient />;
}
