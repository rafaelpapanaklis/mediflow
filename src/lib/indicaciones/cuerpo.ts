// El cuerpo de una hoja es TEXTO PLANO (lo que sale igual en WhatsApp, en el
// PDF y en la vista previa). Dos convenciones y ninguna más:
//   · una línea que empieza con «- », «• » o «* » es una viñeta;
//   · una línea en blanco separa párrafos.
//
// PURO: sin Prisma ni React.

export type BloqueHoja = { tipo: "parrafo"; texto: string } | { tipo: "lista"; items: string[] };

const VINETA = /^\s*(?:[-•*])\s+/;

export function bloquesDeHoja(cuerpo: string): BloqueHoja[] {
  const bloques: BloqueHoja[] = [];
  let parrafo: string[] = [];
  let lista: string[] | null = null;

  const cerrarParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: "parrafo", texto: parrafo.join(" ") });
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista && lista.length > 0) bloques.push({ tipo: "lista", items: lista });
    lista = null;
  };

  for (const crudo of String(cuerpo ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const linea = crudo.trim();
    if (!linea) {
      cerrarParrafo();
      cerrarLista();
      continue;
    }
    if (VINETA.test(linea)) {
      cerrarParrafo();
      if (!lista) lista = [];
      lista.push(linea.replace(VINETA, "").trim());
      continue;
    }
    cerrarLista();
    parrafo.push(linea);
  }
  cerrarParrafo();
  cerrarLista();
  return bloques;
}

/** El cuerpo tal como se lee en WhatsApp: viñetas con «•» y párrafos separados por una línea. */
export function hojaATextoWhatsApp(cuerpo: string): string {
  return bloquesDeHoja(cuerpo)
    .map((b) => (b.tipo === "parrafo" ? b.texto : b.items.map((i) => `• ${i}`).join("\n")))
    .join("\n\n");
}

export function cuerpoVacio(cuerpo: unknown): boolean {
  return typeof cuerpo !== "string" || cuerpo.trim() === "";
}
