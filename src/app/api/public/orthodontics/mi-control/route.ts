// GET /api/public/orthodontics/mi-control?slug=<clinicSlug> — ws1-t1 ronda 2
// (Ortodoncia conectada a la reserva web): un paciente YA IDENTIFICADO en el
// portal (cookie patient_session) puede reservar "Control de ortodoncia" con
// su doctor tratante desde la MISMA reserva pública que ya usa. Un visitante
// sin sesión, o un paciente sin caso activo en ESTA clínica, sigue viendo
// solo "Valoración de ortodoncia" (ws1-t1 ronda 1) — este endpoint responde
// `{ casoActivo: null }` para los dos casos, sin distinguirlos: la reserva
// pública no necesita saber por qué, solo qué ofrecer.
//
// SIEMPRE 200 (nunca 401): esto no es un dato del paciente, es "qué opciones
// mostrar en un formulario público" — fallar en silencio a `casoActivo: null`
// dejaría ver solo Valoración, que es exactamente lo que ve cualquiera.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext } from "@/lib/patient-portal/guard";
import { getOrthoBookingContext } from "@/lib/orthodontics/whatsapp-bot-booking";

export const dynamic = "force-dynamic";

export interface MiControlResponse {
  casoActivo: { label: string; durationMin: number; treatingDoctorId: string | null } | null;
}

export async function GET(req: NextRequest): Promise<NextResponse<MiControlResponse>> {
  try {
    const slug = req.nextUrl.searchParams.get("slug");
    if (!slug) return NextResponse.json({ casoActivo: null });

    const ctx = await getPatientPortalContext();
    if (!ctx) return NextResponse.json({ casoActivo: null });

    const clinic = await prisma.clinic.findUnique({ where: { slug }, select: { id: true } });
    if (!clinic) return NextResponse.json({ casoActivo: null });

    // Multi-clínica: la cuenta del portal puede tener pacientes en varias
    // clínicas (links); solo cuenta el vínculo de ESTA clínica (por slug).
    const link = ctx.links.find((l) => l.clinicId === clinic.id);
    if (!link) return NextResponse.json({ casoActivo: null });

    const contexto = await getOrthoBookingContext(clinic.id, link.patientId);
    if (!contexto.casoActivo) return NextResponse.json({ casoActivo: null });

    return NextResponse.json({
      casoActivo: {
        label: contexto.casoActivo.label,
        durationMin: contexto.casoActivo.durationMin,
        treatingDoctorId: contexto.casoActivo.treatingDoctorId,
      },
    });
  } catch (err) {
    console.error("[public/orthodontics/mi-control] error:", err);
    return NextResponse.json({ casoActivo: null });
  }
}
