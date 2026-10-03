// La especialidad de cada persona del equipo (`User.specialty`) en el selector de Equipo (ws1-t1, arreglos de
// las revisiones, 3-oct-2026).
//
// El selector solo conoce la lista de abajo, pero en la base hay otros textos: el registro de la clínica guarda
// la CATEGORÍA como especialidad del dueño («dental», «orthodontics»…), la importación de doctores y «Mi perfil»
// guardan texto libre. Un valor fuera de la lista hacía que el <select> pintara «Sin especialidad» —parecía
// borrada— y quien lo tocaba creyendo arreglarlo podía pisarla.
//
//   · Los sinónimos conocidos (español, inglés, con o sin acentos) se leen como su valor de la lista.
//   · Lo que no se reconoce se respeta TAL CUAL y el selector lo ofrece como una opción más: nunca se pierde.
//
// Solo cambia cómo se lee: no se escribe nada en la base. Si nadie toca el campo, el guardado no lo manda
// (parcheDeCambios compara contra el mismo valor ya leído); si alguien elige otra opción, se guarda esa.
//
// PURO: sin React ni Prisma.

/** Los valores que se guardan desde Equipo (ids estables; el texto visible sale de i18n en team-client). */
export const ESPECIALIDADES_EQUIPO = [
  "Odontología General",
  "Ortodoncia",
  "Endodoncia",
  "Periodoncia",
  "Cirugía Maxilofacial",
  "Implantología",
  "Odontopediatría",
  "Prostodoncia",
  "Estética Dental",
  "Otra",
] as const;

export type EspecialidadEquipo = (typeof ESPECIALIDADES_EQUIPO)[number];

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[\s_-]+/g, " ");
}

const SINONIMOS: Record<EspecialidadEquipo, string[]> = {
  "Odontología General": [
    "dental", "dentist", "dentista", "general", "odontologia", "odontologia general", "odontologo", "odontologa",
    "odontologo general", "cirujano dentista", "general dentistry", "general dentist", "dentistry", "dental general",
  ],
  Ortodoncia: ["orthodontics", "orthodontist", "ortodoncista", "orthodontic", "ortho", "orto"],
  Endodoncia: ["endodontics", "endodontist", "endodoncista", "endo"],
  Periodoncia: ["periodontics", "periodontist", "periodoncista", "perio"],
  "Cirugía Maxilofacial": [
    "maxilofacial", "cirugia", "cirugia oral", "oral surgery", "oral surgeon", "maxillofacial", "maxillofacial surgery",
    "oral and maxillofacial surgery", "cirujano maxilofacial", "cirugia bucal",
  ],
  Implantología: ["implants", "implantes", "implantologia", "implantologo", "implantology", "implant"],
  Odontopediatría: ["pediatric", "pediatrics", "pediatric dentistry", "pediatria", "odontopediatra", "odontopediatria", "pedodontics"],
  Prostodoncia: ["prosthodontics", "prosthodontist", "prostodoncista", "protesis", "rehabilitacion oral"],
  "Estética Dental": ["esthetic", "aesthetic", "cosmetic", "cosmetic dentistry", "estetica", "estetica dental", "aesthetic dentistry"],
  Otra: ["other", "otra", "otro", "others"],
};

const POR_NORMALIZADO = new Map<string, EspecialidadEquipo>();
for (const id of ESPECIALIDADES_EQUIPO) {
  POR_NORMALIZADO.set(normalizar(id), id);
  for (const s of SINONIMOS[id]) POR_NORMALIZADO.set(normalizar(s), id);
}

/** ¿Es uno de los valores de la lista? */
export function esDeLaLista(valor: string | null | undefined): valor is EspecialidadEquipo {
  return (ESPECIALIDADES_EQUIPO as readonly string[]).includes(valor ?? "");
}

/**
 * Cómo se lee lo guardado: el valor de la lista si es él o un sinónimo conocido; si no, el texto tal cual
 * (recortado). Vacío o null → "".
 */
export function especialidadParaElSelector(guardada: string | null | undefined): string {
  const v = (guardada ?? "").trim();
  if (!v) return "";
  return POR_NORMALIZADO.get(normalizar(v)) ?? v;
}

/**
 * Las opciones extra del selector: el valor actual si no es de la lista (para que se vea y se conserve).
 */
export function opcionFueraDeLista(valor: string): string | null {
  return valor && !esDeLaLista(valor) ? valor : null;
}
