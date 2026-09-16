/**
 * EL CONTEXTO DE PANTALLA — qué sabe Sabina de dónde estás.
 *
 * Desde que Sabina se abre en un cajón sobre cualquier pantalla del panel
 * (ws1-t1, «Sabina en todas partes»), la pregunta llega con una pista de dónde
 * estaba quien la escribió. Sirve para lo que pidió Rafael: el doctor abre la
 * ficha de Ana Ruiz, pregunta «¿qué le receté la última vez?» y NO tiene que
 * escribir el nombre.
 *
 * 🔴 LA PISTA NO ES UNA LLAVE. Esto es lo único importante de este archivo.
 * Lo que manda el navegador diciendo «paciente 123» no autoriza NADA:
 *   · el `pacienteId` se vuelve a comprobar aquí contra la sesión —clínica,
 *     visibilidad y `deletedAt`— con la misma función que usan las
 *     herramientas (`pacienteVisibleYActivo`), y además se exige
 *     `patients.view` igual que la pantalla;
 *   · si no pasa, el paciente se CAE del contexto en silencio y la pregunta
 *     sigue su camino como si no lo hubieran mandado. No se dice «no puedes
 *     ver a ese paciente»: eso ya sería confirmar que existe;
 *   · y aunque pasara, las herramientas vuelven a comprobarlo todo por su
 *     cuenta. Esto solo ahorra escribir el nombre; no abre ninguna puerta.
 *
 * 🔴 NADA DE TEXTO LIBRE DEL CLIENTE LLEGA AL PROMPT. La pantalla viaja como
 * un id de una lista CERRADA (`ETIQUETA_PANTALLA`), la fecha con un regex de
 * AAAA-MM-DD, y el nombre del paciente sale de la base, no del navegador. Si
 * el cliente pudiera escribir en el prompt, sería una inyección de órdenes al
 * modelo con el nombre de la clínica encima.
 *
 * ── LO QUE NO SE MANDA, Y POR QUÉ (regla 2 del contrato: cada carácter se
 *    paga en CADA pregunta) ───────────────────────────────────────────────
 *   · la URL entera, sus parámetros y la pestaña abierta — ruido: el modelo no
 *     contesta distinto por estar en «?tab=fotos»;
 *   · el id de la cita abierta — es lo que más tienta y lo que peor acaba:
 *     reagendar y cancelar son ESCRITURAS, y darles un id que puso el cliente
 *     es justo lo que la regla roja prohíbe. Que el modelo lo resuelva con sus
 *     herramientas, como hasta hoy;
 *   · lo que haya escrito en un formulario a medias — no es asunto de Sabina.
 */

import { z } from "zod";
import { dbDe, exigirSesion, tienePermiso, visorDe } from "./tools/base";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
// La lista de pantallas y sus nombres viven del lado del navegador, en un
// módulo PURO (sin React y sin `window`), y se importan desde aquí a propósito:
// es la MISMA lista con la que la pantalla arma la pista y con la que el cajón
// le dice al doctor qué está viendo Sabina. Dos copias se separan al primer
// cambio, y entonces el cartel promete una cosa y el prompt dice otra.
import { esPantallaConocida, ETIQUETA_PANTALLA } from "@/components/sabina/contexto-pantalla";
import type { SabinaCtx } from "./tipos";

/** Lo que manda el navegador. Todo opcional: sin contexto, Sabina es la de siempre. */
export const esquemaContextoSabina = z.object({
  pantalla: z.string().max(40).optional(),
  pacienteId: z.string().max(64).optional(),
  /** El día que está mirando la agenda, AAAA-MM-DD. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ContextoSabinaCrudo = z.infer<typeof esquemaContextoSabina>;

/**
 * 🔴 EL NOMBRE TAMBIÉN SE LIMPIA, AUNQUE VENGA DE LA BASE.
 *
 * Que un dato salga de nuestra tabla no lo vuelve texto controlado: `firstName`
 * y `lastName` se validan con `z.string().min(2)` y SIN tope, y la columna es
 * texto libre. Quien pueda dar de alta un paciente puede escribir en el
 * apellido un salto de línea y un párrafo con órdenes, y ese párrafo acabaría
 * DENTRO del prompt del sistema —el canal de más confianza del modelo— para el
 * doctor que abra su ficha. Aparte del ataque, un nombre de 5 KB multiplicaría
 * el gasto de cada pregunta de esa clínica, porque el prompt se rearma en cada
 * ronda del bucle.
 *
 * Tres cosas, y ninguna mutila un nombre de verdad:
 *   1. los espacios se aplastan a uno solo, así que el nombre **no puede
 *      empezar una línea propia** dentro del prompt — que es lo que le daría
 *      pinta de instrucción;
 *   2. se quitan las comillas y los acentos graves, para que no pueda salirse
 *      de las «» en las que se escribe siempre;
 *   3. se corta a 60 caracteres.
 *
 * Lo que esto NO promete: que dentro de esos 60 caracteres en una línea no
 * quepa una frase con pinta de orden. Contra eso está que el nombre va entre
 * «», que Sabina no escribe en la base y que toda herramienta vuelve a
 * comprobar permisos: lo peor que consigue quien lo intente es una respuesta
 * rara para un compañero de SU MISMA clínica.
 */
const TOPE_NOMBRE = 60;

function nombreSeguro(firstName: unknown, lastName: unknown): string {
  const crudo = `${typeof firstName === "string" ? firstName : ""} ${typeof lastName === "string" ? lastName : ""}`;
  const limpio = crudo
    // 🔴 `\s` de JavaScript NO cubre todo lo que parte una línea: deja fuera
    // U+0085 (NEL) y el resto de los controles C0/C1, que muchos visores —y el
    // modelo— tratan como salto. Se listan a mano, junto con los invisibles de
    // dirección (U+200B-200F) y la BOM, que sirven para disfrazar texto.
    .replace(/[\s\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]+/g, " ")
    // Lo que serviría para cerrar las «» en las que va escrito.
    .replace(/[«»"'`]/g, "")
    .trim();
  if (limpio.length <= TOPE_NOMBRE) return limpio;
  // Se corta por CARACTERES, no por unidades UTF-16: un `slice` a pelo puede
  // partir un par subrogado por la mitad y dejar media letra inválida.
  return `${Array.from(limpio).slice(0, TOPE_NOMBRE).join("").trimEnd()}…`;
}

/** El nombre, siempre entre «», para que se lea como un dato y no como una orden. */
function citado(nombre: string): string {
  return `«${nombre}»`;
}

export interface ContextoSabinaResuelto {
  /** Id de `ETIQUETA_PANTALLA`, ya validado contra la lista. */
  pantalla: string | null;
  /** Solo si la sesión PUEDE verlo. El nombre sale de la base. */
  paciente: { id: string; nombre: string } | null;
  fecha: string | null;
}

/** Nada que decir: ni pantalla conocida, ni paciente, ni fecha. */
export function contextoVacio(c: ContextoSabinaResuelto | null): boolean {
  return !c || (c.pantalla === null && c.paciente === null && c.fecha === null);
}

/**
 * Convierte lo que mandó el navegador en lo que Sabina puede creerse.
 *
 * Nunca lanza y nunca devuelve un error al usuario: el contexto es un extra.
 * Si algo no cuadra —el id no es de esta clínica, la tabla falla, el cuerpo
 * viene raro— se devuelve lo que sí se pudo comprobar, o `null`.
 */
export async function resolverContextoSabina(
  ctx: SabinaCtx,
  crudo: unknown,
): Promise<ContextoSabinaResuelto | null> {
  // 🔴 La guarda de la regla (c) de CLAUDE.md, la misma que envuelve a cada
  // herramienta: con `clinicId: undefined` Prisma descarta la clave y el
  // `findFirst` de abajo devolvería el paciente de CUALQUIER clínica. Hoy la
  // ruta ya corta antes (`crearSabinaCtx` devuelve null), pero esta función es
  // pública y la puerta siguiente no tiene por qué acordarse.
  try {
    exigirSesion(ctx);
  } catch {
    return null;
  }

  const parseado = esquemaContextoSabina.safeParse(crudo ?? {});
  if (!parseado.success) return null;
  const { pantalla, pacienteId, fecha } = parseado.data;

  const pantallaValida = esPantallaConocida(pantalla) ? pantalla : null;
  const fechaValida = typeof fecha === "string" ? fecha : null;

  let paciente: ContextoSabinaResuelto["paciente"] = null;
  const id = typeof pacienteId === "string" ? pacienteId.trim() : "";
  // El permiso PRIMERO: sin `patients.view` no se consulta ni el nombre. Es la
  // misma key que pide la ficha, y sale del ctx YA recortado a lo que el Super
  // Admin deja hacer a Sabina en nombre de esta persona.
  if (id && tienePermiso(ctx, "patients.view")) {
    try {
      // 🔴 LA COMPROBACIÓN DE VERDAD: clínica de la SESIÓN, visibilidad del
      // paciente y `deletedAt: null` — el MISMO criterio de
      // `pacienteVisibleYActivo`, que es por donde pasa cada herramienta antes
      // de leer nada de un paciente. Va en UNA consulta y no en dos (la del
      // permiso + la del nombre) porque esto corre en CADA pregunta y el
      // pooler se satura; el `where` se arma con los mismos helpers para que
      // no pueda separarse del de la herramienta, y hay una prueba que compara
      // las dos respuestas paciente a paciente (`contexto.test.ts`).
      const visAnd = patientVisibilityAnd(visorDe(ctx));
      const fila = await dbDe(ctx).patient.findFirst({
        where: {
          id,
          clinicId: ctx.clinicId, // 🔴 SIEMPRE de la sesión
          deletedAt: null,
          ...(visAnd.length ? { AND: visAnd } : {}),
        },
        select: { id: true, firstName: true, lastName: true },
      });
      const nombre = nombreSeguro(fila?.firstName, fila?.lastName);
      if (fila && nombre) paciente = { id: fila.id, nombre };
    } catch {
      // Una lectura que falla NO tumba la pregunta: se contesta sin contexto de
      // paciente, que es exactamente como contestaba Sabina hasta hoy.
      paciente = null;
    }
  }

  const resuelto: ContextoSabinaResuelto = { pantalla: pantallaValida, paciente, fecha: fechaValida };
  return contextoVacio(resuelto) ? null : resuelto;
}

/**
 * El bloque que se le añade al prompt del sistema. `""` cuando no hay nada que
 * decir — y ese caso importa: sin contexto, la pregunta cuesta lo mismo que
 * costaba antes de esta pantalla.
 *
 * Corto a propósito (§2 del contrato). Dice dónde está, y SOLO si hay paciente
 * añade la regla del pronombre, que es para lo que existe todo esto.
 */
export function bloqueDeContexto(contexto: ContextoSabinaResuelto | null): string {
  if (contextoVacio(contexto)) return "";
  const c = contexto as ContextoSabinaResuelto;

  // La ficha del paciente y «el paciente que está en el sillón» NO son lo
  // mismo, y decirlo mal sería peor que callarlo: un doctor puede estar
  // mirando la agenda con una consulta abierta. Cada caso, su frase.
  const enFicha = c.pantalla === "ficha-paciente" && c.paciente !== null;
  const partes: string[] = [];
  if (enFicha) partes.push(`la ficha de ${citado(c.paciente!.nombre)}`);
  else if (esPantallaConocida(c.pantalla)) partes.push(ETIQUETA_PANTALLA[c.pantalla]);
  if (c.fecha) partes.push(`el día ${c.fecha}`);

  const lineas = ["DÓNDE ESTÁ QUIEN PREGUNTA"];
  if (partes.length > 0) lineas.push(`Tiene abierto en pantalla: ${partes.join(", ")}.`);
  // El paciente del sillón va en SU frase, no pegado a la de la pantalla: si la
  // pantalla no está en la lista, `partes` está vacío y «Tiene abierto en
  // pantalla: y está atendiendo a…» sería una frase rota.
  if (c.paciente && !enFicha) lineas.push(`Está atendiendo a ${citado(c.paciente.nombre)} en una consulta abierta.`);
  if (c.paciente) {
    lineas.push(
      `Si habla de "este paciente", "le", "él" o "ella" sin nombrar a nadie, es ${citado(c.paciente.nombre)}: usa patientId "${c.paciente.id}" y no lo busques. Si nombra a otro, manda el que nombre.`,
    );
  }
  return lineas.join("\n");
}
