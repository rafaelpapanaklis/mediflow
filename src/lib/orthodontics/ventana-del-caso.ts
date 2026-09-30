// Ortodoncia — la ventana única del caso (ws1-t12, decisión de Rafael, 29-sep-2026): «Abrir caso» es UNA ventana
// con dos pasos, Diagnóstico → Plan de tratamiento (con el cobro dentro), y «Editar» abre ESA MISMA ventana en el
// paso que toca: un solo formulario para crear y para editar. PURO: sin React ni Prisma; lo prueban los tests.
//
// Lo obligatorio para ABRIR el caso es la técnica y el doctor. Todo lo demás se puede dejar a medias: sin costo no
// se crea la factura («lo armo después»); sin retención, controles o aparatología el caso se abre igual y Tablero y
// Alertas lo listan como «incompleto» hasta que se complete.

import type { OrthoBillingMode } from "./billing-mode";
import { leerCostoTotal, MIN_NOMBRE_TUTOR, MIN_TELEFONO_TUTOR, telefonoTutorValido, type ModoResponsable } from "./alta-caso-formulario";
import { faltantesDelPlanDePago, planDePagoParaEnviar, type PlanDePagoAlAbrir } from "./cobro/plan-al-abrir";

export type PasoDeLaVentana = "diagnostico" | "plan";

/**
 * Lo que falta del PASO 1 (diagnóstico) para pasar al plan. El diagnóstico entero es opcional (el resumen también, sin
 * mínimo): solo un paciente en observación pide la fecha de revisión.
 */
export function faltantesDelDiagnostico(e: {
  necesitaDiagnostico: boolean;
  enObservacion: boolean;
  proximaRevision: string;
}): string[] {
  const faltan: string[] = [];
  if (!e.necesitaDiagnostico) return faltan;
  if (e.enObservacion && e.proximaRevision === "") faltan.push("la fecha de la próxima revisión");
  return faltan;
}

export interface EstadoDelPlanEnLaVentana {
  sinTecnica: boolean;
  /** Hay que elegir al doctor (nadie quedó propuesto y la base guarda ese dato). */
  sinDoctor: boolean;
  /** Lo que se escribió en «Costo total» (vacío = aún no). */
  costoTexto: string;
  modo: OrthoBillingMode;
  modoResponsable: ModoResponsable;
  tutorElegidoId: string;
  tutorNombre: string;
  tutorTelefono: string;
  /** El error de la parte del plan completo (rangos, FDI, fechas…), o null. */
  errorDelPlanCompleto: string | null;
  /** Solo editar, con factura: lo ya pagado. El costo nuevo no puede quedar por debajo. */
  yaPagado?: number;
  /** Casilla «Lo armo después» y lo escrito del plan de pago. */
  despues: boolean;
  puedeCobrar: boolean;
  precioColocacion: string;
  enganche: string;
  numPagos: string;
  primerPago: string;
  /** Editar con factura ya creada: enganche y pagos no se piden (se cambian en Cobro). */
  conFactura?: boolean;
}

export interface FaltantesDelPlan {
  /** Sin esto no se abre el caso: la técnica y el doctor. */
  obligatorios: string[];
  /** Algo que se escribió y no sirve: se dice qué corregir. Lo vacío NO es un problema. */
  correcciones: string[];
}

/** ¿Se va a crear la factura con este plan? (costo escrito y válido, con permiso de cobro y sin «después»). */
export function hayQueCrearLaFactura(e: Pick<EstadoDelPlanEnLaVentana, "modo" | "costoTexto" | "despues" | "puedeCobrar" | "precioColocacion" | "conFactura">): boolean {
  if (e.conFactura || !e.puedeCobrar || e.despues) return false;
  if (e.modo === "PAGO_POR_CONTROL") return e.precioColocacion.trim() !== "";
  return leerCostoTotal(e.costoTexto) !== null;
}

export function faltantesDelPlanCompleto(e: EstadoDelPlanEnLaVentana): FaltantesDelPlan {
  const obligatorios: string[] = [];
  if (e.sinTecnica) obligatorios.push("la técnica (la clínica no tiene ninguna activa: agrégala en Configuración → Técnicas y precios)");
  if (e.sinDoctor) obligatorios.push("el doctor tratante (elige quién lleva el caso)");

  const correcciones: string[] = [];
  const costo = leerCostoTotal(e.costoTexto);
  if (e.costoTexto.trim() !== "" && costo === null) correcciones.push("un costo válido (mayor que cero) o déjalo vacío para armarlo después");
  if (costo !== null && e.yaPagado !== undefined && e.yaPagado > 0 && costo + 0.005 < e.yaPagado) {
    correcciones.push(`un costo que no quede por debajo de lo ya pagado (${e.yaPagado.toLocaleString("es-MX", { style: "currency", currency: "MXN" })})`);
  }
  if (e.modoResponsable === "existing" && e.tutorElegidoId === "") correcciones.push("elegir al responsable del pago (o marcar «El paciente»)");
  if (e.modoResponsable === "new") {
    if (e.tutorNombre.trim().length < MIN_NOMBRE_TUTOR) correcciones.push("el nombre del responsable del pago");
    if (!telefonoTutorValido(e.tutorTelefono)) correcciones.push(`el teléfono del responsable del pago (mínimo ${MIN_TELEFONO_TUTOR} cifras)`);
  }
  if (e.errorDelPlanCompleto) correcciones.push(`el plan de tratamiento (${e.errorDelPlanCompleto.replace(/\.$/, "")})`);
  // Solo si se va a crear la factura: lo del plan de pago tiene que valer.
  if (hayQueCrearLaFactura(e)) {
    correcciones.push(...faltantesDelPlanDePago({ modo: e.modo, costoTotal: costo, precioColocacion: e.precioColocacion, enganche: e.enganche, numPagos: e.numPagos, primerPago: e.primerPago }));
  }
  return { obligatorios, correcciones };
}

/** «Para abrir el caso falta: la técnica y el doctor tratante. Corrige: …» */
export function fraseDeLoQueFalta(f: FaltantesDelPlan, modo: "crear" | "editar"): string | null {
  const lista = (xs: string[]) => (xs.length === 1 ? xs[0]! : `${xs.slice(0, -1).join("; ")} y ${xs[xs.length - 1]}`);
  const partes: string[] = [];
  if (f.obligatorios.length > 0) partes.push(`${modo === "crear" ? "Para abrir el caso" : "Para guardar"} falta: ${lista(f.obligatorios)}.`);
  if (f.correcciones.length > 0) partes.push(`Corrige: ${lista(f.correcciones)}.`);
  return partes.length > 0 ? partes.join(" ") : null;
}

/**
 * ¿Qué se manda a crear del cobro? `null` = sin factura (a medias): «lo armo después», sin permiso, o aún sin
 * costo. Lo hace `planDePagoParaEnviar` (las reglas de siempre) tras comprobar que hay un costo o una colocación.
 */
export function planDePagoAlAbrir(e: EstadoDelPlanEnLaVentana & { enObservacion: boolean }): PlanDePagoAlAbrir | null {
  if (!hayQueCrearLaFactura(e)) return null;
  return planDePagoParaEnviar({
    enObservacion: e.enObservacion,
    puedeCobrar: e.puedeCobrar,
    despues: e.despues,
    modo: e.modo,
    costoTotal: leerCostoTotal(e.costoTexto),
    precioColocacion: e.precioColocacion,
    enganche: e.enganche,
    numPagos: e.numPagos,
    primerPago: e.primerPago,
  });
}

/** Lo que se dice bajo el botón cuando no falta nada, según lo que pasará con el cobro. */
export function notaDelCobro(e: { enObservacion: boolean; puedeCobrar: boolean; despues: boolean; conFactura: boolean; seCreaLaFactura: boolean; modo: "crear" | "editar" }): string {
  if (e.enObservacion) return "Queda dentro de la ficha del paciente";
  if (e.conFactura) return "Los cambios quedan en el plan y en su factura";
  if (!e.puedeCobrar) return "Recepción armará el plan de pago";
  if (e.despues) return "El plan de pago queda pendiente: se arma en Cobro";
  if (e.seCreaLaFactura) return "Se creará la factura del tratamiento con este plan";
  return e.modo === "crear" ? "Sin costo todavía: el caso se abre sin factura y la armas en Cobro" : "Sin costo todavía: la factura se arma en Cobro";
}

/** El costo que se guarda en el caso: lo escrito, o 0 si aún no hay («lo armo después»). */
export function costoParaGuardar(costoTexto: string): number {
  return leerCostoTotal(costoTexto) ?? 0;
}
