/**
 * `ayuda_del_panel` — los pasos EN PANTALLA para hacer algo en DaleControl:
 * «¿cómo configuro Mercado Pago?», «¿dónde bloqueo la agenda de un doctor?».
 *
 * No lee la base: devuelve el texto de UN tema de `../ayuda-del-panel`, en el
 * idioma del panel de la clínica (`ctx.idioma`), para que los botones se
 * llamen como los ve quien pregunta.
 *
 * 🔴 Si el tema no está en la lista, Sabina NO se inventa los pasos. El enum de
 * `tema` es cerrado a propósito: una pregunta de ayuda que no cabe en ningún
 * tema no tiene por dónde entrar, y la descripción le dice al modelo que lo
 * admita. Una instrucción inventada le hace perder media hora a una
 * recepcionista.
 *
 * 🔴 Explicar no es hacer: esta herramienta no conecta, no cambia ajustes y no
 * cobra. Los pasos los da el usuario en la pantalla.
 *
 * ── EL PERMISO ─────────────────────────────────────────────────────────
 * `today.view`. No protege ningún dato (aquí no hay datos de la clínica): es
 * la key que los cinco roles tienen por defecto, y el contrato exige una. Que
 * alguien lea los pasos para conectar Mercado Pago no le abre la pantalla: la
 * pantalla sigue pidiendo su propio permiso, y el texto dice quién puede.
 */

import { z } from "zod";
import { definirHerramienta } from "./base";
import { IDS_TEMAS_AYUDA, TEMAS_AYUDA, temaAyuda, type IdiomaAyuda } from "../ayuda-del-panel";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  tema: z.enum(IDS_TEMAS_AYUDA),
});

export type ParamsAyuda = z.infer<typeof parametros>;

/**
 * Sin el texto: los pasos viajan UNA vez, en el `resumen`. El motor le manda al
 * modelo `datos` y `resumen` juntos, y con los pasos en los dos cada pregunta de
 * ayuda los cobraba dos veces.
 */
export interface DatosAyuda {
  tema: string;
  idioma: IdiomaAyuda;
}

function idiomaDe(ctx: SabinaCtx): IdiomaAyuda {
  return ctx.idioma === "en" ? "en" : "es";
}

async function ejecutar(ctx: SabinaCtx, params: ParamsAyuda): Promise<DatosAyuda> {
  const tema = temaAyuda(params.tema);
  // El enum ya lo cerró; esto solo cubre una llamada directa a `ejecutar`.
  if (!tema) throw new Error(`tema_desconocido: ${params.tema}`);
  const idioma = idiomaDe(ctx);
  return { tema: tema.id, idioma };
}

function resumir(d: DatosAyuda): string {
  const aviso =
    d.idioma === "en"
      ? "El panel de esta clínica está en inglés: cita los botones tal cual vienen aquí."
      : "Cita los botones tal cual vienen aquí.";
  const pasos = temaAyuda(d.tema)?.texto[d.idioma] ?? "";
  return `Pasos del panel (${d.tema}). ${aviso} No añadas pasos que no estén en este texto.\n${pasos}`;
}

export const ayudaDelPanel = definirHerramienta<ParamsAyuda, DatosAyuda>({
  nombre: "ayuda_del_panel",
  descripcion:
    "Pasos en pantalla para hacer algo en el panel de DaleControl. Temas: " +
    TEMAS_AYUDA.map((t) => `${t.id} (${t.pista})`).join("; ") +
    ". Si lo que preguntan no es ninguno de estos temas, NO la llames y NO inventes pasos, botones ni pantallas: di que no tienes esa guía y que pregunten a soporte.",
  parametros,
  permiso: "today.view",
  ejecutar,
  resumir,
  vacio: () => false,
});
