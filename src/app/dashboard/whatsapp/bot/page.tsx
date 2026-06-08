export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { BotClient } from "./bot-client";

export const metadata: Metadata = { title: "Bot de WhatsApp — MediFlow" };

export default async function WhatsAppBotPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "whatsapp.view");
  return <BotClient />;
}
