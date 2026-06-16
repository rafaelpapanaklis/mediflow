import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { ConnectionsClient, type ConnectionAccount } from "./connections-client";

export const dynamic = "force-dynamic";

export default async function MarketingConnectionsPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null; // el layout del dashboard ya redirige a login

  const rows = await prisma.socialAccount.findMany({
    where: { clinicId: ctx.clinicId },
    select: {
      id: true,
      provider: true,
      externalId: true,
      name: true,
      igBusinessId: true,
      connected: true,
      createdAt: true,
      // accessTokenEnc nunca se selecciona ni llega al cliente.
    },
    orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
  });

  const accounts: ConnectionAccount[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK",
    externalId: r.externalId,
    name: r.name,
    igBusinessId: r.igBusinessId,
    connected: r.connected,
  }));

  return <ConnectionsClient accounts={accounts} canManage={ctx.isAdmin} />;
}
