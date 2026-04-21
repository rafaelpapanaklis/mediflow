"use client";

import { useEffect, useState } from "react";
import { Zap, HardDrive, MessageCircle, Scan } from "lucide-react";
import { formatBytes, type PlanLimits } from "@/lib/plans";
import { CardNew } from "@/components/ui/design-system/card-new";

interface Usage {
  plan: string;
  planLabel: string;
  limits: PlanLimits;
  ai:       { used: number;  limit: number; lastResetAt: string };
  storage:  { used: number;  limit: number; files: number };
  whatsapp: { sentThisMonth: number; limit: number };
  xray:     { analysesThisMonth: number };
}

function pct(used: number, limit: number) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function barColor(p: number) {
  if (p >= 90) return "var(--danger)";
  if (p >= 70) return "var(--warning)";
  return "var(--brand)";
}

interface UsageRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  used: string;
  limit: string;
  pctValue: number;
}

function UsageRow({ icon, title, subtitle, used, limit, pctValue }: UsageRowProps) {
  return (
    <CardNew>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ color: "var(--brand)", display: "grid", placeItems: "center" }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>{title}</h3>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0 0" }}>{subtitle}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-1)" }}>{used}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>de {limit}</div>
        </div>
      </div>
      <div style={{
        height: 8,
        background: "rgba(255,255,255,0.06)",
        borderRadius: 4,
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${pctValue}%`,
          background: barColor(pctValue),
          borderRadius: 4,
          transition: "width .3s",
        }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{pctValue}% del límite</div>
    </CardNew>
  );
}

export function ClinicUsageTab({ clinicId }: { clinicId: string }) {
  const [data, setData]   = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/clinics/${clinicId}/usage`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError("Error al cargar uso"));
  }, [clinicId]);

  if (error) return (
    <div style={{
      padding: 16,
      background: "rgba(239,68,68,0.08)",
      border: "1px solid rgba(239,68,68,0.3)",
      borderRadius: 12,
      color: "var(--danger)",
      fontSize: 13,
    }}>{error}</div>
  );
  if (!data) return (
    <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
      Cargando…
    </div>
  );

  const aiPct = pct(data.ai.used, data.ai.limit);
  const stPct = pct(data.storage.used, data.storage.limit);
  const waPct = pct(data.whatsapp.sentThisMonth, data.whatsapp.limit);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Plan header */}
      <CardNew>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{
              fontSize: 10,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}>Plan</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand)", marginTop: 2 }}>
              {data.planLabel} ({data.plan})
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-3)" }}>
            Last AI reset: {new Date(data.ai.lastResetAt).toLocaleDateString("es-MX")}
          </div>
        </div>
      </CardNew>

      <UsageRow
        icon={<Zap size={20} />}
        title="Tokens IA consumidos este mes"
        subtitle="Se reinician cada primer día del mes automáticamente."
        used={data.ai.used.toLocaleString()}
        limit={data.ai.limit.toLocaleString()}
        pctValue={aiPct}
      />

      <UsageRow
        icon={<HardDrive size={20} />}
        title="Storage usado"
        subtitle={`${data.storage.files.toLocaleString()} archivos en patient-files.`}
        used={formatBytes(data.storage.used)}
        limit={formatBytes(data.storage.limit)}
        pctValue={stPct}
      />

      <UsageRow
        icon={<MessageCircle size={20} />}
        title="WhatsApps enviados este mes"
        subtitle="Recordatorios de cita + recalls + manuales."
        used={data.whatsapp.sentThisMonth.toLocaleString()}
        limit={data.whatsapp.limit.toLocaleString()}
        pctValue={waPct}
      />

      {/* XRay (no limit) */}
      <CardNew>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ color: "var(--brand)", display: "grid", placeItems: "center" }}>
            <Scan size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
              Análisis IA de radiografías
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0 0" }}>
              Llamadas al endpoint /api/xrays/[id]/analyze este mes.
            </p>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-1)" }}>
            {data.xray.analysesThisMonth.toLocaleString()}
          </div>
        </div>
      </CardNew>
    </div>
  );
}
