/**
 * «El panel, en vivo»: las funciones que se enseñan con vídeo del panel REAL
 * (clínica de prueba, nombres cambiados solo en pantalla) y la lista real de
 * secciones del menú de Administración.
 *
 * Los vídeos viven en public/landing/videos/<id>.mp4 con su primer frame en
 * <id>.webp. Se grabaron el 25-sep-2026 contra el build de producción de la
 * misma rama (ver grabacion/ del trabajo).
 */

export interface FuncionVideo {
  id: "hoy" | "agenda" | "pacientes" | "odontograma" | "sabina" | "administracion";
  /** Ícono de Material Symbols Rounded (fuente de ligaduras del menú del panel). */
  icono: string;
  nombre: string;
  linea: string;
  /** Lo que se ve en el vídeo: sirve de alt/aria y de texto del reporte. */
  ve: string;
  /** Etiqueta visible en la esquina de la tarjeta (Rafael, ajuste 3: «+20 funciones» en Administración). */
  etiqueta?: string;
}

export const FUNCIONES_VIDEO: FuncionVideo[] = [
  { id: "hoy", icono: "home", nombre: "Hoy", linea: "Ingresos, citas, ocupación y no-shows del día o del mes.", ve: "El tablero Hoy: ingresos del mes, citas, ocupación y no-shows; cambio de periodo Hoy/Mes; próximas citas y desempeño del equipo." },
  { id: "agenda", icono: "calendar_month", nombre: "Agenda", linea: "Por doctor y sillón, con la línea de «ahora» y el detalle de cada cita.", ve: "La agenda en vista Día con los tres doctores, la vista Semana y el detalle de una cita con su flujo (confirmada → registrado → en consulta)." },
  { id: "pacientes", icono: "group", nombre: "Pacientes", linea: "Lista con saldo a la vista, filtro «Con deuda» y búsqueda al instante.", ve: "La lista de pacientes, el filtro «Con deuda», la búsqueda de «Arturo» y su ficha con el botón de cobrar el saldo." },
  { id: "odontograma", icono: "dentistry", nombre: "Odontograma 3D", linea: "Hallazgos diente por diente y cada pieza en 3D, cara por cara.", ve: "El odontograma con hallazgos, el diente 26 abierto en Vista 3D, girándolo y resaltando sus caras." },
  { id: "sabina", icono: "auto_awesome", nombre: "Sabina", linea: "Pregúntale por tu clínica; contesta con cifras y con lo que miró.", ve: "Sabina: se teclea «¿Cuánto me deben este mes?» y responde con las cifras reales y el «Miré: …» debajo." },
  { id: "administracion", icono: "apps", nombre: "Administración", linea: "Finanzas, equipo, inventario, página web, WhatsApp, configuración… todo el sistema.", ve: "El menú de Administración recorrido entero y tres de sus secciones: Analítica, Equipo y Configuración.", etiqueta: "+20 funciones" },
];

export const PANEL_VIVO_COPY = {
  eyebrow: "Así se usa",
  title: "El panel, en vivo: tal como lo vas a usar",
  subtitle: "Grabado del panel real. Toca una función y mira cómo se trabaja con ella; el ratón se mueve solo.",
};
