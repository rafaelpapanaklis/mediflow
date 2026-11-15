"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, MessageCircle, Phone, X } from "lucide-react";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { upperFirst } from "@/components/barber/upper-first";
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
  // «Rechazar» pide confirmación: aquí queda la solicitud que se está por rechazar.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Cuando al cliente NO le va a llegar aviso, el dueño lo ve aquí y avisa él.
  const [aviso, setAviso] = useState<{
    accion: "aceptar" | "rechazar";
    nombre: string;
    telefono: string | null;
  } | null>(null);

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

  const resolve = async (r: BarberBookingRequestDTO, accion: "aceptar" | "rechazar") => {
    const id = r.id;
    setError(null);
    setConfirmId(null);
    setAviso(null);
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
      // El servidor dice si al cliente le va a llegar aviso. Si no (sin WhatsApp
      // conectado, sin teléfono o —al rechazar— fuera de las 24 h), se lo decimos
      // al dueño con el teléfono a la mano. Sin dato (servidor viejo) no se alarma.
      if (body?.notified === false) {
        setAviso({ accion, nombre: r.clientName, telefono: r.clientPhone || null });
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
          <Link2 size={16} style={{ color: "var(--brand-ink)" }} />
          <b style={{ fontSize: 13 }}>{t("barber.reserva.solicitudes.tuLiga")}</b>
          <code
            style={{
              flex: "1 1 220px",
              minWidth: 0,
              fontSize: 12.5,
              color: "var(--text-2)",
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius-sm)",
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
            color: "var(--danger)",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger-border-strong)",
            borderRadius: "var(--radius-md)",
            padding: "10px 12px",
            margin: "0 0 14px",
          }}
        >
          {error}
        </p>
      ) : null}

      {aviso ? (
        <div
          role="status"
          data-aviso-manual
          style={{
            background: "var(--warning-soft)",
            border: "1px solid var(--warning-border-strong)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
            margin: "0 0 14px",
          }}
        >
          <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
            {aviso.accion === "aceptar"
              ? t("barber.reserva.solicitudes.avisaTuAcepto", { nombre: aviso.nombre })
              : t("barber.reserva.solicitudes.avisaTuRechazo", { nombre: aviso.nombre })}
          </p>
          <p style={{ fontSize: 14.5, fontWeight: 700, color: "var(--warning-strong)", margin: "4px 0 10px" }}>
            {t("barber.reserva.solicitudes.avisaTu")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {aviso.telefono ? (
              <>
                <a href={`tel:+52${aviso.telefono}`} style={{ ...SMALL_BTN, ...GHOST_BTN }}>
                  <Phone size={14} /> {t("barber.reserva.solicitudes.avisaTuLlamar")} · {formatBarberPhone(aviso.telefono)}
                </a>
                <a
                  href={`https://wa.me/52${aviso.telefono}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...SMALL_BTN, ...GHOST_BTN }}
                >
                  <MessageCircle size={14} /> {t("barber.reserva.solicitudes.avisaTuWhatsapp")}
                </a>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-2)", alignSelf: "center" }}>
                {t("barber.reserva.solicitudes.avisaTuSinTelefono")}
              </span>
            )}
            <button type="button" style={{ ...SMALL_BTN, ...GHOST_BTN }} onClick={() => setAviso(null)}>
              {t("barber.reserva.solicitudes.avisaTuCerrar")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Pestañas */}
      <div style={TABS}>
        {(["pendientes", "resueltas"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            style={{
              ...TAB,
              borderBottomColor: tab === id ? "var(--brand)" : "transparent",
              color: tab === id ? "var(--text-1)" : "var(--text-3)",
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
                    <span style={{ ...PILL, marginLeft: 6 }} data-origen={r.source}>
                      {r.source === "WHATSAPP"
                        ? t("barber.reserva.solicitudes.origenWhatsapp")
                        : t("barber.reserva.solicitudes.origenWeb")}
                    </span>
                  </p>
                  <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>
                    {upperFirst(fmtWhen(r.startAt))}
                    {" · "}
                    {r.barberName ?? t("barber.reserva.solicitudes.cualquierBarbero")}
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
                    <p style={{ fontSize: 12.5, color: "var(--warning-strong)", margin: "8px 0 0", fontWeight: 600 }}>
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
                        aria-label={formatBarberPhone(r.clientPhone)}
                      >
                        <Phone size={14} /> {formatBarberPhone(r.clientPhone)}
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
                    onClick={() => void resolve(r, "aceptar")}
                  >
                    <Check size={15} /> {t("barber.reserva.solicitudes.aceptar")}
                  </button>
                  <button
                    type="button"
                    style={{ ...SMALL_BTN, ...GHOST_BTN }}
                    disabled={busyId === r.id}
                    aria-expanded={confirmId === r.id}
                    onClick={() => setConfirmId(confirmId === r.id ? null : r.id)}
                  >
                    <X size={15} /> {t("barber.reserva.solicitudes.rechazar")}
                  </button>
                  {confirmId === r.id ? (
                    <div
                      role="alertdialog"
                      aria-label={t("barber.reserva.solicitudes.confirmarRechazo", { nombre: r.clientName })}
                      style={{
                        flexBasis: "100%",
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 12px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--danger-soft)",
                        border: "1px solid var(--danger-border-strong)",
                      }}
                    >
                      <span style={{ fontSize: 13.5, fontWeight: 600, flex: "1 1 200px" }}>
                        {t("barber.reserva.solicitudes.confirmarRechazo", { nombre: r.clientName })}
                      </span>
                      <button
                        type="button"
                        autoFocus
                        style={{ ...SMALL_BTN, background: "var(--danger)", border: "1px solid var(--danger)", color: "var(--bg-elev)" }}
                        disabled={busyId === r.id}
                        onClick={() => void resolve(r, "rechazar")}
                      >
                        {t("barber.reserva.solicitudes.confirmarRechazoSi")}
                      </button>
                      <button
                        type="button"
                        style={{ ...SMALL_BTN, ...GHOST_BTN }}
                        onClick={() => setConfirmId(null)}
                      >
                        {t("barber.reserva.solicitudes.confirmarRechazoNo")}
                      </button>
                    </div>
                  ) : null}
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

// Rediseño D (tanda 3): radios del tema (12 tarjeta, 8 control), pestañas
// subrayadas y etiquetas sin MAYÚSCULAS. Mismos tamaños de letra.
const CARD: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-1)",
  padding: 16,
  marginBottom: 14,
};

const TABS: React.CSSProperties = {
  display: "flex",
  gap: 2,
  margin: "0 0 16px",
  borderBottom: "1px solid var(--border-soft)",
};

const TAB: React.CSSProperties = {
  background: "transparent",
  border: 0,
  borderBottom: "2px solid transparent",
  marginBottom: -1,
  padding: "10px 14px",
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
  borderRadius: "var(--radius-md)",
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
  fontWeight: 600,
  color: "var(--text-2)",
  background: "var(--bg-elev-2)",
  borderRadius: 999,
  padding: "3px 9px",
  whiteSpace: "nowrap",
};
