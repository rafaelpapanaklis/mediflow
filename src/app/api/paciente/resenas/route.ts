import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { getPatientReviewables, submitPatientReview } from "@/lib/reviews/service";
import { ReviewError } from "@/lib/reviews/types";

// Reseñas del paciente desde el portal (post-cita). Reusa el modelo ClinicReview
// y la misma moderación que el flujo por token. Multi-tenant: el guard resuelve
// ctx.links (patientId/clinicId de la sesión) y el service filtra por ellos.
export const dynamic = "force-dynamic";

// GET → { pending, done }: citas completadas del paciente y estado de su reseña.
export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();
    const data = await getPatientReviewables(ctx.links);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[paciente/resenas] GET", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST { appointmentId, rating, comment? } → publica la reseña de esa cita.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 10); // 10 envíos / min / IP
  if (limited) return limited;

  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const result = await submitPatientReview(
      ctx.links,
      body.appointmentId,
      body.rating,
      body.comment,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[paciente/resenas] POST", err);
    return NextResponse.json(
      { error: "No pudimos enviar tu reseña. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
