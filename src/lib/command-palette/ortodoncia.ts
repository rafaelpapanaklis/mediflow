/**
 * ORTODONCIA EN EL BUSCADOR DEL TOPBAR (Ctrl+K) — ws1-t5, 28-sep-2026.
 *
 * El fallo (revisión de lógica de uso, fila 9 del mapa): escribir
 * «ortodoncia» respondía «Sin resultados», y un paciente en tratamiento solo
 * abría su ficha, nunca su caso. El buscador no sabía que el módulo existe.
 *
 * LÓGICA PURA: sin React, sin Prisma y sin iconos, para probarla en node. Los
 * iconos los pone `actions.ts`; QUIÉN puede ver qué lo decide el servidor
 * (GET /api/dashboard/search) y aquí solo llega ya resuelto.
 *
 * Regla de la casa: nada de ortodoncia se enseña si la sede de la sesión no
 * tiene el módulo contratado o la persona no tiene el permiso del módulo.
 */

/** Lo que el servidor le dice a la paleta sobre esta persona en esta sede. */
export interface AccesoOrtodonciaPaleta {
  /** Sede dental, módulo contratado de verdad y permiso `specialties.orthodontics`. */
  activo: boolean;
  /** Además puede abrir la Configuración del módulo (`settings.view`). */
  configuracion: boolean;
}

export const SIN_ACCESO_ORTODONCIA: AccesoOrtodonciaPaleta = { activo: false, configuracion: false };

/**
 * Las tres condiciones del guardia del módulo (`decidirEntradaAlModulo`), más
 * la de Configuración. Si falta cualquiera de las tres primeras, no hay nada.
 */
export function accesoOrtodonciaParaPaleta(e: {
  esDental: boolean;
  moduloActivo: boolean;
  tienePermisoModulo: boolean;
  puedeVerConfiguracion: boolean;
}): AccesoOrtodonciaPaleta {
  const activo = e.esDental && e.moduloActivo && e.tienePermisoModulo;
  return { activo, configuracion: activo && e.puedeVerConfiguracion };
}

/** Lee el bloque `ortodoncia` de la respuesta sin fiarse de su forma. */
export function leerAccesoOrtodoncia(valor: unknown): AccesoOrtodonciaPaleta {
  if (!valor || typeof valor !== "object") return SIN_ACCESO_ORTODONCIA;
  const v = valor as { activo?: unknown; configuracion?: unknown };
  const activo = v.activo === true;
  return { activo, configuracion: activo && v.configuracion === true };
}

export interface DestinoOrtodoncia {
  id: string;
  /** Lo que se lee en la fila: «Ortodoncia: Cobranza de mensualidades». */
  label: string;
  /** Qué hay ahí, en una línea. */
  sub: string;
  href: string;
  /** Palabras con las que la gente lo busca, además del nombre. */
  keywords: string[];
  /** Solo para quien puede abrir la Configuración del módulo. */
  soloConfiguracion?: boolean;
}

/**
 * Los seis apartados del módulo, con los MISMOS nombres que su submenú
 * (src/app/dashboard/orthodontics/layout.tsx). Las palabras clave son las que
 * usa la clínica: «brackets», «mensualidad», «control», «alineadores»…
 */
export const DESTINOS_ORTODONCIA: readonly DestinoOrtodoncia[] = [
  {
    id: "orto:tablero",
    label: "Ortodoncia: Tablero",
    sub: "Casos en curso, controles de hoy y lo que entra por mensualidades",
    href: "/dashboard/orthodontics/tablero",
    keywords: ["ortodoncia", "brackets", "alineadores", "casos", "resumen", "produccion"],
  },
  {
    id: "orto:pacientes",
    label: "Ortodoncia: Casos",
    sub: "Todos los casos de ortodoncia de la clínica",
    href: "/dashboard/orthodontics/pacientes",
    keywords: ["ortodoncia", "brackets", "alineadores", "casos", "caso", "tratamiento", "abrir caso"],
  },
  {
    id: "orto:cobranza",
    label: "Ortodoncia: Cobranza de mensualidades",
    sub: "Quién debe, cuánto y desde cuándo",
    href: "/dashboard/orthodontics/cobranza",
    keywords: [
      "ortodoncia", "brackets", "mensualidad", "mensualidades", "cobrar", "vencido", "vencidas",
      "adeudo", "deuda", "enganche", "plan de pago",
    ],
  },
  {
    id: "orto:controles",
    label: "Ortodoncia: Controles",
    sub: "Controles de hoy y pacientes sin su próximo control",
    href: "/dashboard/orthodontics/controles",
    keywords: [
      "ortodoncia", "brackets", "control", "controles", "registrar control", "hoja de control",
      "activacion", "cambio de arco", "proximo control",
    ],
  },
  {
    id: "orto:alertas",
    label: "Ortodoncia: Alertas",
    sub: "Casos que piden atención",
    href: "/dashboard/orthodontics/alertas",
    keywords: ["ortodoncia", "brackets", "alertas", "avisos", "sin proximo control", "pendientes"],
  },
  {
    id: "orto:configuracion",
    label: "Ortodoncia: Configuración",
    sub: "Modo de cobro, doctor tratante y mensajes del módulo",
    href: "/dashboard/orthodontics/configuracion",
    keywords: ["ortodoncia", "brackets", "ajustes", "modo de cobro", "plantillas", "doctor tratante"],
    soloConfiguracion: true,
  },
];

/** Los destinos que ESTA persona puede abrir. Sin módulo o sin permiso: ninguno. */
export function destinosOrtodoncia(acceso: AccesoOrtodonciaPaleta): DestinoOrtodoncia[] {
  if (!acceso.activo) return [];
  return DESTINOS_ORTODONCIA.filter((d) => !d.soloConfiguracion || acceso.configuracion);
}

/** La ficha del paciente, abierta en su pestaña de Ortodoncia. */
export function hrefCasoOrtodoncia(patientId: string): string {
  return `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia`;
}

/**
 * ¿Este paciente del resultado lleva la fila «Abrir su caso de ortodoncia»?
 * Solo si el servidor dijo que tiene caso Y la persona tiene acceso al módulo:
 * un `casoOrtodoncia: true` suelto, sin el acceso, no enseña nada.
 */
export function ofreceAbrirCaso(
  paciente: { casoOrtodoncia?: unknown },
  acceso: AccesoOrtodonciaPaleta,
): boolean {
  return acceso.activo && paciente.casoOrtodoncia === true;
}
