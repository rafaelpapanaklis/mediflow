"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Tarjeta "Tu manager de cuenta" — variante HORIZONTAL del prototipo (1f).
// Se monta ARRIBA de la lista de tickets en /dashboard/soporte.
//
// Los datos llegan YA resueltos desde el servidor (ver
// src/lib/account-manager/get-for-clinic.ts): este componente no calcula
// disponibilidad ni conoce el catálogo de managers — sólo pinta el manager
// asignado a la clínica de la sesión.
//
// Tres estados, los tres del prototipo:
//   · con manager EN LÍNEA         → chip verde con punto pulsante + badge en el avatar
//   · con manager FUERA DE HORARIO → chip gris + copy tranquilizador; el botón
//     de WhatsApp SIGUE habilitado (puede escribir; le contestan en su horario)
//   · sin manager                  → estado vacío con CTA a ticket
// ═══════════════════════════════════════════════════════════════════════════

import { FileText, UserRound } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import type { AccountManagerCardData } from "@/lib/account-manager/get-for-clinic";
import { firstNameOf, initialsFromName } from "@/lib/account-manager/types";
import styles from "./account-manager-card.module.css";

/** Glifo oficial de WhatsApp (mismo path del prototipo). */
function WhatsAppGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={styles.waIcon} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

interface Props {
  /** null = la clínica no tiene manager asignado (o el SQL aún no se aplicó). */
  data: AccountManagerCardData | null;
  /** Nombre de la clínica — va en el mensaje pre-escrito de WhatsApp. */
  clinicName: string;
  /** Abre el modal de nuevo ticket YA EXISTENTE. No duplicamos ese flujo. */
  onOpenTicket: () => void;
}

export function AccountManagerCard({ data, clinicName, onOpenTicket }: Props) {
  const t = useT();

  // ── Estado vacío: sin manager asignado ───────────────────────────────────
  if (!data) {
    return (
      <section className={styles.card} aria-label={t("accountManager.eyebrow")}>
        <div className={styles.empty}>
          <div className={styles.emptyHeader}>
            <span className={styles.eyebrow}>{t("accountManager.eyebrow")}</span>
            <span className={`${styles.chip} ${styles.chipSoon}`}>{t("accountManager.soon")}</span>
          </div>
          <div className={styles.emptyIcon} style={{ marginTop: 16 }}>
            <UserRound size={24} strokeWidth={1.7} aria-hidden />
          </div>
          <div className={styles.emptyTitle}>{t("accountManager.emptyTitle")}</div>
          <p className={styles.emptyBody}>{t("accountManager.emptyBody")}</p>
          <div className={styles.emptyActions}>
            <ButtonNew
              variant="primary"
              type="button"
              icon={<FileText size={15} strokeWidth={1.8} />}
              onClick={onOpenTicket}
            >
              {t("accountManager.emptyCta")}
            </ButtonNew>
          </div>
          <div className={styles.emptyFootnote}>{t("accountManager.emptyFootnote")}</div>
        </div>
      </section>
    );
  }

  const { manager, online, scheduleText, nextAvailable } = data;
  const firstName = firstNameOf(manager.name) || manager.name;

  // Mensaje pre-escrito: le ahorra a la clínica explicar quién es. El prototipo
  // no lo definía; se añade porque del otro lado llegan muchos chats sin
  // contexto. encodeURIComponent porque lleva coma, punto y acentos.
  const prefilled = encodeURIComponent(
    t("accountManager.prefilledMessage", { manager: firstName, clinic: clinicName }),
  );
  const waHref = `https://wa.me/${manager.whatsappE164}?text=${prefilled}`;

  return (
    <section className={styles.card} aria-label={t("accountManager.eyebrow")}>
      <div className={styles.headRow}>
        <div className={styles.avatarWrap}>
          {manager.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa (Supabase Storage): next/image exigiría allowlist de dominios.
            <img className={styles.avatar} src={manager.photoUrl} alt={manager.name} width={54} height={54} />
          ) : (
            <div className={styles.avatarFallback} aria-hidden>
              {initialsFromName(manager.name)}
            </div>
          )}
          {online && <span className={styles.presenceDot} aria-hidden />}
        </div>

        <div className={styles.body}>
          <div className={styles.topRow}>
            <span className={styles.eyebrow}>{t("accountManager.eyebrow")}</span>
            {online ? (
              <span className={`${styles.chip} ${styles.chipOnline}`}>
                <span className={`${styles.chipDot} ${styles.chipDotOnline}`} aria-hidden />
                {t("accountManager.online")}
              </span>
            ) : (
              <span className={`${styles.chip} ${styles.chipOffline}`}>
                <span className={`${styles.chipDot} ${styles.chipDotOffline}`} aria-hidden />
                {t("accountManager.offline")}
              </span>
            )}
          </div>

          <div className={styles.name}>
            {manager.name} <span className={styles.quote}>— {t("accountManager.quote")}</span>
          </div>

          <div className={styles.meta}>
            {t("accountManager.attends", { schedule: scheduleText })}
            {" · "}
            <span className={styles.phone}>{manager.whatsappDisplay}</span>
            {/* Fuera de horario el prototipo añade cuándo vuelve a atender. */}
            {!online && nextAvailable ? <>{" · "}{nextAvailable}</> : null}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        {/* Fuera de horario el botón NO se deshabilita: puede escribir ahora y
            le contestan en su horario (así lo define el prototipo). */}
        <a className={styles.waButton} href={waHref} target="_blank" rel="noopener noreferrer">
          <WhatsAppGlyph size={16} />
          {t("accountManager.writeWhatsapp")}
        </a>
        <div className={styles.ticketHint}>
          {online ? null : <>{t("accountManager.writeNowReplyLater")}{" "}</>}
          {t("accountManager.orOpenTicketPrefix")}
          <button type="button" className={styles.ticketLink} onClick={onOpenTicket}>
            {t("accountManager.orOpenTicketLink")}
          </button>
          {t("accountManager.orOpenTicketSuffix")}
        </div>
      </div>
    </section>
  );
}
