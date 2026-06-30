"use client";

// Centro de notificaciones del paciente (WS1-T10).
// · Lista (leídas/no leídas) con "marcar todas como leídas" y marcado por ítem.
// · Preferencias de recordatorio: canal (WhatsApp/correo/ambos) + anticipación
//   (24 h / 2 h). null = usar la configuración de la clínica. El cron las respeta.
// Multi-tenant: todo server-side por ctx.links. Responsive, español neutro (tú).
import { useEffect, useState } from "react";
import { Bell, CalendarClock, MessageSquare } from "lucide-react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import { PacienteCard, PacienteEmptyState } from "@/components/paciente/ui";
import {
  DEFAULT_NOTIF_PREFS,
  type NotifChannel,
  type NotifLeadMinutes,
  type NotifPrefs,
  type PacienteNotificacion,
  type PacienteNotificacionesResponse,
} from "@/lib/patient-notifications/types";

const GAP = "clamp(12px, 2vw, 18px)";
const MUTED = "rgba(245,245,247,0.65)";
const FAINT = "rgba(245,245,247,0.5)";

const H1: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(20px, 2.4vw, 26px)",
  fontWeight: 700,
};

const primaryBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "11px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  color: "rgba(245,245,247,0.85)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    background: active ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.05)",
    border: active ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.1)",
    color: active ? "#e9d5ff" : "rgba(245,245,247,0.7)",
    transition: "all .15s",
  };
}

const okBox: React.CSSProperties = {
  background: "rgba(34,197,94,0.12)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#4ade80",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
};
const errBox: React.CSSProperties = {
  background: "rgba(248,113,113,0.1)",
  border: "1px solid rgba(248,113,113,0.35)",
  color: "#f87171",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
};

/** "hace 5 min" / "hace 3 h" / "hace 2 d" / fecha absoluta. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function TypeIcon({ type }: { type: string }) {
  const common = { size: 18 };
  if (type === "APPOINTMENT_CHANGE") return <CalendarClock {...common} />;
  if (type === "MESSAGE") return <MessageSquare {...common} />;
  return <Bell {...common} />;
}

async function patchRead(payload: { id: string } | { all: true }): Promise<boolean> {
  try {
    const res = await fetch("/api/paciente/notificaciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function putPrefs(prefs: NotifPrefs | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/paciente/notificaciones/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ prefs }),
    });
    let json: { error?: string } = {};
    try {
      json = await res.json();
    } catch {
      /* sin body */
    }
    if (!res.ok) {
      return { ok: false, error: json?.error || "No se pudieron guardar los cambios." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Error de conexión. Revisa tu internet e intenta de nuevo." };
  }
}

const CHANNEL_LABEL: Record<NotifChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Correo",
  both: "Ambos",
};
const LEAD_LABEL: Record<NotifLeadMinutes, string> = {
  1440: "24 horas antes",
  120: "2 horas antes",
};

export default function PacienteNotificacionesPage() {
  const list = usePacienteData<PacienteNotificacionesResponse>("/api/paciente/notificaciones");
  const prefsData = usePacienteData<{ prefs: NotifPrefs | null }>(
    "/api/paciente/notificaciones/prefs",
  );

  const [useClinic, setUseClinic] = useState(true);
  const [channel, setChannel] = useState<NotifChannel>(DEFAULT_NOTIF_PREFS.channel);
  const [lead, setLead] = useState<NotifLeadMinutes>(DEFAULT_NOTIF_PREFS.leadMinutes);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; msg: string } | null>(null);

  // Carga inicial del formulario desde las prefs guardadas.
  useEffect(() => {
    if (!prefsData.data) return;
    const p = prefsData.data.prefs;
    if (p) {
      setUseClinic(false);
      setChannel(p.channel);
      setLead(p.leadMinutes);
    } else {
      setUseClinic(true);
      setChannel(DEFAULT_NOTIF_PREFS.channel);
      setLead(DEFAULT_NOTIF_PREFS.leadMinutes);
    }
  }, [prefsData.data]);

  const notifications: PacienteNotificacion[] = list.data?.notifications ?? [];
  const unread = list.data?.unreadCount ?? 0;

  async function onMarkOne(n: PacienteNotificacion) {
    if (n.read) return;
    const ok = await patchRead({ id: n.id });
    if (ok) list.mutate();
  }
  async function onMarkAll() {
    if (unread === 0) return;
    setMarking(true);
    const ok = await patchRead({ all: true });
    setMarking(false);
    if (ok) list.mutate();
  }
  async function onSavePrefs() {
    setSaving(true);
    const res = await putPrefs(useClinic ? null : { channel, leadMinutes: lead });
    setSaving(false);
    if (res.ok) {
      setStatus({ type: "ok", msg: "Preferencias guardadas." });
      prefsData.mutate();
      setTimeout(() => setStatus(null), 3000);
    } else {
      setStatus({ type: "error", msg: res.error || "No se pudo guardar." });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: GAP, width: "100%", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={H1}>Notificaciones</h1>
        <button
          type="button"
          onClick={onMarkAll}
          disabled={unread === 0 || marking}
          style={{ ...ghostBtn, opacity: unread === 0 || marking ? 0.5 : 1 }}
        >
          {marking ? "Marcando..." : "Marcar todas como leídas"}
        </button>
      </div>

      {/* ── Lista ──────────────────────────────────────────────────────── */}
      {!list.data && list.error ? (
        <PacienteCard>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, color: MUTED }}>
              No pudimos cargar tus notificaciones. Revisa tu conexión e inténtalo de nuevo.
            </span>
            <button type="button" onClick={() => list.mutate()} style={ghostBtn}>
              Reintentar
            </button>
          </div>
        </PacienteCard>
      ) : !list.data || list.isLoading ? (
        <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 76,
                borderRadius: 14,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <PacienteCard>
          <PacienteEmptyState message="No tienes notificaciones por ahora. Aquí verás tus recordatorios de cita y avisos." />
        </PacienteCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onMarkOne(n)}
              aria-label={n.read ? n.title : `${n.title} (sin leer)`}
              style={{
                textAlign: "left",
                cursor: n.read ? "default" : "pointer",
                fontFamily: "inherit",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                width: "100%",
                background: n.read ? "#121020" : "rgba(124,58,237,0.10)",
                border: n.read
                  ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(139,92,246,0.45)",
                borderRadius: 14,
                padding: "clamp(12px, 2vw, 16px)",
                transition: "all .15s",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  background: n.read ? "rgba(255,255,255,0.06)" : "rgba(124,58,237,0.22)",
                  color: n.read ? "rgba(245,245,247,0.7)" : "#c4b5fd",
                }}
              >
                <TypeIcon type={n.type} />
              </span>
              <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: n.read ? 600 : 700, color: "#f5f5f7" }}>
                    {n.title}
                  </span>
                  <span style={{ fontSize: 11.5, color: FAINT, whiteSpace: "nowrap" }}>
                    {timeAgo(n.createdAt)}
                  </span>
                </span>
                <span style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.45 }}>{n.body}</span>
              </span>
              {!n.read && (
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: "#8b5cf6",
                    marginTop: 6,
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Preferencias ───────────────────────────────────────────────── */}
      <PacienteCard title="Preferencias de recordatorio">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>
            Elige cómo y cuándo quieres tus recordatorios de cita. Por defecto seguimos la
            configuración de tu clínica.
          </p>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              color: "#f5f5f7",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={useClinic}
              onChange={(e) => setUseClinic(e.target.checked)}
              style={{ width: 17, height: 17, accentColor: "#8b5cf6", cursor: "pointer" }}
            />
            Usar la configuración de mi clínica (recomendado)
          </label>

          {!useClinic && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: FAINT }}>¿Por dónde?</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(["whatsapp", "email", "both"] as NotifChannel[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setChannel(c)}
                      aria-pressed={channel === c}
                      style={chip(channel === c)}
                    >
                      {CHANNEL_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: FAINT }}>
                  ¿Con cuánta anticipación?
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {([1440, 120] as NotifLeadMinutes[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLead(l)}
                      aria-pressed={lead === l}
                      style={chip(lead === l)}
                    >
                      {LEAD_LABEL[l]}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: FAINT, lineHeight: 1.45 }}>
                  Solo aplica si tu clínica ofrece ese momento de aviso; si no, seguirás recibiendo
                  los recordatorios que ella tenga configurados.
                </span>
              </div>
            </div>
          )}

          {status && <div style={status.type === "ok" ? okBox : errBox}>{status.msg}</div>}

          <div>
            <button
              type="button"
              onClick={onSavePrefs}
              disabled={saving}
              style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Guardando..." : "Guardar preferencias"}
            </button>
          </div>
        </div>
      </PacienteCard>
    </div>
  );
}
