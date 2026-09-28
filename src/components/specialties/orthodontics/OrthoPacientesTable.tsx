"use client";
// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). Tabla con buscador
// de los casos activos, con su cobranza real (decisión 1: factura del
// tratamiento, nunca OrthoPaymentPlan). Hermana de la vieja
// OrthodonticsSpecialtyClient.tsx (S1, `/dashboard/specialties/orthodontics`,
// sin ocultar todavía porque sigue siendo el único camino para abrir un caso
// — ver REPORTE-ws1-t1.md, punto 6): esta es la NUEVA, sin el toggle Kanban
// (`build-kanban-data.ts` sigue leyendo el modelo viejo y no es de esta
// parte) — reemplaza a la vieja cuando "Alta del caso" (Ola 1) termine su
// wizard y S1 se pueda ocultar.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";

export interface OrthoPacienteRow {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorName: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "RETENTION" | "COMPLETED" | "DROPPED_OUT";
  overdueAmountMxn: number;
  nextDueDate: string | null;
}

const STATUS_LABEL: Record<OrthoPacienteRow["status"], string> = {
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  ON_HOLD: "Pausado",
  RETENTION: "Retención",
  COMPLETED: "Completado",
  DROPPED_OUT: "Abandono",
};

const STATUS_TONE: Record<OrthoPacienteRow["status"], "success" | "brand" | "warning" | "info" | "neutral" | "danger"> = {
  PLANNED: "brand",
  IN_PROGRESS: "success",
  ON_HOLD: "warning",
  RETENTION: "info",
  COMPLETED: "neutral",
  DROPPED_OUT: "danger",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function OrthoPacientesTable({ rows }: { rows: OrthoPacienteRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.patientName.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ position: "relative", maxWidth: 280 }}>
        <Search
          size={14}
          aria-hidden
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar paciente…"
          aria-label="Buscar paciente"
          style={{
            width: "100%",
            padding: "6px 10px 6px 30px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text-1)",
            fontSize: 12,
          }}
        />
      </div>

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
        <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <Th>Paciente</Th>
                <Th>Estado</Th>
                <Th>Saldo vencido</Th>
                <Th>Próxima mensualidad</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.planId}
                  onClick={() => router.push(`/dashboard/patients/${r.patientId}?tab=ortodoncia`)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AvatarNew name={r.patientName} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: "var(--text-1)" }}>{r.patientName}</div>
                        {r.treatingDoctorName && (
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{r.treatingDoctorName}</div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <BadgeNew tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</BadgeNew>
                  </Td>
                  <Td>
                    {r.overdueAmountMxn > 0 ? (
                      <span style={{ color: "var(--danger, #ef4444)", fontWeight: 600 }}>{fmtMoney(r.overdueAmountMxn)}</span>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>Al día</span>
                    )}
                  </Td>
                  <Td>{fmtDate(r.nextDueDate)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
