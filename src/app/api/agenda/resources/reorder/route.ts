import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const dynamic = "force-dynamic";

const Schema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(200),
});

export async function POST(req: Request) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "resources.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { orderedIds } = parsed.data;
  const owned = await prisma.resource.findMany({
    where: {
      clinicId: session.clinic.id,
      isActive: true,
      id: { in: orderedIds },
    },
    select: { id: true },
  });
  if (owned.length !== orderedIds.length) {
    return NextResponse.json(
      { error: "not_found_or_not_owned" },
      { status: 404 },
    );
  }

  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.resource.update({
        where: { id },
        data: { orderIndex: idx },
      }),
    ),
  );

  revalidateAfter("resources");
  return NextResponse.json({ ok: true });
}
