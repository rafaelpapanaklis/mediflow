import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission } from "@/lib/barber-auth";
import { barberApiError, requireBarberApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * Buscador de clientes para vender una membresía. Devuelve lo MÍNIMO
 * (nombre, teléfono y si ya tiene membresía vigente): nada de notas,
 * preferencias ni correo. Los clientes los administra otra terminal; esto
 * es solo lectura para poder elegir a quién se le vende.
 */
export async function GET(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;

  // Defensa en profundidad: ver clientes exige su propio permiso.
  try {
    assertBarberPermission(g.ctx, "clients.view");
  } catch {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const digits = q.replace(/\D/g, "");

    const clients = await prisma.barberClient.findMany({
      where: {
        barbershopId: g.ctx.barbershopId,
        blockedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                ...(digits ? [{ phone: { contains: digits } }] : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        memberships: {
          where: { status: "ACTIVE", endAt: { gt: new Date() } },
          select: { id: true, endAt: true, membership: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
      take: 20,
    });

    return NextResponse.json({
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        activeMembership: c.memberships[0]
          ? { name: c.memberships[0].membership.name, endAt: c.memberships[0].endAt.toISOString() }
          : null,
      })),
    });
  } catch (err) {
    return barberApiError(err);
  }
}
