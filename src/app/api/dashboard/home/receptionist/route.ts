import { hasPermission } from "@/lib/auth/permissions";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import {
  fetchAppointmentsForDay,
  fetchPendingValidation,
} from "@/lib/agenda/server";
import { calendarDayRangeUtc, todayInTz } from "@/lib/agenda/time-utils";
import { computeReceivables } from "@/lib/caja";
import { avisoDeFacturasVencidas } from "@/lib/dinero/aviso-vencido";
import type {
  HomeActionItem,
  HomeReceptionistData,
  WaitlistEntry as WaitlistEntryHome,
  AppointmentDTO,
} from "@/lib/home/types";
import { accionCitasSinConfirmar } from "@/lib/home/accion-sin-confirmar";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const dateISO = todayInTz(session.clinic.timezone);

  const [todayAppts, pendingCount, waitlistRows, unreadMsgs, overdueInvoices] =
    await Promise.all([
      fetchAppointmentsForDay(dateISO, session.timeConfig, {
        clinicId: session.clinic.id,
        clinicCategory: session.clinic.category,
        // Enmascara pacientes restringidos que este usuario no puede ver.
        viewer: { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id },
        ortoAcceso: hasPermission({ role: session.user.role, permissionsOverride: session.user.permissionsOverride ?? [] }, "specialties.orthodontics"),
      }),
      fetchPendingValidation(
        dateISO,
        session.timeConfig,
        session.clinic.id,
        session.clinic.category,
        { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id },
      ),
      // La tarjeta «Fila de espera» de Hoy es la FILA DE WALK-IN (lo que recepción agrega y atiende en
      // /dashboard/walk-in), no la lista de espera de citas, que se queda en la Agenda (ws1-t4, decisión 7).
      // Solo la de hoy y solo quien sigue esperando: lo que ya está en atención ya es una cita de hoy.
      prisma.walkInQueue.findMany({
        where: {
          clinicId: session.clinic.id,
          status: { in: ["WAITING", "ASSIGNED"] },
          joinedAt: { gte: calendarDayRangeUtc(dateISO, session.clinic.timezone).startUtc },
        },
        orderBy: [{ priority: "desc" }, { joinedAt: "asc" }],
        take: 10,
      }),
      countUnreadWhatsapp(session.clinic.id).catch(() => 0),
      sumOverdueInvoices(session.clinic.id).catch(() => ({ count: 0, total: 0 })),
    ]);

  // Computar minutesWaiting para CHECKED_IN
  const now = Date.now();
  const todayWithWait: AppointmentDTO[] = todayAppts.map((a) => {
    if (a.status !== "CHECKED_IN" || !a.checkedInAt) return a;
    const diff = Math.max(0, Math.floor((now - new Date(a.checkedInAt).getTime()) / 60_000));
    return { ...a, minutesWaiting: diff };
  });

  const checkedInPatients = todayWithWait.filter(
    (a) => a.status === "CHECKED_IN",
  );

  // ─── Action items ─────────────────────────────────────────────
  const actionItems: HomeActionItem[] = [];

  const unconfirmed = todayAppts.filter((a) => a.status === "SCHEDULED");
  if (unconfirmed.length > 0) {
    actionItems.push(accionCitasSinConfirmar(unconfirmed, dateISO, session.clinic.waConnected));
  }

  if (overdueInvoices.count > 0) {
    actionItems.push({
      id: "overdue-invoices",
      tone: "danger",
      // ws1-t2 (auditoría de uso C-24): la MISMA cifra que el aviso del dueño y
      // el «Vencido» de Caja, y dicha igual («vencidas», no «por cobrar»).
      // N-10: con la línea que dice que es todo lo vencido de la clínica.
      title: avisoDeFacturasVencidas(overdueInvoices.count, overdueInvoices.total).titulo,
      detail: avisoDeFacturasVencidas(overdueInvoices.count, overdueInvoices.total).detalle,
      cta: {
        label: "Registrar pago",
        href: "/dashboard/billing?filter=overdue",
      },
    });
  }

  if (unreadMsgs > 0) {
    actionItems.push({
      id: "unread-wa",
      tone: "info",
      title: `${unreadMsgs} mensaje${unreadMsgs === 1 ? "" : "s"} WhatsApp sin leer`,
      // ws1-t1 (C-108): un solo nombre, «Mensajes», y a la bandeja donde se contestan (no a la de conectar).
      cta: { label: "Abrir Mensajes", href: "/dashboard/inbox" },
    });
  }

  if (pendingCount.length > 0) {
    actionItems.push({
      id: "pending-validation",
      tone: "warning",
      title: `${pendingCount.length} cita${
        pendingCount.length === 1 ? "" : "s"
      } pendiente${pendingCount.length === 1 ? "" : "s"} de validar`,
      detail: "Auto-agendadas por pacientes",
      cta: {
        label: "Revisar",
        href: "/dashboard/agenda?pending=open",
      },
    });
  }

  // ─── Waitlist ─────────────────────────────────────────────────
  // A quién se asignó cada fila (ws1-t4, fallo 6): una lectura más, solo si alguna está asignada, y con el
  // tenant de la sesión (un id ajeno no trae nombre).
  const asignados = Array.from(new Set(waitlistRows.map((e) => e.assignedTo).filter((v): v is string => !!v)));
  const nombres = new Map<string, string>();
  if (asignados.length > 0) {
    const usuarios = await prisma.user.findMany({
      where: { id: { in: asignados }, clinicId: session.clinic.id },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const u of usuarios) nombres.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
  }

  const waitlist: WaitlistEntryHome[] = waitlistRows.map((e) => ({
    id: e.id,
    patient: { id: e.patientId ?? "", name: e.patientName },
    reason: e.service || undefined,
    since: e.joinedAt.toISOString(),
    assignedToName: (e.assignedTo && nombres.get(e.assignedTo)) || null,
  }));

  const data: HomeReceptionistData = {
    todayAppointments: todayWithWait,
    actionItems,
    waitlist,
    checkedInPatients,
  };

  return NextResponse.json(data);
}

/**
 * El schema usa WhatsAppReminder (no WhatsappMessage) sin campos de
 * direction/readAt. Sin esos campos no hay forma de contar mensajes
 * inbound sin leer — degradado a 0 hasta que el modelo cambie.
 */
async function countUnreadWhatsapp(_clinicId: string): Promise<number> {
  return 0;
}

/**
 * Facturas VENCIDAS con el mismo cálculo que el aviso del dueño, Caja y
 * Finanzas (`computeReceivables`, ws1-t2 · auditoría de uso C-24): sin
 * borradores, por cuota en las facturas a plazos, con los cargos de control de
 * ortodoncia y con «hoy» en la zona de la clínica. Antes contaba a mano
 * `total − paid` de las facturas con `dueDate` pasada (con borradores, sin
 * cuotas ni controles) y recepción veía «1 factura por cobrar · $800» mientras
 * el dueño veía «15 vencidas · $66,900».
 */
async function sumOverdueInvoices(
  clinicId: string,
): Promise<{ count: number; total: number }> {
  const saldos = await computeReceivables(clinicId, new Date());
  const count = Object.values(saldos.vencidoPorFactura).filter((v) => v > 0.005).length;
  return { count, total: saldos.vencido };
}

