// ═══════════════════════════════════════════════════════════════════════════
// A QUIÉN SE LE MANDA UNA FACTURA O UN RECIBO (ws1-t10, decisión de Rafael).
//
// Si el caso de la factura tiene RESPONSABLE DE PAGO (el tutor u otra persona,
// en ortodoncia), el aviso de saldo, la factura por correo y el recibo se le
// ofrecen a él —es quien paga—, y al paciente si también tiene por dónde. Sin
// responsable, exactamente como siempre: al paciente. El aviso de «no tiene
// teléfono/correo» solo sale si NINGUNO de los dos tiene.
//
// PURO: sin Prisma ni red. Lo usan las tres rutas de envío y la ficha.
// ═══════════════════════════════════════════════════════════════════════════

export type CanalDeEnvio = "telefono" | "correo";

/**
 * A quién va: "auto" = el responsable si tiene ese canal y, si no, el paciente
 * (lo que hace el botón sin más); o el que se elija: solo uno, o los dos.
 */
export type DestinoDeEnvio = "auto" | "responsable" | "paciente" | "ambos";

export const DESTINOS_DE_ENVIO: readonly DestinoDeEnvio[] = ["auto", "responsable", "paciente", "ambos"];

export function esDestinoDeEnvio(v: unknown): v is DestinoDeEnvio {
  return typeof v === "string" && (DESTINOS_DE_ENVIO as readonly string[]).includes(v);
}

export interface PersonaDeContacto {
  nombre: string;
  /** «madre», «padre»… ya legible, o vacío. Solo el responsable lo lleva. */
  parentesco?: string | null;
  telefono?: string | null;
  correo?: string | null;
}

export interface Destinatario {
  rol: "responsable" | "paciente";
  nombre: string;
  /** El teléfono o el correo, recortado. */
  valor: string;
}

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function valorDe(p: PersonaDeContacto | null | undefined, canal: CanalDeEnvio): string | null {
  const v = (canal === "telefono" ? p?.telefono : p?.correo)?.trim() ?? "";
  if (!v) return null;
  return canal === "correo" && !CORREO_VALIDO.test(v) ? null : v;
}

/** «María Pérez (madre)», o solo el nombre. */
export function nombreConParentesco(p: PersonaDeContacto): string {
  const par = p.parentesco?.trim();
  return par ? `${p.nombre} (${par})` : p.nombre;
}

export interface ResultadoDeDestinatarios {
  destinatarios: Destinatario[];
  /** No hay a quién mandárselo. */
  sinContacto: boolean;
  /** Por qué, en palabras de la clínica (null si hay a quién). */
  motivo: string | null;
}

const PALABRA: Record<CanalDeEnvio, { sin: string; invalido: string }> = {
  telefono: { sin: "teléfono registrado", invalido: "teléfono registrado" },
  correo: { sin: "correo registrado", invalido: "correo válido" },
};

/**
 * Los destinatarios de un envío por `canal`. El motivo de «no hay a quién» dice
 * de quién falta el dato: sin responsable habla solo del paciente (el aviso de
 * siempre); con responsable, de los dos.
 */
export function destinatariosDeEnvio(args: {
  paciente: PersonaDeContacto | null | undefined;
  responsable: PersonaDeContacto | null | undefined;
  canal: CanalDeEnvio;
  destino?: DestinoDeEnvio;
}): ResultadoDeDestinatarios {
  const { paciente, responsable, canal } = args;
  const destino = args.destino ?? "auto";
  const vPac = valorDe(paciente, canal);
  const vResp = valorDe(responsable, canal);
  const pac: Destinatario | null = vPac ? { rol: "paciente", nombre: paciente?.nombre || "Paciente", valor: vPac } : null;
  const resp: Destinatario | null = vResp && responsable ? { rol: "responsable", nombre: responsable.nombre, valor: vResp } : null;

  let elegidos: Destinatario[];
  switch (destino) {
    case "responsable": elegidos = resp ? [resp] : []; break;
    case "paciente": elegidos = pac ? [pac] : []; break;
    case "ambos": elegidos = [resp, pac].filter((x): x is Destinatario => x !== null); break;
    default: elegidos = resp ? [resp] : pac ? [pac] : [];
  }
  // Mismo teléfono o correo en los dos (p. ej. el tutor dio el del hijo): un solo mensaje.
  elegidos = elegidos.filter((d, i) => elegidos.findIndex((o) => o.valor.toLowerCase() === d.valor.toLowerCase()) === i);
  if (elegidos.length > 0) return { destinatarios: elegidos, sinContacto: false, motivo: null };

  const dato = PALABRA[canal];
  let motivo: string;
  if (!responsable) {
    motivo = `El paciente no tiene ${canal === "telefono" ? "teléfono registrado" : "correo registrado"}.`;
  } else if (destino === "responsable") {
    motivo = `El responsable de pago (${nombreConParentesco(responsable)}) no tiene ${dato.invalido}. Agrégalo en el expediente del paciente.`;
  } else if (destino === "paciente") {
    motivo = `El paciente no tiene ${dato.sin}.`;
  } else {
    motivo = `Ni el responsable de pago (${nombreConParentesco(responsable)}) ni el paciente tienen ${dato.sin}. Agrégalo en el expediente del paciente.`;
  }
  return { destinatarios: [], sinContacto: true, motivo };
}

/**
 * Para la ficha (sin los datos, solo si los hay): ¿se puede mandar por este canal?
 * Con responsable basta que uno de los dos tenga; sin responsable, el paciente.
 */
export function hayPorDondeEnviar(c: { paciente: boolean; responsable?: boolean | null; hayResponsable?: boolean }): boolean {
  return c.hayResponsable ? c.paciente || c.responsable === true : c.paciente;
}

/** Lo que dice el botón bajo la ficha: «Se enviará a María (madre)». */
export function textoDeDestino(destino: DestinoDeEnvio, resp: PersonaDeContacto | null | undefined): string | null {
  if (!resp) return null;
  const quien = nombreConParentesco(resp);
  if (destino === "paciente") return "Se enviará al paciente";
  if (destino === "ambos") return `Se enviará a ${quien} y al paciente`;
  return `Se enviará a ${quien}, responsable del pago`;
}

/** Lo que la ficha de la factura sabe del contacto (sin los datos, solo si existen). */
export interface ContactoDeFicha {
  correo: boolean;
  telefono: boolean;
  responsable?: { nombre: string; parentesco?: string | null; correo: boolean; telefono: boolean } | null;
}

/**
 * Para la ficha: ¿se puede mandar por este canal y por qué no? `contacto` undefined = todavía no se
 * sabe (no se deshabilita nada: la ruta responde con su motivo). Con responsable, el aviso de «no
 * tiene» solo sale si NINGUNO de los dos tiene; sin responsable, el de siempre (del paciente).
 */
export function estadoDeEnvioEnFicha(
  contacto: ContactoDeFicha | undefined,
  canal: CanalDeEnvio,
): { puede: boolean; motivo: string | null; hayResponsable: boolean } {
  if (!contacto) return { puede: true, motivo: null, hayResponsable: false };
  const resp = contacto.responsable ?? null;
  const dePaciente = canal === "telefono" ? contacto.telefono : contacto.correo;
  const deResp = resp ? (canal === "telefono" ? resp.telefono : resp.correo) : false;
  if (dePaciente || deResp) return { puede: true, motivo: null, hayResponsable: !!resp };
  if (!resp) return { puede: false, motivo: null, hayResponsable: false }; // el texto de siempre lo pone la ficha
  const dato = canal === "telefono" ? "teléfono" : "correo";
  return {
    puede: false,
    motivo: `Ni el responsable de pago (${nombreConParentesco({ nombre: resp.nombre, parentesco: resp.parentesco })}) ni el paciente tienen ${dato} registrado: agrégalo en el expediente para poder enviar la factura.`,
    hayResponsable: true,
  };
}

/**
 * A quién se puede mandar desde la ficha, para la lista de opciones: el responsable primero; el
 * paciente solo si tiene ese canal; «los dos» si ambos lo tienen. Vacío = sin responsable (no hay
 * nada que elegir: va al paciente).
 */
export function opcionesDeDestinoEnFicha(
  contacto: ContactoDeFicha | undefined,
  canal: CanalDeEnvio,
): Array<{ valor: DestinoDeEnvio; texto: string }> {
  const resp = contacto?.responsable;
  if (!contacto || !resp) return [];
  const pac = canal === "telefono" ? contacto.telefono : contacto.correo;
  const rsp = canal === "telefono" ? resp.telefono : resp.correo;
  const nombre = nombreConParentesco({ nombre: resp.nombre, parentesco: resp.parentesco });
  const lista: Array<{ valor: DestinoDeEnvio; texto: string }> = [];
  if (rsp) lista.push({ valor: "responsable", texto: `Responsable de pago: ${nombre}` });
  if (pac) lista.push({ valor: "paciente", texto: "Paciente" });
  if (pac && rsp) lista.push({ valor: "ambos", texto: "Los dos" });
  return lista;
}
