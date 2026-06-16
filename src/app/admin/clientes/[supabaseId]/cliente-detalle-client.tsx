"use client";

import Link from "next/link";
import {
  ArrowLeft, Mail, MessageCircle, Eye, Building2, DollarSign, TrendingUp,
  Users, CalendarDays, Activity, Wallet,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { RevenueAreaChart } from "@/components/dashboard/revenue-area-chart";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import type {
  ClienteDetalle, ClienteClinica, ClienteAggStatus, ClienteTag, ClinicNormStatus,
} from "@/lib/admin/clientes";
import { PlanDonut, ActivityBars } from "./cliente-charts";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const AGG_TONE: Record<ClienteAggStatus, Tone> = { activo: "success", trial: "info", mixto: "warning", churn: "danger" };
const AGG_LABEL: Record<ClienteAggStatus, string> = { activo: "Activo", trial: "Trial", mixto: "Mixto", churn: "Churn" };
const TAG_META: Record<ClienteTag, { label: string; tone: Tone }> = {
  vip: { label: "VIP", tone: "brand" },
  nuevo: { label: "Nuevo", tone: "info" },
  en_riesgo: { label: "En riesgo", tone: "danger" },
};
const PLAN_TONE: Record<string, Tone> = { CLINIC: "brand", PRO: "info", BASIC: "neutral" };

const STATUS_META: Record<ClinicNormStatus, { label: string; tone: Tone }> = {
  active: { label: "Activa", tone: "success" },
  trial: { label: "En trial", tone: "warning" },
  past_due: { label: "Pago vencido", tone: "danger" },
  expired: { label: "Trial expirado", tone: "danger" },
  churn: { label: "Cancelada", tone: "danger" },
  none: { label: "Sin suscripción", tone: "neutral" },
};

function healthColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning)";
  return "var(--danger)";
}

export function ClienteDetalleClient({ cliente }: { cliente: ClienteDetalle }) {
  const waPhone = cliente.ownerPhone ? cliente.ownerPhone.replace(/[^\d]/g, "") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <CardNew noPad>
        <div style={{ padding: 20, display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <Link
            href="/admin/clientes"
            style={{
              padding: 8, borderRadius: 8, display: "grid", placeItems: "center",
              color: "var(--text-3)", border: "1px solid var(--border-soft)",
              background: "var(--bg-elev)", flexShrink: 0,
            }}
            aria-label="Volver"
          >
            <ArrowLeft size={14} />
          </Link>
          <AvatarNew name={cliente.ownerName} size="xl" />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 20, margin: 0, color: "var(--text-1)", fontWeight: 600 }}>{cliente.ownerName}</h1>
              <BadgeNew tone={AGG_TONE[cliente.aggStatus]} dot>{AGG_LABEL[cliente.aggStatus]}</BadgeNew>
              {cliente.tags.map((t) => (
                <BadgeNew key={t} tone={TAG_META[t].tone}>{TAG_META[t].label}</BadgeNew>
              ))}
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--text-2)", flexWrap: "wrap" }}>
              <span>{cliente.ownerEmail}</span>
              {cliente.ownerPhone && <span>{cliente.ownerPhone}</span>}
              <span>Alta {formatRelativeDate(cliente.createdAt)}</span>
              <span>Último acceso {formatRelativeDate(cliente.lastAccess)}</span>
              {cliente.affiliateName && <span>Traído por {cliente.affiliateName}</span>}
            </div>
            {/* Health score */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, maxWidth: 320 }}>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>Health</span>
              <div style={{ flex: 1, height: 6, background: "var(--bg-elev-2)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${cliente.healthScore}%`, background: healthColor(cliente.healthScore), transition: "width 0.3s" }} />
              </div>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>{cliente.healthScore}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href={`mailto:${cliente.ownerEmail}`} style={{ textDecoration: "none" }}>
              <ButtonNew variant="secondary" icon={<Mail size={14} />}>Email</ButtonNew>
            </a>
            {waPhone && (
              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <ButtonNew variant="secondary" icon={<MessageCircle size={14} />}>WhatsApp</ButtonNew>
              </a>
            )}
          </div>
        </div>
      </CardNew>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <KpiCard label="Clínicas" value={String(cliente.clinicsCount)} icon={Building2} />
        <KpiCard label="MRR" value={formatCurrency(cliente.mrr, "MXN")} icon={DollarSign} />
        <KpiCard label="Ingresos históricos" value={formatCurrency(cliente.ingresosTotales, "MXN")} icon={Wallet} />
        <KpiCard label="LTV estimado" value={formatCurrency(cliente.ltv, "MXN")} icon={TrendingUp} />
        <KpiCard label="Pacientes" value={String(cliente.totalPatients)} icon={Users} />
        <KpiCard label="Citas" value={String(cliente.totalAppointments)} icon={CalendarDays} />
      </div>

      {/* Gráficas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <CardNew title="Ingresos de suscripción" sub="Últimos 12 meses (pagos cobrados)">
          <RevenueAreaChart data={cliente.revenueSeries} />
        </CardNew>
        <CardNew title="Distribución de planes" sub="Clínicas por plan">
          {cliente.planDistribution.length > 0 ? (
            <PlanDonut data={cliente.planDistribution} />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Sin datos</div>
          )}
        </CardNew>
      </div>

      <CardNew title="Actividad por clínica" sub="Pacientes y citas acumulados">
        <ActivityBars data={cliente.activityPerClinic} />
      </CardNew>

      {/* Clínicas */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
          <Activity size={15} style={{ color: "var(--brand)" }} />
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            Clínicas del cliente ({cliente.clinics.length})
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {cliente.clinics.map((c) => (
            <ClinicCard key={c.id} clinic={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ClinicCard({ clinic }: { clinic: ClienteClinica }) {
  const status = STATUS_META[clinic.status];
  const tokenPct = clinic.aiTokensLimit > 0
    ? Math.min(100, Math.round((clinic.aiTokensUsed / clinic.aiTokensLimit) * 100))
    : 0;

  return (
    <CardNew noPad>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AvatarNew name={clinic.name} size="sm" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Link
              href={`/admin/clinics/${clinic.id}`}
              style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {clinic.name}
            </Link>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>/{clinic.slug}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <BadgeNew tone={PLAN_TONE[clinic.plan] ?? "neutral"}>{clinic.plan}</BadgeNew>
          <BadgeNew tone={status.tone} dot>{status.label}</BadgeNew>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{formatCurrency(clinic.planPrice, "MXN")}/mes</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 12 }}>
          <Metric label="Pacientes" value={String(clinic.patients)} />
          <Metric label="Citas" value={String(clinic.appointments)} />
          <Metric label="Ingresos" value={formatCurrency(clinic.ingresos, "MXN")} />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
            <span>Tokens IA</span>
            <span className="mono">{tokenPct}%</span>
          </div>
          <div style={{ width: "100%", height: 4, background: "var(--bg-elev-2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${tokenPct}%`, background: tokenPct >= 90 ? "var(--danger)" : tokenPct >= 70 ? "var(--warning)" : "var(--brand)" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          <Link href={`/admin/clinics/${clinic.id}`} style={{ textDecoration: "none", flex: 1 }}>
            <ButtonNew size="sm" variant="secondary" icon={<Eye size={13} />}>
              Ver detalle
            </ButtonNew>
          </Link>
          <a href={`/api/admin/impersonate?clinicId=${clinic.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", flex: 1 }}>
            <ButtonNew size="sm" variant="primary" icon={<Eye size={13} />}>Impersonar</ButtonNew>
          </a>
        </div>
      </div>
    </CardNew>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div className="mono" style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
