"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, MessageCircle, Phone, X } from "lucide-react";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { BarberBookingRequestDTO } from "@/lib/barber/booking";

/* ═══════════════════════════════════════════════════════════════════════
   Bandeja de solicitudes — la barbería acepta o rechaza lo que la gente
   apartó desde su página.

   La cita YA existe y ya tiene el hueco apartado desde que el cliente
   reservó: aceptar solo la pasa a CONFIRMED y rechazar a CANCELLED. Por eso
   no hay que volver a comprobar disponibilidad al aceptar.
   ═══════════════════════════════════════════════════════════════════════ */

export function SolicitudesClient({
  locale,
  timezone,
  policy,
  bookingPath,
  showBranch,
  pendientes,
  resueltas,
}: {
  locale: string;
  timezone: string;
  policy: "auto" | "manual";
  /** Ruta pública de reserva; el origen se arma en el navegador. */
  bookingPath: string;
  /** Cadena con varias sedes: se etiqueta cada solicitud. */
  showBranch: boolean;
  pendientes: BarberBookingRequestDTO[];
  resueltas: BarberBookingRequestDTO[];
}) {
  const t = useMemo(() => getBarberT(locale), [locale]);
  const router = useRouter();
  const intl = locale === "en" ? "en-US" : "es-MX";

  const [tab, setTab] = useState<"pendientes" | "resueltas">("pendientes");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const money = useMemo(
    () =>
      new Intl.NumberFormat(intl, {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      }),
    [intl],
  );

  const fmtWhen = (iso: string) =>
    new Intl.DateTimeFormat(intl, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
    }).format(new Date(iso));

  const resolve = async (id: string, accion: "aceptar" | "rechazar") => {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/barber/booking-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "No pudimos guardar el cambio");
        return;
      }
      router.refresh();
    } catch {
      setError("No hay conexión. Revisa tu internet.");
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${bookingPath}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copia la liga a mano: " + bookingPath);
    }
  };

  const list = tab === "pendientes" ? pendientes : resueltas;

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em", margin: 0 }}>
        {t("barber.reserva.solicitudes.title")}
      </h1>
      <p style={{ fontSize: 14, color: "var(--text-3)", margin: "6px 0 18px" }}>
        {t("barber.reserva.solicitudes.sub")}
      </p>

      {/* Liga pública + modo de confirmación */}
      <div style={CARD}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Link2 size={16} style={{ color: "var(--brand)" }} />
          <b style={{ fontSize: 13 }}>{t("barber.reserva.solicitudes.tuLiga")}</b>
          <code
            style={{
              flex: "1 1 220px",
              minWidth: 0,
              fontSize: 12.5,
              color: "var(--text-2)",
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: 8,
              padding: "6px 10px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {bookingPath}
          </code>
          <button type="button" className="barber-btn-primary" style={SMALL_BTN} onClick={() => void copyLink()}>
            <Copy size={14} />
            {copied ? t("barber.reserva.solicitudes.copiado") : t("barber.reserva.solicitudes.copiar")}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "10px 0 0" }}>
          {policy === "auto"
            ? t("barber.reserva.solicitudes.modoAuto")
            : t("barber.reserva.solicitudes.modoManual")}
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            fontSize: 13,
            color: "#b91c1c",
            background: "rgba(185,28,28,0.08)",
            border: "1px solid rgba(185,28,28,0.28)",
            borderRadius: 10,
            padding: "10px 12px",
            margin: "0 0 14px",
          }}
        >
          {error}
        </p>
      ) : null}

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 6, margin: "0 0 16px" }}>
        {(["pendientes", "resueltas"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              ...TAB,
              background: tab === id ? "var(--brand-soft)" : "transparent",
              borderColor: tab === id ? "var(--border-brand)" : "var(--border-soft)",
              color: tab === id ? "var(--brand)" : "var(--text-2)",
            }}
          >
            {t(`barber.reserva.solicitudes.${id}`)}
            {id === "pendientes" && pendientes.length > 0 ? ` (${pendientes.length})` : ""}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p style={{ ...CARD, textAlign: "center", color: "var(--text-3)", fontSize: 14 }}>
          {tab === "pendientes"
            ? t("barber.reserva.solicitudes.vacioPendientes")
            : t("barber.reserva.solicitudes.vacioResueltas")}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {list.map((r) => (
            <article key={r.id} style={CARD}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                    {r.clientName}{" "}
                    <span style={{ ...PILL, marginLeft: 6 }}>
                      {r.clientVisits > 0
                        ? t("barber.reserva.solicitudes.clienteVisitas", { n: r.clientVisits })
                        : t("barber.reserva.solicitudes.clienteNuevo")}
                    </span>
                  </p>
                  <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0", textTransform: "capitalize" }}>
                    {fmtWhen(r.startAt)}
                    {" · "}
                    <span style={{ textTransform: "none" }}>
                      {r.barberName ?? t("barber.reserva.solicitudes.cualquierBarbero")}
                    </span>
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text-3)", margin: "3px 0 0" }}>
                    {r.services.map((s) => s.name).join(" + ")}
                    {r.services.length ? ` · ${money.format(r.total)}` : ""}
                    {showBranch ? ` · ${r.branchLabel}` : ""}
                  </p>
                  {r.notes ? (
                    <p
                      style={{
                        fontSize: 12.5,
                        color: "var(--text-3)",
                        margin: "8px 0 0",
                        whiteSpace: "pre-wrap",
                        borderLeft: "2px solid var(--border-brand)",
                        paddingLeft: 8,
                      }}
                    >
                      {r.notes}
                    </p>
                  ) : null}
                  {r.isPast && r.status === "PENDING" ? (
                    <p style={{ fontSize: 12.5, color: "#b45309", margin: "8px 0 0", fontWeight: 600 }}>
                      {t("barber.reserva.solicitudes.vencida")}
                    </p>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {r.clientPhone ? (
                    <>
                      <a
                        href={`tel:+52${r.clientPhone}`}
                        style={{ ...SMALL_BTN, ...GHOST_BTN }}
                        aria-label={r.clientPhone}
                      >
                        <Phone size={14} /> {r.clientPhone}
                      </a>
                      <a
                        href={`https://wa.me/52${r.clientPhone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...SMALL_BTN, ...GHOST_BTN }}
                        aria-label="WhatsApp"
                      >
                        <MessageCircle size={14} />
                      </a>
                    </>
                  ) : null}
                </div>
              </div>

              {r.status === "PENDING" ? (
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="barber-btn-primary"
                    style={SMALL_BTN}
                    disabled={busyId === r.id}
                    onClick={() => void resolve(r.id, "aceptar")}
                  >
                    <Check size={15} /> {t("barber.reserva.solicitudes.aceptar")}
                  </button>
                  <button
                    type="button"
                    style={{ ...SMALL_BTN, ...GHOST_BTN }}
                    disabled={busyId === r.id}
                    onClick={() => void resolve(r.id, "rechazar")}
                  >
                    <X size={15} /> {t("barber.reserva.solicitudes.rechazar")}
                  </button>
                </div>
              ) : (
                <p style={{ ...PILL, display: "inline-block", marginTop: 12 }}>{STATUS_LABEL[r.status]}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  IN_PROGRESS: "En silla",
  DONE: "Completada",
  NO_SHOW: "No llegó",
  CANCELLED: "Rechazada",
};

const CARD: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 14,
  padding: 16,
  marginBottom: 14,
};

const TAB: React.CSSProperties = {
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const SMALL_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const GHOST_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--text-1)",
};

const PILL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  background: "var(--bg-elev-2)",
  borderRadius: 999,
  padding: "3px 9px",
  whiteSpace: "nowrap",
};
