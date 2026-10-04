// N-31 (segunda auditoría): la caché del cliente de `precargarPestanaOrto`. La pestaña la arranca al pintarse (antes
// de que los componentes monten y pidan lo suyo en fila) y cada componente, al montarse, usa `conPrecarga`: si la
// precarga trae su dato (de este caso, de hace menos de 30 s), lo usa; si no —o si la precarga falló—, llama a su
// acción como siempre. Las RECARGAS (después de cobrar, firmar…) no pasan por aquí: piden el dato fresco.

import { precargarPestanaOrto } from "@/app/actions/orthodontics/precargarPestana";

const VIGENCIA_MS = 30_000;

interface Entrada {
  clave: string;
  at: number;
  datos: Promise<Record<string, unknown> | null>;
  /**
   * Cuándo llegó la precarga. Sus datos sirven hasta 5 s DESPUÉS de llegar (lo que tardan en montar las secciones,
   * dos veces en desarrollo por el modo estricto de React); una recarga posterior —tras cobrar, firmar…— va fresca.
   */
  llegoEn: number | null;
}

const USO_TRAS_LLEGAR_MS = 5_000;

let actual: Entrada | null = null;

function claveDe(a: { patientId: string; treatmentPlanId?: string | null; diagnosisId?: string | null }): string {
  return `${a.patientId}|${a.treatmentPlanId ?? ""}|${a.diagnosisId ?? ""}`;
}

/** Arranca la precarga de este caso (una sola vez cada 30 s por caso). Seguro de llamar en el render. */
export function iniciarPrecarga(a: { patientId: string; treatmentPlanId?: string | null; diagnosisId?: string | null }): void {
  if (typeof window === "undefined" || !a.patientId) return;
  const clave = claveDe(a);
  if (actual && actual.clave === clave && Date.now() - actual.at < VIGENCIA_MS) return;
  const entrada: Entrada = { clave, at: Date.now(), datos: Promise.resolve(null), llegoEn: null };
  entrada.datos = precargarPestanaOrto(a)
    .catch(() => null)
    .then((d) => {
      entrada.llegoEn = Date.now();
      return d;
    });
  actual = entrada;
}

/**
 * El dato `nombre` de la precarga del caso `id` (plan, paciente o diagnóstico, según el dato), o `llamar()` si no
 * está. `llamar` es la acción de siempre: el resultado tiene la misma forma.
 */
export function conPrecarga<T>(nombre: string, id: string | null | undefined, llamar: () => Promise<T>): Promise<T> {
  const e = actual;
  if (!e || !id || Date.now() - e.at >= VIGENCIA_MS || !e.clave.split("|").includes(id)) return llamar();
  if (e.llegoEn !== null && Date.now() - e.llegoEn > USO_TRAS_LLEGAR_MS) return llamar();
  return e.datos.then((d) => (d && nombre in d ? (d[nombre] as T) : llamar()));
}
