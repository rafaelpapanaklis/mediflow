// Ortodoncia — el arco que lleva puesto el paciente EN CADA ARCADA (ws1-t12, revisión en panel.108, fallo 4). PURO.
//
// Desde ws1-t12 (punto 4b) cambiar solo el arco superior deja el anterior «actual» en la inferior, así que el caso puede
// llevar dos arcos a la vez. `resolveCurrentWire` (current-wire.ts) devuelve uno solo —el último anotado— y la cabecera
// decía «NiTi 016» aunque abajo siguiera el «NiTi 014». Aquí se resuelve cada arcada por separado con el mismo criterio:
// manda lo anotado en las hojas de control FIRMADAS (la más reciente primero: su «Arco nuevo» y, si no cubre esa
// arcada, el «Actual» con el que llegó); sin ninguna que la cubra, el paso «actual» de la Secuencia de arcos de esa
// arcada (el último por orden).

import { arcadaDeArco } from "./material-de-arco";

type Arco = { id: string; archUpper?: boolean | null; archLower?: boolean | null };

export interface ArcosActuales<A> {
  superior: A | null;
  inferior: A | null;
}

function cubre(arco: Arco, arcada: "superior" | "inferior"): boolean {
  const a = arcadaDeArco(arco);
  return a === "Ambas" || a.toLowerCase() === arcada;
}

export function arcosActuales<A extends Arco>(
  pasos: readonly (A & { status: string; orderIndex: number })[],
  controles: readonly { status: string; visitDate: string | Date; wireFrom: A | null; wireTo: A | null }[],
): ArcosActuales<A> {
  const firmados = controles
    .map((c, i) => ({ c, i, t: new Date(c.visitDate).getTime() }))
    .filter(({ c }) => c.status === "SIGNED" && (c.wireTo || c.wireFrom))
    .sort((a, b) => b.t - a.t || b.i - a.i)
    .map(({ c }) => c);
  const activos = pasos.filter((p) => p.status === "ACTIVE").sort((a, b) => b.orderIndex - a.orderIndex);

  const de = (arcada: "superior" | "inferior"): A | null => {
    for (const c of firmados) {
      if (c.wireTo && cubre(c.wireTo, arcada)) return c.wireTo;
      if (c.wireFrom && cubre(c.wireFrom, arcada)) return c.wireFrom;
    }
    return activos.find((p) => cubre(p, arcada)) ?? null;
  };
  return { superior: de("superior"), inferior: de("inferior") };
}
