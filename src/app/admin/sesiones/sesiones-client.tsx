"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Smartphone, ShieldCheck, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useTOptional } from "@/i18n/i18n-provider";

interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  current: boolean;
}

function uaSummary(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Dispositivo desconocido", mobile: false };
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  let browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Navegador";
  let os =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad|iPod/.test(ua) ? "iOS" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "";
  return { label: os ? `${browser} · ${os}` : browser, mobile };
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

export function SesionesClient({
  initial,
  adminEmail,
}: {
  initial: SessionRow[];
  adminEmail: string;
}) {
  const router = useRouter();
  const tOpt = useTOptional();
  const tr = useCallback(
    (key: string, fallback: string) => {
      const v = tOpt?.(key);
      return v && v !== key ? v : fallback;
    },
    [tOpt],
  );

  const [sessions, setSessions] = useState<SessionRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sessions", { cache: "no-store" });
      if (res.status === 401) {
        // Revocó su propia sesión actual → de vuelta al login.
        router.push("/admin/login");
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      toast.error(tr("admin.sessions.refreshError", "No se pudieron cargar las sesiones"));
    }
  }, [router, tr]);

  const revoke = useCallback(
    async (row: SessionRow) => {
      setBusy(row.id);
      try {
        const res = await fetch("/api/admin/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "revoke", id: row.id }),
        });
        if (!res.ok && res.status !== 401) throw new Error();
        toast.success(
          row.current
            ? tr("admin.sessions.closedCurrent", "Sesión cerrada")
            : tr("admin.sessions.revoked", "Sesión revocada"),
        );
        if (row.current) {
          router.push("/admin/login");
          return;
        }
        await refresh();
      } catch {
        toast.error(tr("admin.sessions.revokeError", "No se pudo revocar la sesión"));
      } finally {
        setBusy(null);
      }
    },
    [refresh, router, tr],
  );

  const revokeAll = useCallback(async () => {
    setBusy("__all__");
    setConfirmAll(false);
    try {
      const res = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revokeAll" }),
      });
      if (!res.ok) throw new Error();
      toast.success(tr("admin.sessions.allClosed", "Se cerraron las demás sesiones"));
      await refresh();
    } catch {
      toast.error(tr("admin.sessions.revokeError", "No se pudo revocar la sesión"));
    } finally {
      setBusy(null);
    }
  }, [refresh, tr]);

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "8px 0 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          {tr("admin.sessions.title", "Sesiones de administrador")}
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          {tr(
            "admin.sessions.subtitle",
            "Sesiones activas de tu cuenta de administrador. Revoca cualquiera al instante.",
          )}{" "}
          <span className="mono" style={{ color: "var(--text-2)" }}>{adminEmail}</span>
        </p>
      </div>

      <CardNew
        title={tr("admin.sessions.activeTitle", "Sesiones activas")}
        sub={tr("admin.sessions.activeSub", "Cada dispositivo donde iniciaste sesión")}
      >
        {/* Acciones globales */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            type="button"
            onClick={refresh}
            className="icon-btn-new"
            aria-label={tr("admin.sessions.refresh", "Actualizar")}
            title={tr("admin.sessions.refresh", "Actualizar")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "auto", padding: "0 10px", fontSize: 12, color: "var(--text-2)" }}
          >
            <RefreshCw size={13} />
            {tr("admin.sessions.refresh", "Actualizar")}
          </button>

          {confirmAll ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                {tr("admin.sessions.confirmAll", "¿Cerrar las demás sesiones?")}
              </span>
              <ButtonNew variant="danger" onClick={revokeAll} disabled={busy === "__all__"}>
                {busy === "__all__"
                  ? tr("admin.sessions.closing", "Cerrando…")
                  : tr("admin.sessions.confirmYes", "Sí, cerrar")}
              </ButtonNew>
              <ButtonNew variant="ghost" onClick={() => setConfirmAll(false)} disabled={busy === "__all__"}>
                {tr("common.cancel", "Cancelar")}
              </ButtonNew>
            </div>
          ) : (
            <ButtonNew
              variant="ghost"
              onClick={() => setConfirmAll(true)}
              disabled={others === 0 || busy !== null}
            >
              {tr("admin.sessions.closeOthers", "Cerrar todas las demás")}
              {others > 0 ? ` (${others})` : ""}
            </ButtonNew>
          )}
        </div>

        {/* Lista */}
        {sessions.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {tr("admin.sessions.empty", "No hay sesiones activas.")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sessions.map((s) => {
              const { label, mobile } = uaSummary(s.userAgent);
              const Icon = mobile ? Smartphone : Monitor;
              return (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "12px 14px",
                    background: "var(--bg-elev-2)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--brand-soft)", color: "var(--brand)",
                    }}
                  >
                    <Icon size={16} />
                  </div>

                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{label}</span>
                      {s.current && (
                        <BadgeNew tone="success" dot>
                          {tr("admin.sessions.current", "Actual")}
                        </BadgeNew>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span className="mono">{s.ipAddress ?? "IP desconocida"}</span>
                      <span>· {tr("admin.sessions.started", "Inició")}: {fmtDate(s.createdAt)}</span>
                      <span>· {tr("admin.sessions.expires", "Expira")}: {fmtDate(s.expiresAt)}</span>
                    </div>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    <ButtonNew
                      variant={s.current ? "ghost" : "danger"}
                      onClick={() => revoke(s)}
                      disabled={busy !== null}
                    >
                      {busy === s.id
                        ? tr("admin.sessions.closing", "Cerrando…")
                        : s.current
                          ? tr("admin.sessions.closeCurrent", "Cerrar esta sesión")
                          : tr("admin.sessions.revoke", "Revocar")}
                    </ButtonNew>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            marginTop: 14, padding: "10px 14px", display: "flex", gap: 8,
            background: "var(--brand-soft)", border: "1px solid rgba(124,58,237,0.25)",
            borderRadius: 10, fontSize: 12, color: "var(--text-2)",
          }}
        >
          <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--brand)" }} />
          <span>
            {tr(
              "admin.sessions.note",
              "Las sesiones expiran solas a las 8 horas. Si pierdes un dispositivo, revoca su sesión aquí: el token deja de funcionar al instante.",
            )}
          </span>
        </div>
      </CardNew>
    </div>
  );
}
