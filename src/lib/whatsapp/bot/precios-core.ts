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
// Segunda ronda (decisiones de Rafael sobre el primer reporte):
//  - El interruptor depende de DÓNDE está registrado el precio, no de la
//    categoría: lo que está en Procedimientos (también «Control de
//    ortodoncia» o «Colocación de aparatología») va con «Procedimientos»; lo
//    que está en «Técnicas y precios», con «Ortodoncia».
//  - Los precios se dicen, PERO si las instrucciones de la clínica dicen que no
//    se dé el precio de algo, el bot obedece (ahí mandan las instrucciones).
//  - Sin tope: el bot «sabe» todo el catálogo, pero en cada turno solo entran
//    los renglones que coinciden con lo que escribió el paciente (palabras sin
//    acentos, plurales y sinónimos simples). Las REGLAS van en la parte fija
//    cacheada del prompt; los renglones que coinciden, en la parte que cambia
//    cada turno (sin caché). Sin coincidencia: las reglas de siempre.
//
// Lo que las reglas no fijan va en constantes de este archivo y en la sección
// «DECISIONES PARA RAFAEL» del reporte de ws1-t3.

/** Categoría del catálogo que es de ortodoncia (catalog-procedures-constantes.ts). */
export const CATEGORIA_ORTO = "orthodontics";

/**
 * Lo que se anota DENTRO de la hoja de control: no se ofrece como servicio
 * (mismo criterio que el menú de agendar, catalog-procedures.ts).
 */
export const HECHOS_DENTRO_DEL_CONTROL: readonly string[] = ["Activación", "Cambio de arco", "Ajuste de aparatología"];

/**
 * DECISIÓN PARA RAFAEL (ronda 1, aprobada «como lo tienes») — con el
 * interruptor APAGADO se respeta el precio que la clínica escribió en sus FAQs
 * o instrucciones. Con `false`, apagado = «el costo se da en la valoración»
 * aunque la FAQ diga un precio.
 */
export const APAGADO_RESPETA_PRECIO_DE_FAQ = true;

/**
 * DECISIÓN PARA RAFAEL — además del mensaje de este turno, se buscan
 * coincidencias en los últimos N mensajes del PACIENTE (para «quiero una
 * limpieza» → «¿y cuánto cuesta?»).
 */
export const MENSAJES_PREVIOS_PARA_BUSCAR = 2;

/**
 * DECISIÓN PARA RAFAEL — una palabra del paciente que aparece en MÁS de
 * estos renglones del catálogo («posterior», «infantil», «de ortodoncia»…) no
 * basta por sí sola para meter renglones: con un catálogo de 300 metía 55. Si
 * el paciente escribió además otra palabra más precisa («resina»), esa manda;
 * si solo escribió palabras comunes, no entra ninguno y siguen las reglas de
 * siempre (instrucciones, FAQ o una persona).
 */
export const PALABRA_COMUN_DESDE = 12;

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
  /** Procedimientos ACTIVOS del catálogo de ESTA clínica (todos: sin tope). */
  procedimientos: readonly ProcedimientoParaBot[];
  /** Técnicas ACTIVAS de ortodoncia de ESTA clínica. */
  tecnicas: readonly TecnicaParaBot[];
  /** ¿El bot puede agendar? Si no, «agendar la valoración» = pasar a una persona. */
  puedeAgendar: boolean;
  /** Moneda de la clínica (MXN por defecto). */
  moneda?: string;
}

export interface Renglon {
  nombre: string;
  precio: number;
}

/** Lo que entra al prompt: reglas (parte fija, cacheada) y renglones de ESTE turno (parte variable). */
export interface PreciosDelTurno {
  reglas: string;
  coincidencias: string;
}

export const PRECIOS_VACIOS: PreciosDelTurno = Object.freeze({ reglas: "", coincidencias: "" });

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

/** Quita repetidos (mismo nombre sin importar mayúsculas: se queda el primero) y ordena por nombre. */
function depurar(rs: readonly Renglon[]): Renglon[] {
  const vistos = new Set<string>();
  const unicos: Renglon[] = [];
  for (const r of rs) {
    const clave = r.nombre.toLocaleLowerCase("es");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(r);
  }
  return unicos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export interface GruposDePrecios {
  /** De Administración → Procedimientos (cualquier categoría): interruptor «Procedimientos». */
  procedimientos: Renglon[];
  /** De «Técnicas y precios» (solo con el módulo): interruptor «Ortodoncia». */
  ortodoncia: Renglon[];
}

/**
 * Qué entra en cada grupo, ANTES de mirar los interruptores. Solo renglones
 * con precio real (regla 3: un $0 no aparece en ningún lado, ni como «sí lo
 * hacemos»). El grupo lo decide DÓNDE está registrado: el catálogo va con
 * Procedimientos aunque sea de categoría ortodoncia; las técnicas, con
 * Ortodoncia, y solo si la clínica tiene el módulo.
 */
export function gruposDePrecios(e: EntradaPreciosBot): GruposDePrecios {
  const procedimientos: Renglon[] = [];
  const ortodoncia: Renglon[] = [];
  for (const p of e.procedimientos) {
    const nombre = nombreLimpio(p.name);
    if (!nombre || !esPrecioReal(p.basePrice)) continue;
    if (p.category === CATEGORIA_ORTO && HECHOS_DENTRO_DEL_CONTROL.includes(nombre)) continue;
    procedimientos.push({ nombre, precio: p.basePrice });
  }
  if (e.tieneOrtodoncia) {
    for (const t of e.tecnicas) {
      const nombre = nombreLimpio(t.nombre);
      if (!nombre || !esPrecioReal(t.precio)) continue;
      ortodoncia.push({ nombre, precio: t.precio });
    }
  }
  return { procedimientos: depurar(procedimientos), ortodoncia: depurar(ortodoncia) };
}

// ── Búsqueda por palabras ───────────────────────────────────────────────────

/**
 * Palabras que no distinguen un tratamiento de otro («¿cuánto cuesta la
 * limpieza dental?»: solo cuenta «limpieza»). Ya en raíz (ver `raiz`).
 */
const VACIAS = new Set([
  "cuant", "cuest", "cuestan", "cost", "costar", "preci", "precios", "cobran", "cobr", "val", "sale",
  "dental", "dentale", "dient", "piez", "tratamient", "general", "normal", "simpl", "sencill",
  "hola", "buen", "tard", "noch", "graci", "favor", "quier", "quisier", "gustari", "tien", "tienen", "hacen", "hace",
  "pued", "puedo", "saber", "sabe", "inform", "informacion", "sobre", "como", "est", "esta", "ese", "eso", "este",
  "donde", "cuand", "tambien", "much", "poc", "para", "por", "con", "sin", "una", "uno", "unos", "del", "los", "las",
  "que", "qué", "algo", "alguno", "algun", "otra", "otro", "mas", "menos", "aproximad", "promedi",
]);

/**
 * Sinónimos simples, ya en raíz: cada palabra del paciente (o del nombre del
 * procedimiento) se lleva a la misma raíz. DECISIÓN PARA RAFAEL: lista corta y
 * conservadora; crece aquí.
 */
const SINONIMOS: Record<string, string> = {
  profilaxi: "limpiez",
  limpiar: "limpiez",
  fren: "bracket",
  brac: "bracket",
  braket: "bracket",
  empast: "resin",
  calz: "resin",
  tapadur: "resin",
  obturacion: "resin",
  conduct: "endodonci",
  nervi: "endodonci",
  fund: "coron",
  invisalign: "alineador",
  blanquear: "blanqueamient",
  blanquead: "blanqueamient",
  extraer: "extraccion",
};

/**
 * Si el paciente pregunta por ortodoncia en general («¿cuánto cuesta la
 * ortodoncia?», «¿y los frenos?»), entran TODAS las técnicas: son pocas (hasta
 * 40) y sus nombres no suelen decir «ortodoncia».
 */
const ORTO_EN_GENERAL = new Set(["ortodonci", "bracket", "alineador", "aparat"]);

/** Minúsculas, sin acentos, sin signos. */
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Raíz simple: sin plural («-es», «-s») y sin la vocal final. «implantes» = «implante» = «implant». */
export function raiz(palabra: string): string {
  let t = palabra;
  if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s")) t = t.slice(0, -1);
  if (t.length > 4 && /[aeo]$/.test(t)) t = t.slice(0, -1);
  return SINONIMOS[t] ?? t;
}

/** Las raíces que distinguen: ≥ 4 letras (o sinónimo conocido) y no vacías. */
export function palabrasClave(s: string): Set<string> {
  const out = new Set<string>();
  for (const p of normalizarTexto(s).split(" ")) {
    if (!p) continue;
    const r = raiz(p);
    if (r.length < 4 || VACIAS.has(r)) continue;
    out.add(r);
  }
  return out;
}

/**
 * Los renglones cuyo nombre comparte al menos una palabra clave PRECISA con
 * el texto del paciente. Precisa = aparece en a lo más PALABRA_COMUN_DESDE
 * renglones de `universo` (todo lo que el bot sabe de la clínica).
 */
export function coincidencias(
  rs: readonly Renglon[],
  clavesPaciente: ReadonlySet<string>,
  universo: readonly Renglon[] = rs,
): Renglon[] {
  if (clavesPaciente.size === 0) return [];
  const clavesDe = new Map<Renglon, Set<string>>();
  const claves = (r: Renglon) => {
    let c = clavesDe.get(r);
    if (!c) clavesDe.set(r, (c = palabrasClave(r.nombre)));
    return c;
  };
  const precisas = new Set<string>();
  for (const k of clavesPaciente) {
    let n = 0;
    for (const r of universo) if (claves(r).has(k)) n++;
    if (n > 0 && n <= PALABRA_COMUN_DESDE) precisas.add(k);
  }
  if (precisas.size === 0) return [];
  return rs.filter((r) => {
    for (const k of claves(r)) if (precisas.has(k)) return true;
    return false;
  });
}

// ── El prompt ───────────────────────────────────────────────────────────────

/**
 * Reglas (parte FIJA, cacheada) y renglones que coinciden con lo que escribió
 * el paciente en ESTE turno (parte variable). `reglas` = "" si la clínica no
 * tiene nada con precio que el bot pueda nombrar: el prompt queda EXACTAMENTE
 * como antes de este cambio. Las reglas solo dependen de la clínica (catálogo
 * e interruptores), nunca del mensaje: así no rompen la caché.
 *
 * `centinelas`: los de ai-prompt.ts (se pasan para no importar ai-prompt aquí).
 */
export function preciosDelTurno(
  e: EntradaPreciosBot,
  textoPaciente: string,
  centinelas: { agenda: string; handoff: string },
): PreciosDelTurno {
  const moneda = e.moneda?.trim() || "MXN";
  const g = gruposDePrecios(e);
  const grupos = [
    { titulo: "Procedimientos", renglones: g.procedimientos, encendido: e.darPreciosProcedimientos },
    { titulo: "Ortodoncia", renglones: g.ortodoncia, encendido: e.darPreciosOrtodoncia },
  ].filter((x) => x.renglones.length > 0);
  if (grupos.length === 0) return { ...PRECIOS_VACIOS };

  const hayEncendido = grupos.some((x) => x.encendido);
  const hayApagado = grupos.some((x) => !x.encendido);
  const siAcepta = e.puedeAgendar
    ? `si acepta agendarla, responde EXACTAMENTE ${centinelas.agenda} (solo eso)`
    : `si acepta agendarla, responde EXACTAMENTE ${centinelas.handoff} (solo eso) para que una persona del equipo la agende`;

  const reglas: string[] = [
    "PRECIOS Y TRATAMIENTOS DE LA CLÍNICA (salen del panel de la clínica):",
    "- Al final de este mensaje, en «TRATAMIENTOS QUE COINCIDEN CON LO QUE ESCRIBE EL PACIENTE», pueden venir los tratamientos del panel de la clínica que tienen que ver con lo que pregunta, marcados «con precio» o «sin precio por este medio».",
  ];
  if (hayEncendido) {
    reglas.push(
      "- De los «con precio»: da el precio tal cual. No hagas descuentos, no sumes, no estimes totales ni des rangos, y no prometas que es el precio final del tratamiento de esa persona. Si una pregunta frecuente o las instrucciones dan otro precio para ese mismo tratamiento, usa el de la lista.",
      `- EXCEPCIÓN, aquí mandan las instrucciones de la clínica: si dicen que NO se dé el precio de algo (por ejemplo, del control en un plan a plazos), obedécelas aunque venga «con precio». Haz lo que indiquen; si no dicen qué responder, di que el costo se da en la valoración y ofrece agendarla; ${siAcepta}.`,
    );
  }
  if (hayApagado) {
    reglas.push(
      APAGADO_RESPETA_PRECIO_DE_FAQ
        ? `- De los «sin precio por este medio»: si las instrucciones o preguntas frecuentes de la clínica NO dan ese precio, di que sí lo hacen, que el costo se da en la valoración, y ofrece agendarla; ${siAcepta}. Si insiste en saber el precio, responde EXACTAMENTE ${centinelas.handoff} (solo eso).`
        : `- De los «sin precio por este medio»: di que sí lo hacen, que el costo se da en la valoración, y ofrece agendarla; ${siAcepta}. Si insiste en saber el precio, responde EXACTAMENTE ${centinelas.handoff} (solo eso). No des el precio aunque aparezca en otro lado.`,
    );
  }
  reglas.push(
    `- De un tratamiento que NO aparece en esa lista (o si no viene ninguna) no digas precio ni supongas nada: sigue las instrucciones y preguntas frecuentes de la clínica; si ahí no está, responde EXACTAMENTE ${centinelas.handoff}.`,
  );

  // Los renglones de ESTE turno.
  const claves = palabrasClave(textoPaciente);
  const ortoEnGeneral = [...claves].some((k) => ORTO_EN_GENERAL.has(k));
  const universo = grupos.flatMap((x) => x.renglones);
  const conPrecio: string[] = [];
  const sinPrecio: string[] = [];
  for (const x of grupos) {
    const rs = x.titulo === "Ortodoncia" && ortoEnGeneral ? x.renglones : coincidencias(x.renglones, claves, universo);
    for (const r of rs) {
      if (x.encendido) conPrecio.push(`- ${r.nombre}: ${formatoPrecio(r.precio, moneda)}`);
      else sinPrecio.push(`- ${r.nombre}`);
    }
  }
  const lineas: string[] = [];
  if (conPrecio.length > 0 || sinPrecio.length > 0) {
    lineas.push("TRATAMIENTOS QUE COINCIDEN CON LO QUE ESCRIBE EL PACIENTE (del panel de la clínica):");
    if (conPrecio.length > 0) lineas.push("Con precio:", ...conPrecio);
    if (sinPrecio.length > 0) lineas.push("Sin precio por este medio (la clínica sí lo hace):", ...sinPrecio);
  }
  return { reglas: reglas.join("\n"), coincidencias: lineas.join("\n") };
}

/** El texto del paciente en el que se busca: este mensaje + sus N anteriores. */
export function textoParaBuscar(incoming: string, historia: ReadonlyArray<{ role: string; text: string }>): string {
  const previos = historia
    .filter((h) => h.role === "patient")
    .slice(-MENSAJES_PREVIOS_PARA_BUSCAR)
    .map((h) => h.text ?? "");
  return [...previos, incoming].join("\n");
}
