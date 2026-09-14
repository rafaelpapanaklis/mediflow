/**
 * Sabina — `registrar_paciente` (ws1-t3) enchufada a la confirmación en dos
 * fases (ws1-t1). Es el adaptador que faltaba al juntar las dos ramas.
 *
 * El encaje no era directo. ws1-t3 diseñó una tarjeta con VARIAS opciones (usar
 * el que existe / es otra persona / cancelar) y `confirmarRegistroPaciente`
 * recibe cuál tocó el usuario. La confirmación de ws1-t1 tiene UN botón y no
 * lleva opción. Sin tocar ninguna de las dos, se reparte así:
 *
 *  · Sin duplicado → tarjeta «Dar de alta a …», un botón, opción `crear`.
 *  · Con duplicado → NO hay tarjeta: Sabina pregunta en el chat si es la misma
 *    persona. Si lo es, no hay nada que escribir (se usa ese expediente). Si el
 *    usuario dice que es otra, el modelo vuelve a llamar con
 *    `esOtraPersona: true` y sale la tarjeta «como paciente NUEVO, aunque ya
 *    existe alguien igual», opción `crear_a_sabiendas`.
 *
 * `allowDuplicate` sigue sin mandarlo el modelo: lo añade solo
 * `confirmarRegistroPaciente`, solo con `crear_a_sabiendas`, solo si la propuesta
 * enseñó el duplicado y después de volver a buscar. `esOtraPersona` elige qué
 * tarjeta se enseña; lo que escribe es el botón de esa tarjeta, que lo dice.
 *
 * ⛔ Nada de Prisma: el alta la hace POST /api/patients, por la llave.
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import { definirAccion, type ManejadorRuta, type SabinaEjecucion, type SabinaPreparacion } from "./engine-acciones";
import { registrarPaciente, buscarDuplicados, type ParamsAlta, type PropuestaAlta } from "./tools/registrar-paciente";
import { confirmarRegistroPaciente, type ResultadoAlta } from "./tools/registrar-paciente-confirmar";
import type { SabinaCtx } from "./tipos";

type OpcionEjecutable = "crear" | "crear_a_sabiendas";

export interface DatosAltaAccion {
  opcionId: OpcionEjecutable;
  propuesta: PropuestaAlta;
}

export type ParamsAltaAccion = ParamsAlta & { esOtraPersona?: boolean };

const parametros = (registrarPaciente.parametros as unknown as z.AnyZodObject).extend({
  esOtraPersona: z
    .boolean()
    .optional()
    .describe(
      "Solo si la llamada anterior avisó de que YA EXISTE alguien igual y el usuario te dijo que es OTRA persona. Nunca lo pongas por tu cuenta.",
    ),
}) as unknown as z.ZodType<ParamsAltaAccion>;

const esquemaDatos = z.object({
  opcionId: z.enum(["crear", "crear_a_sabiendas"]),
  propuesta: z
    .object({
      accion: z.literal("registrar_paciente"),
      permiso: z.literal("patients.create"),
      emitidaPara: z.object({ clinicId: z.string(), userId: z.string() }),
      cuerpo: z
        .object({
          firstName: z.string(),
          lastName: z.string(),
          phone: z.string(),
          allergies: z.array(z.string()),
          dob: z.string().optional(),
          gender: z.enum(["M", "F", "OTHER"]).optional(),
          email: z.string().optional(),
        })
        .strict(),
      duplicados: z
        .object({
          comprobacion: z.enum(["completa", "parcial"]),
          visibles: z.array(z.object({ pacienteId: z.string() }).passthrough()),
          masVisibles: z.number(),
          hayOcultos: z.boolean(),
          huella: z.string().nullable(),
        })
        .passthrough(),
      opciones: z.array(z.object({ id: z.string(), tipo: z.string() }).passthrough()),
    })
    .passthrough(),
}) as unknown as z.ZodType<DatosAltaAccion>;

/* ── fase 1 ────────────────────────────────────────────────────────────── */

function detallesDe(p: PropuestaAlta) {
  // Nombre y apellidos por separado, y cada alergia aparte: «María José | Pérez» y
  // «María | José Pérez» escriben expedientes distintos y juntos se verían iguales.
  const filas = [
    { etiqueta: "Nombre", valor: p.cuerpo.firstName },
    { etiqueta: "Apellidos", valor: p.cuerpo.lastName },
    { etiqueta: "Teléfono", valor: p.ficha.telefono },
    { etiqueta: "Alergias", valor: p.ficha.alergias === "Ninguna" ? "Ninguna" : p.cuerpo.allergies.join(" · ") },
  ];
  if (p.ficha.fechaNacimiento) filas.push({ etiqueta: "Fecha de nacimiento", valor: p.ficha.fechaNacimiento });
  if (p.ficha.genero) filas.push({ etiqueta: "Género", valor: p.ficha.genero });
  if (p.ficha.correo) filas.push({ etiqueta: "Correo", valor: p.ficha.correo });
  if (p.sinCapturar.length > 0) filas.push({ etiqueta: "Sin capturar", valor: p.sinCapturar.join(", ") });
  return filas;
}

export function preparacionDeAlta(p: PropuestaAlta, esOtraPersona: boolean): SabinaPreparacion<DatosAltaAccion> {
  const hayDuplicado = !p.opciones.some((o) => o.tipo === "crear");
  if (!hayDuplicado) {
    return {
      tipo: "propuesta",
      datos: { opcionId: "crear", propuesta: p },
      tarjeta: {
        frase: `Dar de alta a ${p.ficha.nombre} (tel. ${p.ficha.telefono}) como paciente nuevo.`,
        detalles: detallesDe(p),
        avisos: [...p.efectos, ...p.avisos],
      },
    };
  }
  if (!esOtraPersona) {
    return {
      tipo: "aclarar",
      pregunta:
        `${p.pregunta ?? "Ya existe un paciente con esos datos. ¿Es la misma persona?"} ` +
        "Si es la misma, no doy de alta a nadie y seguimos con su expediente. Si es otra persona, dímelo y preparo el alta como paciente nuevo.",
      opciones: p.opciones.filter((o) => o.tipo !== "cancelar").map((o) => o.etiqueta),
    };
  }
  // «Ya existe… ¿X es la misma persona?» sin la pregunta final: en la tarjeta es un aviso.
  const yaExiste = (p.pregunta ?? "").replace(/\s*¿[^¿]*\?\s*$/, "").trim();
  return {
    tipo: "propuesta",
    datos: { opcionId: "crear_a_sabiendas", propuesta: p },
    tarjeta: {
      frase: `Dar de alta a ${p.ficha.nombre} (tel. ${p.ficha.telefono}) como paciente NUEVO, aunque ya existe alguien con esos datos.`,
      detalles: detallesDe(p),
      avisos: [
        ...(yaExiste ? [yaExiste] : []),
        "Confirmar crea un expediente aparte. Si en realidad es la misma persona, quedará duplicada.",
        ...p.efectos,
        ...p.avisos,
      ],
    },
  };
}

/* ── fase 2 ────────────────────────────────────────────────────────────── */

export function ejecucionDeAlta(r: ResultadoAlta): SabinaEjecucion {
  switch (r.estado) {
    case "creado":
      return { ok: true, frase: r.frase, entidad: { tipo: "patient", id: r.paciente.pacienteId } };
    case "duplicado":
      // Tras el botón no hay tarjeta nueva que elegir: se dice y se vuelve al chat.
      return { ok: false, tipo: "conflicto", frase: `No se creó nada. ${r.frase} Dímelo en el chat y lo preparo de nuevo.` };
    case "sin_permiso":
    case "sesion_cerrada":
      return { ok: false, tipo: "sin_permiso", frase: r.frase };
    case "tope_plan":
    case "datos_invalidos":
      return { ok: false, tipo: "invalido", frase: r.frase };
    default:
      // `error`, y los que no salen con `crear`/`crear_a_sabiendas`.
      return { ok: false, tipo: "error", frase: r.frase };
  }
}

export const accionRegistrarPaciente = definirAccion<ParamsAltaAccion, DatosAltaAccion>({
  nombre: "registrar_paciente",
  descripcion:
    `${registrarPaciente.descripcion} Si ya existe alguien igual, devuelve la pregunta: házsela al usuario. ` +
    "Solo si te contesta que es OTRA persona, vuelve a llamarla con los mismos datos y esOtraPersona: true.",
  titulo: "Dar de alta paciente",
  boton: "Sí, dar de alta",
  queHace: "dar de alta pacientes",
  permiso: "patients.create",
  deshacer: {
    reversible: false,
    aviso:
      "Un alta no se borra: solo se puede archivar desde la ficha, con el permiso «Archivar/eliminar pacientes», y archivar cancela sus citas futuras.",
  },
  parametros,
  datos: esquemaDatos,

  async preparar(ctx: SabinaCtx, params: ParamsAltaAccion) {
    const { esOtraPersona, ...alta } = params;
    return preparacionDeAlta(await registrarPaciente.ejecutar(ctx, alta as ParamsAlta), esOtraPersona === true);
  },

  /** Los duplicados que vio la tarjeta. Si al confirmar hay otros, no se escribe. */
  async huella(ctx: SabinaCtx, datos: DatosAltaAccion) {
    const ahora = await buscarDuplicados(ctx, datos.propuesta.cuerpo);
    const vistos = datos.propuesta.duplicados.huella;
    if (vistos && ahora.huella === vistos) return `${datos.opcionId}:${vistos}`;
    return `cambio:${randomUUID()}`;
  },

  async ejecutar(llave, ctx, datos) {
    const { POST } = await import("@/app/api/patients/route");
    const r = await confirmarRegistroPaciente({
      ctx,
      propuesta: datos.propuesta,
      opcionId: datos.opcionId,
      llamar: async (cuerpo) => llave.llamar(POST as ManejadorRuta, { metodo: "POST", ruta: "/api/patients", cuerpo }),
    });
    return ejecucionDeAlta(r);
  },
});
