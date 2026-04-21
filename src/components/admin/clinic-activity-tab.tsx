"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Calendar, CreditCard, FileText, User, FileImage, Activity as ActivityIcon } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";

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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Timeline cards grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
      }}>
        {timelineItems.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: 12,
              padding: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "var(--brand-soft)",
                display: "grid", placeItems: "center",
                flexShrink: 0,
                color: "var(--brand)",
              }}>
                <Icon size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{item.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>{relTime(item.iso)}</div>
                {item.detail && (
                  <div style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>{item.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Daily chart */}
      <CardNew title="Actividad últimos 30 días">
        <div style={{ height: 224 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
              <XAxis dataKey="label" stroke="var(--text-3)" tick={{ fontSize: 10 }} />
              <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--text-1)",
                }}
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
              />
              <Bar dataKey="count" fill="var(--brand)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardNew>

      {/* Last logins + activity per user */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
      }}>
        <CardNew title="Últimos accesos">
          {users.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>Sin usuarios</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {users.slice(0, 6).map((u, idx, arr) => (
                <div
                  key={u.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                    padding: "6px 0",
                    borderBottom: idx < arr.length - 1 ? "1px solid var(--border-soft)" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{u.firstName} {u.lastName}</div>
                    <div style={{ color: "var(--text-3)" }}>{u.email}</div>
                  </div>
                  <div style={{ color: "var(--text-2)" }}>{relTime(u.lastLogin)}</div>
                </div>
              ))}
            </div>
          )}
        </CardNew>

        <CardNew title="Acciones por usuario (30 días)">
          {userActivity.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>Sin registros de auditoría</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {userActivity.slice(0, 6).map(row => (
                <div key={row.userId} style={{ fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
                      {row.user ? `${row.user.firstName} ${row.user.lastName}` : row.userId}
                    </span>
                    <span className="mono" style={{ color: "var(--brand)", fontWeight: 700 }}>{row.count}</span>
                  </div>
                  <div style={{
                    height: 6,
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}>
                    <div
                      style={{
                        height: "100%",
                        background: "var(--brand)",
                        width: `${Math.min(100, (row.count / (userActivity[0]?.count || 1)) * 100)}%`,
                        borderRadius: 3,
                        transition: "width .3s",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardNew>
      </div>
    </div>
  );
}
