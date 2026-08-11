import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import {
  activeDoctors,
  expirePastRequests,
  isMissingTable,
  toDTO,
  type BookingRequestDTO,
} from "@/lib/booking-requests/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/booking-requests?status=PENDIENTE
 *
 * Bandeja de solicitudes de cita hechas SIN cuenta desde la mini-web. Antes de
 * listar marca EXPIRADA lo que ya venció: una solicitud de ayer no se le puede
 * ofrecer a nadie, pero tampoco se borra.
 */
export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;

  const clinicId = session.clinic.id;
  const status = req.nextUrl.searchParams.get("status") ?? "PENDIENTE";

  try {
    await expirePastRequests(clinicId);

    const filas = await prisma.bookingRequest.findMany({
      where: {
        clinicId, // NUNCA undefined: sin esto Prisma devuelve las de todas las clínicas
        ...(status === "TODAS" ? {} : { status }),
      },
      orderBy: { requestedAt: "asc" },
      take: 100,
    });

    const doctores = await activeDoctors(clinicId);
    const nombre = new Map(doctores.map(d => [d.id, `${d.firstName} ${d.lastName}`]));

    const requests: BookingRequestDTO[] = filas.map(f =>
      toDTO(f, session.clinic.timezone, f.doctorId ? nombre.get(f.doctorId) ?? null : null),
    );

    const pendientes = status === "PENDIENTE"
      ? requests.length
      : await prisma.bookingRequest.count({ where: { clinicId, status: "PENDIENTE" } });

    return NextResponse.json({ requests, pendientes });
  } catch (err) {
    // El SQL de landing-v2 todavía no aplicado: la agenda sigue funcionando
    // sin bandeja en vez de romperse entera.
    if (isMissingTable(err)) return NextResponse.json({ requests: [], pendientes: 0 });
    console.error("[booking-requests] GET:", err);
    return NextResponse.json({ error: "No pudimos cargar las solicitudes" }, { status: 500 });
  }
}
