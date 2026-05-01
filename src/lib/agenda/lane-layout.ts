import type { AgendaAppointmentDTO } from "./types";

export interface LaneSlot {
  appt: AgendaAppointmentDTO;
  lane: number;
  laneCount: number;
}

interface ClusterState {
  members: AgendaAppointmentDTO[];
  laneOf: Map<string, number>;
  endMs: number;
}

function endMsOf(a: AgendaAppointmentDTO, fallbackMin: number): number {
  const startMs = new Date(a.startsAt).getTime();
  if (!a.endsAt) return startMs + fallbackMin * 60_000;
  return new Date(a.endsAt).getTime();
}

/**
 * Asigna a cada cita una `lane` (columna paralela) y un `laneCount`
 * (cantidad total de carriles en su grupo overlapping). Resuelve el
 * solapamiento visual: en vez de apilarse en la misma `top/left/width`,
 * cada una toma `width = 100% / laneCount` y `left = lane * width`.
 *
 * Algoritmo (greedy estilo Google Calendar):
 *  1. Filtramos cancelaciones (no ocupan carril).
 *  2. Ordenamos por `startsAt` asc, desempate por `endsAt` desc.
 *  3. Mantenemos un cluster activo (citas conectadas por overlap
 *     transitivo). Cuando una cita arranca después del `endMs` máximo
 *     del cluster, lo cerramos y comenzamos uno nuevo.
 *  4. Dentro del cluster, una cita toma la lane libre más baja
 *     considerando SOLO las citas que siguen activas en su startMs (no
 *     las que ya terminaron antes). Esto permite re-uso de lanes
 *     cuando una cita corta terminó en medio del cluster.
 *  5. Al cerrar un cluster, todas sus citas reciben el mismo
 *     `laneCount = max(lane) + 1` para que el ancho visual sea
 *     uniforme.
 *
 * Citas sin `endsAt` usan `startsAt + fallbackMin` como duración (mismo
 * default que el card cuando no tiene endsAt).
 *
 * Multi-tenant: el caller filtra por clinicId/doctor antes de llamar;
 * este helper es agnóstico de tenant.
 */
export function assignLanes(
  appts: AgendaAppointmentDTO[],
  fallbackDurationMin = 30,
): LaneSlot[] {
  const visible = appts.filter((a) => a.status !== "CANCELLED");
  if (visible.length === 0) return [];

  const sorted = [...visible].sort((a, b) => {
    const sa = new Date(a.startsAt).getTime();
    const sb = new Date(b.startsAt).getTime();
    if (sa !== sb) return sa - sb;
    return endMsOf(b, fallbackDurationMin) - endMsOf(a, fallbackDurationMin);
  });

  const results: LaneSlot[] = [];

  function flush(cluster: ClusterState) {
    if (cluster.members.length === 0) return;
    let maxLane = 0;
    cluster.laneOf.forEach((lane) => {
      if (lane > maxLane) maxLane = lane;
    });
    const laneCount = maxLane + 1;
    for (const m of cluster.members) {
      results.push({
        appt: m,
        lane: cluster.laneOf.get(m.id) ?? 0,
        laneCount,
      });
    }
  }

  let cluster: ClusterState = { members: [], laneOf: new Map(), endMs: 0 };

  for (const appt of sorted) {
    const startMs = new Date(appt.startsAt).getTime();
    const endMs = endMsOf(appt, fallbackDurationMin);

    if (cluster.members.length > 0 && startMs >= cluster.endMs) {
      flush(cluster);
      cluster = { members: [], laneOf: new Map(), endMs: 0 };
    }

    const activeLanes = new Set<number>();
    for (const m of cluster.members) {
      if (endMsOf(m, fallbackDurationMin) > startMs) {
        const lane = cluster.laneOf.get(m.id);
        if (lane !== undefined) activeLanes.add(lane);
      }
    }
    let lane = 0;
    while (activeLanes.has(lane)) lane++;

    cluster.members.push(appt);
    cluster.laneOf.set(appt.id, lane);
    if (endMs > cluster.endMs) cluster.endMs = endMs;
  }

  flush(cluster);

  return results.sort((a, b) => {
    const sa = new Date(a.appt.startsAt).getTime();
    const sb = new Date(b.appt.startsAt).getTime();
    return sa - sb;
  });
}
