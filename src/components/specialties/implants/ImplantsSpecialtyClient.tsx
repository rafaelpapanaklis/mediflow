"use client";
// Implants — panel agregado client. KPIs + filtros + tabla + modal.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Anchor, Plus, Activity, Hourglass, Wrench, Calendar, Search } from "lucide-react";
import type { ImplantBrand, ImplantStatus } from "@prisma/client";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PatientSearchModal } from "@/components/specialties/PatientSearchModal";
import type {
  ImplantPatientRow,
  ImplantSpecialtyDoctor,
  ImplantSpecialtyKpis,
} from "@/lib/implants/load-patients";

type SerializableRow = Omit<ImplantPatientRow, "placedAt" | "nextControlAt"> & {
  placedAt: string;
  nextControlAt: string | null;
};

type StatusFilter = "all" | "active" | "healing" | "prosthetic" | "complications";

const STATUS_LABEL: Record<ImplantStatus, string> = {
  PLANNED: "Planeado",
  PLACED: "Colocado",
  OSSEOINTEGRATING: "Cicatrización",
  UNCOVERED: "Descubierto",
  LOADED_PROVISIONAL: "Carga provisional",
  LOADED_DEFINITIVE: "Carga definitiva",
  FUNCTIONAL: "Funcional",
  COMPLICATION: "Complicación",
  FAILED: "Fallido",
  REMOVED: "Retirado",
};

const STATUS_TONE: Record<ImplantStatus, "success" | "info" | "warning" | "neutral" | "danger" | "brand"> = {
  PLANNED: "brand",
  PLACED: "info",
  OSSEOINTEGRATING: "info",
  UNCOVERED: "warning",
  LOADED_PROVISIONAL: "warning",
  LOADED_DEFINITIVE: "success",
  FUNCTIONAL: "success",
  COMPLICATION: "danger",
  FAILED: "danger",
  REMOVED: "neutral",
};

const BRAND_LABEL: Record<ImplantBrand, string> = {
  STRAUMANN: "Straumann",
  NOBEL_BIOCARE: "Nobel Biocare",
  NEODENT: "Neodent",
  MIS: "MIS",
  BIOHORIZONS: "BioHorizons",
  ZIMMER_BIOMET: "Zimmer Biomet",
  IMPLANT_DIRECT: "Implant Direct",
  ODONTIT: "Odontit",
  OTRO: "Otro",
};

const MILESTONE_LABEL: Record<string, string> = {
  M_1_WEEK: "1 semana",
  M_2_WEEKS: "2 semanas",
  M_1_MONTH: "1 mes",
  M_3_MONTHS: "3 meses",
  M_6_MONTHS: "6 meses",
  M_12_MONTHS: "12 meses",
  M_24_MONTHS: "24 meses",
  M_5_YEARS: "5 años",
  M_10_YEARS: "10 años",
  UNSCHEDULED: "Sin programar",
};

export interface ImplantsSpecialtyClientProps {
  rows: SerializableRow[];
  kpis: ImplantSpecialtyKpis;
  doctors: ImplantSpecialtyDoctor[];
}

export function ImplantsSpecialtyClient(props: ImplantsSpecialtyClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const showDoctorFilter = props.doctors.length > 1;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.rows.filter((r) => {
      if (statusFilter === "active" && (r.status === "REMOVED" || r.status === "FAILED")) return false;
      if (statusFilter === "healing" && r.status !== "OSSEOINTEGRATING") return false;
      if (
        statusFilter === "prosthetic" &&
        !(["UNCOVERED", "LOADED_PROVISIONAL", "LOADED_DEFINITIVE"] as ImplantStatus[]).includes(r.status)
      )
        return false;
      if (statusFilter === "complications" && r.status !== "COMPLICATION") return false;
      if (doctorFilter !== "all" && r.doctorId !== doctorFilter) return false;
      if (q && !r.patientName.toLowerCase().includes(q) && !String(r.toothFdi).includes(q))
        return false;
      return true;
    });
  }, [props.rows, statusFilter, doctorFilter, query]);

  const brandLabel = (r: SerializableRow) => {
    if (r.brand === "OTRO" && r.brandCustomName) return `${r.brandCustomName} · ${r.modelName}`;
    return `${BRAND_LABEL[r.brand]} · ${r.modelName}`;
  };

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
            <Anchor size={20} aria-hidden />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>
              Implantología
            </h1>
            <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
              Panel agregado de implantes en todas las fases.
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
        <KpiCard label="Implantes activos" value={String(props.kpis.activeImplants)} icon={Activity} />
        <KpiCard label="En cicatrización" value={String(props.kpis.inHealing)} icon={Hourglass} />
        <KpiCard label="En fase prostética" value={String(props.kpis.inProsthetic)} icon={Wrench} />
        <KpiCard label="Controles anuales pendientes" value={String(props.kpis.pendingAnnualControls)} icon={Calendar} />
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
              ["active", "Activos"],
              ["healing", "Cicatrización"],
              ["prosthetic", "Prostética"],
              ["complications", "Complicaciones"],
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
          Sin implantes en este filtro.
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
                <Th>Fase</Th>
                <Th>Marca / modelo</Th>
                <Th>Próximo control</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.implantId}
                  onClick={() =>
                    router.push(
                      `/dashboard/patients/${r.patientId}?tab=implantes&implant=${r.implantId}`,
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
                  <Td>
                    <BadgeNew tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</BadgeNew>
                  </Td>
                  <Td>{brandLabel(r)}</Td>
                  <Td>
                    {r.nextControlAt
                      ? `${MILESTONE_LABEL[r.nextControlMilestone ?? ""] ?? r.nextControlMilestone} · ${new Date(r.nextControlAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}`
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PatientSearchModal open={modalOpen} onClose={() => setModalOpen(false)} specialty="implants" />
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
