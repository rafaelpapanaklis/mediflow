export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IntegrationsClient } from "./integrations-client";

export const metadata: Metadata = { title: "Integraciones — MediFlow" };

export default async function IntegrationsPage() {
  const user = await getCurrentUser();

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: {
      id: true,
      name: true,
      twilioAccountSid: true,
      twilioAuthToken: true,
      twilioWhatsappNumber: true,
      postmarkInboundEmail: true,
    },
  });

  // Status del lado servidor: detectamos qué env vars tenemos.
  const serverStatus = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    postmarkInbound: Boolean(process.env.POSTMARK_INBOUND_SECRET),
  };

  return (
    <IntegrationsClient
      clinic={
        clinic ?? {
          id: "",
          name: "",
          twilioAccountSid: null,
          twilioAuthToken: null,
          twilioWhatsappNumber: null,
          postmarkInboundEmail: null,
        }
      }
      serverStatus={serverStatus}
    />
  );
}
