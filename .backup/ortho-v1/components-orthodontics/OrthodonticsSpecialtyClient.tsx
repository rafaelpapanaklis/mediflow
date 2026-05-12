"use client";
// Orthodontics — panel agregado client. KPIs + filtros + tabla + toggle Kanban.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Smile,
  Plus,
  CalendarDays,
  AlertCircle,
  Hourglass,
  Activity,
  Search,
  LayoutGrid,
  List,
} from "lucide-react";
import type { OrthoPaymentStatus } from "@prisma/client";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PatientSearchModal } from "@/components/specialties/PatientSearchModal";
import { OrthoKanbanBoard } from "./_components/OrthoKanbanBoard";
import type { OrthoKanbanCard } from "@/lib/types/orthodontics";
import type {
  OrthoPatientRow,
  OrthoSpecialtyDoctor,
  OrthoSpecialtyKpis,
  OrthoRowStatus,
} from "@/lib/orthodontics/load-patients";

type SerializableRow = Omit<OrthoPatientRow, "nextAppointmentAt"> & {
  nextAppointmentAt: string | null;
};

type StatusFilter = "all" | "active" | "completed" | "on_hold";

const STATUS_LABEL: Record<OrthoRowStatus, string> = {
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  ON_HOLD: "Pausado",
  RETENTION: "Retención",
  COMPLETED: "Completado",
  DROPPED_OUT: "Abandono",
  DIAGNOSIS_ONLY: "Solo diagnóstico",
};

const PHASE_LABEL: Record<string, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre",
  DETAILS: "Detalles",
  FINISHING: "Acabados",
  RETENTION: "Retención",
};

const PAYMENT_LABEL: Record<OrthoPaymentStatus | "NONE", string> = {
  ON_TIME: "Al día",
  LIGHT_DELAY: "Atraso leve",
  SEVERE_DELAY: "Atraso severo",
  PAID_IN_FULL: "Liquidado",
  NONE: "Sin plan",
};

const PAYMENT_TONE: Record<OrthoPaymentStatus | "NONE", "success" | "warning" | "danger" | "neutral" | "info"> = {
  ON_TIME: "success",
  LIGHT_DELAY: "warning",
  SEVERE_DELAY: "danger",
  PAID_IN_FULL: "info",
  NONE: "neutral",
};

export interface OrthodonticsSpecialtyClientProps {
  rows: SerializableRow[];
  kpis: OrthoSpecialtyKpis;
  doctors: OrthoSpecialtyDoctor[];
  kanbanCards: OrthoKanbanCard[];
}

export function OrthodonticsSpecialtyClient(props: OrthodonticsSpecialtyClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [modalOpen, setModalOpen] = useState(false);

  const showDoctorFilter = props.doctors.length > 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.rows.filter((r) => {
      if (statusFilter !== "all") {
        if (statusFilter === "active") {
          if (
            r.status !== "IN_PROGRESS" &&
            r.status !== "PLANNED" &&
            r.status !== "RETENTION" &&
            r.status !== "DIAGNOSIS_ONLY"
          )
            return false;
        }
        if (statusFilter === "completed" && r.status !== "COMPLETED") return false;
        if (statusFilter === "on_hold" && r.status !== "ON_HOLD") return false;
      }
      if (doctorFilter !== "all" && r.doctorId !== doctorFilter) return false;
      if (q && !r.patientName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [props.rows, statusFilter, doctorFilter, query]);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--surface-1)",
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: "var(--brand-soft, rgba(99,102,241,0.15))",
              color: "var(--brand, #6366f1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Smile size={20} aria-hidden />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>
              Ortodoncia
            </h1>
            <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
              Panel agregado de tratamientos activos, pagos y controles.
            </p>
          </div>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => setModalOpen(true)}>
          Nuevo plan
        </ButtonNew>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <KpiCard label="Tratamientos activos" value={String(props.kpis.activeTreatments)} icon={Activity} />
        <KpiCard label="Citas hoy" value={String(props.kpis.todayAppointments)} icon={CalendarDays} />
        <KpiCard
          label="Pagos vencidos"
          value={String(props.kpis.overduePaymentsCount)}
          icon={AlertCircle}
          delta={
            props.kpis.overduePaymentsAmountMxn > 0
              ? { value: fmtMoney(props.kpis.overduePaymentsAmountMxn), direction: "down", sub: " adeudo" }
              : undefined
          }
        />
        <KpiCard label="Próximos a finalizar" value={String(props.kpis.finishingSoon)} icon={Hourglass} />
      </section>

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(
            [
              ["active", "En curso"],
              ["completed", "Completados"],
              ["on_hold", "Pausados"],
              ["all", "Todos"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: statusFilter === key ? "var(--brand, #6366f1)" : "var(--surface-2)",
                color: statusFilter === key ? "white" : "var(--text-1)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {showDoctorFilter && (
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              aria-label="Filtrar por doctor"
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text-1)",
                fontSize: 12,
              }}
            >
              <option value="all">Todos los doctores</option>
              {props.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              aria-hidden
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-3)",
              }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar paciente…"
              aria-label="Buscar paciente"
              style={{
                padding: "6px 10px 6px 30px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text-1)",
                fontSize: 12,
                width: 220,
              }}
            />
          </div>
          <div
            role="tablist"
            aria-label="Vista"
            style={{
              display: "inline-flex",
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              onClick={() => setView("table")}
              style={{
                padding: "6px 10px",
                background: view === "table" ? "var(--brand, #6366f1)" : "var(--surface-2)",
                color: view === "table" ? "white" : "var(--text-1)",
                border: 0,
                cursor: "pointer",
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <List size={14} aria-hidden /> Tabla
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "kanban"}
              onClick={() => setView("kanban")}
              style={{
                padding: "6px 10px",
                background: view === "kanban" ? "var(--brand, #6366f1)" : "var(--surface-2)",
                color: view === "kanban" ? "white" : "var(--text-1)",
                border: 0,
                cursor: "pointer",
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <LayoutGrid size={14} aria-hidden /> Kanban
            </button>
          </div>
        </div>
      </section>

      {view === "table" ? (
        <OrthoTable rows={filtered} onRowClick={(id) => router.push(`/dashboard/patients/${id}?tab=ortodoncia`)} />
      ) : (
        <OrthoKanbanBoard cards={props.kanbanCards} />
      )}

      <PatientSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        specialty="orthodontics"
      />
    </div>
  );
}

function OrthoTable({
  rows,
  onRowClick,
}: {
  rows: SerializableRow[];
  onRowClick: (patientId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 13,
          background: "var(--surface-2)",
          borderRadius: 8,
          border: "1px dashed var(--border)",
        }}
      >
        Sin pacientes en este filtro.
      </div>
    );
  }

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div
      style={{
        overflow: "auto",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--surface-1)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
            <Th>Paciente</Th>
            <Th>Estado</Th>
            <Th>Fase actual</Th>
            <Th>Mes</Th>
            <Th>Próxima cita</Th>
            <Th>Pagos</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.diagnosisId}
              onClick={() => onRowClick(r.patientId)}
              style={{
                borderTop: "1px solid var(--border)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Td>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AvatarNew name={r.patientName} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: "var(--text-1)" }}>{r.patientName}</div>
                    {r.doctorName && (
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{r.doctorName}</div>
                    )}
                  </div>
                </div>
              </Td>
              <Td>
                <BadgeNew tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</BadgeNew>
              </Td>
              <Td>{r.currentPhase ? PHASE_LABEL[r.currentPhase] ?? r.currentPhase : "—"}</Td>
              <Td>
                {r.monthInTreatment !== null && r.estimatedDurationMonths !== null
                  ? `${r.monthInTreatment} / ${r.estimatedDurationMonths}`
                  : "—"}
              </Td>
              <Td>{fmtDate(r.nextAppointmentAt)}</Td>
              <Td>
                <BadgeNew tone={PAYMENT_TONE[r.paymentStatus]}>{PAYMENT_LABEL[r.paymentStatus]}</BadgeNew>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusTone(s: OrthoRowStatus): "success" | "info" | "warning" | "neutral" | "danger" | "brand" {
  switch (s) {
    case "IN_PROGRESS":
      return "success";
    case "PLANNED":
      return "brand";
    case "RETENTION":
      return "info";
    case "ON_HOLD":
      return "warning";
    case "DROPPED_OUT":
      return "danger";
    case "COMPLETED":
      return "neutral";
    case "DIAGNOSIS_ONLY":
      return "warning";
  }
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        fontWeight: 600,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        padding: "10px 12px",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "middle" }}>{children}</td>;
}
