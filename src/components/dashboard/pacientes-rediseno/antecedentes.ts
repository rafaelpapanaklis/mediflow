import { RISK_FLAG_LABELS } from "@/lib/health-questionnaire";
import { construirAlertas, normalizar } from "./alertas";

/**
 * Los antecedentes médicos del paciente, ya escritos, para ENSEÑARLOS en
 * «Nueva consulta» en vez de volver a pedirlos.
 *
 * Hoy ese formulario tiene un cuadro de texto vacío, «Antecedentes médicos
 * relevantes», con el ejemplo «Diabetes, hipertensión, medicamentos
 * actuales…» — justo lo que el Cuestionario de salud ya guardó campo por
 * campo y lo que la cabecera ya pinta en rojo. Se captura dos veces lo mismo
 * y las dos versiones pueden discrepar.
 *
 * Esto no consulta nada nuevo: arma el resumen con lo que la ficha ya tiene
 * en la mano (banderas del cuestionario vigente + los campos del paciente).
 */

export interface EntradaAntecedentes {
  riskFlags: string[];
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  bloodType?: string | null;
}

export interface BloqueAntecedentes {
  id: "riesgo" | "alergias" | "padecimientos" | "medicacion" | "sangre";
  labelKey: string;
  valores: string[];
  /** Los dos primeros son de seguridad: se pintan en rojo. */
  critico: boolean;
}

function limpiar(lista: string[] | null | undefined): string[] {
  const vistos: Record<string, true> = {};
  const salida: string[] = [];
  (lista || []).forEach((texto) => {
    const v = (texto == null ? "" : String(texto)).trim();
    const n = normalizar(v);
    if (!n || vistos[n]) return;
    vistos[n] = true;
    salida.push(v);
  });
  return salida;
}

/**
 * Devuelve solo los bloques que tienen algo que decir. Un array vacío
 * significa «de este paciente no sabemos nada todavía», y ahí la pantalla
 * manda al Cuestionario de salud en vez de ofrecer un cuadro en blanco.
 */
export function construirAntecedentes(entrada: EntradaAntecedentes): BloqueAntecedentes[] {
  const bloques: BloqueAntecedentes[] = [];

  // Se reparte el MISMO resultado ya limpio de repetidos que pinta la cabecera
  // (`construirAlertas`): si aquí se listaran los campos del paciente en crudo,
  // esta tarjeta volvería a decir «Alergia a penicilina» arriba y «Penicilina»
  // dos líneas más abajo — el defecto que se viene a quitar, movido de sitio.
  const chips = construirAlertas({
    riskFlags: entrada.riskFlags || [],
    allergies: entrada.allergies || [],
    chronicConditions: entrada.chronicConditions || [],
    currentMedications: entrada.currentMedications || [],
  });

  const riesgo = limpiar((entrada.riskFlags || []).map((f) => RISK_FLAG_LABELS[f] ?? f));
  if (riesgo.length) {
    bloques.push({ id: "riesgo", labelKey: "pacientesRediseno.antecedentes.riesgo", valores: riesgo, critico: true });
  }

  const alergias = limpiar(
    chips.filter((c) => c.clave.indexOf("alergia-") === 0).map((c) => c.texto),
  );
  if (alergias.length) {
    bloques.push({ id: "alergias", labelKey: "pacientesRediseno.antecedentes.alergias", valores: alergias, critico: true });
  }

  const padecimientos = limpiar(
    chips.filter((c) => c.clave.indexOf("cronica-") === 0).map((c) => c.texto),
  );
  if (padecimientos.length) {
    bloques.push({ id: "padecimientos", labelKey: "pacientesRediseno.antecedentes.padecimientos", valores: padecimientos, critico: false });
  }

  const medicacion = limpiar(
    chips.filter((c) => c.clave.indexOf("medicamento-") === 0).map((c) => c.texto),
  );
  if (medicacion.length) {
    bloques.push({ id: "medicacion", labelKey: "pacientesRediseno.antecedentes.medicacion", valores: medicacion, critico: false });
  }

  const sangre = (entrada.bloodType ?? "").trim();
  if (sangre) {
    bloques.push({ id: "sangre", labelKey: "pacientesRediseno.antecedentes.sangre", valores: [sangre], critico: false });
  }

  return bloques;
}
