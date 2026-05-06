"use client";
// Pediatrics — panel agregado client. KPIs + filtros + tabla + modal con gate edad.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Baby, Plus, Activity, Sparkles, AlertTriangle, Sprout, Search } from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PatientSearchModal } from "@/components/specialties/PatientSearchModal";
import type { CambraCategory } from "@/lib/pediatrics/cambra";
import type {
  PediatricPatientRow,
  PediatricSpecialtyKpis,
} from "@/lib/pediatrics/load-patients";

type SerializableRow = Omit<PediatricPatientRow, "nextAppointmentAt"> & {
  nextAppointmentAt: string | null;
};

type StatusFilter = "all" | "high_risk" | "recall_due" | "no_appointment";

const CAMBRA_LABEL: Record<CambraCategory, string> = {
  bajo: "Bajo",
  moderado: "Moderado",
  alto: "Alto",
  extremo: "Extremo",
};

const CAMBRA_TONE: Record<CambraCategory, "success" | "warning" | "danger" | "info"> = {
  bajo: "success",
  moderado: "warning",
  alto: "danger",
  extremo: "danger",
};

const FRANKL_LABEL: Record<number, string> = {
  1: "1 — Defin. negativo",
  2: "2 — Negativo",
  3: "3 — Positivo",
  4: "4 — Defin. positivo",
};

export interface PediatricsSpecialtyClientProps {
  rows: SerializableRow[];
  kpis: PediatricSpecialtyKpis;
}

export function PediatricsSpecialtyClient(props: PediatricsSpecialtyClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.rows.filter((r) => {
      if (statusFilter === "high_risk" && r.cambra !== "alto" && r.cambra !== "extremo") return false;
      if (statusFilter === "recall_due" && !r.cariesRecallDue) return false;
      if (statusFilter === "no_appointment" && r.nextAppointmentAt !== null) return false;
      if (q && !r.patientName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [props.rows, statusFilter, query]);

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
            <Baby size={20} aria-hidden />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>
              Odontopediatría
            </h1>
            <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
              Panel agregado de pacientes 0–18 años con expediente pediátrico activo.
            </p>
          </div>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => setModalOpen(true)}>
          Nuevo registro
        </ButtonNew>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <KpiCard label="Pacientes activos" value={String(props.kpis.activePatients)} icon={Activity} />
        <KpiCard label="Profilaxis pendientes" value={String(props.kpis.pendingProphylaxis)} icon={Sparkles} />
        <KpiCard label="CAMBRA alto/extremo" value={String(props.kpis.highOrExtremeCambra)} icon={AlertTriangle} />
        <KpiCard label="Controles erupción" value={String(props.kpis.eruptionControls)} icon={Sprout} />
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
              ["high_risk", "CAMBRA alto/extremo"],
              ["recall_due", "Profilaxis vencida"],
              ["no_appointment", "Sin próxima cita"],
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
              width: 240,
            }}
          />
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
                <Th>Edad</Th>
                <Th>Riesgo CAMBRA</Th>
                <Th>Frankl última</Th>
                <Th>Próxima cita</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.patientId}
                  onClick={() => router.push(`/dashboard/patients/${r.patientId}?tab=pediatria`)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AvatarNew name={r.patientName} size="sm" />
                      <div style={{ fontWeight: 500 }}>{r.patientName}</div>
                    </div>
                  </Td>
                  <Td>{r.ageLabel}</Td>
                  <Td>
                    {r.cambra ? (
                      <BadgeNew tone={CAMBRA_TONE[r.cambra]}>{CAMBRA_LABEL[r.cambra]}</BadgeNew>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>Sin valoración</span>
                    )}
                  </Td>
                  <Td>
                    {r.latestFranklValue
                      ? FRANKL_LABEL[r.latestFranklValue] ?? `Frankl ${r.latestFranklValue}`
                      : "—"}
                  </Td>
                  <Td>
                    {r.nextAppointmentAt
                      ? `${r.nextAppointmentType ?? "Cita"} · ${new Date(r.nextAppointmentAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}`
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PatientSearchModal open={modalOpen} onClose={() => setModalOpen(false)} specialty="pediatrics" />
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
