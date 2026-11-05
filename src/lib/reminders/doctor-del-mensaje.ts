// Cómo se nombra al doctor en lo que le llega al PACIENTE (ws1-t10 · cita «Sin
// doctor», P3). Plan: ~/gerentes/trabajos/20261104-1815-cita-sin-doctor-opcion-
// sin-doctor-por-de/PLAN.md §2.6.
//
// Una cita puede no tener doctor todavía (`Appointment.doctorId` null). Lo que
// sale hacia el paciente —recordatorio, aviso de agendada/reprogramada, correo,
// página de confirmar, portal— no puede decir «Te atiende: » vacío ni «Dr/a.
// undefined», y una plantilla aprobada por Meta no admite una variable vacía.
//
// Dos reglas, y solo dos:
//   1. Texto libre (plantillas de la clínica, también las ya personalizadas):
//      la línea que solo habla del doctor («Te atiende: {doctor}», «Dr/a.
//      {doctor}», «👨‍⚕️ *Te atiende:* {doctor}») se quita entera. Si la variable
//      va dentro de una frase que sigue («Tu cita con {doctor} el {fecha}»), la
//      frase se conserva con DOCTOR_NEUTRO en su lugar (y sin el «Dr/a.»).
//   2. Plantillas de Meta: el {{5}} nunca va vacío; sin doctor lleva
//      DOCTOR_NEUTRO (D5). Mismo número de variables: la plantilla aprobada no
//      cambia de forma.
//
// Con doctor, nada cambia: estas funciones devuelven lo mismo que se armaba a
// mano en cada sitio (`Dr/a. Nombre Apellido`).
//
// PURO: sin Prisma ni red.

/**
 * D5 — lo que se dice en lugar del doctor cuando la cita no tiene. Una sola
 * constante: si Rafael elige otra fórmula («tu doctor(a)», «el equipo de la
 * clínica»…), se cambia aquí y vale para Meta, el texto libre y el portal.
 */
export const DOCTOR_NEUTRO = "nuestro equipo";

export type DoctorDeCita = { firstName?: string | null; lastName?: string | null } | null | undefined;

/** «Nombre Apellido», o null si la cita no tiene doctor (o no tiene nombre). */
export function nombreDelDoctor(doctor: DoctorDeCita): string | null {
  if (!doctor) return null;
  const nombre = `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim();
  return nombre || null;
}

/** «Dr/a. Nombre Apellido» (lo de siempre), o null sin doctor. */
export function doctorConTitulo(doctor: DoctorDeCita): string | null {
  const nombre = nombreDelDoctor(doctor);
  return nombre ? `Dr/a. ${nombre}` : null;
}

/** El {{5}} de una plantilla de Meta: nunca vacío. */
export function doctorParaPlantilla(doctor: DoctorDeCita): string {
  return doctorConTitulo(doctor) ?? DOCTOR_NEUTRO;
}

/** Marcadores del doctor en las plantillas de texto libre de la clínica. */
export const MARCADORES_DOCTOR = ["{doctor}", "{doctorName}"] as const;

/** Los demás marcadores: una línea que lleva alguno es una frase que no se puede borrar. */
const OTROS_MARCADORES = ["{paciente}", "{nombre}", "{clinica}", "{clinicName}", "{fecha}", "{hora}", "{link}"];

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const TRATAMIENTO = String.raw`(?:Dr\/a\.?|Dr\.?\/Dra\.?|Dr\(a\)\.?|Dra\.?|Dr\.?|Doctor\/a|Doctor\(a\)|Doctora|Doctor)`;

/**
 * Lo que acompaña a la variable («el Dr/a. {doctor}», «del Dr. {doctor}», «tu
 * doctor {doctor}», «con el {doctor}»): sin doctor se va con ella, para que se
 * lea «con nuestro equipo» y no «con el Dr/a. nuestro equipo». El artículo y el
 * tratamiento solo cuentan si empiezan palabra («Raquel Dr.» no pierde nada).
 * Sin lookbehind a propósito: corre también en el navegador (vista previa) y
 * Safari anterior a 16.4 —iPads de clínica— lo rechaza con un SyntaxError.
 */
function conTratamiento(marcador: string): RegExp {
  return new RegExp(
    // «el/la» y «la/el» primero: si no, «con el/la doctor(a) {doctor}» dejaba «con el/nuestro equipo» (revisión t12, M1).
    String.raw`(^|[^\p{L}\p{N}])(?:(el\/la|la\/el|el|la|tu|del|al)\s+)?(?:` + TRATAMIENTO + String.raw`\s*)?` + escapar(marcador),
    "giu",
  );
}

/**
 * «del Dr. {doctor}» → «de nuestro equipo»; «al …» → «a …»; «el/la/tu …» →
 * sin artículo. Con mayúscula si la variable abría la frase («El Dr. {doctor}
 * te espera» → «Nuestro equipo te espera»).
 */
function neutro(marcador: string, linea: string): string {
  return linea.replace(conTratamiento(marcador), (m: string, antes: string, articulo: string | undefined, pos: number) => {
    const a = (articulo ?? "").toLowerCase();
    const texto = `${a === "del" ? "de " : a === "al" ? "a " : ""}${DOCTOR_NEUTRO}`;
    const primera = m.slice(antes.length).charAt(0);
    const previo = linea.slice(0, pos + antes.length);
    const inicioDeFrase = previo.trim() === "" || /[.!?¡¿]\s*$/.test(previo);
    // «El Dr. {doctor}…» o «{doctor} te espera…» al abrir la frase van con mayúscula.
    const abre = inicioDeFrase && (primera === "{" || primera !== primera.toLowerCase());
    return `${antes}${abre ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto}`;
  });
}

/**
 * ¿Lo que va ANTES de la variable es solo un rótulo («Te atiende:», «👨‍⚕️
 * *Doctor:*», «Dr/a.», «Con»)? Si es texto de la clínica (un teléfono, una
 * indicación, una frase larga), la línea no se puede borrar: se queda con
 * «nuestro equipo» (revisión de P3, M2).
 */
function soloRotuloAntes(linea: string, marcadores: readonly string[]): boolean {
  let ini = linea.length;
  for (const m of marcadores) {
    const i = linea.indexOf(m);
    if (i >= 0) ini = Math.min(ini, i);
  }
  const antes = linea
    .slice(0, ini)
    .replace(new RegExp(TRATAMIENTO + String.raw`\s*$`, "iu"), "")
    .replace(/[^\p{L}\p{N}.!?:\s]/gu, "")
    .trim();
  if (antes.length > 30) return false;
  if (/\p{N}/u.test(antes)) return false;
  // Un punto, «¡» o «?» antes del final = había otra frase antes del doctor.
  if (/[.!?]/.test(antes.replace(/[.:]+$/, ""))) return false;
  // Un rótulo termina en «:» («Atendido por:») o son una o dos palabras («Te
  // atiende», «Con»). «Consulta de ortodoncia con {doctor}» dice qué es la
  // cita: es frase, no rótulo (refutación de P3).
  return antes.endsWith(":") || antes.split(/\s+/).filter(Boolean).length <= 2;
}

/** ¿Hay letras o números después de la última variable del doctor? (= la frase sigue). */
function fraseSigue(linea: string, marcadores: readonly string[]): boolean {
  let fin = -1;
  for (const m of marcadores) {
    const i = linea.lastIndexOf(m);
    if (i >= 0) fin = Math.max(fin, i + m.length);
  }
  return fin >= 0 && /[\p{L}\p{N}]/u.test(linea.slice(fin));
}

/**
 * La línea que sigue a la del doctor ya no es algo que el rótulo de arriba
 * presente: en blanco, el final, otro rótulo con su valor («Fecha: {fecha}») o
 * solo el enlace. Si presenta datos sueltos ({fecha}, {hora}), el rótulo se
 * queda (revisión t12, m1).
 */
function siguienteSueltaElRotulo(siguiente: string | undefined): boolean {
  if (siguiente === undefined || siguiente.trim() === "") return true;
  if (siguiente.trim() === "{link}") return true;
  return /^\s*[^\s{][^:{}\n]{0,38}:/u.test(siguiente);
}

/**
 * ¿La línea del doctor trae su propio rótulo («Doctor: {doctor}», «👨‍⚕️
 * *Doctor:* {doctor}»)? Entonces el rótulo de arriba es de SECCIÓN («Datos de
 * tu cita:») y solo se quita si debajo no queda nada (revisión t12, m1-v2).
 */
function lineaConRotulo(linea: string, marcadores: readonly string[]): boolean {
  let ini = linea.length;
  for (const m of marcadores) {
    const i = linea.indexOf(m);
    if (i >= 0) ini = Math.min(ini, i);
  }
  return /:\s*$/.test(linea.slice(0, ini).replace(/[*_~\s]+$/u, ""));
}

/** Un rótulo que solo presentaba la línea de abajo («Te atiende:», «*Doctor:*»). */
function esRotulo(linea: string): boolean {
  const t = linea.replace(/[*_~\s]+$/u, "").trim();
  return t.length > 0 && t.length <= 40 && t.endsWith(":") && !/\{[^{}]+\}/.test(t);
}

/**
 * Quita el doctor de una plantilla de texto libre ANTES de sustituir las
 * variables (regla 1 de arriba). Devuelve la plantilla sin ninguno de
 * `marcadores`; el resto de variables queda intacto para el render normal.
 *
 * `otros`: los demás marcadores de esa plantilla (una línea que lleva alguno es
 * frase). Por defecto, los de los recordatorios; las hojas de indicaciones pasan
 * los suyos, de corchetes (`[FECHA_CITA]`…), con la misma regla.
 */
export function quitarDoctorDeLaPlantilla(
  plantilla: string,
  marcadores: readonly string[] = MARCADORES_DOCTOR,
  otros: readonly string[] = OTROS_MARCADORES,
): string {
  if (!marcadores.some((m) => plantilla.includes(m))) return plantilla;
  const texto = quitar(plantilla, marcadores, false, otros);
  // Si al quitar la línea no queda nada que leer (una plantilla de una sola
  // línea con el doctor al final), mejor la frase con «nuestro equipo».
  let sinVariables = texto.replace(/\{[^{}]+\}/g, "");
  for (const m of otros) sinVariables = sinVariables.replaceAll(m, "");
  return /\p{L}/u.test(sinVariables) ? texto : quitar(plantilla, marcadores, true, otros);
}

function quitar(
  plantilla: string,
  marcadores: readonly string[],
  todoFrase: boolean,
  otros: readonly string[] = OTROS_MARCADORES,
): string {
  const lineas = plantilla.split("\n");
  const salida: string[] = [];
  let quitada = false;
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!marcadores.some((m) => linea.includes(m))) {
      salida.push(linea);
      continue;
    }
    const esFrase =
      todoFrase ||
      otros.some((m) => linea.includes(m)) ||
      fraseSigue(linea, marcadores) ||
      !soloRotuloAntes(linea, marcadores);
    if (esFrase) {
      let l = linea;
      for (const m of marcadores) l = neutro(m, l).replaceAll(m, DOCTOR_NEUTRO);
      salida.push(l);
      continue;
    }
    // La línea solo habla del doctor: fuera, con su rótulo si lo tenía en la
    // línea de arriba y no presentaba nada más.
    quitada = true;
    const siguiente = lineas[i + 1];
    const anterior = salida[salida.length - 1];
    const suelta = lineaConRotulo(linea, marcadores)
      ? siguiente === undefined || siguiente.trim() === ""
      : siguienteSueltaElRotulo(siguiente);
    if (anterior !== undefined && esRotulo(anterior) && suelta) {
      salida.pop();
    }
  }
  let texto = salida.join("\n");
  // Los saltos que dejó la línea quitada: nunca más de una línea en blanco seguida.
  if (quitada) texto = texto.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
  return texto;
}
