"use client";

import Link from "next/link";
import {
  ArrowLeft, Mail, MessageCircle, Building2, CalendarDays, Clock, ShieldCheck, ShieldOff,
  UserCheck, Eye,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { formatRelativeDate } from "@/lib/format";
import type { PacienteDetalle, PacienteAppointment } from "@/lib/admin/pacientes";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

// Etiqueta + color por estado de cita. Mantener alineado con AppointmentStatus
// del schema (incluye legacy PENDING).
const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Agendada", tone: "info" },
  SCHEDULED: { label: "Agendada", tone: "info" },
  CONFIRMED: { label: "Confirmada", tone: "success" },
  CHECKED_IN: { label: "Registrada", tone: "info" },
  IN_CHAIR: { label: "En sillón", tone: "brand" },
  IN_PROGRESS: { label: "En consulta", tone: "brand" },
  COMPLETED: { label: "Completada", tone: "success" },
  CHECKED_OUT: { label: "Finalizada", tone: "success" },
  CANCELLED: { label: "Cancelada", tone: "danger" },
  NO_SHOW: { label: "No asistió", tone: "danger" },
};

const IDENTITY_LABEL: Record<PacienteDetalle["identityType"], string> = {
  email: "Agrupada por correo",
  phone: "Agrupada por teléfono",
  single: "Sin correo ni teléfono",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PacienteDetalleClient({ paciente }: { paciente: PacienteDetalle }) {
  const acct = paciente.account;
  const waPhone = paciente.phone ? paciente.phone.replace(/[^\d]/g, "") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <CardNew noPad>
        <div style={{ padding: 20, display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <Link
            href="/admin/pacientes"
            style={{
              padding: 8, borderRadius: 8, display: "grid", placeItems: "center",
              color: "var(--text-3)", border: "1px solid var(--border-soft)",
              background: "var(--bg-elev)", flexShrink: 0,
            }}
            aria-label="Volver a pacientes"
          >
            <ArrowLeft size={14} />
          </Link>
          <AvatarNew name={paciente.name} size="xl" />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 20, margin: 0, color: "var(--text-1)", fontWeight: 600 }}>
                {paciente.name}
              </h1>
              {acct.hasAccount ? (
                <BadgeNew tone={acct.verified ? "success" : "warning"} dot>
                  {acct.verified ? "Cuenta verificada" : "Cuenta sin verificar"}
                </BadgeNew>
              ) : (
                <BadgeNew tone="neutral" dot>
                  Solo invitada
                </BadgeNew>
              )}
              <BadgeNew tone="info">{IDENTITY_LABEL[paciente.identityType]}</BadgeNew>
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--text-2)", flexWrap: "wrap" }}>
              {paciente.email && <span>{paciente.email}</span>}
              {paciente.phone && <span>{paciente.phone}</span>}
              {paciente.firstSeen && <span>Primer registro {formatRelativeDate(paciente.firstSeen)}</span>}
              {paciente.lastAppointment && (
                <span>Última cita {formatRelativeDate(paciente.lastAppointment)}</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {paciente.email && (
              <a href={`mailto:${paciente.email}`} style={{ textDecoration: "none" }}>
                <ButtonNew variant="secondary" icon={<Mail size={14} />}>Email</ButtonNew>
              </a>
            )}
            {waPhone && (
              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <ButtonNew variant="secondary" icon={<MessageCircle size={14} />}>WhatsApp</ButtonNew>
              </a>
            )}
          </div>
        </div>
      </CardNew>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <KpiCard label="Clínicas" value={String(paciente.clinicsCount)} icon={Building2} />
        <KpiCard label="Citas totales" value={String(paciente.appointmentsCount)} icon={CalendarDays} />
        <KpiCard
          label="Cuenta DaleControl"
          value={acct.hasAccount ? (acct.verified ? "Verificada" : "Sin verificar") : "No"}
          icon={acct.hasAccount ? UserCheck : ShieldOff}
        />
        <KpiCard
          label="Última cita"
          value={paciente.lastAppointment ? formatRelativeDate(paciente.lastAppointment) : "—"}
          icon={Clock}
        />
      </div>

      {/* Estado de la cuenta */}
      <CardNew title="Cuenta del paciente" sub="Registro en el portal del paciente (DaleControl)">
        {acct.hasAccount ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, fontSize: 13 }}>
            <Field
              label="Estado"
              value={
                <BadgeNew tone={acct.verified ? "success" : "warning"} dot>
                  {acct.verified ? "Verificada" : "Sin verificar"}
                </BadgeNew>
              }
            />
            {acct.name && <Field label="Nombre en la cuenta" value={acct.name} />}
            {acct.email && <Field label="Correo" value={acct.email} />}
            {acct.phone && <Field label="Teléfono" value={acct.phone} />}
            {acct.createdAt && <Field label="Registrada" value={formatRelativeDate(acct.createdAt)} />}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-3)", fontSize: 13 }}>
            <ShieldCheck size={16} style={{ color: "var(--text-4)" }} />
            Esta persona solo existe como paciente invitado: ha agendado pero no ha creado una cuenta
            en el portal de DaleControl.
          </div>
        )}
      </CardNew>

      {/* Clínicas */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
          <Building2 size={15} style={{ color: "var(--brand)" }} />
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            Clínicas donde tiene expediente ({paciente.clinics.length})
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {paciente.clinics.map((c) => (
            <CardNew key={c.id} noPad>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <AvatarNew name={c.name} size="sm" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link
                      href={`/admin/clinics/${c.id}`}
                      style={{
                        color: "var(--text-1)", fontWeight: 600, fontSize: 14, textDecoration: "none",
                        display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </Link>
                    {c.slug && (
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>/{c.slug}</div>
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 12 }}>
                  <Metric label="Citas" value={String(c.appointmentsCount)} />
                  <Metric label="Folio" value={c.patientNumber || "—"} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)" }}>
                  <span>Alta {c.firstSeen ? formatRelativeDate(c.firstSeen) : "—"}</span>
                  <span>Últ. {c.lastAppointment ? formatRelativeDate(c.lastAppointment) : "—"}</span>
                </div>
                <Link href={`/admin/clinics/${c.id}`} style={{ textDecoration: "none" }}>
                  <ButtonNew size="sm" variant="secondary" icon={<Eye size={13} />}>Ver clínica</ButtonNew>
                </Link>
              </div>
            </CardNew>
          ))}
          {paciente.clinics.length === 0 && (
            <div style={{ color: "var(--text-3)", fontSize: 13 }}>Sin clínicas asociadas.</div>
          )}
        </div>
      </div>

      {/* Citas */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
          <CalendarDays size={15} style={{ color: "var(--brand)" }} />
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            Citas ({paciente.appointmentsCount})
          </h2>
          {paciente.appointmentsTruncated && (
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              · mostrando las {paciente.appointments.length} más recientes
            </span>
          )}
        </div>
        <CardNew noPad>
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Clínica</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {paciente.appointments.map((a) => (
                  <AppointmentRow key={a.id} appt={a} />
                ))}
                {paciente.appointments.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                      Esta persona aún no tiene citas registradas
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardNew>
      </div>
    </div>
  );
}

function AppointmentRow({ appt }: { appt: PacienteAppointment }) {
  const meta = STATUS_META[appt.status] || { label: appt.status, tone: "neutral" as Tone };
  return (
    <tr>
      <td className="mono" style={{ fontSize: 12, color: "var(--text-1)", whiteSpace: "nowrap" }}>
        {fmtDateTime(appt.date)}
      </td>
      <td style={{ color: "var(--text-2)", fontSize: 13 }}>{appt.clinicName}</td>
      <td style={{ color: "var(--text-3)", fontSize: 12 }}>{appt.type || "—"}</td>
      <td>
        <BadgeNew tone={meta.tone} dot>{meta.label}</BadgeNew>
      </td>
    </tr>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-1)" }}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
