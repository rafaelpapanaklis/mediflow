import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { guardarInvitarPaciente } from "@/lib/google-calendar-estado";

// PATCH { invitarPaciente: boolean } → «Enviar invitación por correo al paciente».
// Solo admins. La clínica sale de la sesión, nunca del cliente.
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.invitarPaciente !== "boolean") {
    return NextResponse.json({ error: "invitarPaciente debe ser true o false" }, { status: 400 });
  }

  const guardado = await guardarInvitarPaciente(ctx.clinicId, body.invitarPaciente);
  if (!guardado) {
    // La tabla nueva aún no se ha aplicado (sql/ws1-t12-google-calendar-estado.sql).
    return NextResponse.json(
      { error: "Este ajuste todavía no está disponible: falta aplicar una actualización de la base. Avisa a soporte.", codigo: "tabla_ausente" },
      { status: 503 },
    );
  }
  return NextResponse.json({ success: true, invitarPaciente: body.invitarPaciente });
}
