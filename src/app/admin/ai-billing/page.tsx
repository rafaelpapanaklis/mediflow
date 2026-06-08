export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { AiBillingClient } from "./ai-billing-client";

export const metadata: Metadata = { title: "Tesorería IA — Admin MediFlow" };

// La auth admin la maneja el middleware (cookie admin_token sobre /admin/*).
export default function AdminAiBillingPage() {
  return <AiBillingClient />;
}
