// «Ya existe … ¿Abrir su ficha o crear igual?» (ws1-t1, auditoría BEVADENT, E2).
//
// El POST de `/api/patients` responde 409 DUPLICATE_PATIENT con los gemelos que la sesión PUEDE ver (id,
// número, nombre, teléfono) y si además hay alguno fuera de su alcance. «Nuevo paciente» preguntaba con un
// `window.confirm` del navegador: solo «Aceptar/Cancelar», sin decir cuál era el gemelo ni dejar abrir su
// ficha — y lo que recepción casi siempre quiere es ir al expediente que ya existe, no crear otro.

export interface GemeloVisible {
  id: string;
  patientNumber: string | null;
  fullName: string;
  phone: string | null;
}

export interface Duplicado {
  gemelos: GemeloVisible[];
  hayOcultos: boolean;
  /** La frase del servidor, por si no hay ningún gemelo visible que nombrar. */
  mensaje: string | null;
}

/** Lee el cuerpo del 409. `null` si no es un aviso de duplicado. */
export function leerDuplicado(cuerpo: unknown): Duplicado | null {
  const c = cuerpo as Record<string, unknown> | null;
  if (!c || c.code !== "DUPLICATE_PATIENT") return null;
  const lista = Array.isArray(c.duplicates) ? c.duplicates : [];
  const gemelos: GemeloVisible[] = [];
  for (const d of lista) {
    const g = d as Record<string, unknown> | null;
    if (!g || typeof g.id !== "string" || !g.id) continue;
    gemelos.push({
      id: g.id,
      patientNumber: typeof g.patientNumber === "string" && g.patientNumber ? g.patientNumber : null,
      fullName: typeof g.fullName === "string" ? g.fullName : "",
      phone: typeof g.phone === "string" && g.phone ? g.phone : null,
    });
  }
  return {
    gemelos,
    hayOcultos: c.hasHiddenDuplicates === true,
    mensaje: typeof c.error === "string" && c.error ? c.error : null,
  };
}

export interface TextosDuplicado {
  titulo: string;
  /** Con gemelos visibles. `{name}` = el nombre que se está dando de alta. */
  cuerpoVisible: (nombre: string, cuantos: number) => string;
  cuerpoOculto: string;
  abrirFicha: string;
  crearIgual: string;
  cancelar: string;
  creando: string;
}

const ES: TextosDuplicado = {
  titulo: "Este paciente ya podría existir",
  cuerpoVisible: (nombre, cuantos) =>
    cuantos === 1
      ? `Ya existe un paciente con el nombre «${nombre}». ¿Abrir su ficha o crear uno nuevo igual?`
      : `Ya existen ${cuantos} pacientes con el nombre «${nombre}». ¿Abrir una de sus fichas o crear uno nuevo igual?`,
  cuerpoOculto:
    "Ya existe en la clínica un paciente con estos datos que no puedes ver. Pide a un administrador que lo revise antes de crear otro expediente, o créalo igual si es otra persona.",
  abrirFicha: "Abrir su ficha",
  crearIgual: "Crear igual",
  cancelar: "Cancelar",
  creando: "Creando…",
};

const EN: TextosDuplicado = {
  titulo: "This patient may already exist",
  cuerpoVisible: (nombre, cuantos) =>
    cuantos === 1
      ? `A patient named «${nombre}» already exists. Open their record or create a new one anyway?`
      : `${cuantos} patients named «${nombre}» already exist. Open one of their records or create a new one anyway?`,
  cuerpoOculto:
    "A patient with these details already exists in the clinic but you can't see them. Ask an administrator to check before creating another record, or create it anyway if it's a different person.",
  abrirFicha: "Open record",
  crearIgual: "Create anyway",
  cancelar: "Cancel",
  creando: "Creating…",
};

export function textosDuplicado(locale: string | null | undefined): TextosDuplicado {
  return (locale ?? "es").toLowerCase().startsWith("en") ? EN : ES;
}
