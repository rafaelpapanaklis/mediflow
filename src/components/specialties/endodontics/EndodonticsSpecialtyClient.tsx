"use client";
// Endodontics — panel agregado client. KPIs + filtros + tabla + modal.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Plus, Activity, AlertCircle, History, Wrench, Search } from "lucide-react";
import type { EndoOutcomeStatus, EndoTreatmentType } from "@prisma/client";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PatientSearchModal } from "@/components/specialties/PatientSearchModal";
import type {
  EndoPatientRow,
  EndoSpecialtyDoctor,
  EndoSpecialtyKpis,
} from "@/lib/endodontics/load-patients";

type SerializableRow = Omit<EndoPatientRow, "startedAt" | "completedAt" | "nextFollowUpAt"> & {
  startedAt: string;
  completedAt: string | null;
  nextFollowUpAt: string | null;
};

type StatusFilter = "all" | "active" | "completed" | "abandoned";

const TREATMENT_TYPE_LABEL: Record<EndoTreatmentType, string> = {
  TC_PRIMARIO: "TC primario",
  RETRATAMIENTO: "Retratamiento",
  APICECTOMIA: "Apicectomía",
  PULPOTOMIA_EMERGENCIA: "Pulpotomía emerg.",
  TERAPIA_REGENERATIVA: "Regenerativa",
};

const OUTCOME_LABEL: Record<EndoOutcomeStatus, string> = {
  EN_CURSO: "En curso",
  COMPLETADO: "Completado",
  FALLIDO: "Fallido",
  ABANDONADO: "Abandonado",
};

const MILESTONE_LABEL: Record<string, string> = {
  CONTROL_6M: "Control 6m",
  CONTROL_12M: "Control 12m",
  CONTROL_24M: "Control 24m",
  CONTROL_EXTRA: "Control extra",
};

export interface EndodonticsSpecialtyClientProps {
  rows: SerializableRow[];
  kpis: EndoSpecialtyKpis;
  doctors: EndoSpecialtyDoctor[];
}

export function EndodonticsSpecialtyClient(props: EndodonticsSpecialtyClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const showDoctorFilter = props.doctors.length > 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.rows.filter((r) => {
      if (statusFilter === "active" && r.outcomeStatus !== "EN_CURSO") return false;
      if (statusFilter === "completed" && r.outcomeStatus !== "COMPLETADO") return false;
      if (statusFilter === "abandoned" && r.outcomeStatus !== "ABANDONADO") return false;
      if (doctorFilter !== "all" && r.doctorId !== doctorFilter) return false;
      if (q && !r.patientName.toLowerCase().includes(q) && !String(r.toothFdi).includes(q))
        return false;
      return true;
    });
  }, [props.rows, statusFilter, doctorFilter, query]);

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
            <Zap size={20} aria-hidden />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>
              Endodoncia
            </h1>
            <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
              Panel agregado de tratamientos, controles y restauraciones.
            </p>
          </div>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => setModalOpen(true)}>
          Nuevo TC
        </ButtonNew>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <KpiCard label="TCs activos" value={String(props.kpis.activeTreatments)} icon={Activity} />
        <KpiCard label="Controles pendientes" value={String(props.kpis.pendingFollowUps)} icon={AlertCircle} />
        <KpiCard label="Retratamientos en curso" value={String(props.kpis.retreatmentsActive)} icon={History} />
        <KpiCard label="Restauraciones pendientes" value={String(props.kpis.pendingRestorations)} icon={Wrench} />
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
              ["abandoned", "Abandonados"],
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
              placeholder="Buscar paciente o diente…"
              aria-label="Buscar paciente o diente"
              style={{
                padding: "6px 10px 6px 30px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text-1)",
                fontSize: 12,
                width: 240,
              }}
            />
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
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
          Sin tratamientos en este filtro.
        </div>
      ) : (
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
                <Th>Diente</Th>
                <Th>Tipo</Th>
                <Th>Sesión</Th>
                <Th>Estado</Th>
                <Th>Próximo control</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.treatmentId}
                  onClick={() =>
                    router.push(
                      `/dashboard/patients/${r.patientId}?tab=endodoncia&tooth=${r.toothFdi}`,
                    )
                  }
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AvatarNew name={r.patientName} size="sm" />
                      <div>
                        <div style={{ fontWeight: 500 }}>{r.patientName}</div>
                        {r.doctorName && (
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{r.doctorName}</div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                      {r.toothFdi}
                    </span>
                  </Td>
                  <Td>{TREATMENT_TYPE_LABEL[r.treatmentType]}</Td>
                  <Td>
                    {r.currentStep} / {r.sessionsCount}
                  </Td>
                  <Td>
                    <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      <BadgeNew tone={statusTone(r.outcomeStatus)}>
                        {OUTCOME_LABEL[r.outcomeStatus]}
                      </BadgeNew>
                      {r.needsRestoration && <BadgeNew tone="warning">Restauración</BadgeNew>}
                    </div>
                  </Td>
                  <Td>
                    {r.nextFollowUpAt
                      ? `${MILESTONE_LABEL[r.nextFollowUpMilestone ?? ""] ?? r.nextFollowUpMilestone} · ${new Date(r.nextFollowUpAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PatientSearchModal open={modalOpen} onClose={() => setModalOpen(false)} specialty="endodontics" />
    </div>
  );
}

function statusTone(s: EndoOutcomeStatus): "success" | "info" | "warning" | "neutral" | "danger" {
  switch (s) {
    case "EN_CURSO":
      return "success";
    case "COMPLETADO":
      return "info";
    case "FALLIDO":
      return "danger";
    case "ABANDONADO":
      return "neutral";
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
