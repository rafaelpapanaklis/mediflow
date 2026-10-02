/**
 * `equipo_clinica` — quién trabaja aquí y en qué es cada quién.
 *
 * La otra mitad de «que conozca la clínica»: sin esto, «¿quién hace ortodoncia
 * aquí?» no tenía respuesta aunque el dato estuviera en la base.
 *
 * ── DE DÓNDE SALE, Y QUÉ NO SALE ───────────────────────────────────────
 * De `User`: la clínica de la sesión e `isActive`. Quién «puede llevar citas»
 * (`esDoctor`) es la regla única de la Agenda que usan `resolverDoctor`, «Nueva
 * cita» y el POST (`puedeRecibirCitas`: doctor, administrador o dueño con
 * «Aparece en la agenda» marcada; decisión de Rafael, 2-oct-2026).
 * De cada persona viajan cinco cosas y ni una más: nombre, rol, especialidad,
 * servicios y si está en la agenda.
 *
 * 🔴 Lo que se queda fuera A PROPÓSITO, aunque la pantalla Equipo sí lo enseñe:
 * correo, teléfono, cédula profesional, cédula de especialidad y
 * `permissionsOverride`. La cédula es un identificador oficial de una persona y
 * el override es la configuración de seguridad de la clínica; ninguna de las dos
 * contesta «¿quién hace ortodoncia?», y todo lo que Sabina devuelve acaba en el
 * texto de una conversación guardada. Importa más de lo que parece: el motor le
 * manda al modelo el objeto `datos` ENTERO, no solo el `resumen`, así que este
 * `select` es la única barrera que hay.
 *
 * ── EL PERMISO: `agenda.view`, y un ALCANCE que sigue al panel ─────────
 * `team.view` gatea la pantalla Equipo, que es la de administrar personas
 * (altas, bajas, correos, cédulas, permisos) y que por default no tienen ni
 * DOCTOR ni RECEPTIONIST. Pero el CUADRO DE DOCTORES es otra cosa: ya está a la
 * vista de cualquiera con agenda —el selector de doctor de «Nueva cita»,
 * `fetchActiveDoctors`—, `resolverDoctor` se lo enumera al modelo cuando se va a
 * agendar («Quienes sí reciben citas son: …»), y nombre, especialidad y servicios de
 * cada profesional son PÚBLICOS en la web de la clínica (`/descubre/clinica/[slug]`
 * y `/reservar/[slug]`), sin sesión ninguna.
 *
 * Así que la key es `agenda.view` y el ALCANCE se recorta al de la pantalla que
 * tiene delante quien pregunta:
 *   · con `team.view`  → el equipo entero, como en /dashboard/team;
 *   · sin `team.view`  → SOLO quien recibe citas, como en el selector de «Nueva cita».
 *
 * La primera versión devolvía la plantilla completa —con quién es el «Dueño» y
 * quién «Recepción»— a cualquiera con agenda: eso es el organigrama, y en el
 * panel esa misma persona recibe un 403 de `GET /api/team`. Y el recorte NO se
 * hace en silencio (regla 3 del contrato): el `resumen` dice que va sobre los
 * doctores y por qué.
 *
 * ⚠️ El hueco conocido, por si alguien lo encuentra y cree que es un fallo: una
 * herramienta declara UNA key (MAPA-engranaje §1.3). Un usuario con un override
 * a medida que le dé `team.view` SIN `agenda.view` entra a /dashboard/team en el
 * panel y aquí se lleva un `sin_permiso` por `agenda.view`. Los cinco roles por
 * default llevan las dos juntas, así que solo se alcanza a mano; y el error cae
 * del lado seguro (Sabina dice menos que la pantalla, nunca más). Cambiar la key
 * a `team.view` NO es la salida: dejaría la herramienta muerta para DOCTOR y
 * RECEPTIONIST, que son quienes preguntan «¿quién hace ortodoncia aquí?».
 */

import { z } from "zod";
import {
  dbDe,
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  plural,
  recortar,
  tienePermiso,
  type Lista,
} from "./base";
import { nombreDe, normal } from "./agenda-comun";
import { RECIBE_CITAS_WHERE, ROLES_QUE_ATIENDEN, puedeRecibirCitas } from "@/lib/agenda/roles-que-atienden";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** Nombre, especialidad o servicio: «ortodoncia», «Salas». Sin él, el equipo entero. */
  busqueda: z.string().min(2).max(60).optional(),
  /** `true` = solo los que pueden llevar citas (los que aparecen en la agenda). */
  soloDoctores: z.boolean().optional(),
});

export type ParamsEquipo = z.infer<typeof parametros>;

/**
 * Cuántas personas se leen. Una clínica «16+» es el tramo más grande que
 * recoge el alta (`Clinic.clinicSize`); 200 deja sitio de sobra y pone un techo
 * al contexto y al pooler. Si el tope muerde, se DICE.
 */
const TOPE_LECTURA = 200;

/**
 * El rol como lo llama el panel, no como lo llama Prisma. Es solo la etiqueta
 * que se enseña: lo que decide («¿puede llevar citas?») nunca se compara contra
 * este diccionario, sino con `puedeRecibirCitas`, en `esDoctor`.
 */
const ROL: Record<string, string> = {
  SUPER_ADMIN: "Dueño",
  ADMIN: "Administrador",
  DOCTOR: "Doctor",
  RECEPTIONIST: "Recepción",
  READONLY: "Solo lectura",
};

/**
 * Las etiquetas de los roles que atienden. Solo para el TEXTO del resumen
 * («fuera de la agenda» frente a «ese rol no lleva citas»); quién puede llevar
 * una cita lo decide `esDoctor`.
 */
const ROLES_QUE_LLEVAN_CITAS = new Set<string>(ROLES_QUE_ATIENDEN.map((r) => ROL[r]));

export interface MiembroFila {
  nombre: string;
  /** Etiqueta legible del rol. */
  rol: string;
  /**
   * ¿Puede llevar una cita? La regla única de la Agenda (`puedeRecibirCitas`):
   * doctor, administrador o dueño activo con «Aparece en la agenda» marcada.
   */
  esDoctor: boolean;
  /**
   * `User.specialty` (el campo que usan la agenda y la web pública) y, si está
   * vacío, `User.especialidad` (el de NOM-024). `null` = no la capturó.
   */
  especialidad: string | null;
  /** `User.services` — lo que esa persona hace, como lo escribió la clínica. */
  servicios: string[];
  /** `User.agendaActive`: si aparece o no en el calendario. */
  enAgenda: boolean;
}

export interface DatosEquipo {
  equipo: Lista<MiembroFila>;
  /**
   * Personas del ALCANCE (ver `alcance`) antes del filtro de búsqueda. Sale de
   * un `count`, no de las filas leídas: con el tope de lectura mordiendo, contar
   * las filas daría un total falso presentado como total.
   */
  enElAlcance: number;
  /** De ésas, cuántas aparecen en la agenda: las únicas que pueden llevar una cita. */
  doctores: number;
  /** `"equipo"` = todo el personal (con `team.view`); `"doctores"` = solo quien lleva citas. */
  alcance: "equipo" | "doctores";
  busqueda: string | null;
  soloDoctores: boolean;
  /** El alcance pasa de `TOPE_LECTURA` y la búsqueda solo miró a los primeros. */
  lecturaRecortada: boolean;
}

export const equipoClinica = definirHerramienta<ParamsEquipo, DatosEquipo>({
  nombre: "equipo_clinica",
  descripcion:
    "Quién trabaja en ESTA clínica: nombre, rol y en qué es cada quién (especialidad y servicios). " +
    "Úsala para «¿quién hace ortodoncia aquí?», «¿qué doctores tengo?» o para saber a quién proponer " +
    "en una cita. Solo puede llevar citas quien aparece en la agenda: un doctor, un administrador o el dueño " +
    "con «Aparece en la agenda» marcada en Equipo (esDoctor = true).",
  parametros,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosEquipo> {
    const db = dbDe(ctx);
    // El alcance es el de la pantalla que tiene delante quien pregunta (ver el
    // encabezado): sin `team.view`, solo los doctores.
    const verTodos = tienePermiso(ctx, "team.view");
    // 🔴 clinicId de la SESIÓN, e `isActive`. Una persona dada de baja no está en
    // el equipo. Sin `team.view`, solo quien recibe citas (la regla de `resolverDoctor`
    // y de «Nueva cita»).
    const where: Record<string, any> = verTodos
      ? { clinicId: ctx.clinicId, isActive: true }
      : { clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE };

    const [personas, enElAlcance, doctores] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          firstName: true,
          lastName: true,
          role: true,
          specialty: true,
          especialidad: true,
          services: true,
          agendaActive: true,
          isActive: true,
        },
        orderBy: [{ role: "asc" }, { firstName: "asc" }],
        take: TOPE_LECTURA,
      }),
      db.user.count({ where }),
      verTodos ? db.user.count({ where: { clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE } }) : Promise.resolve(-1),
    ]);

    const todos: MiembroFila[] = personas.map((u: any) => ({
      nombre: nombreDe(u),
      rol: ROL[String(u.role)] ?? String(u.role ?? ""),
      esDoctor: puedeRecibirCitas(u),
      // `specialty` manda: es el que pintan la agenda y la web pública. El de
      // NOM-024 (`especialidad`) solo entra cuando el otro está vacío.
      especialidad: textoODefecto(u.specialty) ?? textoODefecto(u.especialidad),
      servicios: Array.isArray(u.services) ? u.services.filter((s: unknown) => typeof s === "string" && s.trim()) : [],
      enAgenda: u.agendaActive !== false,
    }));

    // El filtro va en memoria por lo mismo que en `procedimientos_y_precios`:
    // `mode: "insensitive"` de Prisma no dobla acentos, y «ortodoncia» tiene que
    // encontrar «Ortodoncia». Además `services` es un array de texto libre.
    const palabras = normal(params.busqueda).split(" ").filter(Boolean);
    const filas = todos.filter((m) => {
      if (params.soloDoctores && !m.esDoctor) return false;
      if (palabras.length === 0) return true;
      const heno = normal(`${m.nombre} ${m.especialidad ?? ""} ${m.servicios.join(" ")}`);
      return palabras.every((p) => heno.indexOf(p) !== -1);
    });

    return {
      equipo: recortar(filas, filas.length),
      enElAlcance,
      doctores: doctores >= 0 ? doctores : enElAlcance,
      alcance: verTodos ? "equipo" : "doctores",
      busqueda: params.busqueda ?? null,
      soloDoctores: params.soloDoctores === true,
      lecturaRecortada: enElAlcance > TOPE_LECTURA,
    };
  },

  /**
   * «No hay datos» solo cuando hay a quién mirar y el filtro no encontró a
   * nadie. Con el alcance VACÍO la respuesta tiene contenido —«esta clínica no
   * tiene a nadie que reciba citas»—, que además es la razón exacta por
   * la que va a fallar el siguiente intento de agendar (`resolverDoctor`).
   */
  vacio: (d) => d.enElAlcance > 0 && d.equipo.total === 0,

  resumir(d) {
    if (d.enElAlcance === 0) {
      return (
        "En esta clínica nadie recibe citas: solo se agenda con un doctor, administrador o dueño activo " +
        "que tenga marcada «Aparece en la agenda». Se marca (o se da de alta a un doctor) en Equipo, en el panel."
      );
    }

    const linea = (m: MiembroFila) => {
      const que = m.especialidad ?? (m.servicios.length ? m.servicios.slice(0, 4).join(", ") : null);
      return (
        `${m.nombre} — ${m.rol}` +
        (que ? ` · ${que}` : "") +
        (!m.esDoctor && !m.enAgenda && ROLES_QUE_LLEVAN_CITAS.has(m.rol) ? " (fuera de la agenda: no recibe citas)" : "")
      );
    };
    const filas = d.equipo.filas;
    // El recorte de lectura se dice en TODAS las ramas: una respuesta cerrada
    // («es Hugo Salas») sobre una lectura recortada es peor que no contestar.
    const recorte = d.lecturaRecortada
      ? ` (la clínica tiene ${d.enElAlcance} personas; miré las primeras ${TOPE_LECTURA}, puede haber más)`
      : "";
    // Regla 3: el recorte de alcance se DICE, no se omite. Detrás de una lista va
    // en su propia línea: pegado al último renglón parece parte de esa persona.
    const avisoAlcance =
      d.alcance === "doctores" && !d.soloDoctores
        ? "Te doy solo a quienes reciben citas: el equipo completo (recepción, administración) se ve en Equipo, y para eso no tienes permiso."
        : "";
    const traLista = (lista: string) => (avisoAlcance ? `${lista ? "\n" : " "}${avisoAlcance}` : "");

    if (d.busqueda) {
      if (filas.length === 1) {
        const m = filas[0];
        const ojo = m.esDoctor
          ? ""
          : ROLES_QUE_LLEVAN_CITAS.has(m.rol)
            ? " Ojo: tiene apagada «Aparece en la agenda» en Equipo, así que no se le pueden agendar citas."
            : ` Ojo: su rol es ${m.rol}, y ese rol no lleva citas.`;
        return `${linea(m)}.${ojo}${recorte}${traLista("")}`;
      }
      const lista = lineasDeLista(filas, linea);
      return (
        `${plural(d.equipo.total, "persona del equipo coincide", "personas del equipo coinciden")} con ` +
        `«${d.busqueda}»${fraseRecorte(d.equipo, "personas")}${recorte}:${lista}${traLista(lista)}`
      );
    }

    const cab =
      d.soloDoctores || d.alcance === "doctores"
        ? `${plural(d.equipo.total, "profesional en la agenda", "profesionales en la agenda")}`
        : `${plural(d.equipo.total, "persona activa", "personas activas")} en la clínica, de las que ` +
          `${plural(d.doctores, "aparece en la agenda y puede llevar citas", "aparecen en la agenda y pueden llevar citas")}`;
    // Con una sola fila `lineasDeLista` devuelve "" (una lista de uno es ruido),
    // así que el nombre va en la frase o se perdería — el caso de la clínica de
    // un solo doctor, que es de las más comunes.
    const lista = filas.length === 1 ? "" : lineasDeLista(filas, linea);
    const cuerpo = filas.length === 1 ? ` ${linea(filas[0])}.` : lista;
    const dosPuntos = filas.length === 1 ? "" : ":";
    return `${cab}${fraseRecorte(d.equipo, "personas")}${recorte}${dosPuntos}${cuerpo}${traLista(lista)}`;
  },
});

/** Texto con contenido, o `null`. Un `""` guardado no es una especialidad. */
function textoODefecto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}
