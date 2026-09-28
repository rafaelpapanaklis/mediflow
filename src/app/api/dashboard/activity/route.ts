import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { patientVisibilityAnd, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { dateISOInTz } from "@/lib/agenda/legacy-helpers";
import { cachedByKey, claveDeClinica } from "@/lib/route-cache";
import { hasPermission } from "@/lib/auth/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import {
  eventoDeCasoAbierto,
  eventoDeCitaCompletada,
  eventoDePago,
} from "@/lib/orthodontics/actividad-campana";
import { avisosDeFotos } from "@/lib/orthodontics/fotos-paciente";
import { cargarFotosPorRevisar } from "@/lib/orthodontics/fotos-paciente-db";

export const dynamic = "force-dynamic";

// La campana de actividad pollea esto cada 60s en todas las pantallas (ver
// ~/gerentes/salidas/MAPA-conexiones.md §6.1), mismo patrón que sidebar-counts
// e insights. 30s = la mitad del intervalo de polling.
//
// CUÁNTO PUEDE ENVEJECER (ws1-t1): 30 s la lista de eventos. El punto de «hay
// algo nuevo» NO envejece nada: se calcula DESPUÉS de la caché contra la cookie
// notifLastSeen de quien pregunta, así que marcar leído (mark-read) lo apaga en
// la siguiente petición, caiga en la instancia que caiga.
const CACHE_TTL_MS = 30_000;

interface ActivityEvent {
  id: string;
  type: "payment" | "patient_new" | "appointment_completed" | "booking_request" | "ortho_case" | "ortho_photo";
  title: string;
  subtitle?: string;
  amount?: number;
  href: string;
  at: Date;
}

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 20);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Visibilidad por paciente: el feed de actividad NO tiene gate de rol (lo ven
  // doctores y recepción) y expone nombres de pacientes en pagos, altas y citas
  // completadas. Filtramos por relación con patientNullable (las filas sin
  // paciente no están restringidas). Va en AND; vacío/null para admins = sin filtro.
  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const patientVis = patientVisibilityAnd(viewer);
  const relatedVis = relatedPatientVisibilityAnd(viewer, { patientNullable: true });

  // Solicitudes de cita SIN cuenta: nadie tiene expediente todavía, así que
  // no hay visibilidad por paciente que aplicar — pero sí hay una persona
  // esperando respuesta. Si el SQL de landing-v2 aún no se aplicó, la tabla no
  // existe (P2021/42P01) y la campana sigue funcionando sin ellas.
  // Solo depende de clinicId (sin visibilidad por paciente: no hay expediente
  // todavía), así que el TTL puede compartirse entre todos los usuarios de la
  // clínica sin riesgo de fuga.
  //
  // Solicitudes, eventos recientes e interruptor van en PARALELO (ws1-t1):
  // antes las solicitudes se esperaban solas y los otros tres arrancaban
  // después, un viaje de ida y vuelta a la base más en cada fallo de caché.
  // A dónde mandan los avisos de cita. Con el interruptor por clínica
  // `menu-dos-niveles` la clínica ve la agenda NUEVA (/dashboard/agenda), así
  // que la campana manda ahí: «Cita completada» abre el panel de esa cita
  // (`?date=&highlight=`, lo mismo que hace la paleta) y «Solicitud de cita»
  // abre la bandeja de la mini-web (`?solicitudes=1`), que la agenda nueva ya
  // monta. Sin el interruptor, los mismos enlaces de siempre, byte por byte.
  // La respuesta del interruptor vive 60 s en memoria por clínica: no es una
  // consulta más por cada sondeo de la campana.
  //
  // 🔴 patientVis/relatedVis dependen de ctx.userId (visibilidad por
  // paciente: un doctor sin acceso a un paciente no debe ver su pago/alta/cita
  // aquí). Por eso esta clave lleva clinicId, userId Y rol — cachear solo por
  // clínica haría que un doctor viera lo que ve otro doctor de la misma
  // clínica (o al revés, que un admin viera la lista recortada de un doctor);
  // el rol, porque la visibilidad cambia con él y un cambio de rol no puede
  // heredar la lista del rol anterior.
  //
  // ORTODONCIA (ws1-t5): la campana sabe de ortodoncia SOLO en sedes dentales
  // con el módulo contratado de verdad y para quien tiene el permiso del
  // módulo. Va DENTRO de la misma caché (clínica + persona + rol), acotado a
  // la clínica de la sesión y con la misma visibilidad por paciente. Si algo
  // de ortodoncia falla (tablas sin crear, base ocupada), la campana sale
  // igual que antes, sin esos eventos.
  const quien = { role: ctx.role as any, permissionsOverride: ctx.permissionsOverride };
  const puedeOrtodoncia =
    ctx.clinicCategory === "DENTAL" && !ctx.isPlanExpired && hasPermission(quien, "specialties.orthodontics");

  const [solicitudes, [paidInvoices, newPatients, doneAppointments, orto], agendaNueva] = await Promise.all([
    cachedByKey(
      claveDeClinica("activity-solicitudes", ctx.clinicId),
      CACHE_TTL_MS,
      () =>
        prisma.bookingRequest
          .findMany({
            // requestedAt futuro: una solicitud cuyo horario ya pasó está vencida
            // (la bandeja de la agenda la marca EXPIRADA al abrirse) y no debe seguir
            // sonando en la campana como si alguien pudiera contestarla.
            where: { clinicId: ctx.clinicId, status: "PENDIENTE", requestedAt: { gte: new Date() } },
            select: {
              id: true, patientName: true, requestedAt: true, serviceName: true, createdAt: true,
              // La hora pedida se muestra en la zona de la CLÍNICA: el servidor corre
              // en UTC y sin esto una solicitud de las 9:00 salía como las 15:00.
              clinic: { select: { timezone: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 10,
          })
          .catch((err: { code?: string }) => {
            if (err?.code === "P2021" || err?.code === "42P01") return [];
            throw err;
          }),
    ),
    cachedByKey(
      claveDeClinica("activity-recent", ctx.clinicId, ctx.userId, ctx.role),
      CACHE_TTL_MS,
      async () => {
        const [facturas, pacientes, citas, casosNuevos] = await Promise.all([
          prisma.invoice.findMany({
            where: { clinicId: ctx.clinicId, status: { in: ["PAID", "PARTIAL"] }, ...(relatedVis.length ? { AND: relatedVis } : {}) },
            select: { id: true, paid: true, paymentMethod: true, paidAt: true, updatedAt: true,
              patient: { select: { firstName: true, lastName: true } } },
            orderBy: { paidAt: "desc" },
            take: 10,
          }),
          prisma.patient.findMany({
            where: { clinicId: ctx.clinicId, ...(patientVis.length ? { AND: patientVis } : {}) },
            select: { id: true, firstName: true, lastName: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          prisma.appointment.findMany({
            where: { clinicId: ctx.clinicId, status: "COMPLETED", ...(relatedVis.length ? { AND: relatedVis } : {}) },
            select: { id: true, updatedAt: true, startsAt: true, type: true, patientId: true,
              patient: { select: { firstName: true, lastName: true } } },
            orderBy: { updatedAt: "desc" },
            take: 10,
          }),
          puedeOrtodoncia
            ? hasActiveOrthodonticsModule(ctx.clinicId)
                .then((activo) =>
                  activo
                    ? prisma.orthodonticTreatmentPlan.findMany({
                        where: {
                          clinicId: ctx.clinicId,
                          deletedAt: null,
                          ...(relatedVis.length ? { AND: relatedVis } : {}),
                        },
                        select: {
                          id: true, patientId: true, createdAt: true,
                          patient: { select: { firstName: true, lastName: true } },
                        },
                        orderBy: { createdAt: "desc" },
                        take: 10,
                      })
                    : null,
                )
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        // `casosNuevos === null` = sin acceso a ortodoncia (o no se pudo leer).
        // ¿Cuáles de los pagos son del plan de pago de un caso? Una consulta,
        // solo si hay acceso y hay pagos que mirar.
        let facturasDeCaso: string[] = [];
        if (casosNuevos !== null && facturas.length > 0) {
          facturasDeCaso = await prisma.orthodonticTreatmentPlan
            .findMany({
              where: { clinicId: ctx.clinicId, deletedAt: null, invoiceId: { in: facturas.map((f) => f.id) } },
              select: { invoiceId: true },
            })
            .then((filas) => filas.map((f) => f.invoiceId).filter((id): id is string => !!id))
            .catch(() => []);
        }

        // Fotos que el paciente mandó desde su portal y nadie ha revisado
        // (ws1-t5, hallazgo 96). Mismo acceso que el resto de ortodoncia y la
        // misma visibilidad por paciente; nunca lanza.
        const fotosPorRevisar = casosNuevos !== null ? await cargarFotosPorRevisar(ctx.clinicId, viewer) : [];

        return [
          facturas,
          pacientes,
          citas,
          { acceso: casosNuevos !== null, casosNuevos: casosNuevos ?? [], facturasDeCaso, fotosPorRevisar },
        ] as const;
      },
    ),
    menuDosNivelesEncendido(ctx.clinicId),
  ]);

  // La fecha de la cita en la zona de la CLÍNICA (como la hora de las
  // solicitudes): el servidor corre en UTC y sin esto una cita de la noche
  // abriría la agenda del día siguiente.
  const zona: string = ctx.clinic?.timezone || "America/Mexico_City";
  const hrefCita = (a: { id: string; startsAt: Date }) => agendaNueva
    ? `/dashboard/agenda?date=${dateISOInTz(a.startsAt, zona)}&highlight=${a.id}`
    : `/dashboard/appointments?focus=${a.id}`;
  const hrefSolicitudes = agendaNueva
    ? `/dashboard/agenda?solicitudes=1`
    : `/dashboard/appointments?solicitudes=1`;

  // El feed es de actividad OCURRIDA. Un evento con fecha futura (p. ej. una
  // factura cuyo paidAt se capturó a futuro) encabeza la lista y se lee como si
  // ya hubiera pasado ("en alrededor de 2 meses"). Lo descartamos DESPUÉS de
  // normalizar los tres orígenes: la fecha del evento no siempre es la columna
  // por la que ordena Prisma (las facturas usan paidAt ?? updatedAt), así que no
  // se puede filtrar en el WHERE sin perder el fallback. El margen absorbe el
  // desfase de reloj entre el servidor de la app y el de la base de datos.
  const CLOCK_SKEW_MS = 60_000;
  const horizon = Date.now() + CLOCK_SKEW_MS;

  const events: ActivityEvent[] = [
    ...paidInvoices.map(i => ({
      id: `inv-${i.id}`,
      type: "payment" as const,
      ...eventoDePago(i, { esDeOrtodoncia: orto.facturasDeCaso.includes(i.id) }),
      amount: Number(i.paid),
      href: `/dashboard/billing?focus=${i.id}`,
      at: i.paidAt ?? i.updatedAt,
    })),
    ...newPatients.map(p => ({
      id: `pat-${p.id}`,
      type: "patient_new" as const,
      title: `Nuevo paciente — ${p.firstName} ${p.lastName}`,
      href: `/dashboard/patients/${p.id}`,
      at: p.createdAt,
    })),
    ...doneAppointments.map(a => ({
      id: `app-${a.id}`,
      type: "appointment_completed" as const,
      ...eventoDeCitaCompletada(a, { accesoOrtodoncia: orto.acceso, hrefDeLaCita: hrefCita(a) }),
      at: a.updatedAt,
    })),
    ...orto.casosNuevos.map(eventoDeCasoAbierto),
    // Un aviso por caso con fotos del paciente sin revisar; lleva al caso.
    ...avisosDeFotos(orto.fotosPorRevisar).map((a) => ({ ...a, type: "ortho_photo" as const })),
    ...solicitudes.map(s => ({
      id: `req-${s.id}`,
      type: "booking_request" as const,
      title: `Solicitud de cita — ${s.patientName}`,
      subtitle: `${s.requestedAt.toLocaleString("es-MX", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: s.clinic?.timezone || "America/Mexico_City",
      })}${s.serviceName ? ` · ${s.serviceName}` : ""}`,
      href: hrefSolicitudes,
      at: s.createdAt,
    })),
  ]
    .filter(e => e.at.getTime() <= horizon)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 20);

  const lastSeenRaw = cookies().get("notifLastSeen")?.value;
  const lastSeen = lastSeenRaw ? new Date(lastSeenRaw) : null;
  const unreadCount = lastSeen
    ? events.filter(e => e.at > lastSeen).length
    : events.length;

  return NextResponse.json({
    events: events.map(e => ({ ...e, at: e.at.toISOString() })),
    unreadCount,
  });
}
