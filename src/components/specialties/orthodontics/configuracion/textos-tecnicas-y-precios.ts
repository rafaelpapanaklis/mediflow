// Ortodoncia — textos de «Técnicas y precios» y del precio por técnica en el alta del caso (ws1-t12, ticket 3 de
// BEVADENT, 6b). Viven aquí y no en los diccionarios a propósito (mismo motivo que textos-firma-control.ts): los
// diccionarios los tocan a la vez otras pantallas y un commit de esos archivos arrastraría sus líneas.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  titulo: "Técnicas y precios",
  sub:
    "Las técnicas que ofrece tu clínica al abrir un caso y sus precios. En «Pago por control», el pago inicial es la factura de colocación y cada control se cobra con el precio de su técnica al firmar la hoja. En «Precio total a plazos», el caso propone el precio total. Cambiar esta tabla no toca los casos ya abiertos ni las facturas hechas.",
  faltaSql: "Falta aplicar sql/ortodoncia-tecnicas-propias.sql para guardar tu lista. Mientras, ves las técnicas de siempre.",
  faltaSqlCaso:
    "Falta aplicar sql/ws1-t12-precio-control-por-caso.sql: hasta entonces todos los controles se cobran con «Control de ortodoncia» del catálogo, aunque la técnica tenga su precio.",
  ninguna: "No ofreces ninguna técnica. Agrega una o restaura las de siempre para poder abrir casos nuevos.",
  nombre: "Nombre",
  tipoBase: "Tipo base",
  pagoInicial: "Pago inicial",
  precioControl: "Precio por control",
  precioTotal: "Precio total (a plazos)",
  phNombre: "Nombre de la técnica",
  phDelCatalogo: "Del catálogo",
  phSinPrecio: "Sin precio",
  quitar: "Quitar",
  cancelar: "Cancelar",
  quitarAria: (n: string) => `Quitar ${n || "la técnica"}`,
  confirmarQuitar: (n: string) => `¿Quitar «${n || "esta técnica"}»? Deja de ofrecerse; los casos que ya la usan la conservan.`,
  quitadas: "Quitadas (no se ofrecen en casos nuevos)",
  sinNombre: "Sin nombre",
  volverAOfrecer: "Volver a ofrecer",
  agregar: "Agregar técnica",
  restaurar: "Restaurar las de siempre",
  restauradas: "Las técnicas de siempre volvieron a la lista. Guarda para aplicarlo.",
  guardar: "Guardar técnicas",
  guardando: "Guardando…",
  guardadas: "Técnicas y precios guardados.",
  maximo: (n: number) => `Máximo ${n} técnicas.`,
  ayudaVacios:
    "Vacío en «Pago inicial» = se propone «Colocación de aparatología» del catálogo; vacío en «Precio por control» = se cobra «Control de ortodoncia» del catálogo.",
  avisoModoPorControl: (nombres: string) =>
    `Tu clínica cobra por control, pero ${nombres} solo tiene «Precio total». Llena «Pago inicial» y «Precio por control»: el precio total solo se usa en casos a plazos y ya no se propone en «Pago por control».`,
  soloLectura: "Solo quien puede cambiar la configuración de la clínica edita técnicas y precios.",
  // ── Alta del caso (DrawerNewCase) ──
  alta: {
    precioControl: "Precio por control",
    controlDeTecnica: (t: string) => `Es el de «${t}» (Configuración → Técnicas y precios). Cada control se cobra así al firmar su hoja.`,
    controlDelCatalogo: "Esta técnica no tiene precio por control: se cobra «Control de ortodoncia» del catálogo.",
    sinPrecioControl: "Ni la técnica ni el catálogo tienen precio de control: los controles no se facturarán solos.",
    colocacionDeTecnica: (t: string) => `Es el pago inicial de «${t}». Cámbialo si este paciente pactó otro.`,
    cambioDeTecnica: (t: string, precio: string | null) =>
      precio
        ? `Al guardar, los próximos controles de este caso se cobrarán a ${precio} (precio de «${t}»). Los ya facturados no cambian.`
        : `Al guardar, los próximos controles de este caso se cobrarán con «Control de ortodoncia» del catálogo: «${t}» no tiene precio por control. Los ya facturados no cambian.`,
    estimadoSinPrecio: (n: string) => `${n} controles previstos. Para estimar el total falta el precio por control de la técnica o el de «Control de ortodoncia» del catálogo.`,
  },
};

const en: typeof es = {
  titulo: "Techniques and prices",
  sub:
    "The techniques your clinic offers when opening a case, and their prices. With “Pay per check-up”, the initial payment is the placement invoice and each check-up is charged at its technique's price when its sheet is signed. With “Total price in installments”, the case proposes the total price. Changing this table does not touch open cases or existing invoices.",
  faltaSql: "sql/ortodoncia-tecnicas-propias.sql is not applied yet, so your list can't be saved. Meanwhile you see the standard techniques.",
  faltaSqlCaso:
    "sql/ws1-t12-precio-control-por-caso.sql is not applied yet: until then every check-up is charged with the catalog's “Control de ortodoncia”, even if the technique has its own price.",
  ninguna: "You don't offer any technique. Add one or restore the standard ones to open new cases.",
  nombre: "Name",
  tipoBase: "Base type",
  pagoInicial: "Initial payment",
  precioControl: "Price per check-up",
  precioTotal: "Total price (installments)",
  phNombre: "Technique name",
  phDelCatalogo: "From catalog",
  phSinPrecio: "No price",
  quitar: "Remove",
  cancelar: "Cancel",
  quitarAria: (n) => `Remove ${n || "the technique"}`,
  confirmarQuitar: (n) => `Remove “${n || "this technique"}”? It stops being offered; cases already using it keep it.`,
  quitadas: "Removed (not offered on new cases)",
  sinNombre: "No name",
  volverAOfrecer: "Offer again",
  agregar: "Add technique",
  restaurar: "Restore the standard ones",
  restauradas: "The standard techniques are back on the list. Save to apply.",
  guardar: "Save techniques",
  guardando: "Saving…",
  guardadas: "Techniques and prices saved.",
  maximo: (n) => `${n} techniques at most.`,
  ayudaVacios:
    "Empty “Initial payment” = the catalog's “Colocación de aparatología” is proposed; empty “Price per check-up” = the catalog's “Control de ortodoncia” is charged.",
  avisoModoPorControl: (nombres) =>
    `Your clinic charges per check-up, but ${nombres} only has a “Total price”. Fill in “Initial payment” and “Price per check-up”: the total price is only used for installment cases and is no longer proposed with “Pay per check-up”.`,
  soloLectura: "Only users who can change the clinic's settings can edit techniques and prices.",
  alta: {
    precioControl: "Price per check-up",
    controlDeTecnica: (t) => `It's the price of “${t}” (Settings → Techniques and prices). Each check-up is charged this way when its sheet is signed.`,
    controlDelCatalogo: "This technique has no check-up price: the catalog's “Control de ortodoncia” is charged.",
    sinPrecioControl: "Neither the technique nor the catalog has a check-up price: check-ups won't be invoiced automatically.",
    colocacionDeTecnica: (t) => `It's the initial payment of “${t}”. Change it if this patient agreed on another one.`,
    cambioDeTecnica: (t, precio) =>
      precio
        ? `When you save, this case's next check-ups will be charged ${precio} (price of “${t}”). Check-ups already invoiced don't change.`
        : `When you save, this case's next check-ups will be charged with the catalog's “Control de ortodoncia”: “${t}” has no check-up price. Check-ups already invoiced don't change.`,
    estimadoSinPrecio: (n) => `${n} planned check-ups. To estimate the total, the technique's check-up price or the catalog's “Control de ortodoncia” price is missing.`,
  },
};

export type TextosTecnicasYPrecios = typeof es;

export function textosTecnicasYPrecios(locale: string | null | undefined): TextosTecnicasYPrecios {
  return locale === "en" ? en : es;
}

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosTecnicasYPrecios(): TextosTecnicasYPrecios {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  return textosTecnicasYPrecios(locale);
}
