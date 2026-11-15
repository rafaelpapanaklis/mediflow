"use client";

// ═══════════════════════════════════════════════════════════════════════
// Mover una visita arrastrándola y alargarla jalando su borde de abajo —
// en la vista Día y en la vista Semana, con mouse y con el dedo.
//
// Punteros a pelo (no @dnd-kit), como ya hacía la vista Día, por la misma
// razón: hay que VALIDAR el hueco mientras se mueve para pintar el fantasma
// en rojo, con el motivo, ANTES de soltar. La validación es la que da la
// pantalla (slotVerdict → checkAppointmentSlot, la misma del servidor).
//
// Lo que la pantalla anticipa y lo que NO:
//  · Soltar en un hueco que la pantalla ve inválido no manda nada: la visita
//    se queda donde estaba y un aviso dice por qué.
//  · Soltar en uno válido llama a onMove/onResize; quien decide de verdad es
//    el servidor (PATCH de siempre). Si dice que no, la visita regresa.
//
// Con MOUSE: el arrastre empieza al moverse 4 px (antes es un clic, que abre
// el detalle). Con el DEDO: hay que MANTENER apretado ~0.45 s; si el dedo se
// mueve antes, era scroll de la agenda y la visita no se toca (antes, con
// `touch-action: none`, un dedo que caía sobre una visita no podía desplazar
// la agenda).
//
// Esc cancela. Cerca del borde de arriba o de abajo, la rejilla se desplaza
// sola para poder llevar la visita a una hora que no se ve.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { BarberAppointmentDTO } from "@/lib/barber/types";
import {
  DRAG_START_PX,
  LONG_PRESS_MS,
  avisarSinArrastre,
  edgeScrollDelta,
  minuteAtOffset,
  moveStartMinute,
  resizeDuration,
  touchGesture,
} from "./rejilla";

export type DragMode = "move" | "resize";

/** Dónde caería la visita si se soltara ahora. */
export interface DragPreview {
  appointmentId: string;
  mode: DragMode;
  /** Columna de destino (Día: barbero; Semana: día). */
  colKey: string;
  barberId: string;
  dayStartUtc: number;
  /** Minuto de inicio, contado desde la medianoche del día de la columna. */
  startMin: number;
  durationMin: number;
  /** ¿Cambia algo respecto de donde está? */
  changed: boolean;
  ok: boolean;
  /** Motivo, ya traducido, si no cabe. */
  reason: string;
}

export interface CardDragOptions {
  pxPerMin: number;
  boundsStart: number;
  boundsEnd: number;
  scrollerRef: RefObject<HTMLDivElement | null>;
  columnRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  /** La columna en la que hoy está la visita. */
  homeColumn: (appt: BarberAppointmentDTO) => string | null;
  /** Qué significa soltar en una columna: con qué barbero y en qué día. */
  resolveColumn: (
    colKey: string,
    appt: BarberAppointmentDTO,
  ) => { barberId: string; dayStartUtc: number } | null;
  verdict: (
    appt: BarberAppointmentDTO,
    target: { barberId: string; dayStartUtc: number; startMin: number; durationMin: number },
  ) => { ok: boolean; reason: string };
  canDrag: (appt: BarberAppointmentDTO) => boolean;
  onMove: (appt: BarberAppointmentDTO, startAt: Date, barberId: string) => void;
  onResize: (appt: BarberAppointmentDTO, durationMin: number) => void;
  /** Se soltó donde no cabe: la pantalla avisa por qué (no se manda nada). */
  onRejected: (appt: BarberAppointmentDTO, preview: DragPreview) => void;
  /** Al empezar a arrastrar (p. ej. para cerrar el resumen al pasar). */
  onStart?: () => void;
  /**
   * Se intentó arrastrar una visita que no se puede mover (completada,
   * cancelada, sin barbero o sin permiso): la pantalla dice por qué. Se
   * llama una vez por gesto, cuando el arrastre habría empezado.
   */
  onDenied?: (appt: BarberAppointmentDTO) => void;
}

interface Session {
  appt: BarberAppointmentDTO;
  mode: DragMode;
  pointerId: number;
  pointerType: string;
  originX: number;
  originY: number;
  downAt: number;
  lastX: number;
  lastY: number;
  homeKey: string;
  homeDayStartUtc: number;
  homeStartMin: number;
  homeDuration: number;
  grabOffsetMin: number;
  active: boolean;
  colKey: string;
  timer: number | null;
  frame: number | null;
  capture: HTMLElement | null;
}

export function useCardDrag(options: CardDragOptions) {
  const opt = useRef(options);
  opt.current = options;

  const session = useRef<Session | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const previewRef = useRef<DragPreview | null>(null);
  // «El clic que viene es la cola de un arrastre»: se levanta al soltar (o
  // cancelar) un arrastre ACTIVO y lo consume el siguiente clic.
  const justDragged = useRef(false);
  const listeners = useRef<(() => void) | null>(null);
  // El gesto sobre una visita que NO se mueve: solo para avisar (no arrastra).
  const deniedWatch = useRef<(() => void) | null>(null);

  /** Vigila el gesto sobre una visita que no se mueve y avisa una vez. */
  const watchDenied = useCallback((e: React.PointerEvent, appt: BarberAppointmentDTO) => {
    deniedWatch.current?.();
    const o = opt.current;
    if (!o.onDenied) return;
    const pointerId = e.pointerId;
    const pointerType = e.pointerType;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const t0 = performance.now();
    let lastX = x0;
    let lastY = y0;
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (deniedWatch.current === stop) deniedWatch.current = null;
    };
    const check = () => {
      const elapsed = performance.now() - t0;
      const moved = Math.hypot(lastX - x0, lastY - y0);
      if (avisarSinArrastre(pointerType, elapsed, moved)) {
        stop();
        opt.current.onDenied?.(appt);
      } else if (pointerType === "touch" && touchGesture(elapsed, moved) === "scroll") {
        // El dedo se movió antes de tiempo: era scroll, no se avisa nada.
        stop();
      }
    };
    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      check();
    }
    if (pointerType === "touch") timer = window.setTimeout(check, LONG_PRESS_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    deniedWatch.current = stop;
  }, []);

  const publish = useCallback((next: DragPreview | null) => {
    const prev = previewRef.current;
    const same =
      prev === next ||
      (prev &&
        next &&
        prev.appointmentId === next.appointmentId &&
        prev.mode === next.mode &&
        prev.colKey === next.colKey &&
        prev.startMin === next.startMin &&
        prev.durationMin === next.durationMin &&
        prev.ok === next.ok &&
        prev.changed === next.changed);
    if (same) return;
    previewRef.current = next;
    setPreview(next);
  }, []);

  const columnAt = useCallback((clientX: number): string | null => {
    for (const [key, node] of Array.from(opt.current.columnRefs.current.entries())) {
      const rect = node.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return key;
    }
    return null;
  }, []);

  const pointerMinuteIn = useCallback((colKey: string, clientY: number): number | null => {
    const node = opt.current.columnRefs.current.get(colKey);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return minuteAtOffset(clientY - rect.top, opt.current.boundsStart, opt.current.pxPerMin);
  }, []);

  /** Recalcula el destino con la última posición del puntero. */
  const compute = useCallback(() => {
    const s = session.current;
    if (!s || !s.active) return;
    const o = opt.current;
    let colKey = s.homeKey;
    let target = { barberId: s.appt.barberId ?? "", dayStartUtc: s.homeDayStartUtc };
    let startMin = s.homeStartMin;
    let durationMin = s.homeDuration;

    if (s.mode === "move") {
      const under = columnAt(s.lastX) ?? s.colKey;
      const resolved = o.resolveColumn(under, s.appt);
      if (resolved) {
        colKey = under;
        target = resolved;
      } else {
        colKey = s.colKey;
        target = o.resolveColumn(colKey, s.appt) ?? target;
      }
      const pointerMin = pointerMinuteIn(colKey, s.lastY);
      if (pointerMin === null) return;
      startMin = moveStartMinute({
        pointerMin,
        grabOffsetMin: s.grabOffsetMin,
        durationMin: s.homeDuration,
        boundsStart: o.boundsStart,
        boundsEnd: o.boundsEnd,
      });
    } else {
      const pointerMin = pointerMinuteIn(s.homeKey, s.lastY);
      if (pointerMin === null) return;
      durationMin = resizeDuration({ startMin: s.homeStartMin, pointerMin });
    }
    s.colKey = colKey;

    const changed =
      s.mode === "move"
        ? target.barberId !== (s.appt.barberId ?? "") ||
          target.dayStartUtc + startMin * 60_000 !== s.homeDayStartUtc + s.homeStartMin * 60_000
        : durationMin !== s.homeDuration;
    const v = changed
      ? o.verdict(s.appt, { ...target, startMin, durationMin })
      : { ok: true, reason: "" };
    publish({
      appointmentId: s.appt.id,
      mode: s.mode,
      colKey,
      barberId: target.barberId,
      dayStartUtc: target.dayStartUtc,
      startMin,
      durationMin,
      changed,
      ok: v.ok,
      reason: v.reason,
    });
  }, [columnAt, pointerMinuteIn, publish]);

  const end = useCallback(
    (commit: boolean) => {
      const s = session.current;
      session.current = null;
      listeners.current?.();
      listeners.current = null;
      if (!s) return;
      if (s.timer !== null) window.clearTimeout(s.timer);
      if (s.frame !== null) window.cancelAnimationFrame(s.frame);
      try {
        if (s.capture?.hasPointerCapture(s.pointerId)) s.capture.releasePointerCapture(s.pointerId);
      } catch {
        /* el navegador ya lo soltó */
      }
      document.body.style.removeProperty("cursor");
      const p = previewRef.current;
      publish(null);
      if (!s.active) return;
      justDragged.current = true;
      if (!commit || !p || !p.changed) return;
      const o = opt.current;
      if (!p.ok) {
        o.onRejected(s.appt, p);
        return;
      }
      if (p.mode === "move") {
        o.onMove(s.appt, new Date(p.dayStartUtc + p.startMin * 60_000), p.barberId);
      } else {
        o.onResize(s.appt, p.durationMin);
      }
    },
    [publish],
  );

  const activate = useCallback(() => {
    const s = session.current;
    if (!s || s.active) return;
    s.active = true;
    opt.current.onStart?.();
    document.body.style.cursor = s.mode === "resize" ? "ns-resize" : "grabbing";
    if (s.pointerType === "touch") {
      // Un toquecito de vibración: «ya la agarraste» (Android; iOS lo ignora).
      try {
        navigator.vibrate?.(12);
      } catch {
        /* sin vibración */
      }
    }
    compute();
    // Desplazamiento solo cerca de los bordes mientras dure el arrastre.
    const tick = () => {
      const cur = session.current;
      if (!cur || !cur.active) return;
      const scroller = opt.current.scrollerRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const delta = edgeScrollDelta(cur.lastY, rect.top, rect.bottom);
        if (delta !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop = before + delta;
          if (scroller.scrollTop !== before) compute();
        }
      }
      cur.frame = window.requestAnimationFrame(tick);
    };
    s.frame = window.requestAnimationFrame(tick);
  }, [compute]);

  const begin = useCallback(
    (e: React.PointerEvent, appt: BarberAppointmentDTO, mode: DragMode) => {
      justDragged.current = false;
      const o = opt.current;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!o.canDrag(appt)) {
        watchDenied(e, appt);
        return;
      }
      if (session.current) end(false);
      const homeKey = o.homeColumn(appt);
      if (!homeKey) return;
      const home = o.resolveColumn(homeKey, appt);
      if (!home) return;
      const homeStartMin = (new Date(appt.startAt).getTime() - home.dayStartUtc) / 60_000;
      const homeDuration = (new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()) / 60_000;
      const pointerMin = pointerMinuteIn(homeKey, e.clientY) ?? homeStartMin;
      if (mode === "resize") e.stopPropagation();

      const capture = e.pointerType === "touch" ? null : (e.currentTarget as HTMLElement);
      try {
        capture?.setPointerCapture(e.pointerId);
      } catch {
        /* sin captura: los listeners de window bastan */
      }
      const s: Session = {
        appt,
        mode,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        originX: e.clientX,
        originY: e.clientY,
        downAt: performance.now(),
        lastX: e.clientX,
        lastY: e.clientY,
        homeKey,
        homeDayStartUtc: home.dayStartUtc,
        homeStartMin,
        homeDuration,
        grabOffsetMin: pointerMin - homeStartMin,
        active: false,
        colKey: homeKey,
        timer: null,
        frame: null,
        capture,
      };
      session.current = s;

      if (e.pointerType === "touch") {
        s.timer = window.setTimeout(() => {
          const cur = session.current;
          if (!cur || cur !== s) return;
          cur.timer = null;
          const moved = Math.hypot(cur.lastX - cur.originX, cur.lastY - cur.originY);
          if (touchGesture(LONG_PRESS_MS, moved) === "drag") activate();
          else end(false);
        }, LONG_PRESS_MS);
      }

      const onMove = (ev: PointerEvent) => {
        const cur = session.current;
        if (!cur || ev.pointerId !== cur.pointerId) return;
        cur.lastX = ev.clientX;
        cur.lastY = ev.clientY;
        if (!cur.active) {
          const moved = Math.hypot(ev.clientX - cur.originX, ev.clientY - cur.originY);
          if (cur.pointerType === "touch") {
            // Se movió antes de tiempo: es scroll, no arrastre.
            if (touchGesture(performance.now() - cur.downAt, moved) === "scroll") end(false);
            return;
          }
          if (moved > DRAG_START_PX) activate();
          return;
        }
        compute();
      };
      const onUp = (ev: PointerEvent) => {
        const cur = session.current;
        if (!cur || ev.pointerId !== cur.pointerId) return;
        cur.lastX = ev.clientX;
        cur.lastY = ev.clientY;
        if (cur.active) compute();
        end(true);
      };
      const onCancel = (ev: PointerEvent) => {
        if (session.current && ev.pointerId === session.current.pointerId) end(false);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && session.current?.active) {
          ev.stopPropagation();
          end(false);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      listeners.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
      };
    },
    [activate, compute, end, pointerMinuteIn, watchDenied],
  );

  // Con el dedo y la visita ya «agarrada», el navegador no debe desplazar la
  // agenda. El listener NO pasivo tiene que existir desde el principio del
  // toque (Chrome decide al tocar si el desplazamiento se puede frenar), así
  // que vive en window mientras la rejilla está montada — como hace dnd-kit.
  useEffect(() => {
    const block = (ev: TouchEvent) => {
      if (session.current?.active && ev.cancelable) ev.preventDefault();
    };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  // Al desmontar, nada colgando.
  useEffect(
    () => () => {
      end(false);
      deniedWatch.current?.();
    },
    [end],
  );

  /** ¿Este clic es la cola de un arrastre? (y lo consume) */
  const consumeClick = useCallback(() => {
    if (!justDragged.current) return false;
    justDragged.current = false;
    return true;
  }, []);

  const isDragging = useCallback(() => Boolean(session.current?.active), []);

  return { preview, begin, consumeClick, isDragging };
}
