// H39 (revisión de lógica, ws1-t4): las fotos de cada control pisaban las del
// anterior porque la ficha reusaba SIEMPRE el primer set de etapa «CONTROL».
// T0/T1/T2 son singleton por plan (se reusan); CONTROL es un set por visita:
// solo se reusa el de HOY (para completar las vistas de la misma visita).
export interface SetDeFotoResumen {
  setId?: string;
  stage: string;
  date: string | null;
}

function diaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Devuelve el setId a reusar, o null si hay que crear un set nuevo. */
export function elegirSetParaFoto(
  sets: SetDeFotoResumen[],
  stage: string,
  hoy: Date = new Date(),
): string | null {
  const deLaEtapa = sets.filter((s) => s.stage === stage && s.setId);
  if (stage !== "CONTROL") return deLaEtapa[0]?.setId ?? null;
  const hoyStr = diaLocal(hoy);
  const deHoy = deLaEtapa.find((s) => s.date && diaLocal(new Date(s.date)) === hoyStr);
  return deHoy?.setId ?? null;
}
