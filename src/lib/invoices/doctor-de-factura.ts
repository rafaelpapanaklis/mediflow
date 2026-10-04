// Con qué DOCTOR nace una factura que nadie le asignó a mano (ws1-t2, falla F10 de la
// auditoría BEVADENT: «95 % de lo facturado aparece como Sin doctor» en Finanzas → Por doctor).
//
// Hasta aquí la factura solo llevaba doctor si alguien lo elegía en «Nueva factura»: «Cobrar
// hoy», la factura de una cita (from-appointment, anticipo, controles de ortodoncia) y la
// borrador de la consulta nacían SIEMPRE sin doctor, aunque la cita dijera quién atendió.
//
// La regla, en orden (la primera que da UN doctor gana):
//   1. el que se eligió a mano (lo valida quien llama: de la clínica y que atienda);
//      `null` explícito = «Sin asignar» elegido a propósito → se respeta, no se hereda;
//   2. el doctor de la CITA ligada a la factura;
//   2b. el doctor que firmó la nota clínica de la que sale la factura (borrador de la consulta);
//   3. el doctor de las citas de HOY del paciente (día de la clínica, sin canceladas ni
//      no-asistió), solo si todas son del mismo doctor;
//   4. el doctor de sus PLANES activos (plan de tratamiento ACTIVO y caso de ortodoncia
//      vivo con tratante), solo si todos son del mismo doctor;
//   5. su doctor de CABECERA (`Patient.primaryDoctorId`) — auditoría de uso C-07
//      (4-oct-2026, decisión de Rafael por defecto): «Cobrar hoy» y «Nueva factura» de un
//      paciente sin cita hoy ni plan nacían «Sin doctor» aunque tuviera doctor asignado, y
//      su cobro no entraba a la comisión de nadie.
// Si no hay pista o hay dos doctores distintos, nace sin doctor, como hoy: mejor vacío que un
// doctor equivocado en el corte por doctor (mismo criterio que lib/quotes/doctor-de-la-factura).
// Nunca se cae a «quien pulsa Guardar»: quien factura casi nunca es quien atendió.
//
// PURO: sin Prisma (lo usan la ruta, el editor y las pruebas). Las lecturas viven en
// doctor-de-factura.server.ts.

export type OrigenDoctorFactura = "elegido" | "sin_asignar" | "cita" | "nota" | "cita_de_hoy" | "plan" | "cabecera" | "ninguno";

export interface PistasDoctorFactura {
  /** Doctor de la cita ligada a la factura. */
  cita?: string | null;
  /** Doctor de la nota clínica de la que sale la factura. */
  nota?: string | null;
  /** Doctores de las citas vivas de HOY del paciente (puede repetirse). */
  citasDeHoy?: Array<string | null | undefined>;
  /** Doctores de sus planes activos (dental y ortodoncia). */
  planes?: Array<string | null | undefined>;
  /** C-07: su doctor de cabecera. */
  cabecera?: string | null;
}

export interface DoctorDeFactura {
  doctorId: string | null;
  origen: OrigenDoctorFactura;
}

/** El único doctor de la lista (ignorando vacíos y repetidos); `null` si no hay o hay más de uno. */
export function unicoDoctor(ids: Array<string | null | undefined> | undefined): string | null {
  const distintos = new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.trim() !== ""));
  return distintos.size === 1 ? [...distintos][0] : null;
}

/**
 * Qué pidió el cuerpo de la petición:
 *   · texto no vacío → ese doctor («elegido»);
 *   · `null`         → «Sin asignar» a propósito;
 *   · ausente o ""   → que se herede (`undefined`).
 */
export function doctorPedido(valor: unknown): string | null | undefined {
  if (valor === null) return null;
  if (typeof valor === "string" && valor.trim()) return valor.trim();
  return undefined;
}

/** La regla de arriba, sobre pistas ya leídas. */
export function elegirDoctorDeFactura(pedido: string | null | undefined, pistas: PistasDoctorFactura): DoctorDeFactura {
  if (typeof pedido === "string" && pedido) return { doctorId: pedido, origen: "elegido" };
  if (pedido === null) return { doctorId: null, origen: "sin_asignar" };
  if (pistas.cita) return { doctorId: pistas.cita, origen: "cita" };
  if (pistas.nota) return { doctorId: pistas.nota, origen: "nota" };
  const deHoy = unicoDoctor(pistas.citasDeHoy);
  if (deHoy) return { doctorId: deHoy, origen: "cita_de_hoy" };
  const delPlan = unicoDoctor(pistas.planes);
  if (delPlan) return { doctorId: delPlan, origen: "plan" };
  if (pistas.cabecera) return { doctorId: pistas.cabecera, origen: "cabecera" };
  return { doctorId: null, origen: "ninguno" };
}

/** Día siguiente de un «AAAA-MM-DD» (calendario, sin zona). */
export function diaSiguiente(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
