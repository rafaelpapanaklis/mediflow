import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { TeleconsultaClient } from "./teleconsulta-client";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";

export const metadata = { title: "Teleconsulta — DaleControl" };

/* ============================================================
   DEAD-03 — el rol NO puede salir de la barra de direcciones.

   Esta página entregaba el token de Daily leyendo `role` de la query
   string: `role === "doctor" ? teleDoctorToken : (token ?? telePatientToken)`.
   Sin sesión, sin clinicId y sin comprobar nada.

   El paciente recibe su liga por WhatsApp cuando paga, borra
   `role=patient&token=…`, escribe `role=doctor` y entra como DUEÑO de la
   sala: `createMeetingToken` crea el token del doctor con `is_owner:true`
   (lib/daily.ts:34), o sea que puede iniciar la grabación en la nube,
   expulsar al doctor y quedarse dentro. Y el respaldo `?? telePatientToken`
   hacía que cualquiera con el enlace —reenviado a quien sea— viera el
   nombre completo del paciente, el del doctor, la clínica y la hora sin
   autenticarse. El middleware no cubre esta ruta: su matcher son
   /dashboard, /admin, /api y /proveedores.

   La regla que se aplica ahora es la que este mismo producto ya escribió
   en su ruta hermana /api/teleconsulta/join: el paciente entra con SU
   token y el profesional con SESIÓN. La única diferencia es a quién se le
   acepta la sesión — allí solo al doctor de la cita, aquí a cualquier
   miembro de esa clínica — porque el enlace "Unirse" se pinta en la
   agenda y en /dashboard/teleconsulta, que listan TODAS las
   teleconsultas de la clínica: cerrarlo al doctorId dejaría fuera al
   administrador que entra a acompañar. Lo que se cierra es que entre
   quien no es del equipo, que es de lo que trata el hallazgo.
   ============================================================ */

export default async function TeleconsultaPage({ params, searchParams }: { params: { appointmentId: string }; searchParams: { role?: string; token?: string } }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
      clinic: { select: { name: true, timezone: true } },
    },
  });
  if (!appointment || appointment.mode !== "TELECONSULTATION") notFound();

  const pideSerDoctor = searchParams.role === "doctor";

  let role: "doctor" | "patient";
  let token: string | null;

  if (pideSerDoctor) {
    // El token del doctor manda en la sala. Solo se entrega con sesión de la
    // MISMA clínica: `getAuthContext` resuelve la clínica activa desde la
    // cookie firmada, nunca desde la petición.
    const ctx = await getAuthContext();
    if (!ctx || ctx.clinicId !== appointment.clinicId) return <EntraPorElPanel />;
    role = "doctor";
    token = appointment.teleDoctorToken;
  } else {
    // El paciente: su token ES su credencial, así que tiene que coincidir
    // exacto. Antes se usaba `searchParams.token ?? appointment.telePatientToken`,
    // que es lo mismo que no pedir nada: sin token en la liga, se servía el
    // de la cita. Si la sala todavía no se creó no hay token contra el que
    // comparar y la página no existe para nadie.
    const suyo = appointment.telePatientToken;
    if (!suyo || searchParams.token !== suyo) notFound();
    role = "patient";
    token = suyo;
  }

  return (
    <TeleconsultaClient
      appointmentId={appointment.id}
      roomUrl={appointment.teleRoomUrl}
      token={token}
      role={role}
      patientName={`${appointment.patient.firstName} ${appointment.patient.lastName}`}
      doctorName={`Dr/a. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`}
      clinicName={appointment.clinic.name}
      appointmentType={appointment.type}
      appointmentTime={timeHHMMInTz(appointment.startsAt, appointment.clinic.timezone)}
      paymentStatus={appointment.paymentStatus}
    />
  );
}

/**
 * El profesional que abre su liga sin sesión.
 *
 * Un notFound() aquí sería mentirle: la cita existe y él sí tiene derecho a
 * entrar. Pasa de verdad — el aviso de "nueva teleconsulta pagada" le llega
 * por WhatsApp al teléfono, donde puede no tener el panel abierto. Y no se
 * dice ni el nombre del paciente ni el de la clínica, que es justo lo que
 * esta ruta filtraba a cualquiera con el enlace.
 */
function EntraPorElPanel() {
  return (
    <main style={{
      minHeight: "100dvh", display: "grid", placeItems: "center",
      padding: 24, background: "#0b1220", color: "#e5e7eb",
      font: "16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif",
    }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ font: "600 20px/1.3 inherit", margin: "0 0 10px" }}>
          Inicia sesión para entrar como profesional
        </h1>
        <p style={{ margin: "0 0 20px", color: "#9ca3af" }}>
          Entra al panel con tu cuenta y abre la teleconsulta desde la agenda.
          Si eres el paciente, usa la liga completa que te llegó por WhatsApp.
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-block", padding: "10px 18px", borderRadius: 8,
            background: "#2563eb", color: "#fff", textDecoration: "none",
            font: "600 15px/1 inherit",
          }}
        >
          Ir al panel
        </Link>
      </div>
    </main>
  );
}
