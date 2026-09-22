/**
 * EL CATÁLOGO DE FESTIVOS DE MÉXICO — WS1-T2.
 *
 * Módulo PURO: sin prisma, sin "server-only", sin `new Date()` escondido. Se
 * prueba sin base (`npm run test:agenda-bloqueos`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SE CALCULA, NO SE TECLEA
 *
 * La tentación es una lista de fechas escritas a mano. Esa lista caduca en
 * diciembre y entonces la pantalla de festivos sale vacía justo el año que
 * alguien la abre para cerrar la Navidad. Peor: «el primer lunes de febrero»
 * cae el 2 en 2026, el 1 en 2027 y el 7 en 2028, así que la lista escrita a
 * mano no solo caduca — mientras dura, miente tres de cada cuatro años.
 *
 * Aquí todo sale de la fecha: los lunes móviles con una cuenta de calendario
 * y los dos jueves/viernes de Semana Santa desde la Pascua (algoritmo
 * anónimo gregoriano, «de Gauss»).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 `oficial` Y `porDefecto` NO SON LO MISMO, y la diferencia es de Rafael
 *
 *   · `oficial`    — lo dice la Ley Federal del Trabajo, art. 74. Es un
 *                    hecho, no una preferencia.
 *   · `porDefecto` — si la casilla viene MARCADA cuando se abre la pantalla.
 *
 * Los de costumbre (Jueves y Viernes Santo, Día de Muertos, la Virgen, el 24
 * y el 31) salen con `porDefecto: false` A PROPÓSITO: muchas clínicas
 * dentales abren esos días. Se PROPONEN, para que nadie tenga que acordarse
 * de ellos, pero marcarlos es una decisión de la clínica. Un catálogo que
 * llega con el 24 de diciembre premarcado le cierra la agenda a quien ese día
 * trabaja media jornada, y se entera cuando el paciente llama.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Un festivo del catálogo de un año. */
export interface FestivoMX {
  /**
   * El sello estable del festivo: `MX-2026-NAVIDAD`. Es lo que se guarda en
   * `AgendaBlock.holidayKey` y lo que permite saber cuáles del año YA están
   * puestos SIN adivinarlo comparando fechas — que es justo lo que se rompe
   * cuando alguien mueve el bloqueo una hora o lo pone como medio día.
   */
  key: string;
  nombre: string;
  /** `YYYY-MM-DD` en el calendario civil de México. */
  fecha: string;
  /** Lo marca la Ley Federal del Trabajo, art. 74. */
  oficial: boolean;
  /** La casilla llega marcada al abrir la pantalla. Ver la cabecera. */
  porDefecto: boolean;
}

/** El año mínimo y el máximo que el catálogo acepta. Cinturón contra el dedazo. */
export const FESTIVOS_ANIO_MIN = 2000;
export const FESTIVOS_ANIO_MAX = 2100;

function dosDig(n: number): string {
  return String(n).padStart(2, "0");
}

function fechaISO(anio: number, mes: number, dia: number): string {
  return `${anio}-${dosDig(mes)}-${dosDig(dia)}`;
}

/**
 * El día del mes en que cae el n-ésimo `diaSemana` de un mes.
 *
 * `diaSemana` en convención JS (0 = domingo … 6 = sábado), que es la que
 * devuelve `getUTCDay`. Se cuenta en UTC a propósito: es aritmética de
 * calendario pura, sin husos ni horarios de verano de por medio. El resultado
 * es un número de día, no un instante, así que no hay nada que convertir.
 *
 * Ejemplo: el primer lunes de febrero de 2026 → `nEsimoDiaSemana(2026, 2, 1, 1)` → 2.
 */
export function nEsimoDiaSemana(
  anio: number,
  mes: number,
  diaSemana: number,
  n: number,
): number {
  const primero = new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();
  // Cuántos días hay que avanzar desde el día 1 hasta el primer `diaSemana`.
  const desplazamiento = (diaSemana - primero + 7) % 7;
  return 1 + desplazamiento + (n - 1) * 7;
}

/**
 * EL DOMINGO DE PASCUA del año, en el calendario gregoriano.
 *
 * Algoritmo anónimo gregoriano (el que suele citarse como «de Gauss»). No es
 * una aproximación: da la fecha exacta para cualquier año del calendario
 * gregoriano, y de él cuelgan el Jueves y el Viernes Santo, que son los dos
 * únicos festivos móviles de la lista que no son «el n-ésimo lunes de».
 *
 * Comprobación que vale la pena tener a mano: **Pascua 2026 = 5 de abril**, y
 * por tanto Jueves Santo = 2 de abril y Viernes Santo = 3 de abril.
 */
export function domingoDePascua(anio: number): { mes: number; dia: number } {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzo, 4 = abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

/** `YYYY-MM-DD` desplazado `dias` días. Aritmética de calendario en UTC. */
function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + dias);
  return fechaISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * ¿Este año toca TRANSMISIÓN DEL PODER EJECUTIVO?
 *
 * El art. 74 marca el 1 de diciembre como descanso obligatorio «cada seis
 * años, cuando corresponda a la transmisión del Poder Ejecutivo Federal». La
 * toma de posesión de 2024 fija la serie: 2024, 2030, 2036… El PRÓXIMO es
 * **2030**, y por eso un catálogo de 2026 NO lleva el 1 de diciembre.
 */
export function esAnioDeTransmision(anio: number): boolean {
  return anio >= 2024 && (anio - 2024) % 6 === 0;
}

/**
 * EL CATÁLOGO DEL AÑO, ordenado por fecha.
 *
 * Los ocho primeros son los del art. 74 (`oficial: true`, `porDefecto: true`);
 * los cinco de costumbre salen `oficial: false, porDefecto: false`. La razón
 * de esa asimetría está en la cabecera del archivo y es una decisión de
 * producto, no un descuido.
 */
export function festivosDeMexico(anio: number): FestivoMX[] {
  if (!Number.isInteger(anio) || anio < FESTIVOS_ANIO_MIN || anio > FESTIVOS_ANIO_MAX) {
    throw new Error(
      `El año ${anio} está fuera del catálogo (${FESTIVOS_ANIO_MIN}–${FESTIVOS_ANIO_MAX}).`,
    );
  }

  const oficial = (clave: string, nombre: string, fecha: string): FestivoMX => ({
    key: `MX-${anio}-${clave}`,
    nombre,
    fecha,
    oficial: true,
    porDefecto: true,
  });
  const costumbre = (clave: string, nombre: string, fecha: string): FestivoMX => ({
    key: `MX-${anio}-${clave}`,
    nombre,
    fecha,
    oficial: false,
    porDefecto: false,
  });

  // Semana Santa: los dos días cuelgan de la Pascua, no del calendario fijo.
  const pascua = domingoDePascua(anio);
  const domingoPascua = fechaISO(anio, pascua.mes, pascua.dia);

  const lista: FestivoMX[] = [
    // ── Art. 74 de la Ley Federal del Trabajo ─────────────────────────────
    oficial("ANIO-NUEVO", "Año Nuevo", fechaISO(anio, 1, 1)),
    oficial(
      "CONSTITUCION",
      "Día de la Constitución",
      // Primer LUNES de febrero (no el 5 de febrero: se recorre desde 2006).
      fechaISO(anio, 2, nEsimoDiaSemana(anio, 2, 1, 1)),
    ),
    oficial(
      "BENITO-JUAREZ",
      "Natalicio de Benito Juárez",
      // Tercer LUNES de marzo (no el 21 de marzo, por el mismo motivo).
      fechaISO(anio, 3, nEsimoDiaSemana(anio, 3, 1, 3)),
    ),
    oficial("TRABAJO", "Día del Trabajo", fechaISO(anio, 5, 1)),
    oficial("INDEPENDENCIA", "Independencia de México", fechaISO(anio, 9, 16)),
    oficial(
      "REVOLUCION",
      "Día de la Revolución",
      // Tercer LUNES de noviembre (no el 20 de noviembre).
      fechaISO(anio, 11, nEsimoDiaSemana(anio, 11, 1, 3)),
    ),
    oficial("NAVIDAD", "Navidad", fechaISO(anio, 12, 25)),

    // ── De costumbre: se proponen, NO vienen marcados ─────────────────────
    costumbre("JUEVES-SANTO", "Jueves Santo", sumarDias(domingoPascua, -3)),
    costumbre("VIERNES-SANTO", "Viernes Santo", sumarDias(domingoPascua, -2)),
    costumbre("DIA-DE-MUERTOS", "Día de Muertos", fechaISO(anio, 11, 2)),
    costumbre("GUADALUPE", "Día de la Virgen de Guadalupe", fechaISO(anio, 12, 12)),
    costumbre("NOCHEBUENA", "Nochebuena", fechaISO(anio, 12, 24)),
    costumbre("FIN-DE-ANIO", "Fin de año", fechaISO(anio, 12, 31)),
  ];

  // El 1 de diciembre SOLO los años de transmisión del Ejecutivo. Ver arriba.
  if (esAnioDeTransmision(anio)) {
    lista.push(
      oficial(
        "TRANSMISION-EJECUTIVO",
        "Transmisión del Poder Ejecutivo Federal",
        fechaISO(anio, 12, 1),
      ),
    );
  }

  return lista.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

/** El festivo del catálogo con esa `key`, o `null`. */
export function festivoPorKey(anio: number, key: string): FestivoMX | null {
  return festivosDeMexico(anio).find((f) => f.key === key) ?? null;
}
