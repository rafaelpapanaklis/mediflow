// Textos del aviso de pestaña desfasada de «Ver como clínica» (ws1-t11, punto 2).
// Los ve solo el admin de plataforma (o quien comparta su navegador), es/en.

export interface TextosPestanaVerComo {
  tituloAhora: (clinica: string | null) => string;
  cuerpoAhora: string;
  tituloSalio: string;
  cuerpoSalio: string;
  recargar: string;
  salir: string;
}

const es: TextosPestanaVerComo = {
  tituloAhora: (c) => (c ? `Este navegador ahora está viendo como «${c}»` : "Este navegador ahora está en «Ver como clínica»"),
  cuerpoAhora:
    "Esta pestaña se abrió con otra sesión y ya no corresponde: lo que guardes aquí iría a la clínica de arriba, no a la que ves. Recárgala para ver la clínica real, o sal de «Ver como clínica».",
  tituloSalio: "La sesión de «Ver como clínica» terminó",
  cuerpoSalio:
    "Esta pestaña sigue mostrando la clínica de soporte, pero este navegador ya volvió a otra sesión. Recárgala antes de seguir: lo que guardes aquí no iría a la clínica que ves.",
  recargar: "Recargar esta pestaña",
  salir: "Salir de «Ver como clínica»",
};

const en: TextosPestanaVerComo = {
  tituloAhora: (c) => (c ? `This browser is now viewing as “${c}”` : "This browser is now in “View as clinic”"),
  cuerpoAhora:
    "This tab was opened with another session and no longer matches: anything you save here would go to the clinic above, not the one you see. Reload it to see the real clinic, or leave “View as clinic”.",
  tituloSalio: "The “View as clinic” session ended",
  cuerpoSalio:
    "This tab still shows the support clinic, but this browser is back on another session. Reload it before continuing: anything you save here would not go to the clinic you see.",
  recargar: "Reload this tab",
  salir: "Leave “View as clinic”",
};

export function textosPestanaVerComo(locale: string | null | undefined): TextosPestanaVerComo {
  return String(locale ?? "").toLowerCase().startsWith("en") ? en : es;
}
