/* ============================================================
   Equipo → Permisos: qué ve el dueño en el modal y cuándo «Usar default del rol»
   sale encendido. Puro (sin React) para poder probarlo.

   ws1-t5 (revisión final, 28-sep-2026), T5:
     · La sección «Especialidades» ofrecía Odontopediatría, Endodoncia,
       Periodoncia e Implantología: páginas de módulos del marketplace que ya no
       se contratan. Se OCULTAN del modal, no se borran de los permisos: siguen en
       ALL_PERMISSIONS, en los defaults de los roles y en el menú (`sidebar-nav`),
       y si una persona ya las trae en su override se conservan tal cual al guardar
       (el modal guarda el conjunto completo, visible u oculto).
     · «Marketplace: Ver marketplace de módulos» solo mostraba/ocultaba una
       entrada «Próximamente» del menú. Contratar un módulo (Ortodoncia) NO pasa
       por ese permiso: lo decide `canPurchaseModules(role)` en el servidor (solo el dueño). Se oculta.
     · «Acceso al módulo de Ortodoncia» se queda: es el interruptor por persona.
     · «Usar default del rol» salía apagado en quien tenía un override IGUAL al
       default del rol (el alta ya guarda un override completo cuando se elige
       «Solo dental»). Encendido = no tiene nada propio distinto al rol.
   ============================================================ */

import type { PermissionKey } from "@/lib/auth/permissions";

/** Permisos que el modal no muestra (siguen existiendo; ver arriba). */
export const CLAVES_OCULTAS_EN_MODAL: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  "marketplace.view",
  "specialties.pediatrics",
  "specialties.endodontics",
  "specialties.periodontics",
  "specialties.implants",
]);

/** El título con el que se enseña el grupo (el de «Especialidades» ya solo trae Ortodoncia). */
const TITULO_VISIBLE: Record<string, string> = { Especialidades: "Ortodoncia" };

export interface GrupoDePermisos {
  title: string;
  keys: PermissionKey[];
}

/**
 * ws1-t4 v5 (Rafael, 27-oct): «Crear y cambiar la clave de la sede» solo se
 * enseña si la cuenta tiene 2+ sedes o esta sede ya tiene la clave puesta (lo
 * decide el servidor: `permisoDeClaveVisible`). Oculto se conserva igual que
 * los de arriba.
 */
export function clavesOcultasEnModal(permisoClaveDeSede: boolean): ReadonlySet<PermissionKey> {
  if (permisoClaveDeSede) return CLAVES_OCULTAS_EN_MODAL;
  return new Set<PermissionKey>([...CLAVES_OCULTAS_EN_MODAL, "sede.clave"]);
}

/** Los grupos que se pintan: sin las claves ocultas y sin grupos que se quedan vacíos. */
export function gruposVisibles(
  grupos: readonly GrupoDePermisos[],
  ocultas: ReadonlySet<PermissionKey> = CLAVES_OCULTAS_EN_MODAL,
): GrupoDePermisos[] {
  return grupos
    .map((g) => ({ title: TITULO_VISIBLE[g.title] ?? g.title, keys: g.keys.filter((k) => !ocultas.has(k)) }))
    .filter((g) => g.keys.length > 0);
}

/** ¿El override deja a la persona exactamente con lo que da su rol? (vacío también cuenta) */
export function sigueElDefaultDelRol(
  override: readonly string[] | null | undefined,
  defaultsDelRol: Iterable<string>,
): boolean {
  const propios = new Set(override ?? []);
  if (propios.size === 0) return true;
  const rol = new Set(defaultsDelRol);
  if (propios.size !== rol.size) return false;
  for (const k of propios) if (!rol.has(k)) return false;
  return true;
}

/**
 * En qué se distingue lo que tiene de lo que da su rol (sin las claves de
 * CLAVES_OCULTAS_EN_MODAL). ws1-t4 v6 (revisión de t8, m-1): «Crear y cambiar
 * la clave de la sede» SÍ cuenta aunque con una sola sede no salga en la lista.
 * Si no, un ADMIN que lo tiene salía «personalizado» sin ninguna diferencia a
 * la vista, y «Usar default del rol» se lo quitaba sin que se viera.
 */
export function diferenciasConElRol(
  seleccionados: Iterable<PermissionKey>,
  defaultsDelRol: Iterable<PermissionKey>,
): { sinLoDelRol: PermissionKey[]; ademasDelRol: PermissionKey[] } {
  const sel = new Set(seleccionados);
  const rol = new Set(defaultsDelRol);
  return {
    sinLoDelRol: [...rol].filter((k) => !sel.has(k) && !CLAVES_OCULTAS_EN_MODAL.has(k)),
    ademasDelRol: [...sel].filter((k) => !rol.has(k) && !CLAVES_OCULTAS_EN_MODAL.has(k)),
  };
}
