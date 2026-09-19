import type { PatientNavItem } from "@/components/dashboard/patient-detail/patient-nav-items";
import { APARTADOS_FUERA_DEL_MENU } from "@/components/dashboard/presupuestos-en-facturacion/menu";

/**
 * La FORMA del menú de la ficha, acordada con Rafael: seis apartados
 * siempre a la vista y dos desplegables fijos.
 *
 *   Resumen · Nueva consulta · Odontograma · Plan de tratamiento · Citas · Facturación
 *      │ Clínico ▾   │ Archivos ▾
 *
 * «Más» existió hasta ws1-t3 con «Referencias» dentro; Rafael lo quitó (ver
 * `APARTADOS_FUERA_DEL_MENU`). El grupo sigue existiendo como red: solo se
 * pinta si aparece un apartado que ninguna lista conoce.
 *
 * Es la misma a 1440, a 1280 y en iPad. El menú de hoy MIDE el ancho que le
 * sobra y decide qué enseñar (a 1440 con el menú lateral abierto caben 5 de
 * 17), así que el mismo doctor ve un menú distinto según su pantalla. Aquí no
 * se mide nada: si la fila no cabe, se desliza.
 *
 * Esto es PRESENTACIÓN, no un alta ni una baja: la lista de apartados, su
 * gating por permiso y por módulo siguen viviendo en `patient-nav-items.ts`.
 * Esta función solo reparte lo que aquella devuelve.
 */

/** Los seis de la barra, en el orden acordado. */
export const FIJOS = [
  "resumen",
  "expediente", // «Nueva consulta»
  "odontograma",
  "tratamiento",
  "agenda", // «Citas»
  "facturacion",
] as const;

export const GRUPO_CLINICO = [
  "historia",
  "cuestionario",
  "historial-consultas",
  "nota-evolucion", // la nota como documento (plantillas de la clínica), ws1-t3
  "recetas",
  "consentimientos",
  // «Implantes» (solo con el módulo de Implantología, y hoy «Próximamente»)
  // caía en «Más» por no estar en ninguna lista. Sin «Más», va con lo clínico.
  "implantes",
] as const;

export const GRUPO_ARCHIVOS = ["radiografias", "fotos", "subidos", "modelos-3d"] as const;

// «Presupuestos» estuvo aquí hasta ws1-t1 (se unió con Facturación) y
// «Referencias» hasta ws1-t3 (Rafael: no es necesario). Ninguno se borró: ver
// `presupuestos-en-facturacion/menu.ts`. Volver a enseñar uno es sacarlo de
// `APARTADOS_FUERA_DEL_MENU`: caería en «Más», como todo suelto.
export const GRUPO_MAS = [] as const;

export type IdGrupo = "clinico" | "archivos" | "mas";

export interface GrupoMenuFicha {
  id: IdGrupo;
  /** Key i18n del nombre del botón («Clínico», «Archivos», «Más»). */
  labelKey: string;
  items: PatientNavItem[];
}

export interface MenuFicha {
  fijos: PatientNavItem[];
  grupos: GrupoMenuFicha[];
}

const ORDEN: Record<IdGrupo, readonly string[]> = {
  clinico: GRUPO_CLINICO,
  archivos: GRUPO_ARCHIVOS,
  mas: GRUPO_MAS,
};

const ETIQUETA: Record<IdGrupo, string> = {
  clinico: "pacientesRediseno.menu.clinico",
  archivos: "pacientesRediseno.menu.archivos",
  mas: "pacientesRediseno.menu.mas",
};

function indiceEn(lista: readonly string[], id: string): number {
  const i = lista.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Reparte los apartados que `buildPatientNavItems` deja pasar (ya filtrados
 * por permiso y por módulo) en la forma de arriba.
 *
 * Un apartado que no esté en ninguna de las cuatro listas cae en **Más**. Eso
 * es a propósito: el día que alguien añada una pestaña a `patient-nav-items.ts`
 * y no se acuerde de este archivo, la pestaña seguirá siendo alcanzable en vez
 * de desaparecer de la interfaz. Hoy no hay ningún caso, así que «Más» no se
 * pinta.
 *
 * Los grupos vacíos no se devuelven: sin permiso de recetas, consentimientos y
 * expediente, «Clínico» no se pinta como un botón que no abre nada.
 *
 * La ÚNICA excepción a «nada desaparece» es deliberada y está escrita con
 * nombre y apellido: `APARTADOS_FUERA_DEL_MENU`. Esos apartados no se pintan,
 * pero su pestaña sigue viva y alcanzable por enlace.
 */
export function construirMenuFicha(todos: PatientNavItem[]): MenuFicha {
  const items = todos.filter((i) => APARTADOS_FUERA_DEL_MENU.indexOf(i.id) === -1);
  const porId: Record<string, PatientNavItem> = {};
  items.forEach((i) => {
    porId[i.id] = i;
  });

  const fijos: PatientNavItem[] = [];
  FIJOS.forEach((id) => {
    const item = porId[id];
    if (item) fijos.push(item);
  });

  const cubiertos: Record<string, true> = {};
  (FIJOS as readonly string[]).forEach((id) => {
    cubiertos[id] = true;
  });
  (Object.keys(ORDEN) as IdGrupo[]).forEach((g) => {
    ORDEN[g].forEach((id) => {
      cubiertos[id] = true;
    });
  });

  const sueltos = items.filter((i) => !cubiertos[i.id]);

  const grupos: GrupoMenuFicha[] = [];
  (["clinico", "archivos", "mas"] as IdGrupo[]).forEach((g) => {
    const propios = items.filter((i) => ORDEN[g].indexOf(i.id) !== -1);
    // Los que no conoce nadie se van con «Más», al final y en el orden en el
    // que `buildPatientNavItems` los devolvió.
    const conSueltos = g === "mas" ? propios.concat(sueltos) : propios;
    if (conSueltos.length === 0) return;
    conSueltos.sort((a, b) => indiceEn(ORDEN[g], a.id) - indiceEn(ORDEN[g], b.id));
    grupos.push({ id: g, labelKey: ETIQUETA[g], items: conSueltos });
  });

  return { fijos, grupos };
}
