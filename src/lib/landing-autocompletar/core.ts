/* ============================================================
   AUTOCOMPLETAR LA PÁGINA WEB CON LO QUE LA CLÍNICA YA TIENE.

   La regla que manda: PROPONE, NO PUBLICA. Nada de este archivo escribe
   en la base; todo son funciones puras que arman una propuesta para que
   la clínica la apruebe campo por campo. Lo que se aprueba viaja por el
   PATCH de siempre (/api/clinic-landing) con su lista literal y sus
   validadores: aquí no hay una segunda puerta de escritura.

   Dos clases de dato, y no se mezclan:

   · DUROS — tratamientos, precios, duraciones, doctores, horarios,
     dirección. Se COPIAN de la base. El modelo no los ve escritos como
     algo que pueda cambiar: los precios ni siquiera viajan en el prompt,
     así que no puede citarlos mal.
   · REDACCIÓN — eslogan, presentación, descripción de cada servicio y
     preguntas frecuentes. Eso sí lo escribe la IA, SOLO con los hechos
     de `construirHechos`, y lo que devuelve pasa por `validarRedaccion`,
     que marca cualquier cifra o promesa que no salga de esos hechos.

   Sin imports de servidor: lo usan la ruta del API, el panel (cliente)
   y los tests.
   ============================================================ */

/* ── lo que se lee de la base ──────────────────────────────── */

export interface FilaTarifario {
  id: string;
  name: string;
  category: string;
  basePrice: number;
  duration: number | null;
  description: string | null;
}

export interface FilaDoctor {
  firstName: string;
  lastName: string;
  specialty: string | null;
  role: string;
  /** Solo si la tiene o no: la cédula no se publica ni se manda al modelo. */
  tieneCedula: boolean;
}

export interface FilaHorario {
  dayOfWeek: number; // 0 = lunes … 6 = domingo, como en toda la landing
  enabled: boolean;
  openTime: string;
  closeTime: string;
}

export interface DatosDeClinica {
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  landingWhatsapp: string | null;
  landingMsiPlazos: number[];
}

/** Un elemento de `landingServices` tal como está guardado (JSON libre). */
export type ServicioGuardado = Record<string, unknown>;

/** El mismo tope que `listaDe(60, …)` en @/lib/landing-fields. */
export const MAX_SERVICIOS = 60;

/* ── precios: se copian, y se comparan sin adivinar ────────── */

/** `1200` → "$1,200" · `850.5` → "$850.50". Un precio en 0 no se publica. */
export function precioDeTarifario(basePrice: number): string {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return "";
  const cerrado = Math.round(basePrice * 100) / 100;
  const [entero, decimales] = cerrado.toFixed(2).split(".");
  const conComas = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimales === "00" ? `$${conComas}` : `$${conComas}.${decimales}`;
}

/** La primera cifra de un texto de precio ("Desde $1,200 MXN" → 1200), o null. */
export function cifraDePrecio(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  const m = texto.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Para emparejar «Limpieza Dental» del tarifario con «limpieza dental » de la página. */
export function nombreNormalizado(nombre: unknown): string {
  if (typeof nombre !== "string") return "";
  return nombre
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/* ── servicios: tarifario → propuesta ──────────────────────── */

export type EstadoServicio =
  | "nuevo"        // está en el tarifario y no en la página
  | "distinto"     // está en los dos y el precio o la duración no coinciden
  | "sin-precio"   // está en los dos; la página no enseña precio (puede ser a propósito)
  | "igual";       // está en los dos y coincide: nada que proponer

export interface ServicioPropuesto {
  /** id del procedimiento en el tarifario: la llave de la propuesta. */
  id: string;
  estado: EstadoServicio;
  /** Posición en el `landingServices` GUARDADO, o null si es nuevo. */
  indiceGuardado: number | null;
  nombre: string;
  categoria: string;
  /** Copiado del tarifario, ya con formato. "" si el tarifario lo tiene en 0. */
  precio: string;
  duracionMin: number | null;
  /** La descripción que el doctor escribió en el tarifario, si escribió alguna. */
  descripcionTarifario: string | null;
  /** Lo que la página dice HOY, para que se vea la diferencia. */
  enPagina: { precio: string | null; duracionMin: number | null; desc: string | null } | null;
}

export function proponerServicios(
  tarifario: FilaTarifario[],
  guardados: ServicioGuardado[],
): ServicioPropuesto[] {
  const porNombre = new Map<string, number>();
  guardados.forEach((s, i) => {
    const n = nombreNormalizado(s?.name);
    if (n && !porNombre.has(n)) porNombre.set(n, i);
  });

  const vistos = new Set<string>();
  const out: ServicioPropuesto[] = [];
  for (const fila of tarifario) {
    const nombre = (fila.name ?? "").trim();
    const clave = nombreNormalizado(nombre);
    // Dos filas del tarifario con el mismo nombre: se propone la primera. La
    // página pública no distingue variantes por nombre repetido.
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);

    const precio = precioDeTarifario(fila.basePrice);
    const duracionMin = fila.duration && fila.duration > 0 ? Math.round(fila.duration) : null;
    const descripcionTarifario = fila.description?.trim() ? fila.description.trim() : null;
    const indice = porNombre.get(clave);

    if (indice === undefined) {
      out.push({
        id: fila.id, estado: "nuevo", indiceGuardado: null, nombre, categoria: fila.category,
        precio, duracionMin, descripcionTarifario, enPagina: null,
      });
      continue;
    }

    const g = guardados[indice];
    const precioPagina = typeof g.price === "string" && g.price.trim() ? g.price.trim() : null;
    const durPagina = Number(g.durationMin);
    const enPagina = {
      precio: precioPagina,
      duracionMin: Number.isFinite(durPagina) && durPagina > 0 ? Math.round(durPagina) : null,
      desc: typeof g.desc === "string" && g.desc.trim() ? g.desc.trim() : null,
    };

    let estado: EstadoServicio = "igual";
    if (precio && !precioPagina) estado = "sin-precio";
    else if (precio && cifraDePrecio(precioPagina) !== cifraDePrecio(precio)) estado = "distinto";
    else if (duracionMin && enPagina.duracionMin && duracionMin !== enPagina.duracionMin) estado = "distinto";

    out.push({
      id: fila.id, estado, indiceGuardado: indice, nombre, categoria: fila.category,
      precio, duracionMin, descripcionTarifario, enPagina,
    });
  }
  return out;
}

export interface ServicioAprobado {
  id: string;
  /** false = el servicio entra a la página SIN precio (hay clínicas que no los publican). */
  conPrecio: boolean;
  /** Descripción aprobada (del tarifario o redactada). undefined = no tocar la que haya. */
  desc?: string;
}

export type ResultadoDeAplicar =
  | { ok: true; servicios: ServicioGuardado[] }
  | { ok: false; motivo: string };

/**
 * El `landingServices` nuevo: lo guardado + lo que la clínica aprobó.
 *
 * NUNCA quita ni reordena nada de lo que ya estaba: un servicio que la clínica
 * escribió a mano y no está en el tarifario se queda donde está. De los que ya
 * existían solo cambian precio, duración y —si se aprobó una— la descripción;
 * el ícono y cualquier otra llave se conservan.
 */
export function aplicarServicios(
  guardados: ServicioGuardado[],
  propuesta: ServicioPropuesto[],
  aprobados: ServicioAprobado[],
): ResultadoDeAplicar {
  const porId = new Map(propuesta.map(p => [p.id, p]));
  const siguiente: ServicioGuardado[] = guardados.map(s => ({ ...s }));

  for (const a of aprobados) {
    const p = porId.get(a.id);
    if (!p) continue;
    if (p.indiceGuardado !== null && siguiente[p.indiceGuardado]) {
      const actual = siguiente[p.indiceGuardado];
      if (a.conPrecio && p.precio) actual.price = p.precio;
      if (p.duracionMin) actual.durationMin = p.duracionMin;
      if (typeof a.desc === "string") actual.desc = a.desc;
      continue;
    }
    siguiente.push({
      name: p.nombre,
      desc: typeof a.desc === "string" ? a.desc : (p.descripcionTarifario ?? ""),
      price: a.conPrecio ? p.precio : "",
      durationMin: p.duracionMin ?? 30,
      icon: "🦷",
    });
  }

  if (siguiente.length > MAX_SERVICIOS) {
    return {
      ok: false,
      motivo: `Tu página admite hasta ${MAX_SERVICIOS} servicios y con estos serían ${siguiente.length}. Desmarca ${siguiente.length - MAX_SERVICIOS}.`,
    };
  }
  return { ok: true, servicios: siguiente };
}

/* ── horarios y doctores: ya salen solos, aquí solo se resumen ── */

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** "Lunes a viernes 09:00–18:00 · Sábado 09:00–14:00". "" si no hay ningún día abierto. */
export function resumenDeHorario(horarios: FilaHorario[]): string {
  const abiertos = horarios
    .filter(h => h.enabled && h.dayOfWeek >= 0 && h.dayOfWeek <= 6)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  if (abiertos.length === 0) return "";

  const tramos: { desde: number; hasta: number; horas: string }[] = [];
  for (const h of abiertos) {
    const horas = `${h.openTime}–${h.closeTime}`;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.horas === horas && ultimo.hasta === h.dayOfWeek - 1) ultimo.hasta = h.dayOfWeek;
    else tramos.push({ desde: h.dayOfWeek, hasta: h.dayOfWeek, horas });
  }
  return tramos
    .map(t => t.desde === t.hasta
      ? `${DIAS[t.desde]} ${t.horas}`
      : `${DIAS[t.desde]} a ${DIAS[t.hasta].toLowerCase()} ${t.horas}`)
    .join(" · ");
}

export function nombreDeDoctor(d: FilaDoctor): string {
  return `${d.firstName ?? ""} ${d.lastName ?? ""}`.replace(/\s+/g, " ").trim();
}

/* ── lo que falta: se DICE, no se inventa ──────────────────── */

export interface Faltante {
  que: "tarifario" | "doctores" | "especialidades" | "horarios" | "direccion" | "telefono";
  texto: string;
  /** Dónde se arregla, dentro del panel. */
  href: string;
}

export function faltantes(
  clinica: DatosDeClinica,
  tarifario: FilaTarifario[],
  doctores: FilaDoctor[],
  horarios: FilaHorario[],
): Faltante[] {
  const out: Faltante[] = [];
  if (tarifario.length === 0) {
    out.push({ que: "tarifario", href: "/dashboard/procedures",
      texto: "Tu clínica no tiene tarifario: no hay tratamientos ni precios que copiar. Cárgalos en Procedimientos y vuelve." });
  }
  if (doctores.length === 0) {
    out.push({ que: "doctores", href: "/dashboard/team",
      texto: "No hay doctores activos en tu equipo: la sección de doctores de tu página saldrá vacía." });
  } else if (doctores.every(d => !d.specialty?.trim())) {
    out.push({ que: "especialidades", href: "/dashboard/team",
      texto: "Ningún doctor tiene especialidad escrita: tu página los muestra solo con su nombre." });
  }
  if (!horarios.some(h => h.enabled)) {
    out.push({ que: "horarios", href: "/dashboard/settings",
      texto: "No hay horario de atención configurado: tu página no puede decir cuándo abres." });
  }
  if (!clinica.address?.trim()) {
    out.push({ que: "direccion", href: "/dashboard/landing",
      texto: "Tu clínica no tiene dirección escrita. Está en la pestaña General de esta misma pantalla." });
  }
  if (!clinica.phone?.trim()) {
    out.push({ que: "telefono", href: "/dashboard/landing",
      texto: "Tu clínica no tiene teléfono escrito. Está en la pestaña General de esta misma pantalla." });
  }
  return out;
}

/* ── los hechos que ve el modelo ───────────────────────────── */

/** Tope de servicios que se mandan a redactar en una sola llamada. */
export const MAX_SERVICIOS_A_REDACTAR = 24;

export interface ServicioARedactar { id: string; nombre: string; categoria: string; nota: string | null }

export interface Hechos {
  clinica: string;
  ciudad: string | null;
  direccion: string | null;
  telefono: string | null;
  horario: string | null;
  doctores: { nombre: string; especialidad: string | null }[];
  servicios: ServicioARedactar[];
  mesesSinIntereses: number[];
}

/**
 * Lo ÚNICO que el modelo sabe de la clínica. Sin precios a propósito: un
 * precio no se redacta, se copia — y lo que el modelo no ve, no lo cita mal.
 * Sin cédulas, sin correos, sin pacientes: nada de eso hace falta para
 * escribir una presentación.
 */
export function construirHechos(
  clinica: DatosDeClinica,
  doctores: FilaDoctor[],
  horarios: FilaHorario[],
  servicios: ServicioARedactar[],
): Hechos {
  return {
    clinica: clinica.name,
    ciudad: [clinica.city, clinica.state].filter(x => x?.trim()).join(", ") || null,
    direccion: clinica.address?.trim() || null,
    telefono: clinica.phone?.trim() || null,
    horario: resumenDeHorario(horarios) || null,
    doctores: doctores
      .filter(d => d.role === "DOCTOR" || d.specialty?.trim())
      .slice(0, 12)
      .map(d => ({ nombre: nombreDeDoctor(d), especialidad: d.specialty?.trim() || null })),
    servicios: servicios.slice(0, MAX_SERVICIOS_A_REDACTAR),
    mesesSinIntereses: clinica.landingMsiPlazos ?? [],
  };
}

export const INSTRUCCIONES_DE_REDACCION = [
  "Redactas textos para la página web pública de una clínica en México. Escribes en español de México, claro y cálido, sin exclamaciones ni mayúsculas de adorno.",
  "Tu ÚNICA fuente son los HECHOS que recibes en JSON. No inventes nada que no esté ahí: ni precios, ni promociones, ni años de experiencia, ni número de pacientes, ni tecnología, ni certificaciones, ni doctores, ni horarios, ni formas de pago.",
  "No escribas ninguna cifra de dinero. Los precios no se redactan: la clínica los copia de su tarifario.",
  "Es publicidad de servicios de salud: no prometas resultados, no digas «sin dolor», «garantizado», «100 %», «los mejores», «el mejor» ni compares con otras clínicas. Describe qué es el tratamiento y para quién es, sin diagnosticar.",
  "Si un hecho falta (viene en null o la lista viene vacía), no lo menciones ni lo rellenes.",
  "Devuelve SOLO un objeto JSON, sin texto antes ni después, con esta forma exacta:",
  '{"eslogan": string (máx. 90 caracteres), "presentacion": string (2 a 4 frases, máx. 600 caracteres), "servicios": [{"id": string (el id que recibiste), "desc": string (1 o 2 frases, máx. 180 caracteres)}], "preguntas": [{"pregunta": string, "respuesta": string (máx. 320 caracteres)}]}',
  "En «servicios» devuelve un elemento por cada servicio recibido, con su mismo id. En «preguntas» devuelve entre 4 y 6, solo las que puedas contestar con los hechos (ubicación, horario, cómo agendar, qué servicios hay, meses sin intereses si los hay). Si no puedes contestar una con los hechos, no la incluyas.",
].join("\n");

/* ── lo que devuelve el modelo: se valida, y se marca lo dudoso ── */

export interface TextoRedactado { texto: string; avisos: string[] }

export interface Redaccion {
  eslogan: TextoRedactado | null;
  presentacion: TextoRedactado | null;
  servicios: { id: string; desc: TextoRedactado }[];
  preguntas: { pregunta: string; respuesta: string; avisos: string[] }[];
}

const PROMESAS = /garantiz|sin dolor|100\s?%|\bl[oa]s mejores\b|\bel mejor\b|\bla mejor\b|n[uú]mero uno|#1(?!\d)|indoloro|resultados? asegurad/i;

/**
 * Cifras del texto que NO aparecen en los hechos. "24 horas" con un horario
 * que no lo dice, "15 años de experiencia", "$500": todo eso es invención.
 */
export function cifrasSinRespaldo(texto: string, hechos: Hechos): string[] {
  const respaldo = JSON.stringify(hechos).replace(/,/g, "");
  const cifras = texto.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:[.:]\d+)?/g) ?? [];
  const out: string[] = [];
  for (const c of cifras) {
    // "9:00" escrito por el modelo es el "09:00" del horario.
    if (!respaldo.includes(c) && !respaldo.includes(`0${c}`) && !out.includes(c)) out.push(c);
  }
  return out;
}

export function avisosDe(texto: string, hechos: Hechos): string[] {
  const avisos: string[] = [];
  if (/\$|\bpesos\b|\bmxn\b/i.test(texto)) {
    avisos.push("Menciona dinero. Los precios van en cada servicio, copiados de tu tarifario: revisa este texto antes de aprobarlo.");
  }
  const cifras = cifrasSinRespaldo(texto, hechos);
  if (cifras.length > 0) {
    avisos.push(`Menciona ${cifras.map(c => `«${c}»`).join(", ")}, que no sale de los datos de tu clínica. Compruébalo antes de aprobarlo.`);
  }
  if (PROMESAS.test(texto)) {
    avisos.push("Suena a promesa de resultados. La publicidad de servicios de salud no debe prometerlos: edítalo antes de aprobarlo.");
  }
  return avisos;
}

const recortar = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** El primer objeto JSON de la respuesta, aunque venga envuelto en ```json. */
export function extraerJson(respuesta: string): unknown {
  const desde = respuesta.indexOf("{");
  const hasta = respuesta.lastIndexOf("}");
  if (desde < 0 || hasta <= desde) return null;
  try {
    return JSON.parse(respuesta.slice(desde, hasta + 1));
  } catch {
    return null;
  }
}

/**
 * De lo que dijo el modelo, solo lo que tiene la forma pedida. Un servicio con
 * un id que no se mandó se TIRA (no se empareja por parecido): así una
 * descripción nunca acaba en el tratamiento equivocado.
 */
export function validarRedaccion(crudo: unknown, hechos: Hechos): Redaccion | null {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const r = crudo as Record<string, unknown>;
  const conAvisos = (texto: string): TextoRedactado => ({ texto, avisos: avisosDe(texto, hechos) });

  const eslogan = recortar(r.eslogan, 90);
  const presentacion = recortar(r.presentacion, 600);

  const idsValidos = new Set(hechos.servicios.map(s => s.id));
  const servicios: Redaccion["servicios"] = [];
  if (Array.isArray(r.servicios)) {
    for (const s of r.servicios) {
      const id = typeof s?.id === "string" ? s.id : "";
      const desc = recortar(s?.desc, 180);
      if (!idsValidos.has(id) || !desc || servicios.some(x => x.id === id)) continue;
      servicios.push({ id, desc: conAvisos(desc) });
    }
  }

  const preguntas: Redaccion["preguntas"] = [];
  if (Array.isArray(r.preguntas)) {
    for (const p of r.preguntas.slice(0, 6)) {
      const pregunta = recortar(p?.pregunta, 200);
      const respuesta = recortar(p?.respuesta, 320);
      if (!pregunta || !respuesta) continue;
      preguntas.push({ pregunta, respuesta, avisos: avisosDe(`${pregunta} ${respuesta}`, hechos) });
    }
  }

  if (!eslogan && !presentacion && servicios.length === 0 && preguntas.length === 0) return null;
  return {
    eslogan: eslogan ? conAvisos(eslogan) : null,
    presentacion: presentacion ? conAvisos(presentacion) : null,
    servicios,
    preguntas,
  };
}

/* ── lo que viaja al navegador ─────────────────────────────── */

export interface LecturaDeClinica {
  servicios: ServicioPropuesto[];
  /**
   * El `landingServices` que había en la base AL LEER. Los `indiceGuardado` de
   * arriba apuntan a ESTA lista, y sobre ella se aplica lo aprobado: la copia
   * que tenga la pantalla puede ser más vieja (otra pestaña guardó después).
   */
  serviciosGuardados: ServicioGuardado[];
  /** Cuántos procedimientos activos hay en el tarifario (la fuente). */
  tarifarioActivos: number;
  doctores: { nombre: string; especialidad: string | null; tieneCedula: boolean }[];
  horario: string;
  whatsappSugerido: string | null;
  faltantes: Faltante[];
}

export function armarLectura(
  clinica: DatosDeClinica,
  tarifario: FilaTarifario[],
  doctores: FilaDoctor[],
  horarios: FilaHorario[],
  guardados: ServicioGuardado[],
): LecturaDeClinica {
  return {
    servicios: proponerServicios(tarifario, guardados),
    serviciosGuardados: guardados,
    tarifarioActivos: tarifario.length,
    doctores: doctores.map(d => ({
      nombre: nombreDeDoctor(d),
      especialidad: d.specialty?.trim() || null,
      tieneCedula: d.tieneCedula,
    })),
    horario: resumenDeHorario(horarios),
    // Solo se sugiere si la página no tiene ninguno. Es el teléfono de la
    // clínica tal cual: puede ser un fijo, y por eso es una propuesta.
    whatsappSugerido: !clinica.landingWhatsapp?.trim() && clinica.phone?.trim() ? clinica.phone.trim() : null,
    faltantes: faltantes(clinica, tarifario, doctores, horarios),
  };
}
