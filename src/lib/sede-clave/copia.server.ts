// ws1-t4 v2 · G1 (revisión de t8) — «Copiar la configuración» al crear una sede
// NO puede sacar la configuración de una sede con clave.
//
// La copia sale de la sede PRINCIPAL del dueño (la más antigua): catálogo con
// precios y costos, paquetes, plantillas, hojas, textos del bot, horario,
// recordatorios e imágenes de documentos. Si la principal tiene clave y quien
// crea la sede no la ha tecleado en este navegador, copiarla sería enseñarle
// todo eso en una sede donde sí puede entrar. Entonces:
//   · se copia de la sede ACTIVA (desde la que se crea) si esa no tiene clave;
//   · si también tiene clave (o no se puede comprobar), la sede nace con los
//     valores de siempre, sin copia;
// y el diálogo lo dice (`aviso`).
import { sedesCerradasPara, sedesConClave } from "./gate.server";
import type { AvisoCopia } from "./constantes";

export type { AvisoCopia } from "./constantes";

export interface OrigenDeCopia {
  origen: { clinicId: string; nombre: string } | null;
  aviso: AvisoCopia | null;
}

export async function origenDeCopiaParaSedeNueva(args: {
  supabaseId: string;
  principal: { clinicId: string; nombre: string } | null;
  activa: { clinicId: string; nombre: string };
}): Promise<OrigenDeCopia> {
  const { supabaseId, principal, activa } = args;
  if (!principal) return { origen: null, aviso: null };
  const cerradas = await sedesCerradasPara(supabaseId, [principal.clinicId]);
  if (!cerradas.has(principal.clinicId)) return { origen: principal, aviso: null };
  if (activa.clinicId !== principal.clinicId && activa.clinicId) {
    const conClave = await sedesConClave([activa.clinicId]);
    if (!conClave.has(activa.clinicId)) return { origen: activa, aviso: "principal_con_clave_desde_activa" };
  }
  return { origen: null, aviso: "principal_con_clave_sin_copia" };
}
