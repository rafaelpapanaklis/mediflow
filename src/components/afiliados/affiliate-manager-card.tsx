"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Tarjeta "Tu manager de cuenta" — versión del panel de AFILIADOS.
// Se monta arriba de la lista de tickets en /afiliados/soporte.
//
// Mismo contenido que la tarjeta de la clínica (components/dashboard/
// account-manager-card.tsx) pero escrita al idioma visual de este panel:
// inline styles + variables CSS, sin CSS module y sin i18n (el panel del
// afiliado es solo español).
//
// Los datos llegan YA resueltos desde el servidor: aquí no se calcula
// disponibilidad ni se conoce el catálogo de managers.
//
// Tres estados:
//   · manager EN LÍNEA         → chip verde
//   · manager FUERA DE HORARIO → chip gris + cuándo vuelve a atender; el botón
//     de WhatsApp SIGUE habilitado (puede escribir ahora y le contestan luego)
//   · SIN manager              → canal general de soporte con CTA a ticket.
//     Nunca una tarjeta vacía: "sin manager" es un estado válido y frecuente
//     (la columna accountManagerId puede ni existir todavía en la BD).
// ═══════════════════════════════════════════════════════════════════════════

import { LifeBuoy } from "lucide-react";
import type { AccountManagerDTO } from "@/lib/account-manager/types";
import { firstNameOf, initialsFromName } from "@/lib/account-manager/types";

// ── EXCEPCIÓN AL DESIGN SYSTEM ─────────────────────────────────────────────
// #16a34a es el verde de marca de WhatsApp (un tercero): es justo lo que hace
// el botón reconocible de un vistazo, así que NO se mapea a --brand ni a
// --success. Mismo criterio que la tarjeta de la clínica.
const WA_GREEN = "#16a34a";

/** Glifo oficial de WhatsApp (mismo path que usa la tarjeta de la clínica). */
function WhatsAppGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap", // en móvil el bloque de acción baja a su propia línea
  padding: "16px 20px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-1)",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: "var(--text-3)",
  textTransform: "uppercase",
};

const chipBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.06em",
  whiteSpace: "nowrap",
};

interface Props {
  /** null = el afiliado no tiene manager asignado (o el SQL aún no se aplicó). */
  manager: AccountManagerDTO | null;
  /** Resuelto en el servidor, en la timezone del MANAGER. */
  online: boolean;
  /** "Lun–Vie · 9:00–18:00" */
  scheduleText: string;
  /** "te responde mañana a las 9:00" · "" si no hay nada que prometer. */
  nextAvailable: string;
  /** Van en el mensaje pre-escrito de WhatsApp: identifican quién escribe. */
  affiliateName: string;
  referralCode: string;
  /** Abre el modal de nuevo ticket que ya vive en la pantalla. */
  onOpenTicket: () => void;
}

export function AffiliateManagerCard({
  manager,
  online,
  scheduleText,
  nextAvailable,
  affiliateName,
  referralCode,
  onOpenTicket,
}: Props) {
  // ── Sin manager: canal general de soporte ────────────────────────────────
  if (!manager) {
    return (
      <section style={{ ...cardStyle, justifyContent: "center", textAlign: "center", flexDirection: "column", gap: 10, padding: 22 }} aria-label="Soporte a afiliados">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
          <span style={eyebrowStyle}>Soporte a afiliados</span>
          <span style={{ ...chipBase, background: "var(--brand-soft)", color: "var(--brand)" }}>PRONTO</span>
        </div>
        <div
          aria-hidden
          style={{
            width: 54,
            height: 54,
            borderRadius: "50%",
            background: "var(--brand-soft)",
            color: "var(--brand)",
            display: "grid",
            placeItems: "center",
            marginTop: 6,
          }}
        >
          <LifeBuoy size={24} strokeWidth={1.7} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>
          Aún no tienes un manager asignado
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.55, margin: 0, maxWidth: "44ch" }}>
          Mientras tanto, el equipo de DaleControl te atiende por aquí: abre un ticket
          con tu duda —comisiones, pagos, material de venta— y te respondemos en este
          mismo panel.
        </p>
        <button type="button" className="btn-new btn-new--primary" style={{ marginTop: 6 }} onClick={onOpenTicket}>
          <LifeBuoy size={15} strokeWidth={1.8} />
          Abrir un ticket
        </button>
        <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>
          En cuanto te asignemos un manager, lo verás aquí con su WhatsApp directo.
        </div>
      </section>
    );
  }

  const firstName = firstNameOf(manager.name) || manager.name;

  // Mensaje pre-escrito: del otro lado llegan muchos chats sin contexto, así
  // que el afiliado se identifica solo (nombre + código de referido).
  // encodeURIComponent porque lleva comas, paréntesis y acentos.
  const prefilled = encodeURIComponent(
    `Hola ${firstName}, soy ${affiliateName}, afiliado de DaleControl (código ${referralCode}). Tengo una duda:`,
  );
  const waHref = `https://wa.me/${manager.whatsappE164}?text=${prefilled}`;

  return (
    <section style={cardStyle} aria-label="Tu manager de cuenta">
      {/* Avatar + textos: juntos ocupan el centro y en móvil quedan arriba. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ position: "relative", width: 54, height: 54, flexShrink: 0 }}>
          {manager.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa (Supabase Storage): next/image exigiría allowlist de dominios.
            <img
              src={manager.photoUrl}
              alt={manager.name}
              width={54}
              height={54}
              style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              aria-hidden
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(135deg, var(--violet-400, #a855f7), var(--brand))",
                color: "#fff",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "0.02em",
                userSelect: "none",
              }}
            >
              {initialsFromName(manager.name)}
            </div>
          )}
          {online && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "var(--success)",
                border: "2px solid var(--bg-elev)",
              }}
            />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={eyebrowStyle}>Tu manager de cuenta</span>
            {online ? (
              <span style={{ ...chipBase, background: "var(--success-soft)", color: "var(--success-strong, var(--success))" }}>
                <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)", flexShrink: 0 }} />
                EN LÍNEA
              </span>
            ) : (
              <span style={{ ...chipBase, background: "var(--bg-elev-2)", color: "var(--text-3)" }}>
                <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-4)", flexShrink: 0 }} />
                FUERA DE HORARIO
              </span>
            )}
          </div>

          <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--text-1)", marginTop: 3, letterSpacing: "-0.01em" }}>
            {manager.name}
          </div>

          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
            {scheduleText ? <>Atiende {scheduleText}{" · "}</> : null}
            <span className="mono" style={{ fontWeight: 600, color: "var(--text-2)" }}>
              {manager.whatsappDisplay}
            </span>
            {/* Fuera de horario decimos cuándo vuelve: evita la ansiedad de
                escribir y no saber si alguien contesta. */}
            {!online && nextAvailable ? <>{" · "}{nextAvailable}</> : null}
          </div>
        </div>
      </div>

      {/* Acción. Fuera de horario el botón NO se deshabilita: puede escribir
          ahora y le contestan dentro del horario del manager. */}
      <div style={{ flex: "0 1 224px", minWidth: 200 }}>
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            height: 42,
            borderRadius: "var(--radius)",
            background: WA_GREEN,
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <WhatsAppGlyph size={16} />
          Escribir por WhatsApp
        </a>
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
          {online ? null : <>Escríbele ahora, te responde en su horario.{" "}</>}
          O{" "}
          <button
            type="button"
            onClick={onOpenTicket}
            style={{
              // Nada de `font: inherit` (shorthand): pisaría el fontWeight de
              // abajo según el orden en que React serializa el objeto.
              fontFamily: "inherit",
              fontSize: "inherit",
              fontWeight: 600,
              color: "var(--brand)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            abre un ticket
          </button>
          {" "}si prefieres dejarlo por escrito.
        </div>
      </div>
    </section>
  );
}
