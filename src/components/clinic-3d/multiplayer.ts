// ─────────────────────────────────────────────────────────────────────────────
// A1 — Multijugador con Supabase Realtime (presence + broadcast). SIN servidor
// nuevo. Reutiliza el browser client EXISTENTE: createClient de
// "@/lib/supabase/client" (createBrowserClient de @supabase/ssr; lee
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — YA presentes en el
// repo y validadas en src/env.ts).
//
// TODO(A1): implementar createMultiplayer según este brief.
//
// GUARD: si typeof window === "undefined" o falta process.env.NEXT_PUBLIC_SUPABASE_URL
//   o NEXT_PUBLIC_SUPABASE_ANON_KEY o opts.channelName → enabled=false y todo no-op
//   (el HUD mostrará el aviso discreto "multijugador no disponible"). NUNCA lances.
//
// CANAL: const supabase = createClient(); const channel = supabase.channel(
//   opts.channelName, { config: { presence: { key: <id estable de sesión> },
//   broadcast: { self: false } } });
//   - id de sesión: crypto.randomUUID?.() ?? String(Math.random()).slice(2).
//   - presence: al "subscribe" con status "SUBSCRIBED" → channel.track(opts.me)
//     ({ name, color }).
//   - mantén un Map<key, RemotePlayerState> con lo conocido de cada quien:
//     · presence "sync"/"join"/"leave": reconstruye nombres/colores desde
//       channel.presenceState() (cada entrada trae el meta {name,color}); aplica
//       altas/bajas. EXCLUYE tu propia key. En "leave" elimina del Map.
//     · broadcast "pos" (payload PosBroadcast + viene el sender? usa
//       payload.key o incrústalo): actualiza x/z/yaw/t del jugador; si no existe
//       aún (llegó pos antes que presence), créalo con su meta cuando llegue.
//   - tras CUALQUIER cambio llama opts.onPlayers(Array.from(map.values())) — usa
//     .forEach/Array.from, NUNCA for...of sobre Map (target TS sin ES2015).
//
// sendPos(x,z,yaw): si !enabled return; channel.send({ type:"broadcast",
//   event:"pos", payload: { key:<miId>, x, z, yaw } }). El THROTTLE (10 Hz) y el
//   umbral de cambio los aplica el ORQUESTADOR antes de llamar; aquí solo envía.
//
// dispose(): channel.untrack().catch(()=>{}); supabase.removeChannel(channel);
//   limpia el Map. Idempotente.
//
// enabled = true solo si se pudo crear el canal.
// ─────────────────────────────────────────────────────────────────────────────

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { PresenceMeta, RemotePlayerState } from "./world-types";

export interface Multiplayer {
  enabled: boolean;
  sendPos(x: number, z: number, yaw: number): void;
  dispose(): void;
}

export interface MultiplayerOpts {
  channelName: string;
  me: PresenceMeta;
  onPlayers: (players: RemotePlayerState[]) => void;
}

export function createMultiplayer(opts: MultiplayerOpts): Multiplayer {
  // GUARD: sin browser, sin envs de Supabase o sin canal → no-op silencioso.
  if (
    typeof window === "undefined" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !opts.channelName
  ) {
    return {
      enabled: false,
      sendPos() {},
      dispose() {},
    };
  }

  // ID estable de esta sesión (clave de presence y remitente del broadcast).
  const myId =
    (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
    String(Math.random()).slice(2);

  // Lo conocido de cada jugador remoto (nunca incluye mi propia key).
  const players = new Map<string, RemotePlayerState>();
  let disposed = false;

  const emit = () => {
    opts.onPlayers(Array.from(players.values()));
  };

  let supabase: ReturnType<typeof createClient>;
  let channel: RealtimeChannel;
  try {
    supabase = createClient();
    channel = supabase.channel(opts.channelName, {
      config: {
        presence: { key: myId },
        broadcast: { self: false },
      },
    });
  } catch {
    // Si por lo que sea no se pudo crear el canal → multijugador desactivado.
    return {
      enabled: false,
      sendPos() {},
      dispose() {},
    };
  }

  // Reconcilia el Map contra el snapshot de presence: agrega/actualiza meta de
  // los presentes (excluyendo mi key) y elimina a los que ya no están.
  const reconcileFromPresence = () => {
    const state = channel.presenceState() as Record<
      string,
      Array<Partial<PresenceMeta>>
    >;
    const seen = new Set<string>();
    let changed = false;

    Object.keys(state).forEach((key) => {
      if (key === myId) return;
      seen.add(key);
      const metas = state[key];
      const meta = metas && metas.length ? metas[metas.length - 1] : undefined;
      const name = meta?.name ?? "Invitado";
      const color = meta?.color ?? "#888888";
      const existing = players.get(key);
      if (existing) {
        // Conserva posición conocida; solo refresca identidad si cambió.
        if (existing.name !== name || existing.color !== color) {
          existing.name = name;
          existing.color = color;
          changed = true;
        }
      } else {
        // Aún sin pos (llegará por broadcast); arranca en origen.
        players.set(key, {
          id: key,
          name,
          color,
          x: 0,
          z: 0,
          yaw: 0,
          t: Date.now(),
        });
        changed = true;
      }
    });

    // Bajas: quien está en el Map pero ya no en presence.
    Array.from(players.keys()).forEach((key) => {
      if (!seen.has(key)) {
        players.delete(key);
        changed = true;
      }
    });

    if (changed) emit();
  };

  channel
    .on("presence", { event: "sync" }, reconcileFromPresence)
    .on("presence", { event: "join" }, reconcileFromPresence)
    .on("presence", { event: "leave" }, reconcileFromPresence)
    .on("broadcast", { event: "pos" }, ({ payload }) => {
      const p = payload as { key?: string; x: number; z: number; yaw: number };
      const key = p?.key;
      if (!key || key === myId) return;
      const existing = players.get(key);
      if (existing) {
        existing.x = p.x;
        existing.z = p.z;
        existing.yaw = p.yaw;
        existing.t = Date.now();
      } else {
        // Pos llegó antes que presence: créalo; la meta llegará en el sync.
        players.set(key, {
          id: key,
          name: "Invitado",
          color: "#888888",
          x: p.x,
          z: p.z,
          yaw: p.yaw,
          t: Date.now(),
        });
      }
      emit();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && !disposed) {
        channel.track(opts.me);
      }
    });

  return {
    enabled: true,
    sendPos(x: number, z: number, yaw: number) {
      if (disposed) return;
      // El throttle (POS_HZ) y el umbral de cambio los aplica el orquestador.
      channel.send({
        type: "broadcast",
        event: "pos",
        payload: { key: myId, x, z, yaw },
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
      players.clear();
    },
  };
}
