// ─────────────────────────────────────────────────────────────────────────────
// Los rótulos del avance del caso de ortodoncia (auditoría de uso, C-67).
//
// En un caso de 4 meses la tarjeta decía «Asistencia 100 % · 3 de 3 controles ·
// 6 meses» y, con los 4 de 4 controles hechos, «Avance 75 %». Las cifras eran
// ciertas, pero se leían como contradicciones:
//   · «6 meses» es la VENTANA en que se mide la asistencia, no la duración del
//     caso → «últimos 6 meses».
//   · el 75 % es el TIEMPO transcurrido (mes 3 de 4), no los controles → la barra
//     se llama «Tiempo de tratamiento» y dice «Mes 3 de 4».
//
// PURO: sin React.
// ─────────────────────────────────────────────────────────────────────────────

export interface AsistenciaDelCaso {
  pct: number | null;
  asistio: number;
  falto: number;
}

/** El renglón bajo «Asistencia»: siempre dice que la ventana son los últimos 6 meses. */
export function subtituloDeAsistencia(a: AsistenciaDelCaso | null | undefined): string {
  if (!a) return "últimos 6 meses";
  if (a.pct === null) return "sin controles registrados";
  if (a.falto === 0) return `${a.asistio} de ${a.asistio} controles · últimos 6 meses`;
  return `faltó a ${a.falto} de ${a.asistio + a.falto} · últimos 6 meses`;
}

/** Título y cifra de la barra de tiempo: «Tiempo de tratamiento» · «Mes 3 de 4 · 75 %». */
export function rotuloDeTiempo(mesActual: number, mesesTotales: number): { titulo: string; cifra: string; pct: number } {
  const pct = mesesTotales > 0 ? Math.min(100, Math.round((mesActual / mesesTotales) * 100)) : 0;
  return { titulo: "Tiempo de tratamiento", cifra: `Mes ${mesActual} de ${mesesTotales} · ${pct} %`, pct };
}
