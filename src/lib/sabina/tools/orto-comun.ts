/**
 * Lo común de las tres herramientas de ORTODONCIA de Sabina (ws1-t11):
 * `orto_caso`, `orto_controles` y `orto_cobranza`.
 *
 * 🔴 LAS TRES SON DE SOLO LECTURA (regla dura de Rafael). Ninguna abre casos,
 * firma hojas, cobra mensualidades ni manda recordatorios: dicen lo que hay y
 * dan el ENLACE a la pantalla del panel donde eso se hace. Por eso ninguna es
 * una acción (`definirAccion`), ninguna entra en `ACCIONES_SABINA`, y el enlace
 * no se deja en manos del modelo: viaja en `avisoObligatorio` y el motor lo
 * añade si la respuesta no lo trae.
 *
 * Lo único de ortodoncia que Sabina HACE (decisión de Rafael del 28-sep-2026,
 * «opción B») es AGENDAR, y no aquí: lo hace `agendar_cita`, la acción de
 * siempre, que propone y espera al botón (ver ./orto-agenda). Cobrar
 * ortodoncia, no: `cobrar_factura` lo rechaza (ver ../dinero/orto-candado).
 *
 * ── LOS NOMBRES EMPIEZAN POR `orto_`, NO POR `ortodoncia_` ──────────────
 * `sabina-dinero-actua.test.ts` prohíbe «ortodoncia» y «plan_de_pago» en el
 * nombre de cualquier herramienta del motor (MAPA-dinero §7: Sabina no mueve el
 * dinero de un tratamiento a plazos). Esa prohibición es para ESCRIBIR y sigue
 * en pie tal cual; las de aquí leen.
 *
 * ── QUIÉN PUEDE, EN ESTE ORDEN ─────────────────────────────────────────
 *  1. `specialties.orthodontics` — la key del módulo, la misma del guardia del
 *     panel (`exigirModuloOrtodoncia`). La mira el runner: sin ella,
 *     `sin_permiso` y no se consulta nada.
 *  2. El MÓDULO contratado en la sede (`estadoDelModulo`, en ./orto-motor, que
 *     llama a la misma función que el panel). Sin él NO es «no tienes acceso»
 *     —eso mandaría a pedir un permiso que no arregla nada—: es «esta sede no lo
 *     tiene contratado», con el enlace a la página de contratar.
 *  3. La key de cada PARTE (`medicalRecord.view` para lo clínico, `agenda.view`
 *     para los controles, `billing.view` para el dinero). Las pantallas del
 *     módulo no las piden, así que aquí Sabina queda un punto MÁS estricta que
 *     el panel, nunca más laxa: es lo que hace que el recorte del Super Admin
 *     («a Sabina le quité facturación») valga también para ortodoncia. Lo que
 *     falta va en `omitidas` y el motor lo DICE (regla 3).
 *
 * Este archivo es ligero a propósito: sin Prisma y sin el motor de ortodoncia.
 * Lo importan las tres herramientas, y ellas entran al catálogo del motor.
 */

import { RUTA_CONTRATAR_ORTODONCIA } from "@/lib/orthodontics/contratar";
import { fraseSinPermiso } from "../engine-core";
import { causaSinPermiso, type CausaSinPermiso } from "../permisos-sabina";
import { tienePermiso } from "./base";
import type { PermissionKey, SabinaCtx } from "../tipos";

/** La key del módulo: la misma que pide el guardia del panel. */
export const PERMISO_ORTO: PermissionKey = "specialties.orthodontics";

export type EstadoModulo =
  /** La sede lo tiene contratado y vigente. */
  | "activo"
  /** Clínica dental sin el módulo (o vencido). */
  | "no_contratado"
  /** La clínica no es dental: el módulo no existe para ella. */
  | "no_es_dental";

/** Las pantallas del panel donde se HACE cada cosa. */
export const ENLACES_ORTO = {
  tablero: "/dashboard/orthodontics/tablero",
  pacientes: "/dashboard/orthodontics/pacientes",
  controles: "/dashboard/orthodontics/controles",
  cobranza: "/dashboard/orthodontics/cobranza",
  contratar: RUTA_CONTRATAR_ORTODONCIA,
} as const;

/** La pestaña Ortodoncia de la ficha: la misma dirección que usan las listas del módulo. */
export function enlaceDelCaso(patientId: string): string {
  return `/dashboard/patients/${patientId}?tab=ortodoncia`;
}

/** Una parte que no se pudo dar, y por qué. Misma forma que `resumen_clinica`. */
export interface OmitidaOrto {
  seccion: string;
  permiso: PermissionKey;
  /** Solo si el usuario SÍ tiene el permiso y el Super Admin se lo quitó a Sabina. */
  causa?: Exclude<CausaSinPermiso, "usuario">;
}

/**
 * «¿Puede ver esta parte?», apuntando en `omitidas` la que no. Mismo helper y
 * misma key que el runner: lo único que cambia es que aquí el resto de la
 * respuesta sigue.
 */
export function anotador(ctx: SabinaCtx, omitidas: OmitidaOrto[]) {
  return (seccion: string, permiso: PermissionKey): boolean => {
    if (tienePermiso(ctx, permiso)) return true;
    const causa = causaSinPermiso(ctx, permiso);
    omitidas.push(causa === "usuario" ? { seccion, permiso } : { seccion, permiso, causa });
    return false;
  };
}

/** La cola del `resumen` que obliga a decir lo omitido, con la frase que toca a cada causa. */
export function fraseOmitidas(omitidas: readonly OmitidaOrto[]): string {
  if (omitidas.length === 0) return "";
  const delUsuario = omitidas.filter((o) => !o.causa);
  const deSabina = omitidas.filter((o) => o.causa);
  const avisos: string[] = [];
  if (delUsuario.length > 0) {
    const falta = delUsuario.map((o) => `${o.seccion} (falta ${o.permiso})`).join(", ");
    avisos.push(`NO tienes acceso a: ${falta} — dilo, no lo presentes como que no hay datos.`);
  }
  if (deSabina.length > 0) {
    const frases = Array.from(new Set(deSabina.map((o) => fraseSinPermiso(o.permiso, o.causa))));
    avisos.push(
      `Omití ${deSabina.map((o) => o.seccion).join(", ")}: el usuario SÍ tiene ese acceso, pero el Super Admin no te deja usarlo en su nombre. ` +
        `NO digas que no tiene acceso; di textualmente: "${frases.join(" ")}"`,
    );
  }
  return ` ${avisos.join(" ")}`;
}

/** Lo que Sabina dice cuando la sede no tiene el módulo. La marca es corta: «contratado», «contratar», «se contrata». */
export function avisoSinModulo(estado: Exclude<EstadoModulo, "activo">): { frase: string; marca: string } {
  if (estado === "no_es_dental") {
    return {
      frase: "El módulo de Ortodoncia es de las clínicas dentales: esta clínica no lo tiene ni lo puede contratar.",
      marca: "clinicas dentales",
    };
  }
  return {
    frase:
      "Esta sede no tiene contratado el módulo de Ortodoncia, así que aquí no hay casos, controles ni mensualidades " +
      `de ortodoncia que consultar. Se contrata en [Contratar Ortodoncia](${ENLACES_ORTO.contratar}).`,
    marca: "contrat",
  };
}

/**
 * El enlace, garantizado. `queSeHace` es lo que Sabina NO hace («registrar la
 * hoja de un control»); la marca es la ruta, así que da igual cómo lo redacte el
 * modelo: si la ruta no está en la respuesta, el motor añade la frase.
 */
export function avisoEnlace(queSeHace: string, rotulo: string, ruta: string): { frase: string; marca: string } {
  return {
    frase: `Yo solo lo consulto: ${queSeHace} se hace en [${rotulo}](${ruta}).`,
    marca: ruta,
  };
}

/** Lo que devuelve una herramienta de ortodoncia cuando la sede no tiene el módulo: nada más que eso. */
export interface SinModulo {
  modulo: Exclude<EstadoModulo, "activo">;
  enlace: string;
  omitidas: OmitidaOrto[];
}

export function sinModulo(estado: Exclude<EstadoModulo, "activo">): SinModulo {
  return { modulo: estado, enlace: estado === "no_contratado" ? ENLACES_ORTO.contratar : "", omitidas: [] };
}

/** "2026-10-05" → "5 oct 2026". Una fecha de calendario no tiene zona: se pinta tal cual. */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fechaCorta(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "sin fecha";
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
