// ═══════════════════════════════════════════════════════════════════════════
// Botón "Escribir por WhatsApp" — glifo + verde de marca + el enlace wa.me.
//
// Un solo sitio arma la URL de wa.me y un solo sitio decide cómo se ve el
// botón. Lo usan la tarjeta del manager de /dashboard/soporte y el banner de
// la mini-web (/dashboard/landing).
//
// Es un <a> de verdad, no un <button> con onClick: la clínica tiene que poder
// abrirlo en otra pestaña, copiarlo o compartirlo. Por eso NO usa <ButtonNew />
// (que renderiza <button>) y sí las reglas de su CSS module.
//
// El teléfono viaja en el href y NUNCA se pinta como texto: quien decide si el
// número se enseña es la pantalla que monta el botón, no el botón.
// ═══════════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { WhatsAppGlyph } from "./whatsapp-glyph";
import styles from "./whatsapp-link-button.module.css";

interface Props {
  /** E.164 SIN "+" ("529992602093"), tal cual sale de AccountManagerDTO. */
  phoneE164: string;
  /** Mensaje pre-escrito en TEXTO PLANO — aquí se url-encodea una sola vez. */
  message?: string;
  /** La etiqueta del botón. Siempre traducida por quien lo monta. */
  children: ReactNode;
  /** Ocupa todo el ancho del contenedor (en móvil lo hace siempre). */
  block?: boolean;
  iconSize?: number;
}

export function WhatsAppLinkButton({ phoneE164, message, children, block, iconSize = 16 }: Props) {
  // encodeURIComponent porque el mensaje lleva comas, acentos y signos de
  // interrogación de apertura.
  const href = `https://wa.me/${phoneE164}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  return (
    <a
      className={block ? `${styles.waLink} ${styles.block}` : styles.waLink}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <WhatsAppGlyph size={iconSize} />
      {children}
    </a>
  );
}
