// src/components/dashboard/home/home-admin.tsx
"use client";
import { useRouter } from "next/navigation";
import {
  DollarSign, Calendar, TrendingUp, UserX, ChevronRight,
} from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { HomeSection } from "./home-section";
import { Greeting } from "./parts/greeting";
import { AdminPeriodToggle } from "./parts/admin-period-toggle";
import { TeamPerformanceTable } from "./parts/team-performance-table";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { HomeQuickActions } from "./parts/home-quick-actions";
import { RevenueTrendCard } from "./parts/revenue-trend-card";
import { UpcomingAppointmentsCard } from "./parts/upcoming-appointments-card";
import type { HomeAdminData, AdminPeriod } from "@/lib/home/types";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeAdminData;
  period: AdminPeriod;
}

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

  return (
    <>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 18,
      }}>
        <Greeting
          userFullName={clinic.name}
          trailing="Resumen operativo"
        />
        <HomeQuickActions />
      </div>

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
          justifyContent: "flex-end",
          marginBottom: 14,
        }}
      >
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
        <RevenueTrendCard
          initialData={data.revenueSeries.map((p) => ({
            label: p.month,
            value: p.value,
          }))}
        />

        <UpcomingAppointmentsCard />
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
