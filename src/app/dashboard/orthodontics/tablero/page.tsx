// Ortodoncia — Tablero (T1-T7, ws1-t2, Ola 1). El vistazo del doctor y de la
// dirección: activos, controles de hoy, saldos vencidos, producción,
// conversión de valoraciones, lo que va a entrar por mensualidades y
// colocaciones/retiros del mes. La guarda de módulo ya corrió en el layout.
export const dynamic = "force-dynamic";

import {
  Activity,
  AlertCircle,
  CalendarCheck,
  ClipboardList,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { loadOrthoTableroData } from "@/lib/orthodontics/tablero-data";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtMonthKey(monthKey: string): string {
  const [, m] = monthKey.split("-").map((x) => parseInt(x, 10));
  return MESES[(m ?? 1) - 1] ?? monthKey;
}

export default async function OrthodonticsTableroPage() {
  const user = await getCurrentUser();
  const data = await loadOrthoTableroData(user.clinicId, user.clinic.timezone);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>Tablero</h1>
        <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
          Casos activos, cobranza al corriente y alertas de un vistazo.
        </p>
      </header>

      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}
      >
        <KpiCard label="Pacientes activos" value={String(data.activeCasesCount)} icon={Activity} />
        <KpiCard label="Controles de hoy" value={String(data.controlsToday)} icon={CalendarCheck} />
        <KpiCard
          label="Saldos vencidos"
          value={String(data.overdue.count)}
          icon={AlertCircle}
          delta={
            data.overdue.amountMxn > 0
              ? { value: fmtMoney(data.overdue.amountMxn), direction: "down", sub: " adeudo" }
              : undefined
          }
        />
        <KpiCard
          label="Colocaciones este mes"
          value={String(data.placementsAndRemovals.placements)}
          icon={Wrench}
        />
        <KpiCard
          label="Retiros este mes"
          value={String(data.placementsAndRemovals.removals)}
          icon={Wrench}
        />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
            background: "var(--surface-1)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={16} aria-hidden /> Producción del mes
          </h2>
          {data.productionByDoctor.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12 }}>Sin cobros de ortodoncia este mes.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
              {data.productionByDoctor.map((p) => (
                <li key={p.doctorId ?? "sin-doctor"} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "var(--text-2)" }}>{p.doctorName}</span>
                  <span style={{ fontWeight: 600, color: "var(--text-1)" }}>{fmtMoney(p.amountMxn)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
            background: "var(--surface-1)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
            <Wallet size={16} aria-hidden /> Lo que va a entrar por mensualidades
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {data.monthlyProjection.map((b) => (
              <li key={b.monthKey} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-2)", textTransform: "capitalize" }}>{fmtMonthKey(b.monthKey)}</span>
                <span style={{ fontWeight: 600, color: "var(--text-1)" }}>{fmtMoney(b.amountMxn)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
            background: "var(--surface-1)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardList size={16} aria-hidden /> Valoraciones que se convierten en tratamiento
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>
            De {data.valoraciones.total} valoración{data.valoraciones.total === 1 ? "" : "es"} de pacientes con caso
            de ortodoncia: <strong style={{ color: "var(--text-1)" }}>{data.valoraciones.aceptadas}</strong> aceptada
            {data.valoraciones.aceptadas === 1 ? "" : "s"} y{" "}
            <strong style={{ color: "var(--text-1)" }}>{data.valoraciones.pendientes}</strong> por llamar.
          </p>
        </div>
      </section>

      <p style={{ fontSize: 12, color: "var(--text-3)" }}>
        ¿Buscas la lista de pacientes o las alertas de mensualidad/control?{" "}
        <Link href="/dashboard/orthodontics/pacientes" style={{ color: "var(--brand)" }}>
          Pacientes en tratamiento
        </Link>{" "}
        ·{" "}
        <Link href="/dashboard/orthodontics/alertas" style={{ color: "var(--brand)" }}>
          Alertas
        </Link>
      </p>
    </div>
  );
}
