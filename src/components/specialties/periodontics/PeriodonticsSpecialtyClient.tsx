"use client";
// Periodontics — panel agregado client. KPIs + filtros + tabla + modal.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Plus, Activity, AlertCircle, Repeat, Scissors, Search } from "lucide-react";
import type {
  PeriodontalGrade,
  PeriodontalPhase,
  PeriodontalRiskCategory,
  PeriodontalStage,
} from "@prisma/client";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PatientSearchModal } from "@/components/specialties/PatientSearchModal";
import type {
  PerioPatientRow,
  PerioSpecialtyDoctor,
  PerioSpecialtyKpis,
} from "@/lib/periodontics/load-patients";

type SerializableRow = Omit<PerioPatientRow, "nextMaintenanceAt"> & {
  nextMaintenanceAt: string | null;
};

type StatusFilter = "all" | "active" | "maintenance" | "overdue";

const STAGE_LABEL: Record<PeriodontalStage, string> = {
  SALUD: "Salud",
  GINGIVITIS: "Gingivitis",
  STAGE_I: "Stage I",
  STAGE_II: "Stage II",
  STAGE_III: "Stage III",
  STAGE_IV: "Stage IV",
};

const GRADE_LABEL: Record<PeriodontalGrade, string> = {
  GRADE_A: "A",
  GRADE_B: "B",
  GRADE_C: "C",
};

const PHASE_LABEL: Record<PeriodontalPhase, string> = {
  PHASE_1: "Fase 1",
  PHASE_2: "Fase 2",
  PHASE_3: "Fase 3",
  PHASE_4: "Fase 4 (mantenimiento)",
};

const RISK_LABEL: Record<PeriodontalRiskCategory, string> = {
  BAJO: "Bajo",
  MODERADO: "Moderado",
  ALTO: "Alto",
};

const RISK_TONE: Record<PeriodontalRiskCategory, "success" | "warning" | "danger"> = {
  BAJO: "success",
  MODERADO: "warning",
  ALTO: "danger",
};

export interface PeriodonticsSpecialtyClientProps {
  rows: SerializableRow[];
  kpis: PerioSpecialtyKpis;
  doctors: PerioSpecialtyDoctor[];
}

export function PeriodonticsSpecialtyClient(props: PeriodonticsSpecialtyClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const showDoctorFilter = props.doctors.length > 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.rows.filter((r) => {
      if (statusFilter === "active" && r.planId === null) return false;
      if (statusFilter === "maintenance" && r.currentPhase !== "PHASE_4") return false;
      if (statusFilter === "overdue" && !r.isMaintenanceOverdue) return false;
      if (doctorFilter !== "all" && r.doctorId !== doctorFilter) return false;
      if (q && !r.patientName.toLowerCase().includes(q)) return false;
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
            <Heart size={20} aria-hidden />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>
              Periodoncia
            </h1>
            <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
              Panel agregado de casos, mantenimientos y cirugías.
            </p>
          </div>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => setModalOpen(true)}>
          Iniciar evaluación
        </ButtonNew>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <KpiCard label="Casos en tratamiento" value={String(props.kpis.activeCases)} icon={Activity} />
        <KpiCard label="Mantenimientos vencidos" value={String(props.kpis.overdueMaintenance)} icon={AlertCircle} />
        <KpiCard label="Reevaluaciones pendientes" value={String(props.kpis.pendingReevaluations)} icon={Repeat} />
        <KpiCard label="Cirugías programadas" value={String(props.kpis.scheduledSurgeries)} icon={Scissors} />
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
              ["all", "Todos"],
              ["active", "Con plan"],
              ["maintenance", "Mantenimiento"],
              ["overdue", "Vencidos"],
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
          Sin pacientes en este filtro.
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
                <Th>Stage / Grade</Th>
                <Th>Fase</Th>
                <Th>Próximo mantenimiento</Th>
                <Th>Riesgo Berna</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.patientId}
                  onClick={() => router.push(`/dashboard/patients/${r.patientId}?tab=periodoncia`)}
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
                    {r.stage ? (
                      <BadgeNew tone="info">
                        {STAGE_LABEL[r.stage]}
                        {r.grade ? ` · ${GRADE_LABEL[r.grade]}` : ""}
                      </BadgeNew>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </Td>
                  <Td>
                    {r.currentPhase ? (
                      <span>{PHASE_LABEL[r.currentPhase]}</span>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>Sin plan</span>
                    )}
                  </Td>
                  <Td>
                    {r.nextMaintenanceAt ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span>
                          {new Date(r.nextMaintenanceAt).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                        {r.isMaintenanceOverdue && <BadgeNew tone="danger">Vencido</BadgeNew>}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </Td>
                  <Td>
                    {r.riskCategory ? (
                      <BadgeNew tone={RISK_TONE[r.riskCategory]}>{RISK_LABEL[r.riskCategory]}</BadgeNew>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PatientSearchModal open={modalOpen} onClose={() => setModalOpen(false)} specialty="periodontics" />
    </div>
  );
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
