// Ortodoncia — «Alta del caso»: lo que el formulario EXIGE y cómo lo explica
// (ws1-t3, H18 de la QA en vivo del 28-sep-2026). Puro, sin React ni Prisma:
// lo prueban los tests en node y lo usa DrawerNewCase.
//
// Los tres fallos que arregla:
//  (a) Con un tutor nuevo, el teléfono era obligatorio pero no lo decía en
//      ningún sitio: el botón «Abrir caso» se quedaba gris sin explicación.
//      Ahora el campo lo dice, y bajo el botón sale la lista de lo que falta.
//  (b) «Quién lo refirió» salía vacío y no había forma de agregar a nadie sin
//      salir del alta. Aquí vive la validación del referente nuevo.
//  (c) «Costo total» traía 45000 escrito en el código: un caso se podía abrir
//      con un precio que nadie decidió. Ahora el campo nace VACÍO y hay que
//      escribirlo.
//
// Los mínimos son los MISMOS que exige el servidor
// (`createTreatmentPlanSchema` / `createDiagnosisSchema`, en
// src/lib/validation/orthodontics.ts): si allá cambian, el test de este
// archivo falla.

import type { OrthoBillingMode } from "./billing-mode";

export const MIN_RESUMEN = 40;
export const MIN_RETENCION = 20;
export const MIN_NOMBRE_TUTOR = 2;
export const MIN_TELEFONO_TUTOR = 7;
export const MAX_TELEFONO_TUTOR = 20;
export const MAX_COSTO_TOTAL = 10_000_000;

/** Por qué se pide el teléfono del responsable del pago. Se pinta bajo el campo. */
export const MOTIVO_TELEFONO_TUTOR =
  "Obligatorio. Es el contacto de quien paga: recepción lo usa para localizarlo por las mensualidades.";

export type ModoResponsable = "none" | "existing" | "new";

/** Solo las cifras: «+52 55 1234-5678» → «525512345678». */
export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * ¿Sirve este teléfono? Se cuentan las CIFRAS (no los espacios ni los
 * guiones), y el texto completo tiene que caber en lo que acepta el servidor.
 */
export function telefonoTutorValido(texto: string): boolean {
  const limpio = texto.trim();
  return soloDigitos(limpio).length >= MIN_TELEFONO_TUTOR && limpio.length <= MAX_TELEFONO_TUTOR;
}

/** Lo que se le dice a quien escribió un teléfono que no sirve; `null` si está bien o aún vacío. */
export function errorTelefonoTutor(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio === "") return null;
  if (limpio.length > MAX_TELEFONO_TUTOR) return `Es demasiado largo: máximo ${MAX_TELEFONO_TUTOR} caracteres.`;
  const cifras = soloDigitos(limpio).length;
  if (cifras < MIN_TELEFONO_TUTOR) {
    return `Lleva ${cifras} ${cifras === 1 ? "cifra" : "cifras"}: faltan ${MIN_TELEFONO_TUTOR - cifras} para el mínimo de ${MIN_TELEFONO_TUTOR}.`;
  }
  return null;
}

/**
 * El costo que se escribió, en pesos, o `null` si no es un importe que se
 * pueda guardar (vacío, cero, negativo, con letras o fuera de tope). Acepta
 * «36,000», «36000.50» y «$36,000».
 */
export function leerCostoTotal(texto: string): number | null {
  const limpio = texto.replace(/[$\s,]/g, "");
  if (limpio === "" || !/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_COSTO_TOTAL) return null;
  return n;
}

/** Rótulo y explicación del campo del costo, según cómo cobra la clínica. */
export function textosDelCosto(modo: OrthoBillingMode): { rotulo: string; pista: string } {
  if (modo === "PAGO_POR_CONTROL") {
    return {
      rotulo: "Costo estimado del tratamiento (MXN)",
      pista:
        "Tu clínica cobra por control: no se factura un total. Escribe el estimado que le diste al paciente; queda solo como referencia del caso.",
    };
  }
  return {
    rotulo: "Costo total (MXN)",
    pista:
      "Escribe el precio acordado con el paciente. Es la referencia del caso; lo que de verdad se cobra es la factura del tratamiento («Cobro del tratamiento» → «Abrir plan de pago»): confírmalo ahí antes de firmar el acuerdo.",
  };
}

export interface EstadoAlta {
  /** El paciente aún no tiene diagnóstico: el cajón lo pide también. */
  necesitaDiagnostico: boolean;
  enObservacion: boolean;
  resumen: string;
  /** "YYYY-MM-DD" o vacío. */
  proximaRevision: string;
  retencion: string;
  /** Lo escrito en el campo, tal cual. */
  costoTotal: string;
  modoResponsable: ModoResponsable;
  tutorElegidoId: string;
  tutorNombre: string;
  tutorTelefono: string;
}

/**
 * Lo que falta para poder abrir el caso, en el orden en que aparece en el
 * formulario y dicho para quien lo llena. Lista vacía = se puede guardar.
 *
 * Un paciente en observación no lleva plan: de él solo se pide el diagnóstico
 * y la fecha de su próxima revisión.
 */
export function faltantesDelAlta(e: EstadoAlta): string[] {
  const faltan: string[] = [];

  if (e.necesitaDiagnostico) {
    const largo = e.resumen.trim().length;
    if (largo < MIN_RESUMEN) {
      faltan.push(`el resumen clínico (lleva ${largo} de ${MIN_RESUMEN} caracteres)`);
    }
    if (e.enObservacion && e.proximaRevision === "") {
      faltan.push("la fecha de la próxima revisión");
    }
  }
  if (e.enObservacion) return faltan;

  if (leerCostoTotal(e.costoTotal) === null) {
    faltan.push(e.costoTotal.trim() === "" ? "el costo del tratamiento" : "un costo del tratamiento válido (mayor que cero)");
  }
  const retencion = e.retencion.trim().length;
  if (retencion < MIN_RETENCION) {
    faltan.push(`el plan de retención (lleva ${retencion} de ${MIN_RETENCION} caracteres)`);
  }
  if (e.modoResponsable === "existing" && e.tutorElegidoId === "") {
    faltan.push("elegir al tutor responsable del pago (o marcar «Sin definir»)");
  }
  if (e.modoResponsable === "new") {
    if (e.tutorNombre.trim().length < MIN_NOMBRE_TUTOR) faltan.push("el nombre del responsable del pago");
    if (!telefonoTutorValido(e.tutorTelefono)) {
      faltan.push(`el teléfono del responsable del pago (mínimo ${MIN_TELEFONO_TUTOR} cifras)`);
    }
  }
  return faltan;
}

/** «Para abrir el caso falta: a, b y c.» — la línea que va junto al botón. */
export function fraseDeFaltantes(faltan: string[], enObservacion: boolean): string | null {
  if (faltan.length === 0) return null;
  const lista =
    faltan.length === 1 ? faltan[0] : `${faltan.slice(0, -1).join("; ")} y ${faltan[faltan.length - 1]}`;
  return `${enObservacion ? "Para guardarlo en observación" : "Para abrir el caso"} falta: ${lista}.`;
}

// ── (b) Referente nuevo ─────────────────────────────────────────────────

export interface ReferenteNuevo {
  fullName: string;
  clinicName: string;
  phone: string;
}

/** Los mismos topes que `contactSchema` (src/app/actions/clinical-shared/referrals.ts). */
export const MAX_NOMBRE_REFERENTE = 120;
export const MAX_CLINICA_REFERENTE = 120;
export const MAX_TELEFONO_REFERENTE = 40;

/** Por qué no se puede guardar este referente; `null` si se puede. */
export function errorReferenteNuevo(r: ReferenteNuevo): string | null {
  const nombre = r.fullName.trim();
  if (nombre.length < 2) return "Escribe el nombre de quien lo refirió.";
  if (nombre.length > MAX_NOMBRE_REFERENTE) return `El nombre es demasiado largo (máximo ${MAX_NOMBRE_REFERENTE} caracteres).`;
  if (r.clinicName.trim().length > MAX_CLINICA_REFERENTE) return `El consultorio es demasiado largo (máximo ${MAX_CLINICA_REFERENTE} caracteres).`;
  if (r.phone.trim().length > MAX_TELEFONO_REFERENTE) return `El teléfono es demasiado largo (máximo ${MAX_TELEFONO_REFERENTE} caracteres).`;
  return null;
}

/** Lo que se manda a guardar: sin espacios sobrantes y con `null` en lo que quedó vacío. */
export function referenteParaGuardar(r: ReferenteNuevo): { fullName: string; clinicName: string | null; phone: string | null } {
  const limpio = (t: string) => t.replace(/\s+/g, " ").trim();
  return {
    fullName: limpio(r.fullName),
    clinicName: limpio(r.clinicName) || null,
    phone: limpio(r.phone) || null,
  };
}

/**
 * ¿Ya está en la lista alguien con ese nombre (sin mirar mayúsculas ni
 * acentos)? Para no guardar dos veces al mismo referente: se elige el que hay.
 */
export function referenteYaRegistrado<T extends { id: string; fullName: string }>(
  lista: readonly T[],
  nombre: string,
): T | null {
  const clave = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  const buscado = clave(nombre);
  if (buscado === "") return null;
  return lista.find((r) => clave(r.fullName) === buscado) ?? null;
}
