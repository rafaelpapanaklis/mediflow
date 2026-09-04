"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import {
  eduPersonaDebeEnlazar,
  eduPersonaHref,
  type EduPersonaKind,
  type EduPersonaLinksAllowed,
} from "@/lib/edu/persona-core";

/**
 * DaleControl INSTITUCIONAL — el nombre de una persona, clicable.
 *
 * Punto ÚNICO. Ninguna pantalla del panel escribe un <Link> a la ficha de un
 * paciente, un estudiante o un docente a mano: importa esto. La razón está en
 * el JSDoc de src/lib/edu/persona-core.ts, y la trampa del id (EduStudent vs
 * EduUser) también.
 *
 * ── CÓMO SE USA ─────────────────────────────────────────────────────────
 *   <EduPersonaLink kind="paciente" id={row.patientId}>{row.patientName}</EduPersonaLink>
 *   <EduPersonaLink kind="estudiante" id={c.studentId}>
 *     {c.studentName} · {c.matricula}
 *   </EduPersonaLink>
 *
 * `children` es lo que se VE: el nombre, o el nombre más la matrícula. El
 * componente no lo formatea — cada pantalla ya sabe cómo se llama lo suyo.
 *
 * ── 🔴 NUNCA DENTRO DE OTRO <button> NI DE OTRO <Link> ──────────────────
 * Un ancla dentro de un botón (o dentro de otra ancla) es HTML inválido: el
 * navegador rompe el árbol, y el clic se lo pelean los dos manejadores.
 *
 * El caso concreto, para que no haya que descubrirlo: en
 * src/components/edu/agenda/agenda-lista.tsx el RENGLÓN ENTERO ya es un
 * <button> que abre la cita. Ahí el nombre del paciente NO se envuelve. Eso lo
 * resuelve la ola de clínica poniendo el enlace DENTRO del modal que abre ese
 * botón, donde ya no hay nada que se pelee el clic.
 *
 * ── LO QUE NO SE ENLAZA NUNCA ───────────────────────────────────────────
 * La regla vive aquí porque las tres olas que siguen la van a leer:
 *
 *  1. LA CADENA DE CUSTODIA Y LAS FIRMAS. "escribió X", "Firmada por X", "lo
 *     mandó X", "cobró X", "lo recibió X", "lo revocó X", "expedida por X ·
 *     cédula NNN". Es el rastro de auditoría (NOM-004): nombra a quien fuera
 *     en el momento en que fue, y casi ninguna de esas personas tiene ficha.
 *     Un enlace ahí convierte un hecho histórico en una navegación.
 *
 *  2. DOCUMENTOS LEGALES E IMPRESOS. El texto del consentimiento, la página
 *     pública src/components/edu/consentimiento-publico.tsx (su tipo
 *     EduConsentPublicView no lleva ni un id, a propósito), la línea de firma
 *     del recibo y la receta con cédula. Se imprimen y se firman: no son
 *     pantalla, son papel.
 *
 *  3. TESTIGOS Y REPRESENTANTES LEGALES. No son cuentas del sistema. No hay a
 *     dónde ir.
 *
 *  4. LA VISTA PREVIA DEL ALTA MASIVA DE EQUIPO. Describe gente que todavía no
 *     existe en la base: el id no existe hasta que se confirma el alta.
 */

/** Todo apagado. Es el valor por omisión del contexto: falla CERRADO. */
const EDU_PERSONA_LINKS_NADA: EduPersonaLinksAllowed = {
  paciente: false,
  estudiante: false,
  docente: false,
};

/**
 * Qué fichas puede abrir quien está mirando.
 *
 * 🔴 Por omisión, NINGUNA. Un EduPersonaLink que quede fuera del proveedor
 * —una pantalla nueva colgada de otro sitio, un modal montado en un portal mal
 * puesto— sale en texto plano. El fallo posible es "un nombre que no enlaza",
 * nunca "un enlace que no debía existir".
 */
export const EduPersonaLinksContext =
  createContext<EduPersonaLinksAllowed>(EDU_PERSONA_LINKS_NADA);

/**
 * El proveedor. Se monta UNA vez, en el layout del panel
 * (src/app/instituto/(panel)/layout.tsx), con los tres booleanos ya resueltos
 * en el SERVIDOR. Ninguna pantalla lo vuelve a montar.
 *
 * `children` entra como SLOT desde un Server Component: las pantallas del
 * panel siguen siendo server y no se arrastran al bundle del navegador por
 * vivir dentro de este cliente. Es el mismo patrón que EduShell.
 */
export function EduPersonaLinksProvider({
  value,
  children,
}: {
  value: EduPersonaLinksAllowed;
  children: React.ReactNode;
}) {
  return (
    <EduPersonaLinksContext.Provider value={value ?? EDU_PERSONA_LINKS_NADA}>
      {children}
    </EduPersonaLinksContext.Provider>
  );
}

/** Para quien necesite decidir OTRA cosa con los mismos booleanos. */
export function useEduPersonaLinks(): EduPersonaLinksAllowed {
  return useContext(EduPersonaLinksContext);
}

export interface EduPersonaLinkProps {
  kind: EduPersonaKind;
  /** EduStudent para estudiante, EduUser para docente, EduPatient para paciente. */
  id: string | null | undefined;
  /** Lo que se ve: el nombre, o el nombre y la matrícula. */
  children: React.ReactNode;
  /** Se SUMA a .edu-persona; no la sustituye. */
  className?: string;
  title?: string;
}

/**
 * El nombre. Enlace si se puede, texto plano si no — y quien lo pinta no tiene
 * que preguntar cuál de los dos toca.
 *
 * ⛔ NADA de onClick, router.push, stopPropagation ni estado. Es un <Link> y
 * ya: se abre en pestaña nueva con el botón de en medio, se copia con el menú
 * contextual y el prefetch de Next funciona. Un onClick con router.push rompe
 * las tres cosas y no gana ninguna.
 */
export function EduPersonaLink({
  kind,
  id,
  children,
  className,
  title,
}: EduPersonaLinkProps): JSX.Element {
  const allowed = useContext(EduPersonaLinksContext);

  // Sin id o sin permiso → el texto tal cual, SIN envoltorio y SIN clase. Un
  // <span class="edu-persona"> con cursor de mano y sin destino sería peor que
  // no tener nada.
  if (!eduPersonaDebeEnlazar(kind, id, allowed)) return <>{children}</>;

  // eduPersonaDebeEnlazar ya garantizó que `id` es una cadena con contenido;
  // el cast es porque con "strict": false TypeScript no estrecha el union.
  return (
    <Link
      href={eduPersonaHref(kind, id as string)}
      className={className ? `edu-persona ${className}` : "edu-persona"}
      // Para las pruebas y el QA visual: así se encuentran todos de un grep en
      // el DOM sin depender del texto, que es el nombre de alguien.
      data-persona={kind}
      title={title}
    >
      {children}
    </Link>
  );
}
