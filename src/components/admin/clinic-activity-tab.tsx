"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Calendar, CreditCard, FileText, User, FileImage, Activity as ActivityIcon } from "lucide-react";

interface User { id: string; firstName: string; lastName: string; email: string; role: string; lastLogin: string | null }

interface ActivityData {
  users: User[];
  timeline: {
    lastAppointment: any;
    lastInvoice:     any;
    lastRecord:      any;
    lastPatient:     any;
    lastFile:        any;
    lastAudit:       any;
  };
  dailyActivity: { date: string; count: number }[];
  userActivity:  { userId: string; count: number; user: User | null }[];
}

function relTime(iso?: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d < 1)  return "hoy";
  if (d < 7)  return `hace ${d} d`;
  if (d < 30) return `hace ${Math.floor(d / 7)} sem`;
  return `hace ${Math.floor(d / 30)} meses`;
}

export function ClinicActivityTab({ clinicId }: { clinicId: string }) {
  const [data, setData]     = useState<ActivityData | null>(null);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/clinics/${clinicId}/activity`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError("Error al cargar actividad"));
  }, [clinicId]);

  if (error) return <div className="bg-rose-950/40 border border-rose-700 rounded-xl p-4 text-rose-300 text-sm">{error}</div>;
  if (!data) return <div className="bg-slate-900 border border-slate-700 rounded-xl p-10 text-center text-slate-500 text-sm">Cargando…</div>;

  const { timeline, dailyActivity, userActivity, users } = data;
  const chartData = dailyActivity.map(d => ({ ...d, label: d.date.slice(5) }));

  const timelineItems = [
    { icon: Calendar,   label: "Última cita",         iso: timeline.lastAppointment?.createdAt, detail: timeline.lastAppointment ? `${timeline.lastAppointment.patient?.firstName ?? ""} ${timeline.lastAppointment.patient?.lastName ?? ""}`.trim() || timeline.lastAppointment.type : "" },
    { icon: CreditCard, label: "Última factura",      iso: timeline.lastInvoice?.createdAt,     detail: timeline.lastInvoice ? `#${timeline.lastInvoice.invoiceNumber} · $${timeline.lastInvoice.total}` : "" },
    { icon: FileText,   label: "Último expediente",   iso: timeline.lastRecord?.createdAt,      detail: timeline.lastRecord ? `${timeline.lastRecord.patient?.firstName ?? ""} ${timeline.lastRecord.patient?.lastName ?? ""}`.trim() : "" },
    { icon: User,       label: "Último paciente",     iso: timeline.lastPatient?.createdAt,     detail: timeline.lastPatient ? `${timeline.lastPatient.firstName} ${timeline.lastPatient.lastName}` : "" },
    { icon: FileImage,  label: "Último archivo",      iso: timeline.lastFile?.createdAt,        detail: timeline.lastFile ? `${timeline.lastFile.name}` : "" },
    { icon: ActivityIcon, label: "Última acción",     iso: timeline.lastAudit?.createdAt,       detail: timeline.lastAudit ? `${timeline.lastAudit.action} · ${timeline.lastAudit.entityType}` : "" },
  ];

  return (
    <div className="space-y-5">
      {/* Timeline */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {timelineItems.map(item => (
          <div key={item.label} className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-600/15 flex items-center justify-center flex-shrink-0">
              <item.icon className="w-5 h-5 text-brand-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-400">{item.label}</div>
              <div className="text-sm font-bold text-white mt-0.5">{relTime(item.iso)}</div>
              {item.detail && <div className="text-xs text-slate-500 truncate mt-0.5">{item.detail}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Daily chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <h3 className="text-sm font-bold mb-3">Actividad últimos 30 días</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Last logins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-bold mb-3">Últimos accesos</h3>
          {users.length === 0 ? (
            <div className="text-xs text-slate-500">Sin usuarios</div>
          ) : (
            <div className="space-y-2">
              {users.slice(0, 6).map(u => (
                <div key={u.id} className="flex items-center justify-between text-xs border-b border-slate-800 py-1.5 last:border-0">
                  <div>
                    <div className="font-semibold text-slate-200">{u.firstName} {u.lastName}</div>
                    <div className="text-slate-500">{u.email}</div>
                  </div>
                  <div className="text-slate-400">{relTime(u.lastLogin)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-bold mb-3">Acciones por usuario (30 días)</h3>
          {userActivity.length === 0 ? (
            <div className="text-xs text-slate-500">Sin registros de auditoría</div>
          ) : (
            <div className="space-y-2">
              {userActivity.slice(0, 6).map(row => (
                <div key={row.userId} className="text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-200">
                      {row.user ? `${row.user.firstName} ${row.user.lastName}` : row.userId}
                    </span>
                    <span className="text-brand-400 font-bold">{row.count}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500"
                      style={{ width: `${Math.min(100, (row.count / (userActivity[0]?.count || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
