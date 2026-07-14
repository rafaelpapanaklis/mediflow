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
import { useT } from "@/i18n/i18n-provider";
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
  const t = useT();
  const router = useRouter();

  return (
    <>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 24,
      }}>
        <Greeting
          userFullName={clinic.name}
          trailing={t("home.admin.opSummary")}
        />
        <HomeQuickActions />
      </div>

      <div
        role="group"
        aria-label={t("home.admin.kpiGroupAria")}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 20,
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
              hero={i === 0}
            />
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <AdminPeriodToggle value={period} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          marginBottom: 24,
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
        title={t("home.admin.teamPerformanceTitle")}
        subtitle={t("home.admin.teamPerformanceSubtitle")}
        action={
          <ButtonNew
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard/reports")}
          >
            {t("home.admin.viewFullReport")}
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
              color: "var(--text-3)",
              fontSize: 13,
            }}
          >
            {t("home.admin.noTeamActivity")}
          </div>
        ) : (
          <TeamPerformanceTable rows={data.team} />
        )}
      </HomeSection>
    </>
  );
}

function KpiPlaceholderGrid() {
  const t = useT();
  const placeholders = [
    { label: t("home.admin.kpiRevenue"), icon: DollarSign },
    { label: t("home.admin.kpiAppointments"), icon: Calendar },
    { label: t("home.admin.kpiOccupancy"), icon: TrendingUp },
    { label: t("home.admin.kpiNoShows"), icon: UserX },
  ];
  return (
    <>
      {placeholders.map((p, i) => (
        <KpiCard key={p.label} label={p.label} value="—" icon={p.icon} hero={i === 0} />
      ))}
    </>
  );
}
