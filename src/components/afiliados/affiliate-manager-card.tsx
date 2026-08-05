"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Tarjeta "Tu manager de cuenta" — versión del panel de AFILIADOS.
// Se monta arriba de la lista de tickets en /afiliados/soporte.
//
// Mismo contenido que la tarjeta de la clínica (components/dashboard/
// account-manager-card.tsx) pero escrita al lenguaje visual de ESTE panel:
// las primitivas de components/afiliados/ui/panel-ui + las clases `dcafp-*`
// de src/app/afiliados/panel.css. Sin CSS module y sin i18n (el panel del
// afiliado es solo español).
//
// Va con `accent`: es el canal PRINCIPAL de la pantalla —un WhatsApp directo
// contesta antes que un ticket—, así que se lee como la pieza destacada.
//
// Los datos llegan YA resueltos desde el servidor: aquí no se calcula
// disponibilidad ni se conoce el catálogo de managers.
//
// Tres estados:
//   · manager EN LÍNEA         → chip verde
//   · manager FUERA DE HORARIO → chip ámbar + cuándo vuelve a atender; el botón
//     de WhatsApp SIGUE habilitado (puede escribir ahora y le contestan luego)
//   · SIN manager              → canal general de soporte con CTA a ticket.
//     Nunca una tarjeta vacía: "sin manager" es un estado válido y frecuente
//     (la columna accountManagerId puede ni existir todavía en la BD).
// ═══════════════════════════════════════════════════════════════════════════

import { LifeBuoy } from "lucide-react";
import type { AccountManagerDTO } from "@/lib/account-manager/types";
import { firstNameOf, initialsFromName } from "@/lib/account-manager/types";
import { Chip, EmptyState, Eyebrow, Footnote, PanelCard } from "@/components/afiliados/ui/panel-ui";

// El botón de WhatsApp usa el primario del panel (`dcafp-btn--primary`), no el
// verde de la marca de WhatsApp: dentro del panel la acción principal es
// morada en todas las pantallas y romper eso aquí desalinearía la jerarquía.
// El glifo oficial de abajo es el que lo hace reconocible de un vistazo.

/** Glifo oficial de WhatsApp (mismo path que usa la tarjeta de la clínica). */
function WhatsAppGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/** El avatar del diseño mide 36px; aquí es la pieza destacada y va a 54px. */
const AVATAR_PX = 54;

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
      <PanelCard
        accent
        title="Soporte a afiliados"
        action={<Chip tone="brand" sm>Pronto</Chip>}
      >
        <EmptyState
          icon={<LifeBuoy size={22} strokeWidth={1.8} />}
          title="Aún no tienes un manager asignado"
          action={
            <button type="button" className="dcafp-btn dcafp-btn--primary" onClick={onOpenTicket}>
              <LifeBuoy size={15} strokeWidth={1.9} aria-hidden />
              Abrir un ticket
            </button>
          }
        >
          Mientras tanto, el equipo de DaleControl te atiende por aquí: abre un ticket con
          tu duda —comisiones, pagos, material de venta— y te respondemos en este mismo
          panel.
        </EmptyState>
        <div style={{ marginTop: 12 }}>
          <Footnote>En cuanto te asignemos un manager, lo verás aquí con su WhatsApp directo.</Footnote>
        </div>
      </PanelCard>
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
    <PanelCard accent>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Avatar + textos: juntos ocupan el centro y en móvil quedan arriba. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ position: "relative", width: AVATAR_PX, height: AVATAR_PX, flexShrink: 0 }}>
            {manager.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa (Supabase Storage): next/image exigiría allowlist de dominios.
              <img
                src={manager.photoUrl}
                alt={manager.name}
                width={AVATAR_PX}
                height={AVATAR_PX}
                style={{ width: AVATAR_PX, height: AVATAR_PX, borderRadius: "50%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <div className="dcafp-avatar" aria-hidden style={{ width: AVATAR_PX, height: AVATAR_PX, fontSize: 17 }}>
                {initialsFromName(manager.name)}
              </div>
            )}
            {online && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: 1,
                  bottom: 1,
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "var(--dcafp-ok)",
                  border: "2px solid var(--dcafp-surface)",
                }}
              />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Eyebrow>Tu manager de cuenta</Eyebrow>
              {online ? (
                <Chip tone="ok" dot sm>En línea</Chip>
              ) : (
                <Chip tone="amber" dot sm>Fuera de horario</Chip>
              )}
            </div>

            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: "-0.2px",
                color: "var(--dcafp-ink)",
                marginTop: 4,
                overflowWrap: "anywhere",
              }}
            >
              {manager.name}
            </div>

            <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", marginTop: 4, lineHeight: 1.5, overflowWrap: "anywhere" }}>
              {scheduleText ? <>Atiende {scheduleText}{" · "}</> : null}
              <span className="dcafp-mono" style={{ fontWeight: 700, color: "var(--dcafp-ink-2)" }}>
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
        <div style={{ flex: "0 1 240px", minWidth: 200 }}>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="dcafp-btn dcafp-btn--primary dcafp-btn--block"
          >
            <WhatsAppGlyph size={16} />
            Escribir por WhatsApp
          </a>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--dcafp-ink-3)", marginTop: 8, lineHeight: 1.5 }}>
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
                fontWeight: 700,
                color: "var(--dcafp-brand-deep)",
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
      </div>
    </PanelCard>
  );
}
