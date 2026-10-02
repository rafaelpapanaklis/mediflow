// ws1-t8 (revisión en panel.108 de ws1-t9, fallo 6): lo escrito en «Nueva consulta → Dental general» se perdía
// al cambiar el tipo a «Ortodoncia»: la consulta de ortodoncia ES la hoja de control y la hoja abría con su nota
// precargada, sin nada de lo que el doctor ya había tecleado (seguía solo en el borrador de sesión del
// formulario dental, que nadie miraba).
//
// Ahora la nota del borrador dental (S/O/A/P) pasa a la hoja, unida a la precarga con la misma regla con la
// que la firma adopta el borrador de la consulta (`fusionarTexto`: lo del doctor primero, sin repetir). El
// borrador dental se borra solo cuando la hoja se guarda o se firma: si el doctor cierra la hoja sin guardar,
// lo escrito sigue en «Dental general».
import { fusionarTexto } from "@/lib/orthodontics/hoja-de-control-reglas";

export interface NotaSOAP {
  s: string;
  o: string;
  a: string;
  p: string;
}

/** La misma clave con la que DentalForm guarda su borrador en sessionStorage. */
export function claveBorradorDental(patientId: string): string {
  return `dc:dental-draft:${patientId}`;
}

/** La nota (S/O/A/P) de un borrador dental guardado; null si no hay o no tiene texto. */
export function notaDelBorradorDental(raw: string | null | undefined): NotaSOAP | null {
  if (!raw) return null;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  const borrador = d as { v?: number; form?: Record<string, unknown> } | null;
  if (!borrador || borrador.v !== 1 || !borrador.form) return null;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const nota = {
    s: texto(borrador.form.subjective),
    o: texto(borrador.form.objective),
    a: texto(borrador.form.assessment),
    p: texto(borrador.form.plan),
  };
  return nota.s || nota.o || nota.a || nota.p ? nota : null;
}

export function leerNotaDelBorradorDental(patientId: string): NotaSOAP | null {
  try {
    return notaDelBorradorDental(window.sessionStorage.getItem(claveBorradorDental(patientId)));
  } catch {
    return null;
  }
}

export function borrarBorradorDental(patientId: string): void {
  try {
    window.sessionStorage.removeItem(claveBorradorDental(patientId));
  } catch {
    // sin almacenamiento: no había borrador que borrar
  }
}

/** La nota con la que abre la hoja: lo escrito en la consulta primero y la precarga debajo, sin repetir. */
export function unirNotaDeLaConsulta(consulta: NotaSOAP, base: NotaSOAP | null): NotaSOAP {
  const b = base ?? { s: "", o: "", a: "", p: "" };
  return {
    s: fusionarTexto(consulta.s, b.s),
    o: fusionarTexto(consulta.o, b.o),
    a: fusionarTexto(consulta.a, b.a),
    p: fusionarTexto(consulta.p, b.p),
  };
}
