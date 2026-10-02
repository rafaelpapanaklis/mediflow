// «Convertir en presupuesto» desde el plan de tratamiento (ws1-t3, ticket 3 de BEVADENT, punto 7e).
//
// Los textos viven aquí y no en los diccionarios a propósito (mismo motivo que textos-equipo.ts): los
// diccionarios los tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  boton: "Convertir en presupuesto",
  titulo: "Convertir en presupuesto",
  cargando: "Leyendo el plan…",
  errorCarga: "No se pudo preparar el presupuesto. Intenta de nuevo.",
  errorCrear: "No se pudo crear el presupuesto. Intenta de nuevo.",
  sinPermiso: "Tu usuario no tiene permiso para crear presupuestos.",
  intro: "Así quedaría el presupuesto. Se crea como borrador: no se envía al paciente ni genera ningún cobro.",
  colConcepto: "Concepto",
  colDientes: "Dientes",
  colCant: "Cant.",
  colPrecio: "Precio",
  colImporte: "Importe",
  total: "Total",
  sinPrecio: "sin precio",
  deTarifario: "del tarifario",
  yaTitulo: (folio: string, estado: string) => `Este plan ya tiene el presupuesto ${folio} (${estado}).`,
  yaTexto: "Para no duplicarlo, ábrelo y edítalo ahí. Si lo rechazan o vence, podrás crear otro desde el plan.",
  abrir: (folio: string) => `Abrir ${folio}`,
  crear: "Crear presupuesto borrador",
  creando: "Creando…",
  cancelar: "Cancelar",
  cerrar: "Cerrar",
  avisoSinDetalle: "Este plan no trae procedimientos detallados: se arma un solo concepto con el nombre y el costo del plan. Podrás desglosarlo en el editor.",
  avisoSinPrecio: (n: number) => (n === 1 ? "1 concepto no tiene precio: complétalo en el editor del presupuesto." : `${n} conceptos no tienen precio: complétalos en el editor del presupuesto.`),
  avisoSinTarifario: (n: number) => (n === 1 ? "1 concepto no está en el tarifario: se guarda como texto libre." : `${n} conceptos no están en el tarifario: se guardan como texto libre.`),
  avisoTotalDifiere: (costo: string) => `El costo escrito en el plan (${costo}) no coincide con la suma de los conceptos. El presupuesto usa la suma.`,
  estado: { DRAFT: "borrador", PRESENTED: "presentado", ACCEPTED: "aceptado" } as Record<string, string>,
};

const en: typeof es = {
  boton: "Convert to quote",
  titulo: "Convert to quote",
  cargando: "Reading the plan…",
  errorCarga: "Couldn't prepare the quote. Please try again.",
  errorCrear: "Couldn't create the quote. Please try again.",
  sinPermiso: "Your user doesn't have permission to create quotes.",
  intro: "This is how the quote would look. It is created as a draft: nothing is sent to the patient and no charge is made.",
  colConcepto: "Item",
  colDientes: "Teeth",
  colCant: "Qty",
  colPrecio: "Price",
  colImporte: "Amount",
  total: "Total",
  sinPrecio: "no price",
  deTarifario: "from price list",
  yaTitulo: (folio: string, estado: string) => `This plan already has quote ${folio} (${estado}).`,
  yaTexto: "To avoid a duplicate, open it and edit it there. If it is rejected or expires, you can create another one from the plan.",
  abrir: (folio: string) => `Open ${folio}`,
  crear: "Create draft quote",
  creando: "Creating…",
  cancelar: "Cancel",
  cerrar: "Close",
  avisoSinDetalle: "This plan has no detailed procedures: a single item is built with the plan's name and cost. You can break it down in the editor.",
  avisoSinPrecio: (n: number) => (n === 1 ? "1 item has no price: fill it in in the quote editor." : `${n} items have no price: fill them in in the quote editor.`),
  avisoSinTarifario: (n: number) => (n === 1 ? "1 item is not in the price list: it is saved as free text." : `${n} items are not in the price list: they are saved as free text.`),
  avisoTotalDifiere: (costo: string) => `The cost written in the plan (${costo}) doesn't match the sum of the items. The quote uses the sum.`,
  estado: { DRAFT: "draft", PRESENTED: "presented", ACCEPTED: "accepted" },
};

export const TEXTOS_CONVERTIR_PRESUPUESTO = { es, en } as const;

export function useTextosConvertirPresupuesto() {
  const locale = useLocale();
  return TEXTOS_CONVERTIR_PRESUPUESTO[locale === "en" ? "en" : "es"];
}
