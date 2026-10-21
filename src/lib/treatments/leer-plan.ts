// El LECTOR DUAL del plan de tratamiento (ws1-t12 · P2).
//
// Un plan nuevo trae sus procedimientos en FILAS (`treatment_plan_items`, contrato en `items.ts`);
// uno de antes los trae como TEXTO en `description` (`plan-clinico.ts` los escribe y
// `leerRenglonesDelPlan` los relee). Quien necesita los renglones —el PDF y «Convertir en
// presupuesto»— pregunta aquí y recibe lo mismo de las dos fuentes:
//  · con filas vivas → las filas, con precio EXACTO (centavos) y su procedimiento del tarifario;
//  · sin filas (plan viejo, o la tabla aún no existe) → el texto, como hasta hoy.
// Las canceladas no salen. Puro: la lectura de la base es de `items-db.ts` (`repoFilas.leer`).

import { FASE_CLAVE } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { leerRenglonesDelPlan, textoPuedeEstarRedondeado, type RenglonLeido } from "@/lib/quotes/desde-plan";
import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { aPesos, dientesCsv, filasVivas, ordenarParaElPapel, type Fase, type FilaDelPlan } from "./items";

export interface PlanLeido {
  fuente: "filas" | "texto";
  renglones: RenglonLeido[];
  /** ¿Los precios pudieron quedar redondeados a pesos? Solo un texto viejo; las filas nunca. */
  textoRedondeado: boolean;
  /** Las filas vivas en el orden en que salen los renglones ([] si la fuente es el texto). */
  filas: FilaDelPlan[];
}

export type NombreDeFase = (fase: Fase | null, numero: number | null) => string;

/** Nombre de la fase en el idioma de la clínica: «Fase I · Higiénica», o «Fase 2» si la fila vino de un presupuesto. */
export function nombresDeFase(locale: "es" | "en" = "es"): NombreDeFase {
  const t = makeT(getDict(locale));
  return (fase, numero) => (fase ? t(FASE_CLAVE[fase]) : numero ? t("planTratamiento.filas.faseNumero", { n: numero }) : "");
}

export { ordenarParaElPapel };

/** Filas → los mismos renglones que da el texto, con lo que el texto no sabe (precio exacto, procedimiento, fila). */
export function renglonesDeFilas(filas: FilaDelPlan[], nombreDeFase: NombreDeFase = nombresDeFase("es")): RenglonLeido[] {
  const claves: string[] = [];
  return ordenarParaElPapel(filasVivas(filas)).map((f) => {
    const clave = f.fase ?? `n${f.faseNumero ?? 0}`;
    if (claves.indexOf(clave) === -1) claves.push(clave);
    return {
      nombre: f.nombre,
      dientes: dientesCsv(f.dientes),
      cantidad: f.cantidad,
      precio: aPesos(f.precioCentavos),
      fase: claves.indexOf(clave) + 1,
      faseNombre: nombreDeFase(f.fase, f.faseNumero),
      caras: f.caras.join(""),
      motivo: f.motivo,
      procedureId: f.procedureId,
      filaId: f.id,
    };
  });
}

/** Lee el plan de la fuente que tenga: filas si hay vivas, si no el texto. */
export function leerPlan(
  plan: { description: string | null | undefined },
  filas: FilaDelPlan[] | null | undefined,
  nombreDeFase?: NombreDeFase,
): PlanLeido {
  const vivas = filasVivas(filas ?? []);
  if (vivas.length > 0) {
    const ordenadas = ordenarParaElPapel(vivas);
    return { fuente: "filas", renglones: renglonesDeFilas(ordenadas, nombreDeFase), textoRedondeado: false, filas: ordenadas };
  }
  return {
    fuente: "texto",
    renglones: leerRenglonesDelPlan(plan.description),
    textoRedondeado: textoPuedeEstarRedondeado({ description: plan.description }),
    filas: [],
  };
}
