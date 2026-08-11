import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";

/**
 * POST /api/public/booking-request — SOLICITUD de cita sin cuenta.
 *
 * NO crea una cita. `appointments.patientId` es obligatorio, así que sin
 * expediente no puede existir una cita; y crear el expediente desde un
 * formulario público anónimo llenaría la base de pacientes fantasma. Lo que
 * nace aquí es una fila en `booking_requests` que la clínica acepta (o
 * rechaza) desde la bandeja del panel.
 *
 * TAMPOCO bloquea el hueco: mientras la solicitud está PENDIENTE ese horario
 * le sigue perteneciendo a quien reserve con cuenta. Por eso la respuesta
 * dice "solicitud enviada, te confirmamos por WhatsApp" y NUNCA "cita
 * agendada": si el paciente cree que tiene cita y se presenta, el problema
 * se lo come la clínica.
 *
 * Endpoint PÚBLICO sin sesión: rate limit persistente por IP y campo trampa.
 * El clinicId SIEMPRE sale del slug en el servidor, jamás del cliente.
 */

/** Máximo de solicitudes por IP. Una familia pide 3-4 seguidas; 6 es holgado. */
const RL = { limit: 6, windowSec: 600 };

/** Copy ÚNICO de la respuesta: solicitud, nunca cita. */
const MENSAJE_OK = "Solicitud enviada. La clínica te confirmará por WhatsApp.";

const DIAS_MAX_FUTURO = 180;

function digits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const rl = await persistentRateLimit(req, { ...RL, scope: "public-booking-request" });
    if (rl) return rl;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
    }

    const {
      slug, doctorId, date, startTime, service, serviceDurationMin,
      patientName, patientDob, whatsapp, notes,
      // Campo trampa: invisible para una persona, irresistible para un bot.
      // Si viene con algo, se responde 200 como si nada — un bot que ve el
      // error aprende a esquivarlo; uno que ve éxito no vuelve a intentarlo.
      website,
    } = body as Record<string, any>;

    if (typeof website === "string" && website.trim() !== "") {
      return NextResponse.json({ success: true, status: "PENDIENTE", message: MENSAJE_OK });
    }

    // ── Validación de forma ──────────────────────────────────────────────
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "Clínica no especificada" }, { status: 400 });
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Formato de fecha inválido" }, { status: 400 });
    }
    if (typeof startTime !== "string" || !/^\d{2}:\d{2}$/.test(startTime)) {
      return NextResponse.json({ error: "Formato de hora inválido" }, { status: 400 });
    }

    const nombre = typeof patientName === "string" ? patientName.trim() : "";
    if (nombre.length < 3 || nombre.length > 120) {
      return NextResponse.json({ error: "Escribe tu nombre completo" }, { status: 400 });
    }

    const wa = digits(typeof whatsapp === "string" ? whatsapp : "");
    if (wa.length < 10 || wa.length > 15) {
      return NextResponse.json({ error: "El WhatsApp debe tener 10 dígitos" }, { status: 400 });
    }

    // Fecha de nacimiento: la clínica la necesita para dar de alta el
    // expediente al aceptar. Se valida que sea una fecha real y humana.
    let dob: Date | null = null;
    if (typeof patientDob === "string" && patientDob.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patientDob)) {
        return NextResponse.json({ error: "Fecha de nacimiento inválida" }, { status: 400 });
      }
      const [dy, dm, dd] = patientDob.split("-").map(Number);
      const parsed = new Date(Date.UTC(dy, dm - 1, dd));
      const okReal = parsed.getUTCFullYear() === dy && parsed.getUTCMonth() === dm - 1 && parsed.getUTCDate() === dd;
      const año = new Date().getUTCFullYear();
      if (!okReal || dy < año - 120 || parsed.getTime() > Date.now()) {
        return NextResponse.json({ error: "Fecha de nacimiento inválida" }, { status: 400 });
      }
      dob = parsed;
    }
    if (!dob) {
      return NextResponse.json({ error: "Falta tu fecha de nacimiento" }, { status: 400 });
    }

    // ── La clínica SIEMPRE se resuelve desde el slug, en el servidor ─────
    const clinic = await prisma.clinic.findUnique({
      where: { slug },
      select: {
        id: true, name: true, phone: true, timezone: true, archivedAt: true,
        waConnected: true, waPhoneNumberId: true, waAccessToken: true,
        schedules: { select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true } },
      },
    });
    if (!clinic || clinic.archivedAt) {
      return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
    }

    // ── El horario tiene que EXISTIR en la agenda de ese día ─────────────
    // No se comprueba que esté libre a propósito: la solicitud no reserva el
    // hueco. Lo que se evita es que entren peticiones para un domingo cerrado
    // o para las 3 de la mañana.
    const nowTz = getTzParts(new Date(), clinic.timezone);
    const hoyTz = `${nowTz.year}-${String(nowTz.month).padStart(2, "0")}-${String(nowTz.day).padStart(2, "0")}`;
    if (date < hoyTz) {
      return NextResponse.json({ error: "La fecha debe ser hoy o futura" }, { status: 400 });
    }
    if (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${hoyTz}T00:00:00Z`).getTime() > DIAS_MAX_FUTURO * 86_400_000) {
      return NextResponse.json({ error: "Esa fecha está demasiado lejos" }, { status: 400 });
    }

    const [y, m, d] = date.split("-").map(Number);
    const jsDay = new Date(y, m - 1, d).getDay();
    const scheduleDay = jsDay === 0 ? 6 : jsDay - 1;
    const daySchedule = clinic.schedules.find(s => s.dayOfWeek === scheduleDay);
    if (!daySchedule?.enabled) {
      return NextResponse.json({ error: "La clínica no atiende ese día" }, { status: 400 });
    }

    const [slotH, slotM] = startTime.split(":").map(Number);
    const slotMins = slotH * 60 + slotM;
    const [openH, openM] = daySchedule.openTime.split(":").map(Number);
    const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
    if (slotMins < openH * 60 + openM || slotMins + 30 > closeH * 60 + closeM) {
      return NextResponse.json({ error: "El horario está fuera del horario de atención" }, { status: 400 });
    }
    // Horas ya vencidas del día en curso, en la TZ DE LA CLÍNICA.
    if (date === hoyTz && slotMins <= nowTz.hour * 60 + nowTz.minute) {
      return NextResponse.json({ error: "Ese horario ya pasó. Elige otro, por favor." }, { status: 400 });
    }

    const requestedAt = tzLocalToUtc(date, slotH, slotM, clinic.timezone);

    // ── El doctor pedido, si pidió uno concreto ──────────────────────────
    // "any"/vacío = cualquiera. Un id que no sea de ESTA clínica se degrada a
    // "cualquiera" en vez de rebotar: el paciente no tiene forma de saberlo.
    let doctorPedido: { id: string; firstName: string; lastName: string } | null = null;
    if (typeof doctorId === "string" && doctorId && doctorId !== "any") {
      doctorPedido = await prisma.user.findFirst({
        where: { id: doctorId, clinicId: clinic.id, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
        select: { id: true, firstName: true, lastName: true },
      });
    }

    const servicio = typeof service === "string" && service.trim() ? service.trim().slice(0, 160) : null;
    const duracion = Number.isFinite(Number(serviceDurationMin)) && Number(serviceDurationMin) > 0
      ? Math.min(600, Math.round(Number(serviceDurationMin)))
      : null;
    const notasLimpias = typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 1000) : null;

    // ── Doble envío (doble clic, reintento del navegador) ────────────────
    // Misma clínica, mismo WhatsApp y mismo horario ya pendiente = la misma
    // solicitud. Se responde OK sin duplicar la tarjeta en la bandeja.
    const yaExiste = await prisma.bookingRequest.findFirst({
      where: {
        clinicId: clinic.id,
        patientWhatsapp: wa,
        requestedAt,
        status: "PENDIENTE",
      },
      select: { id: true },
    });
    if (yaExiste) {
      return NextResponse.json({ success: true, status: "PENDIENTE", message: MENSAJE_OK, id: yaExiste.id });
    }

    const solicitud = await prisma.bookingRequest.create({
      data: {
        clinicId:           clinic.id,
        doctorId:           doctorPedido?.id ?? null,
        requestedAt,
        serviceName:        servicio,
        serviceDurationMin: duracion,
        patientName:        nombre,
        patientDob:         dob,
        patientWhatsapp:    wa,
        notes:              notasLimpias,
        status:             "PENDIENTE",
      },
      select: { id: true },
    });

    // ── Avisar a la clínica ──────────────────────────────────────────────
    // Una solicitud que nadie ve deja al paciente esperando para siempre. En
    // el panel aparece sola (la bandeja de la agenda y la campana leen la
    // tabla); aquí se empuja además el WhatsApp al número de la clínica.
    // Best-effort: si el aviso falla, la solicitud YA está guardada.
    if (clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken && clinic.phone) {
      try {
        const fechaBonita = new Date(`${date}T00:00:00`).toLocaleDateString("es-MX", {
          weekday: "long", day: "numeric", month: "long",
        });
        const msg = `🔔 *Nueva solicitud de cita*\n\n`
          + `👤 ${nombre}\n`
          + `📱 ${wa}\n`
          + `📅 ${fechaBonita} · ${startTime}\n`
          + `👨‍⚕️ ${doctorPedido ? `Dr/a. ${doctorPedido.firstName} ${doctorPedido.lastName}` : "Cualquier doctor"}\n`
          + (servicio ? `📋 ${servicio}\n` : "")
          + `\nEntra a tu agenda para confirmarla o rechazarla.`;
        await sendWhatsAppLogged({
          clinic,
          to: clinic.phone,
          body: msg,
          kind: "system",
        });
      } catch (e) {
        console.error("[booking-request] aviso por WhatsApp falló:", e);
      }
    }

    return NextResponse.json({ success: true, status: "PENDIENTE", message: MENSAJE_OK, id: solicitud.id });
  } catch (err) {
    console.error("[booking-request] error:", err);
    return NextResponse.json({ error: "No pudimos enviar tu solicitud. Intenta de nuevo." }, { status: 500 });
  }
}
