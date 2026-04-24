// src/components/dashboard/home/home-admin.tsx
"use client";
import { useRouter } from "next/navigation";
import {
  DollarSign, Calendar, TrendingUp, UserX, ChevronRight,
} from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { RevenueAreaChart } from "@/components/dashboard/revenue-area-chart";
import { HomeSection } from "./home-section";
import { Greeting } from "./parts/greeting";
import { AdminPeriodToggle } from "./parts/admin-period-toggle";
import { AdminAlertRow } from "./parts/admin-alert-row";
import { TeamPerformanceTable } from "./parts/team-performance-table";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { EmptyActionItemsAllClear } from "@/components/dashboard/empty-states";
import type { HomeAdminData, AdminPeriod } from "@/lib/home/types";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeAdminData;
  period: AdminPeriod;
}

const PERIOD_SUBTITLE: Record<AdminPeriod, string> = {
  day:     "Hoy",
  month:   "Este mes",
  quarter: "Últimos 3 meses",
  year:    "Últimos 12 meses",
};

function iconForKpi(label: string) {
  const l = label.toLowerCase();
  if (l.includes("ingreso") || l.includes("revenue")) return DollarSign;
  if (l.includes("cita")) return Calendar;
  if (l.includes("ocupación") || l.includes("ocup")) return TrendingUp;
  if (l.includes("no-show") || l.includes("no show")) return UserX;
  return DollarSign;
}

export function HomeAdmin({ clinic, data, period }: Props) {
  const router = useRouter();
  const noAlerts = data.alerts.length === 0;

  return (
    <>
      <Greeting
        userFullName={clinic.name}
        trailing="Resumen operativo"
      />

      <div
        role="group"
        aria-label="Indicadores clave"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        {data.kpis.length === 0 ? (
          <KpiPlaceholderGrid />
        ) : (
          data.kpis.slice(0, 4).map((k, i) => (
            <KpiCard
              key={`${k.label}-${i}`}
              label={k.label}
              value={k.value}
              icon={iconForKpi(k.label)}
              delta={k.delta}
            />
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Período
        </div>
        <AdminPeriodToggle value={period} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 18,
          marginBottom: 18,
        }}
        className="mf-home-admin-grid"
      >
        <HomeSection
          title="Tendencia de ingresos"
          subtitle={PERIOD_SUBTITLE[period]}
          noPad
        >
          <div style={{ padding: 18 }}>
            {data.revenueSeries.length === 0 ? (
              <div
                style={{
                  padding: "48px 16px",
                  textAlign: "center",
                  color: "var(--text-2)",
                  fontSize: 13,
                }}
              >
                Aún no hay suficiente historial para graficar.
              </div>
            ) : (
              <RevenueAreaChart
                data={data.revenueSeries.map((p) => ({
                  label: p.month,
                  value: p.value,
                }))}
              />
            )}
          </div>
        </HomeSection>

        <HomeSection
          title="Alertas operativas"
          subtitle={
            noAlerts
              ? "Todo en orden"
              : `${data.alerts.length} pendiente${data.alerts.length === 1 ? "" : "s"}`
          }
          noPad
        >
          {noAlerts ? (
            <EmptyActionItemsAllClear size="sm" />
          ) : (
            <div>
              {data.alerts.map((a, i) => (
                <div
                  key={a.id}
                  style={{
                    borderBottom: i === data.alerts.length - 1 ? "none" : undefined,
                  }}
                >
                  <AdminAlertRow alert={a} />
                </div>
              ))}
            </div>
          )}
        </HomeSection>
      </div>

      <HomeSection
        title="Performance del equipo"
        subtitle="Citas, completadas e ingresos generados"
        action={
          <ButtonNew
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard/reports")}
          >
            Ver reporte completo
            <ChevronRight size={12} />
          </ButtonNew>
        }
        noPad
      >
        {data.team.length === 0 ? (
          <div
            style={{
              padding: "32px 16px",
              textAlign: "center",
              color: "var(--text-2)",
              fontSize: 13,
            }}
          >
            Sin actividad de equipo en este período.
          </div>
        ) : (
          <TeamPerformanceTable rows={data.team} />
        )}
      </HomeSection>
    </>
  );
}

function KpiPlaceholderGrid() {
  const placeholders = [
    { label: "Ingresos del mes", icon: DollarSign },
    { label: "Citas", icon: Calendar },
    { label: "Ocupación", icon: TrendingUp },
    { label: "No-shows", icon: UserX },
  ];
  return (
    <>
      {placeholders.map((p) => (
        <KpiCard key={p.label} label={p.label} value="—" icon={p.icon} />
      ))}
    </>
  );
}
