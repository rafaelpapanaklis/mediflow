// ws1-t3 (2-oct-2026) — el bot de WhatsApp puede dar PRECIOS, leyendo lo que
// la clínica ya tiene en el panel. PURO: sin Prisma ni React (lo prueban
// __tests__/precios-bot.test.ts y lo arma precios-bot.ts con la base).
//
// Reglas de Rafael (aprobadas, literales):
//  1. Dos interruptores en «Configurar bot»: «Dar precios de Procedimientos» y
//     «Dar precios de Ortodoncia». APAGADOS de fábrica en todas las clínicas.
//  2. Encendido: el precio de Administración → Procedimientos (activos del
//     catálogo) y, el de Ortodoncia, el de Ortodoncia → Configuración →
//     «Técnicas y precios» (técnicas activas). Ortodoncia solo con el módulo.
//  3. Precio en $0 o vacío: NO es un precio y el bot NO dice nada por su
//     cuenta de ese procedimiento (ni «valoración» ni otra cosa): lo decide la
//     clínica en sus instrucciones.
//  4. Apagado: el bot dice que sí lo hacen, que el costo se da en la
//     valoración, y ofrece agendarla; si insiste en el precio, a una persona.
//  5. Nunca inventar precios; lo demás sigue saliendo de instrucciones y FAQs.
//
// Lo que las reglas no fijan va en constantes de este archivo y en la sección
// «DECISIONES PARA RAFAEL» del reporte de ws1-t3.

/** Categoría del catálogo que es de ortodoncia (catalog-procedures-constantes.ts). */
export const CATEGORIA_ORTO = "orthodontics";

/**
 * DECISIÓN PARA RAFAEL — los procedimientos de ortodoncia del catálogo
 * («Control de ortodoncia», «Colocación de aparatología», «Retenedor»…, todo
 * lo de categoría `orthodontics`) van con el interruptor de ORTODONCIA, no con
 * el de Procedimientos, y por tanto solo si la clínica tiene el módulo.
 */
export const ORTO_DEL_CATALOGO_VA_CON_ORTODONCIA = true;

/**
 * Lo que se anota DENTRO de la hoja de control: no se ofrece como servicio
 * (mismo criterio que el menú de agendar, catalog-procedures.ts).
 */
export const HECHOS_DENTRO_DEL_CONTROL: readonly string[] = ["Activación", "Cambio de arco", "Ajuste de aparatología"];

/**
 * DECISIÓN PARA RAFAEL — tope de renglones por grupo para no inflar el prompt
 * con un catálogo enorme. Se ordenan por nombre y se cortan aquí; de lo que
 * queda fuera el bot no sabe nada (si preguntan, sigue las instrucciones de la
 * clínica o pasa a una persona).
 */
export const MAX_RENGLONES_POR_GRUPO = 80;

/**
 * DECISIÓN PARA RAFAEL — si una pregunta frecuente o las instrucciones dan un
 * precio de un tratamiento:
 *  - interruptor ENCENDIDO y el catálogo también lo tiene con precio: manda el
 *    del catálogo (regla 2: «el bot dice el precio que la clínica tiene en
 *    Procedimientos»);
 *  - interruptor APAGADO: se respeta el precio que la clínica escribió en sus
 *    FAQs o instrucciones (es lo que hace el bot hoy; con los interruptores
 *    apagados de fábrica, ninguna clínica pierde de golpe los precios que ya
 *    había escrito). Con `false`, apagado = «el costo se da en la valoración»
 *    aunque la FAQ diga un precio.
 */
export const APAGADO_RESPETA_PRECIO_DE_FAQ = true;

/** Largo máximo de un nombre en el prompt (los de técnicas ya vienen a 60). */
const NOMBRE_MAX = 80;

export interface ProcedimientoParaBot {
  name: string;
  category: string | null;
  basePrice: number | null;
}

export interface TecnicaParaBot {
  nombre: string;
  precio: number | null;
}

export interface EntradaPreciosBot {
  /** Interruptor «Dar precios de Procedimientos». */
  darPreciosProcedimientos: boolean;
  /** Interruptor «Dar precios de Ortodoncia». */
  darPreciosOrtodoncia: boolean;
  /** ¿La clínica tiene el módulo de Ortodoncia contratado y vigente? */
  tieneOrtodoncia: boolean;
  /** Procedimientos ACTIVOS del catálogo de ESTA clínica. */
  procedimientos: readonly ProcedimientoParaBot[];
  /** Técnicas ACTIVAS de ortodoncia de ESTA clínica. */
  tecnicas: readonly TecnicaParaBot[];
  /** ¿El bot puede agendar? Si no, «agendar la valoración» = pasar a una persona. */
  puedeAgendar: boolean;
  /** Moneda de la clínica (MXN por defecto). */
  moneda?: string;
}

interface Renglon {
  nombre: string;
  precio: number;
}

/** Un precio de verdad: número finito > 0. $0, vacío o basura = NO es precio (regla 3). */
export function esPrecioReal(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Nombre en una línea, sin saltos ni espacios de más (no rompe el prompt). */
export function nombreLimpio(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, NOMBRE_MAX);
}

export function formatoPrecio(n: number, moneda = "MXN"): string {
  const conDecimales = Math.round(n * 100) % 100 !== 0;
  const cifra = n.toLocaleString("es-MX", {
    minimumFractionDigits: conDecimales ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `$${cifra} ${moneda}`;
}

/**
 * Quita repetidos (mismo nombre sin importar mayúsculas: se queda el que
 * llegó primero), ordena por nombre y corta al tope.
 */
function depurar(rs: Renglon[]): { renglones: Renglon[]; cortados: number } {
  const vistos = new Set<string>();
  const unicos: Renglon[] = [];
  for (const r of rs) {
    const clave = r.nombre.toLocaleLowerCase("es");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(r);
  }
  unicos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return {
    renglones: unicos.slice(0, MAX_RENGLONES_POR_GRUPO),
    cortados: Math.max(0, unicos.length - MAX_RENGLONES_POR_GRUPO),
  };
}

export interface GruposDePrecios {
  procedimientos: Renglon[];
  ortodoncia: Renglon[];
}

/**
 * Qué entra en cada grupo, ANTES de mirar los interruptores. Solo renglones
 * con precio real (regla 3: un $0 no aparece en ningún lado, ni como «sí lo
 * hacemos»). Sin módulo de Ortodoncia el grupo de ortodoncia queda vacío,
 * técnicas y procedimientos de ortodoncia del catálogo incluidos.
 */
export function gruposDePrecios(e: EntradaPreciosBot): GruposDePrecios {
  const procedimientos: Renglon[] = [];
  const ortodoncia: Renglon[] = [];
  for (const p of e.procedimientos) {
    const nombre = nombreLimpio(p.name);
    if (!nombre || !esPrecioReal(p.basePrice)) continue;
    const esOrto = ORTO_DEL_CATALOGO_VA_CON_ORTODONCIA && p.category === CATEGORIA_ORTO;
    if (esOrto) {
      if (HECHOS_DENTRO_DEL_CONTROL.includes(nombre)) continue;
      if (e.tieneOrtodoncia) ortodoncia.push({ nombre, precio: p.basePrice });
    } else {
      procedimientos.push({ nombre, precio: p.basePrice });
    }
  }
  if (e.tieneOrtodoncia) {
    for (const t of e.tecnicas) {
      const nombre = nombreLimpio(t.nombre);
      if (!nombre || !esPrecioReal(t.precio)) continue;
      ortodoncia.push({ nombre, precio: t.precio });
    }
  }
  return { procedimientos, ortodoncia };
}

/**
 * El bloque de PRECIOS Y TRATAMIENTOS para la parte FIJA (cacheada) del
 * prompt del bot. "" si no hay nada que decir (catálogo vacío, todo en $0…):
 * entonces el prompt queda EXACTAMENTE como antes de este cambio.
 *
 * `centinelaAgenda` / `centinelaHandoff`: los de ai-prompt.ts (se pasan para
 * no importar ai-prompt aquí y evitar el ciclo).
 */
export function bloquePreciosDelBot(
  e: EntradaPreciosBot,
  centinelas: { agenda: string; handoff: string },
): string {
  const moneda = e.moneda?.trim() || "MXN";
  const g = gruposDePrecios(e);
  const conPrecio: string[] = [];
  const sinPrecio: string[] = [];

  const agregar = (rs: Renglon[], encendido: boolean, titulo: string) => {
    if (rs.length === 0) return;
    const { renglones, cortados } = depurar(rs);
    const lineas = renglones.map((r) => (encendido ? `- ${r.nombre}: ${formatoPrecio(r.precio, moneda)}` : `- ${r.nombre}`));
    if (cortados > 0) lineas.push(`(y ${cortados} más que no aparecen aquí)`);
    (encendido ? conPrecio : sinPrecio).push(`${titulo}:`, ...lineas);
  };
  agregar(g.procedimientos, e.darPreciosProcedimientos, "Procedimientos");
  agregar(g.ortodoncia, e.darPreciosOrtodoncia, "Ortodoncia");

  if (conPrecio.length === 0 && sinPrecio.length === 0) return "";

  const siAcepta = e.puedeAgendar
    ? `si acepta agendarla, responde EXACTAMENTE ${centinelas.agenda} (solo eso)`
    : `si acepta agendarla, responde EXACTAMENTE ${centinelas.handoff} (solo eso) para que una persona del equipo la agende`;

  const out: string[] = ["PRECIOS Y TRATAMIENTOS DE LA CLÍNICA (salen del panel de la clínica):"];
  if (conPrecio.length > 0) {
    out.push(
      "Precios que SÍ puedes dar (precio de lista de la clínica):",
      ...conPrecio,
      "- Da el precio tal cual está aquí. No hagas descuentos, no sumes, no estimes totales ni des rangos, y no prometas que es el precio final del tratamiento de esa persona.",
      "- Si una pregunta frecuente o las instrucciones de la clínica dan otro precio para un tratamiento de esta lista, usa el de esta lista.",
    );
  }
  if (sinPrecio.length > 0) {
    out.push(
      "Tratamientos que la clínica SÍ hace, pero cuyo precio NO das por este medio:",
      ...sinPrecio,
      APAGADO_RESPETA_PRECIO_DE_FAQ
        ? `- Si preguntan el costo de uno de estos y las instrucciones o preguntas frecuentes de la clínica NO dan ese precio: di que sí lo hacen, que el costo se da en la valoración, y ofrece agendarla; ${siAcepta}. Si insiste en saber el precio, responde EXACTAMENTE ${centinelas.handoff} (solo eso).`
        : `- Si preguntan el costo de uno de estos: di que sí lo hacen, que el costo se da en la valoración, y ofrece agendarla; ${siAcepta}. Si insiste en saber el precio, responde EXACTAMENTE ${centinelas.handoff} (solo eso). No des el precio aunque aparezca en otro lado.`,
    );
  }
  out.push(
    `- De un tratamiento que NO aparece en estas listas no digas precio ni supongas nada: sigue las instrucciones y preguntas frecuentes de la clínica; si ahí no está, responde EXACTAMENTE ${centinelas.handoff}.`,
  );
  return out.join("\n");
}
