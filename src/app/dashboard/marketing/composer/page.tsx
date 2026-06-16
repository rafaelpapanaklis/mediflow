// Crear / editar post (WS-MKT-T3). Server component: resuelve auth, estado de
// conexiones y (si ?id=) el post a editar, y se lo pasa al cliente como props.
// Lee ?caption= (viene del Estudio IA) y ?date= (clic en un día del Calendario).

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import ComposerClient from "./composer-client";

export const dynamic = "force-dynamic";

interface SP {
  caption?: string;
  id?: string;
  date?: string;
}

export default async function MarketingComposerPage({ searchParams }: { searchParams: SP }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  let connections = { facebook: false, instagram: false };
  let initialPost: any = null;

  try {
    const [accounts, post] = await Promise.all([
      prisma.socialAccount.findMany({
        where: { clinicId: ctx.clinicId, connected: true }, // aislamiento por clínica
        select: { provider: true },
      }),
      searchParams?.id
        ? prisma.marketingPost.findFirst({ where: { id: searchParams.id, clinicId: ctx.clinicId } })
        : Promise.resolve(null),
    ]);
    connections = {
      facebook: accounts.some((a) => a.provider === "FACEBOOK"),
      instagram: accounts.some((a) => a.provider === "INSTAGRAM"),
    };
    if (post) {
      initialPost = {
        id: post.id,
        channel: post.channel,
        caption: post.caption,
        mediaUrls: post.mediaUrls ?? [],
        status: post.status,
        scheduledFor: post.scheduledFor ? post.scheduledFor.toISOString() : null,
        aiGenerated: post.aiGenerated,
      };
    }
  } catch (e) {
    // Tablas de Marketing aún no migradas → se degrada a "sin conexiones / sin post".
    console.error("[marketing/composer] schema:", (e as Error)?.message);
  }

  return (
    <ComposerClient
      connections={connections}
      initialCaption={typeof searchParams?.caption === "string" ? searchParams.caption : ""}
      initialDate={typeof searchParams?.date === "string" ? searchParams.date : ""}
      initialPost={initialPost}
    />
  );
}
