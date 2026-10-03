import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { prisma } from "@/lib/prisma";
import { getAppointmentEventSettings } from "@/lib/reminders/config";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  // El diálogo de nueva cita decide con esto si enseña «Enviar WhatsApp»: no
  // basta con estar conectado, la clínica puede tener apagada la confirmación
  // al agendar (Dashboard → WhatsApp) y un interruptor que el servidor va a
  // ignorar es un interruptor que miente. Se lee aparte para no engordar
  // `loadClinicSession`, que corre en cada ruta de la agenda. Solo viaja el
  // booleano, nunca el Json.
  const row = await prisma.clinic.findUnique({
    where: { id: session.clinic.id },
    select: { reminderSettings: true },
  });
  const eventos = getAppointmentEventSettings(row ?? {});
  const waConfirmOnCreate = eventos.alAgendar;
  // ws1-t1 (F14): con esto Editar/Mover cita marcan «Avisar al paciente» igual que «Al reprogramar».
  const waNotifyOnReschedule = eventos.alReprogramar;

  return NextResponse.json({ clinic: { ...session.clinic, waConfirmOnCreate, waNotifyOnReschedule } }, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
