"use client";

import { useEffect, useState } from "react";
import { Zap, HardDrive, MessageCircle, Scan } from "lucide-react";
import { formatBytes, type PlanLimits } from "@/lib/plans";

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

function barClass(p: number) {
  if (p >= 90) return "bg-rose-500";
  if (p >= 70) return "bg-amber-500";
  return "bg-emerald-500";
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

  if (error) return <div className="bg-rose-950/40 border border-rose-700 rounded-xl p-4 text-rose-300 text-sm">{error}</div>;
  if (!data) return <div className="bg-slate-900 border border-slate-700 rounded-xl p-10 text-center text-slate-500 text-sm">Cargando…</div>;

  const aiPct = pct(data.ai.used, data.ai.limit);
  const stPct = pct(data.storage.used, data.storage.limit);
  const waPct = pct(data.whatsapp.sentThisMonth, data.whatsapp.limit);

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400">Plan</div>
          <div className="text-lg font-bold text-brand-400">{data.planLabel} ({data.plan})</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          Last AI reset: {new Date(data.ai.lastResetAt).toLocaleDateString("es-MX")}
        </div>
      </div>

      {/* AI */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <Zap className="w-5 h-5 text-brand-400" />
          <div className="flex-1">
            <h3 className="text-sm font-bold">Tokens IA consumidos este mes</h3>
            <p className="text-xs text-slate-500">Se reinician cada primer día del mes automáticamente.</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-extrabold text-white">{data.ai.used.toLocaleString()}</div>
            <div className="text-xs text-slate-400">de {data.ai.limit.toLocaleString()}</div>
          </div>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${barClass(aiPct)}`} style={{ width: `${aiPct}%` }} />
        </div>
        <div className="text-xs text-slate-400 mt-1.5">{aiPct}% del límite</div>
      </div>

      {/* Storage */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <HardDrive className="w-5 h-5 text-brand-400" />
          <div className="flex-1">
            <h3 className="text-sm font-bold">Storage usado</h3>
            <p className="text-xs text-slate-500">{data.storage.files.toLocaleString()} archivos en patient-files.</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-extrabold text-white">{formatBytes(data.storage.used)}</div>
            <div className="text-xs text-slate-400">de {formatBytes(data.storage.limit)}</div>
          </div>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${barClass(stPct)}`} style={{ width: `${stPct}%` }} />
        </div>
        <div className="text-xs text-slate-400 mt-1.5">{stPct}% del límite del plan</div>
      </div>

      {/* WhatsApp */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <MessageCircle className="w-5 h-5 text-brand-400" />
          <div className="flex-1">
            <h3 className="text-sm font-bold">WhatsApps enviados este mes</h3>
            <p className="text-xs text-slate-500">Recordatorios de cita + recalls + manuales.</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-extrabold text-white">{data.whatsapp.sentThisMonth.toLocaleString()}</div>
            <div className="text-xs text-slate-400">de {data.whatsapp.limit.toLocaleString()}</div>
          </div>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${barClass(waPct)}`} style={{ width: `${waPct}%` }} />
        </div>
      </div>

      {/* XRay */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 flex items-center gap-4">
        <Scan className="w-5 h-5 text-brand-400" />
        <div className="flex-1">
          <h3 className="text-sm font-bold">Análisis IA de radiografías</h3>
          <p className="text-xs text-slate-500">Llamadas al endpoint /api/xrays/[id]/analyze este mes.</p>
        </div>
        <div className="text-2xl font-extrabold text-white">{data.xray.analysesThisMonth.toLocaleString()}</div>
      </div>
    </div>
  );
}
