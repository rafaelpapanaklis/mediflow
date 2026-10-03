// ─────────────────────────────────────────────────────────────────────────────
// ¿La carta de consentimiento está de verdad completa? (ws1-t3, auditoría BEVADENT F2)
//
// La pantalla decía «La carta está completa» en cuanto estaban las dos firmas,
// aunque el texto firmado tuviera espacios «______» sin llenar o una sección de
// instrucciones internas de la plantilla («Instrucciones para el doctor: borrar
// antes de imprimir»). Aquí se revisa el TEXTO, que es lo que se firma.
//
// Se cuentan tres cosas:
//   · huecos: cada raya de 3 o más guiones bajos («___», «______»);
//   · marcadores sin rellenar: `[ALGO_EN_MAYÚSCULAS]` que ninguna variable
//     sustituyó (una plantilla de la clínica con un marcador propio);
//   · instrucciones internas: renglones que hablan AL EQUIPO, no al paciente.
//
// Es un AVISO con confirmación, no un bloqueo (ver DECISIONES del reporte
// ws1-t3): las rayas existen a propósito — un dato que la clínica no tiene se
// imprime con raya para llenarlo a mano con bolígrafo (`patient-documents/
// faltantes.ts`). Lo que no puede pasar es firmar sin enterarse, ni que la
// pantalla diga «completa».
//
// PURO: sin Prisma, sin React y sin red. Lo importan el cliente y el servidor.
// ─────────────────────────────────────────────────────────────────────────────

export interface RevisionDeCarta {
  /** Rayas «___» + marcadores `[…]` sin rellenar. */
  huecos: number;
  /** Los renglones de instrucciones internas, tal cual (recortados a 90 caracteres). */
  instrucciones: string[];
}

const RAYA = /_{3,}/g;
// Solo mayúsculas, dígitos y guion bajo: `[NOMBRE_PACIENTE]`. Un «[sic]» o un
// «[1]» de cita no son marcadores.
const MARCADOR = /\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9_]*\]/g;

/**
 * Renglones que se dirigen al equipo de la clínica. Conservador a propósito:
 * «Indicaciones para el paciente» o «Para que el resultado sea el previsto, se
 * te pide…» son de la carta y NO cuentan.
 */
const INSTRUCCION_INTERNA: RegExp[] = [
  /\binstrucciones\s+(internas|de\s+(llenado|uso|la\s+plantilla))\b/,
  /\b(instrucciones|indicaciones|nota)\s+(para|al)\s+(el|la|los|las)?\s*(doctor|doctora|odontolog|dentista|personal|equipo|clinica|asistente|recepcion|estomatolog|medico)/,
  /\binstrucciones\s+para\s+(llenar|completar|usar)\b/,
  /\bpara\s+uso\s+interno\b|\buso\s+interno\b/,
  /\bno\s+(entregar|mostrar|imprimir|enviar)\s+(al|a\s+la|esta\s+\w+\s+al)\s*paciente\b/,
  /\b(borrar|eliminar|quitar|suprimir)\s+(esta|este|estas|estos)\s+(seccion|nota|texto|instruccion|parrafo|apartado|bloque)/,
  /\b(borrar|eliminar|quitar)\s+antes\s+de\s+(imprimir|firmar|enviar|entregar)\b/,
];

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Revisa el texto de la carta. Vacío o nulo = nada que avisar. */
export function revisarCarta(texto: string | null | undefined): RevisionDeCarta {
  const t = texto ?? "";
  const huecos = (t.match(RAYA)?.length ?? 0) + (t.match(MARCADOR)?.length ?? 0);
  const instrucciones: string[] = [];
  for (const renglon of t.split(/\r?\n/)) {
    const limpio = renglon.trim();
    if (!limpio) continue;
    const n = normalizar(limpio);
    if (INSTRUCCION_INTERNA.some((re) => re.test(n))) {
      instrucciones.push(limpio.length > 90 ? `${limpio.slice(0, 89)}…` : limpio);
    }
  }
  return { huecos, instrucciones };
}

/** ¿Hay algo que avisar antes de mandar a firmar o de firmar? */
export function cartaConPendientes(r: RevisionDeCarta): boolean {
  return r.huecos > 0 || r.instrucciones.length > 0;
}

/** Código de la respuesta 409 cuando se firma o se manda sin confirmar. */
export const CODIGO_CARTA_CON_HUECOS = "CARTA_CON_HUECOS";

/**
 * Lo que dice el aviso, en una frase. es/en; las pantallas lo usan tal cual y el
 * servidor lo manda en el 409 para que un cliente viejo enseñe algo legible.
 */
export function avisoDeCarta(r: RevisionDeCarta, locale: "es" | "en" = "es"): string {
  const partes: string[] = [];
  if (locale === "en") {
    if (r.huecos > 0) partes.push(r.huecos === 1 ? "1 blank is still empty (____)" : `${r.huecos} blanks are still empty (____)`);
    if (r.instrucciones.length > 0) {
      partes.push(
        r.instrucciones.length === 1
          ? `it still has an internal instructions section («${r.instrucciones[0]}»)`
          : `it still has ${r.instrucciones.length} internal instructions sections («${r.instrucciones[0]}»…)`,
      );
    }
    return partes.length ? `This letter is not complete: ${partes.join(" and ")}.` : "";
  }
  if (r.huecos > 0) partes.push(r.huecos === 1 ? "queda 1 espacio sin llenar (____)" : `quedan ${r.huecos} espacios sin llenar (____)`);
  if (r.instrucciones.length > 0) {
    partes.push(
      r.instrucciones.length === 1
        ? `tiene una sección de instrucciones internas («${r.instrucciones[0]}»)`
        : `tiene ${r.instrucciones.length} secciones de instrucciones internas («${r.instrucciones[0]}»…)`,
    );
  }
  if (!partes.length) return "";
  const frase = partes.join(" y ");
  return `La carta no está completa: ${frase}.`;
}

/**
 * Para las rutas que mandan a firmar o firman: si la carta tiene pendientes y el
 * cuerpo no trae `confirmarHuecos: true`, devuelve el cuerpo del 409 (código,
 * aviso legible y la revisión para que la pantalla pregunte). `null` = adelante.
 */
export function faltaConfirmarCarta(
  texto: string | null | undefined,
  confirmarHuecos: unknown,
): { error: string; code: typeof CODIGO_CARTA_CON_HUECOS; revision: RevisionDeCarta } | null {
  const revision = revisarCarta(texto);
  if (!cartaConPendientes(revision) || confirmarHuecos === true) return null;
  return {
    error: `${avisoDeCarta(revision)} Confirma que quieres seguir así.`,
    code: CODIGO_CARTA_CON_HUECOS,
    revision,
  };
}

/** Lo que se anota en Movimientos cuando se siguió con pendientes (o nada). */
export function pendientesParaBitacora(texto: string | null | undefined): { huecosSinLlenar: number; instruccionesInternas: number } | null {
  const r = revisarCarta(texto);
  return cartaConPendientes(r) ? { huecosSinLlenar: r.huecos, instruccionesInternas: r.instrucciones.length } : null;
}

/** El texto de Movimientos, con la coletilla si se firmó con pendientes confirmados. */
export function conPendientesDeCarta(texto: string, contenido: string | null | undefined): string {
  const p = pendientesParaBitacora(contenido);
  if (!p) return texto;
  const partes: string[] = [];
  if (p.huecosSinLlenar > 0) {
    partes.push(p.huecosSinLlenar === 1 ? "1 espacio sin llenar" : `${p.huecosSinLlenar} espacios sin llenar`);
  }
  if (p.instruccionesInternas > 0) {
    partes.push(p.instruccionesInternas === 1 ? "1 sección de instrucciones internas" : `${p.instruccionesInternas} secciones de instrucciones internas`);
  }
  return `${texto} (con ${partes.join(" y ")}, confirmado antes de firmar)`;
}
