import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Lista las cuentas conectadas de la clínica. El token (accessTokenEnc) JAMÁS sale. */
export async function GET(_req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const accounts = await prisma.socialAccount.findMany({
    where: { clinicId: ctx.clinicId },
    select: {
      id: true,
      provider: true,
      externalId: true,
      name: true,
      igBusinessId: true,
      connected: true,
      tokenExpiresAt: true,
      createdAt: true,
      // accessTokenEnc EXCLUIDO a propósito.
    },
    orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ accounts });
}

/** Desconecta una cuenta. Scoped por clinicId (un id ajeno borra 0 filas). */
export async function DELETE(req: NextRequest) {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const r = await prisma.socialAccount.deleteMany({
    where: { id, clinicId: ctx!.clinicId },
  });
  if (r.count === 0) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
