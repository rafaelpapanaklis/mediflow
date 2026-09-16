/**
 * `comparar_sedes` — «¿cómo va Altabrisa contra la otra?».
 *
 * ── LO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTE ARCHIVO ────────────────
 * Es la ÚNICA herramienta del catálogo que mira más de una clínica. Todo lo que
 * la hace segura está en `../sedes.ts`, no aquí: quién puede ver qué sede se
 * decide allí, en un solo sitio, a partir de la sesión. Aquí solo se pintan
 * números. Lee ese archivo entero antes de cambiar nada de esto.
 *
 * Las dos cosas que este archivo sí tiene que respetar:
 *
 *  1. 🔴 SUS PARÁMETROS NO NOMBRAN NINGUNA SEDE, y el esquema es `.strict()`:
 *     si el modelo se inventa un `sede`, un `sedeId` o un `sucursal`, la llamada
 *     se RECHAZA con un error que lo dice, en vez de colarse. (Los `clinicId` y
 *     compañía ya los borra `sanearArgumentos` del motor antes de llegar aquí;
 *     el `.strict()` cierra el resto del alfabeto.) No es que el parámetro se
 *     valide: es que el parámetro no existe y decirlo es más barato que
 *     defenderlo.
 *
 *  2. 🔴 NINGUNA CONSULTA SE ESCRIBE AQUÍ. Cada número sale de la herramienta
 *     que ya lo calculaba para una clínica (`ingresos_por_periodo`, `ausencias`,
 *     `pacientes_nuevos`, `pacientes_con_deuda`, `agenda_ocupacion`), llamada
 *     con el ctx de esa sede. Reescribir sus `where` habría sido abrir cinco
 *     sitios nuevos donde olvidar el `clinicId`, y además haría que Sabina y la
 *     pantalla dijeran números distintos.
 *
 * ── EL PERMISO, SEDE POR SEDE ─────────────────────────────────────────
 * Ser ADMIN en Altabrisa no da nada en Centro. Cada sede se gatea con SU ctx
 * —su rol, su override, su recorte de Sabina— usando el MISMO `tienePermiso`
 * que el resto del catálogo. Y lo que falta se DICE (regla 3 del contrato):
 * viaja en `omitidas`, sede por sede, y sale en el `resumen`. Enseñar «Centro:
 * 95 citas» callando que de Altabrisa no se pudo ver el dinero convierte la
 * comparación en una mentira sin decir una frase falsa.
 *
 * La key de la herramienta es `today.view`, por el mismo motivo que
 * `resumen_clinica`: es una foto compuesta, la tienen por default todos los
 * roles, y cada trozo se vuelve a gatear con su propia key. Sin ella, ni se
 * lee una fila.
 *
 * ── EL PERIODO ES EL MISMO PARA TODAS ─────────────────────────────────
 * Los días de calendario (`desde`/`hasta`) se resuelven UNA vez, en la zona de
 * la sede activa, y se le pasan iguales a todas. Cada sede los convierte a su
 * propia ventana UTC con su propia zona, que es lo correcto: «septiembre» en
 * Cancún y «septiembre» en Ciudad de México son los mismos días naturales, no
 * los mismos instantes.
 */

import { z } from "zod";
import { definirHerramienta, pct, pesos, plural, tienePermiso } from "./base";
import { agendaOcupacion } from "./agenda-ocupacion";
import { ausencias } from "./ausencias";
import { ingresosPorPeriodo } from "./ingresos-por-periodo";
import { pacientesConDeuda } from "./pacientes-con-deuda";
import { pacientesNuevos } from "./pacientes-nuevos";
import { esquemaFecha, resolverRango } from "./fechas";
import { sedesVisibles, type SedeVisible } from "../sedes";
import { causaSinPermiso, type CausaSinPermiso } from "../permisos-sabina";
import { fraseSinPermiso } from "../engine-core";
import type { PermissionKey, SabinaCtx } from "../tipos";

/**
 * Qué se compara. Es UN parámetro en vez de seis herramientas: los esquemas de
 * todas viajan en cada llamada al modelo, se usen o no (regla 2 del contrato),
 * y seis herramientas que se diferencian en qué columna traen son seis veces el
 * mismo coste fijo. Además ahorra base: `todo` ya son ~13 consultas por sede.
 */
const METRICAS = ["todo", "dinero", "citas", "pacientes", "ocupacion"] as const;
type Metrica = (typeof METRICAS)[number];

/**
 * 🔴 SIN NINGÚN PARÁMETRO QUE NOMBRE UNA SEDE, y `.strict()`: cualquier clave
 * que no esté aquí —`sede`, `sucursal`, `clinica`, lo que el modelo invente—
 * tumba la llamada con `parametros_invalidos` en vez de ejecutarse.
 */
const parametros = z
  .object({
    metrica: z.enum(METRICAS).optional(),
    desde: esquemaFecha.optional(),
    hasta: esquemaFecha.optional(),
  })
  .strict();

export type ParamsComparar = z.infer<typeof parametros>;

/** Una parte que no se pudo dar de UNA sede, y por qué. Nunca se calla. */
export interface OmitidaEnSede {
  seccion: string;
  permiso: PermissionKey;
  /** Solo si NO es «el usuario no lo tiene»: cambia la frase, no lo que se omite. */
  causa?: Exclude<CausaSinPermiso, "usuario">;
}

export interface FilaSede {
  /** El nombre de la clínica. Nunca un id. */
  nombre: string;
  /** La sede en la que está parada la sesión. */
  esActiva: boolean;
  /**
   * 🔴 Qué abarcan las CITAS y los PACIENTES de esta sede. Un DOCTOR ve solo lo
   * suyo (`buildPatientWhere`/`buildAppointmentWhere` lo recortan), y quien no
   * es doctor ve la clínica entera. Viaja por sede porque el rol es por ficha:
   * alguien puede ser ADMIN en una sede y DOCTOR en otra, y entonces «120
   * contra 8» no compara dos sedes, compara una clínica contra una agenda. Es
   * el mismo criterio, literal, que usan `ausencias` y `agenda_ocupacion`.
   *
   * ⚠️ NO vale para el dinero: ni `ingresos_por_periodo` ni
   * `pacientes_con_deuda` aplican el recorte de doctor (el primero filtra solo
   * por clínica, el segundo solo por visibilidad de paciente). Decir que los
   * ingresos de un doctor son «solo los suyos» sería atribuirle mal una cifra
   * que es de la sede entera, así que el aviso de abajo lo dice con esa
   * precisión.
   */
  alcance: "clinica" | "propio";
  /**
   * DEL PERIODO pedido. `numeroDeCobros` es una CUENTA de pagos, no pesos — se
   * llama así y no `cobros` porque junto a tres importes «cobros: 12» se lee
   * como $12, y el modelo lo copiaría tal cual.
   */
  ingresos: { netos: number; numeroDeCobros: number } | null;
  /**
   * 🔴 ACUMULADO A HOY, **no** del periodo: `pacientes_con_deuda` no lleva
   * rango, suma todas las facturas con saldo. Va en su propia clave para que no
   * se lea como «lo que quedó a deber este mes», que es lo que pasaba al
   * meterlo en el mismo objeto que los ingresos del periodo.
   */
  porCobrar: { total: number; vencido: number } | null;
  citas: { agendadas: number; ausencias: number; tasaPct: number | null } | null;
  pacientes: { nuevos: number; periodoAnterior: number; variacionPct: number | null } | null;
  ocupacion: { pct: number | null; citas: number } | null;
  omitidas: OmitidaEnSede[];
  /**
   * La consulta de ESTA sede falló (un timeout del pooler, por ejemplo). Se
   * marca en vez de tumbar la pregunta entera: con seis sedes son ~85
   * consultas, y que una se caiga no es razón para no dar las otras cinco. Pero
   * se DICE: una sede con todo en `null` y sin marca se leería como una sede
   * sin actividad.
   */
  fallo?: boolean;
}

export interface DatosComparar {
  desde: string;
  hasta: string;
  metrica: Metrica;
  /** Una fila por sede. La activa siempre la primera. */
  sedes: FilaSede[];
  /** Cuántas sedes tiene de verdad quien pregunta. */
  totalSedes: number;
  /** `true` si quedaron sedes fuera de la lista: hay que decirlo, no callarlo. */
  truncado: boolean;
  /**
   * Sedes propias con el PLAN VENCIDO, por su nombre. No se miran (hoy no se
   * puede entrar a ellas desde el panel) y por eso hay que decirlas: callarlas
   * haría creer que esa sede no facturó nada.
   */
  vencidas: string[];
}

export const compararSedes = definirHerramienta<ParamsComparar, DatosComparar>({
  nombre: "comparar_sedes",
  descripcion:
    "Compara las sedes (sucursales) de quien pregunta entre sí en un periodo: ingresos y por cobrar, " +
    "citas y ausencias, pacientes nuevos u ocupación de agenda, con el nombre de cada sede. Úsala para " +
    "«¿cómo va una sede contra la otra?», «¿en cuál se cae más gente?» o «¿dónde se factura más?». " +
    "Las sedes salen de la sesión: NO se puede pedir una por nombre ni por id. Si de alguna sede falta " +
    "permiso para una parte, viene en `omitidas` y HAY QUE DECIRLO: no es que no haya datos.",
  parametros,
  permiso: "today.view",

  async ejecutar(ctx: SabinaCtx, params: ParamsComparar): Promise<DatosComparar> {
    const metrica: Metrica = params.metrica ?? "todo";

    // 🔴 Aquí y en ningún otro sitio se decide qué sedes se miran, y se decide
    // con el ctx de la sesión como única entrada.
    const visibles = await sedesVisibles(ctx);

    // Los días, UNA vez y en la zona de la sede activa, para que la comparación
    // sea del mismo periodo. 30 días hacia atrás por defecto, igual que el
    // resto del catálogo.
    const rango = resolverRango({ desde: params.desde, hasta: params.hasta }, ctx.timezone);

    const sedes: FilaSede[] = [];
    // Sede por sede, en serie. Cada una ya lanza su propia tanda de consultas
    // (hasta ~13 con `todo`); dispararlas todas a la vez satura el pooler, que
    // es exactamente lo que prohíbe la regla de la casa.
    for (let i = 0; i < visibles.sedes.length; i++) {
      const sede = visibles.sedes[i];
      try {
        sedes.push(await unaFila(sede, metrica, rango.desdeISO, rango.hastaISO));
      } catch {
        // Ni el detalle del error ni nada de la base: solo que esta sede no se
        // pudo leer. Lo que no se hace es perder las demás.
        sedes.push({
          nombre: sede.nombre,
          esActiva: sede.esActiva,
          alcance: sede.ctx.role === "DOCTOR" ? "propio" : "clinica",
          ingresos: null,
          porCobrar: null,
          citas: null,
          pacientes: null,
          ocupacion: null,
          omitidas: [],
          fallo: true,
        });
      }
    }

    return {
      desde: rango.desdeISO,
      hasta: rango.hastaISO,
      metrica,
      sedes,
      totalSedes: visibles.total,
      truncado: visibles.truncado,
      vencidas: visibles.vencidas,
    };
  },

  // Nunca es «sin datos»: una sede en calma es una respuesta, y «solo tienes
  // una sede» también. Lo que sí hay que decir va en el resumen.
  vacio: () => false,

  resumir,
});

/* ── una sede ─────────────────────────────────────────────────────────── */

const QUIERE = {
  dinero: (m: Metrica) => m === "todo" || m === "dinero",
  citas: (m: Metrica) => m === "todo" || m === "citas",
  pacientes: (m: Metrica) => m === "todo" || m === "pacientes",
  // Fuera de `todo` a propósito: es la consulta más cara del catálogo (horario
  // de la clínica × sillones × días) y la que menos se compara entre sedes con
  // horarios distintos. Quien la quiera, la pide por su nombre.
  ocupacion: (m: Metrica) => m === "ocupacion",
};

async function unaFila(
  sede: SedeVisible,
  metrica: Metrica,
  desde: string,
  hasta: string,
): Promise<FilaSede> {
  // 🔴 El ctx de ESTA sede: su clinicId, su ficha, sus permisos. Todo lo de
  // abajo se ejecuta con él y con ningún otro.
  const ctx = sede.ctx;

  const omitidas: OmitidaEnSede[] = [];
  /**
   * El MISMO criterio de permiso que el resto del catálogo, con el ctx de aquí.
   *
   * Se llama UNA VEZ POR HERRAMIENTA y con LA KEY QUE ESA HERRAMIENTA DECLARA,
   * nunca con la de su vecina. Importa aunque hoy dos de ellas declaren la
   * misma: aquí se llama a `ejecutar` directo, y `ejecutar` NO vuelve a mirar
   * el `permiso` del catálogo —eso solo lo hace `correrHerramienta`—, así que
   * el día que alguien le cambie la key a una de las dos, gatearla por la de
   * la otra sería servir datos sin su permiso. Se anota una sola vez por
   * (sección, key) para que dos herramientas de la misma área no repitan el
   * aviso.
   */
  const puede = (seccion: string, permiso: PermissionKey): boolean => {
    if (tienePermiso(ctx, permiso)) return true;
    const causa = causaSinPermiso(ctx, permiso);
    const yaEsta = omitidas.some((o) => o.seccion === seccion && o.permiso === permiso);
    if (!yaEsta) {
      omitidas.push(causa === "usuario" ? { seccion, permiso } : { seccion, permiso, causa });
    }
    return false;
  };

  // Cada herramienta con SU key, no con la de al lado. Hoy las dos de dinero
  // declaran `billing.view` y por eso el aviso sale una sola vez; si mañana
  // divergen, cada una se gatea sola y las dos se dicen.
  const verIngresos = QUIERE.dinero(metrica) && puede("ingresos y por cobrar", ingresosPorPeriodo.permiso);
  const verDeuda = QUIERE.dinero(metrica) && puede("ingresos y por cobrar", pacientesConDeuda.permiso);
  const verCitas = QUIERE.citas(metrica) && puede("citas y ausencias", ausencias.permiso);
  const verPacientes = QUIERE.pacientes(metrica) && puede("pacientes nuevos", pacientesNuevos.permiso);
  const verOcupacion = QUIERE.ocupacion(metrica) && puede("ocupación de la agenda", agendaOcupacion.permiso);

  // Tanda 1 — ingresos (2 consultas) + ausencias (3). Cinco: por debajo de las
  // siete que satura el pooler.
  const [ingresos, faltas] = await Promise.all([
    verIngresos
      ? ingresosPorPeriodo.ejecutar(ctx, { desde, hasta, agrupar: "mes" })
      : Promise.resolve(null),
    verCitas ? ausencias.ejecutar(ctx, { desde, hasta }) : Promise.resolve(null),
  ]);

  // Tanda 2 — pacientes nuevos (4 consultas).
  const nuevos = verPacientes ? await pacientesNuevos.ejecutar(ctx, { desde, hasta }) : null;

  // Tanda 3 — la deuda (4), con su propio permiso ya comprobado arriba.
  const deuda = verDeuda ? await pacientesConDeuda.ejecutar(ctx, {}) : null;

  // Tanda 4 — la ocupación, solo si se pidió.
  const ocup = verOcupacion ? await agendaOcupacion.ejecutar(ctx, { desde, hasta }) : null;

  return {
    nombre: sede.nombre,
    esActiva: sede.esActiva,
    // Mismo criterio que `ausencias` y `agenda_ocupacion`, con el rol de ESTA
    // ficha: copiarlo de otra forma sería un segundo criterio para lo mismo.
    alcance: ctx.role === "DOCTOR" ? "propio" : "clinica",
    ingresos: ingresos
      ? { netos: ingresos.ingresosNetos, numeroDeCobros: ingresos.cobros }
      : null,
    porCobrar: deuda ? { total: deuda.totalAdeudado, vencido: deuda.totalVencido } : null,
    citas: faltas
      ? { agendadas: faltas.citasAgendadas, ausencias: faltas.ausencias.total, tasaPct: faltas.tasaPct }
      : null,
    pacientes: nuevos
      ? { nuevos: nuevos.nuevos.total, periodoAnterior: nuevos.periodoAnterior, variacionPct: nuevos.variacionPct }
      : null,
    ocupacion: ocup ? { pct: ocup.ocupacionPctTotal, citas: ocup.citasTotales } : null,
    omitidas,
  };
}

/* ── la línea que lee el doctor ───────────────────────────────────────── */

/**
 * Una línea por sede, con el NOMBRE delante. Es lo que el modelo copia: si aquí
 * sale «Altabrisa: 120 citas, 8 ausencias», la respuesta sale igual, y la
 * pantalla lo pinta como lista (`parseSabinaMarkdown`). Un volcado de veinte
 * métricas por sede no se lee.
 */
function resumir(d: DatosComparar): string {
  if (d.sedes.length === 0) {
    return "No pude resolver ninguna sede que puedas mirar. Dilo tal cual: no des números.";
  }

  if (d.sedes.length === 1) {
    const sola = d.sedes[0];
    return (
      `Solo tienes una sede (${sola.nombre}), así que no hay con qué compararla. ` +
      `Del ${d.desde} al ${d.hasta} — ${cuerpoDeSede(sola) || "sin datos que mostrar"}.` +
      avisos(d)
    );
  }

  const lineas = d.sedes
    .map((s) => `\n- ${s.nombre}: ${cuerpoDeSede(s) || "nada que mostrar"}`)
    .join("");
  return `Del ${d.desde} al ${d.hasta}, ${plural(d.sedes.length, "sede", "sedes")}:${lineas}${avisos(d)}`;
}

/** Los números de una sede, en una frase corta y en el orden en que se preguntan. */
function cuerpoDeSede(s: FilaSede): string {
  const partes: string[] = [];
  if (s.ingresos) {
    partes.push(`${pesos(s.ingresos.netos)} netos`);
  }
  if (s.porCobrar && s.porCobrar.total > 0) {
    // «acumulado» no es un adorno: este saldo NO es del periodo del encabezado,
    // son todas las facturas con saldo de siempre. Sin la palabra, «$0 netos y
    // $180,000 por cobrar» se lee como si los 180 000 fueran de este mes.
    partes.push(`${pesos(s.porCobrar.total)} por cobrar acumulado (no del periodo)`);
  }
  if (s.citas) {
    partes.push(plural(s.citas.agendadas, "cita", "citas"));
    partes.push(
      s.citas.ausencias === 0
        ? "sin ausencias"
        : `${plural(s.citas.ausencias, "ausencia", "ausencias")} (${pct(s.citas.tasaPct)})`,
    );
  }
  if (s.pacientes) {
    const v = s.pacientes.variacionPct;
    partes.push(
      `${plural(s.pacientes.nuevos, "paciente nuevo", "pacientes nuevos")}` +
        (v === null ? "" : ` (${v >= 0 ? "+" : ""}${v}%)`),
    );
  }
  if (s.ocupacion) {
    partes.push(`agenda al ${pct(s.ocupacion.pct)} (${plural(s.ocupacion.citas, "cita", "citas")})`);
  }
  if (partes.length === 0 && s.omitidas.length > 0) return "nada que puedas ver";
  return partes.join(", ");
}

/**
 * Lo que NO se pudo dar, sede por sede. Va DESPUÉS de los números y con el
 * nombre de la sede delante, porque «no tienes acceso a facturación» sin decir
 * en cuál sede deja la comparación igual de falsa que callárselo.
 */
function avisos(d: DatosComparar): string {
  const out: string[] = [];

  const delUsuario = d.sedes
    .map((s) => ({ sede: s.nombre, partes: s.omitidas.filter((o) => !o.causa) }))
    .filter((x) => x.partes.length > 0);
  if (delUsuario.length > 0) {
    const detalle = delUsuario
      .map((x) => `${x.sede} (${x.partes.map((o) => `${o.seccion}: falta ${o.permiso}`).join("; ")})`)
      .join(", ");
    out.push(
      `NO tienes acceso a todo en todas las sedes: ${detalle}. Dilo — esas cifras faltan por permiso, ` +
        `no porque sean cero, y sin decirlo la comparación queda falsa.`,
    );
  }

  // 🔴 Sabina APAGADA en una sede concreta. Va aparte porque
  // `FRASE_SABINA_APAGADA` no nombra la sede, y soltarla tal cual en una
  // comparación hace que Sabina diga «no puedo consultar nada en tu nombre»
  // justo después de dar números — quien lee no tiene forma de saber que habla
  // de la otra sede.
  const apagadas = d.sedes.filter((s) => s.omitidas.some((o) => o.causa === "apagada"));
  if (apagadas.length > 0) {
    out.push(
      `En ${apagadas.map((s) => s.nombre).join(" y ")} el Super Admin apagó a Sabina para tu usuario, ` +
        `así que de esa sede no puedo consultar nada. Dilo NOMBRANDO la sede: sin el nombre parece que ` +
        `no puedo hacer nada en ninguna.`,
    );
  }

  // Lo que el Super Admin le quitó a Sabina (sin apagarla): «no tienes acceso»
  // sería mentirle a quien sí lo tiene, y el motor añadiría después la frase
  // correcta, contradiciéndolo.
  const deSabina = d.sedes
    .map((s) => ({ sede: s.nombre, partes: s.omitidas.filter((o) => o.causa === "sabina") }))
    .filter((x) => x.partes.length > 0);
  if (deSabina.length > 0) {
    const frases = Array.from(
      new Set(
        deSabina.reduce(
          (acc: string[], x) => acc.concat(x.partes.map((o) => fraseSinPermiso(o.permiso, o.causa))),
          [],
        ),
      ),
    );
    const donde = deSabina
      .map((x) => `${x.sede} (${x.partes.map((o) => o.seccion).join("; ")})`)
      .join(", ");
    out.push(
      `Omití partes de ${donde}: el usuario SÍ tiene ese acceso, pero el Super Admin no te deja usarlo ` +
        `en su nombre. NO digas que no tiene acceso; di textualmente: "${frases.join(" ")}"`,
    );
  }

  if (d.vencidas.length > 0) {
    out.push(
      `${d.vencidas.join(" y ")}: ${d.vencidas.length === 1 ? "esa sede tiene" : "esas sedes tienen"} el ` +
        `plan vencido, así que no ${d.vencidas.length === 1 ? "la" : "las"} puedo mirar y no ` +
        `${d.vencidas.length === 1 ? "entra" : "entran"} en la comparación. Dilo: no es que no tenga datos, ` +
        `es que está suspendida y hay que ponerla al corriente para verla.`,
    );
  }

  // Números que no se pueden poner uno al lado del otro sin decirlo: en una
  // sede la persona es doctor (ve lo suyo) y en otra no (ve la clínica entera).
  // Solo si hay algo que el rol de doctor recorte DE VERDAD. El dinero no lo es:
  // `ingresos_por_periodo` filtra solo por clínica y `pacientes_con_deuda` solo
  // por visibilidad de paciente, así que decir que los ingresos de un doctor son
  // «los suyos» sería atribuirle mal una cifra de la sede entera.
  const hayRecortables = d.sedes.some((s) => s.citas || s.pacientes || s.ocupacion);
  const propias = d.sedes.filter((s) => s.alcance === "propio");
  if (propias.length > 0 && d.sedes.length > 1 && hayRecortables) {
    const donde =
      propias.length === d.sedes.length
        ? "todas estas sedes"
        : propias.map((s) => s.nombre).join(" y ");
    out.push(
      `Ojo: en ${donde} eres doctor, así que las CITAS y los PACIENTES de ${
        propias.length === d.sedes.length ? "todas" : "esa(s) sede(s)"
      } son solo LOS TUYOS, no los de la sede entera (el dinero sí es el de la sede completa). ` +
        `NO los compares sin avisar de esto.`,
    );
  }

  const fallidas = d.sedes.filter((s) => s.fallo);
  if (fallidas.length > 0) {
    out.push(
      `No pude leer ${fallidas.map((s) => s.nombre).join(" y ")} (falló la consulta). Dilo: NO ` +
        `${fallidas.length === 1 ? "la presentes" : "las presentes"} como ${
          fallidas.length === 1 ? "una sede sin actividad" : "sedes sin actividad"
        }, y no ${fallidas.length === 1 ? "la incluyas" : "las incluyas"} en la comparación.`,
    );
  }

  if (d.truncado) {
    out.push(
      `Van ${d.sedes.length} de tus ${d.totalSedes} sedes: dilo, no presentes esto como si fueran todas.`,
    );
  }

  return out.length === 0 ? "" : ` ${out.join(" ")}`;
}
