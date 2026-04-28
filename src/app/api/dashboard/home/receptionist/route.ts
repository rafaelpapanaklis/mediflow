import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import {
  fetchAppointmentsForDay,
  fetchPendingValidation,
} from "@/lib/agenda/server";
import { todayInTz } from "@/lib/agenda/time-utils";
import type {
  HomeActionItem,
  HomeReceptionistData,
  WaitlistEntry as WaitlistEntryHome,
  AppointmentDTO,
} from "@/lib/home/types";

export async function GET() {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const dateISO = todayInTz(session.clinic.timezone);

  const [todayAppts, pendingCount, waitlistRows, unreadMsgs, overdueInvoices] =
    await Promise.all([
      fetchAppointmentsForDay(dateISO, session.timeConfig, {
        clinicId: session.clinic.id,
        clinicCategory: session.clinic.category,
      }),
      fetchPendingValidation(
        dateISO,
        session.timeConfig,
        session.clinic.id,
        session.clinic.category,
      ),
      prisma.waitlistEntry.findMany({
        where: { clinicId: session.clinic.id, resolvedAt: null },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
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
    actionItems.push({
      id: "unconfirmed",
      tone: "warning",
      title: `${unconfirmed.length} cita${unconfirmed.length === 1 ? "" : "s"} sin confirmar`,
      detail: unconfirmed
        .slice(0, 3)
        .map((a) => a.patient.name.split(" ")[0])
        .join(", "),
      cta: {
        label: "Recordar por WhatsApp",
        href: "/dashboard/whatsapp?intent=remind",
      },
    });
  }

  if (overdueInvoices.count > 0) {
    actionItems.push({
      id: "overdue-invoices",
      tone: "danger",
      title: `${overdueInvoices.count} factura${
        overdueInvoices.count === 1 ? "" : "s"
      } por cobrar · $${formatMxn(overdueInvoices.total)}`,
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
      cta: { label: "Abrir inbox", href: "/dashboard/whatsapp" },
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
  const waitlist: WaitlistEntryHome[] = waitlistRows.map((e) => ({
    id: e.id,
    patient: {
      id: e.patient.id,
      name: [e.patient.firstName, e.patient.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
    },
    reason: e.reason ?? undefined,
    since: e.createdAt.toISOString(),
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

async function sumOverdueInvoices(
  clinicId: string,
): Promise<{ count: number; total: number }> {
  const now = new Date();
  const rows = await prisma.invoice.findMany({
    where: {
      clinicId,
      status: { notIn: ["CANCELLED"] },
      dueDate: { lt: now },
    },
    select: { total: true, paid: true },
  });
  let count = 0;
  let total = 0;
  for (const r of rows) {
    const remaining = Number(r.total) - Number(r.paid ?? 0);
    if (remaining > 0) {
      count += 1;
      total += remaining;
    }
  }
  return { count, total };
}

function formatMxn(n: number): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: 0 });
}
