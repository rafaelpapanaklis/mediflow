"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Clock, Users } from "lucide-react";
import type { LiveAppointment } from "@/lib/floor-plan/elements";
import waitingStyles from "./waiting-room.module.css";

export interface WaitingRoomEntry {
  id: string;
  patient: string;
  treatment: string;
  doctor: string;
  checkedInAt: string | null;
  scheduledAt: string;
}

interface ChairInfo {
  id: string;
  name: string;
}

/** Mensaje del "llamado por turnos" que se muestra como banner animado. */
interface CallAnnouncement {
  id: string;        // = appointmentId que dejó la sala
  patient: string;
  chairName: string;
  startedAt: number;
}

const CALL_DURATION_MS = 8000;

/**
 * Sala de espera + llamado por turnos.
 * - Lista los pacientes CHECKED_IN ordenados por checkedInAt.
 * - Detecta cuando un paciente sale de la lista (transición CHECKED_IN →
 *   IN_PROGRESS) y, si está asignado a un sillón, muestra el banner
 *   "Paciente X → Sillón Y" con audio opcional.
 */
export function WaitingRoom({
  waiting,
  appointments,
  chairs,
  enableSound = false,
}: {
  waiting: WaitingRoomEntry[];
  appointments: LiveAppointment[];
  chairs: ChairInfo[];
  enableSound?: boolean;
}) {
  const [announcement, setAnnouncement] = useState<CallAnnouncement | null>(null);
  const [soundOn, setSoundOn] = useState(enableSound);
  const prevWaitingIdsRef = useRef<Set<string>>(new Set());
  const announcedIdsRef = useRef<Set<string>>(new Set());

  // Detección de transiciones: ids que estaban antes y ya no están.
  useEffect(() => {
    const currentIds = new Set(waiting.map((w) => w.id));
    const prev = prevWaitingIdsRef.current;
    if (prev.size > 0) {
      // Encontrar el primer id que dejó la lista y NO ya fue anunciado.
      const prevArr = Array.from(prev);
      for (const id of prevArr) {
        if (!currentIds.has(id) && !announcedIdsRef.current.has(id)) {
          // Buscar a qué sillón fue asignado en appointments.
          const apt = appointments.find((a) => a.id === id);
          if (apt?.resourceId) {
            const chair = chairs.find((c) => c.id === apt.resourceId);
            const chairName = chair?.name ?? "Sillón";
            announcedIdsRef.current.add(id);
            setAnnouncement({
              id,
              patient: apt.patient,
              chairName,
              startedAt: Date.now(),
            });
            if (soundOn) playChime();
          }
        }
      }
    }
    prevWaitingIdsRef.current = currentIds;
  }, [waiting, appointments, chairs, soundOn]);

  // Auto-dismiss del banner después de CALL_DURATION_MS.
  useEffect(() => {
    if (!announcement) return;
    const id = setTimeout(() => setAnnouncement(null), CALL_DURATION_MS);
    return () => clearTimeout(id);
  }, [announcement]);

  const sortedWaiting = useMemo(() => {
    // checkedInAt asc; si null, fallback a scheduledAt.
    return waiting.slice().sort((a, b) => {
      const ta = a.checkedInAt ? new Date(a.checkedInAt).getTime() : new Date(a.scheduledAt).getTime();
      const tb = b.checkedInAt ? new Date(b.checkedInAt).getTime() : new Date(b.scheduledAt).getTime();
      return ta - tb;
    });
  }, [waiting]);

  const formatWait = (entry: WaitingRoomEntry) => {
    const ref = entry.checkedInAt ? new Date(entry.checkedInAt) : new Date(entry.scheduledAt);
    const min = Math.max(0, Math.floor((Date.now() - ref.getTime()) / 60_000));
    if (min === 0) return "ahora";
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  return (
    <div className={waitingStyles.wrap}>
      {/* Banner de llamado */}
      {announcement && (
        <div className={waitingStyles.callBanner} role="status" aria-live="polite">
          <div className={waitingStyles.callBannerInner}>
            <Bell size={18} aria-hidden />
            <span className={waitingStyles.callPatient}>{announcement.patient}</span>
            <span className={waitingStyles.callArrow}>→</span>
            <span className={waitingStyles.callChair}>{announcement.chairName}</span>
          </div>
        </div>
      )}

      <header className={waitingStyles.header}>
        <span className={waitingStyles.headerTitle}>
          <Users size={13} aria-hidden /> Sala de espera
        </span>
        <span className={waitingStyles.headerCount}>{sortedWaiting.length}</span>
        <button
          type="button"
          className={waitingStyles.soundBtn}
          onClick={() => setSoundOn((v) => !v)}
          title={soundOn ? "Sonido del llamado: activo" : "Sonido del llamado: silenciado"}
          aria-pressed={soundOn}
        >
          {soundOn ? <Bell size={12} aria-hidden /> : <BellOff size={12} aria-hidden />}
        </button>
      </header>

      {sortedWaiting.length === 0 ? (
        <div className={waitingStyles.empty}>
          Sin pacientes esperando.
        </div>
      ) : (
        <ul className={waitingStyles.list}>
          {sortedWaiting.map((w, idx) => (
            <li key={w.id} className={waitingStyles.item}>
              <span className={waitingStyles.position}>{idx + 1}</span>
              <div className={waitingStyles.itemBody}>
                <div className={waitingStyles.itemPatient}>{w.patient}</div>
                <div className={waitingStyles.itemMeta}>
                  {w.treatment} · {w.doctor}
                </div>
              </div>
              <span className={waitingStyles.itemWait}>
                <Clock size={10} aria-hidden /> {formatWait(w)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Genera un tono "campanita" simple usando Web Audio API. */
function playChime() {
  try {
    const Ctx =
      (window.AudioContext as typeof AudioContext) ??
      ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones = [
      { freq: 880, start: 0 },
      { freq: 1320, start: 0.18 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      gain.gain.setValueAtTime(0, now + t.start);
      gain.gain.linearRampToValueAtTime(0.18, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + 0.5);
    }
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* silent — sin Audio API o bloqueado por autoplay policy */
  }
}
