"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Users, Calendar, DollarSign,
  AlertTriangle, Clock, CheckCircle, XCircle, Bell,
} from "lucide-react";

const DAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function DeltaBadge({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${up ? "text-emerald-600" : "text-red-500"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(delta)}%
    </span>
  );
}

function KpiCard({ icon, label, value, delta, sub, color = "blue" }: {
  icon: React.ReactNode; label: string; value: string; delta?: number; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    blue:   "bg-blue-50 dark:bg-blue-900/30 text-blue-600",
    green:  "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600",
    purple: "bg-purple-50 dark:bg-purple-900/30 text-purple-600",
    amber:  "bg-amber-50 dark:bg-amber-900/30 text-amber-600",
  };
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex gap-3 items-start">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
        {(delta !== undefined || sub) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {delta !== undefined && <DeltaBadge delta={delta} />}
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardClient({ user }: { user: any }) {
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const today = new Date();
  const greeting = today.getHours() < 12 ? "Buenos días" : today.getHours() < 19 ? "Buenas tardes" : "Buenas noches";

  if (loading) {
    return (
      <div className="flex-1 p-6 space-y-4">
        <div className="h-6 bg-muted rounded-lg w-48 animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { today: todayData, month, patients, alerts, unconfirmedAppts, weekChart } = data;

  // Build week bar chart
  const maxAppts = Math.max(...(weekChart?.map((d: any) => parseInt(d.total)) ?? [1]), 1);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-foreground">
          {greeting}, {user.firstName} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          {today.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Today strip */}
      <div className="bg-gradient-to-r from-brand-600 to-brand-500 rounded-2xl p-4 text-white">
        <p className="text-sm font-semibold opacity-90 mb-3">Hoy</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: "Total",     value: todayData.total,     icon: "📅" },
            { label: "Pendientes", value: todayData.upcoming, icon: "⏳" },
            { label: "Atendidas", value: todayData.completed, icon: "✅" },
            { label: "Canceladas", value: todayData.cancelled, icon: "❌" },
          ].map(item => (
            <div key={item.label}>
              <p className="text-xl font-bold">{item.value}</p>
              <p className="text-xs opacity-80">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {(alerts.lowInventory > 0 || alerts.unconfirmedToday > 0 || alerts.overduePayments > 0 || alerts.pendingConsents > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Bell size={12} /> Alertas
          </p>
          <div className="space-y-1.5">
            {alerts.unconfirmedToday > 0 && (
              <Link href="/dashboard/appointments" className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl px-3 py-2.5">
                <Clock size={14} className="text-amber-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-amber-800">
                  {alerts.unconfirmedToday} cita{alerts.unconfirmedToday > 1 ? "s" : ""} sin confirmar hoy
                </p>
              </Link>
            )}
            {alerts.lowInventory > 0 && (
              <Link href="/dashboard/inventory" className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="text-red-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-red-800">
                  {alerts.lowInventory} insumo{alerts.lowInventory > 1 ? "s" : ""} con stock bajo
                </p>
              </Link>
            )}
            {alerts.overduePayments > 0 && (
              <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 rounded-xl px-3 py-2.5">
                <DollarSign size={14} className="text-orange-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-orange-800">
                  {alerts.overduePayments} pago{alerts.overduePayments > 1 ? "s" : ""} vencido{alerts.overduePayments > 1 ? "s" : ""} en planes
                </p>
              </div>
            )}
            {alerts.pendingConsents > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-xl px-3 py-2.5">
                <Bell size={14} className="text-blue-600 flex-shrink-0" />
                <p className="text-xs font-semibold text-blue-800">
                  {alerts.pendingConsents} consentimiento{alerts.pendingConsents > 1 ? "s" : ""} sin firmar
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Este mes</p>
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            icon={<Calendar size={18} />}
            label="Citas"
            value={month.appointments.toString()}
            delta={month.appointmentsDelta}
            sub="vs mes pasado"
            color="blue"
          />
          <KpiCard
            icon={<DollarSign size={18} />}
            label="Ingresos"
            value={formatCurrency(month.revenue)}
            delta={month.revenueDelta}
            sub="vs mes pasado"
            color="green"
          />
          <KpiCard
            icon={<DollarSign size={18} />}
            label="Ticket promedio"
            value={formatCurrency(month.avgTicket)}
            color="purple"
          />
          <KpiCard
            icon={<Users size={18} />}
            label="Pacientes activos"
            value={patients.total.toString()}
            sub={`+${patients.newMonth} nuevos`}
            color="amber"
          />
        </div>
      </div>

      {/* Week chart */}
      {weekChart && weekChart.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Esta semana</p>
          <div className="flex items-end gap-1 h-20">
            {weekChart.map((d: any, i: number) => {
              const total = parseInt(d.total);
              const h     = maxAppts > 0 ? Math.round((total / maxAppts) * 100) : 0;
              const dayDate = new Date(d.day);
              const isToday = d.day === today.toISOString().split("T")[0];
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-muted-foreground">{total || ""}</span>
                  <div className="w-full flex items-end" style={{ height: 56 }}>
                    <div
                      className={`w-full rounded-t-md transition-all ${isToday ? "bg-brand-500" : "bg-brand-200 dark:bg-brand-800"}`}
                      style={{ height: `${Math.max(h, 4)}%` }}
                    />
                  </div>
                  <span className={`text-[10px] ${isToday ? "font-bold text-brand-600" : "text-muted-foreground"}`}>
                    {DAYS_ES[dayDate.getDay()]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unconfirmed today */}
      {unconfirmedAppts && unconfirmedAppts.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Clock size={12} /> Sin confirmar hoy
          </p>
          <div className="space-y-2">
            {unconfirmedAppts.map((appt: any) => (
              <div key={appt.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-semibold">{appt.firstName} {appt.lastName}</p>
                  <p className="text-xs text-muted-foreground">{appt.startTime} · Dr/a. {appt.docFirst} {appt.docLast}</p>
                </div>
                {appt.phone && (
                  <a href={`https://wa.me/${appt.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg">
                    WhatsApp
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Acciones rápidas</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { href: "/dashboard/appointments", icon: "📅", label: "Nueva cita" },
            { href: "/dashboard/patients",     icon: "🧑‍⚕️", label: "Nuevo paciente" },
            { href: "/dashboard/billing",      icon: "💵", label: "Facturación" },
            { href: "/dashboard/inventory",    icon: "📦", label: "Inventario" },
          ].map(a => (
            <Link key={a.href} href={a.href}
              className="flex items-center gap-2.5 bg-card border border-border rounded-xl px-3 py-3 hover:bg-muted/50 transition-colors">
              <span className="text-lg">{a.icon}</span>
              <span className="text-sm font-semibold">{a.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
