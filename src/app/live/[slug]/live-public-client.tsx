"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { toScreen } from "@/lib/floor-plan/iso";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import type {
  LayoutElement,
  LiveAppointment,
} from "@/lib/floor-plan/elements";
import { fmtHM, fmtHMS } from "@/lib/floor-plan/live-mode";
import {
  LiveOverlay,
  LiveTooltip,
  LiveStatusPanel,
  LiveTimeline,
  type HoverData,
} from "../../dashboard/clinic-layout/components/live-mode";
import { WaitingRoom, type WaitingRoomEntry } from "../../dashboard/clinic-layout/components/waiting-room";
import liveStyles from "./live-public.module.css";

interface Chair {
  id: string;
  name: string;
  color: string | null;
}

interface ApiResponse {
  clinic: { id: string; name: string; logoUrl?: string | null; city?: string | null; showPatientNames: boolean };
  layout: {
    elements: LayoutElement[];
    metadata: { zoom?: number; panOffset?: { x: number; y: number } } | null;
  };
  chairs: Chair[];
  appointments: Array<{
    id: string;
    resourceId: string;
    patient: string;
    patientFull?: string;
    treatment: string;
    doctor: string;
    start: string;
    end: string;
    status?: string;
  }>;
  waitingRoom?: WaitingRoomEntry[];
}

const ORIG_X = 680;
const ORIG_Y = 260;

export function LivePublicClient({
  slug,
  clinicName,
  logoUrl,
  city,
  showPatientNames,
}: {
  slug: string;
  clinicName: string;
  logoUrl: string | null;
  city: string | null;
  showPatientNames: boolean;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewTime, setViewTime] = useState<Date>(() => new Date());
  const [hover, setHover] = useState<HoverData | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const catalog = getCatalogForClinic("DENTAL");

  // Polling cada 30s
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/live/${slug}?date=${dateStr}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) {
            // Cookie legacy o expirada — recarga la página completa.
            // El endpoint ya limpió cookies con maxAge=0; el page server
            // detectará la ausencia y mostrará el PasswordGate.
            window.location.replace(`/live/${slug}`);
            return;
          }
          if (!cancelled) setError("error");
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("error");
      }
    };
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug]);

  // Reloj cada segundo
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-tick viewTime si cerca de now
  useEffect(() => {
    if (Math.abs(now.getTime() - viewTime.getTime()) < 90_000) {
      setViewTime(now);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen API
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  const appointments: LiveAppointment[] = useMemo(() => {
    if (!data) return [];
    return data.appointments.map((a) => ({
      id: a.id,
      resourceId: a.resourceId,
      patient: a.patient,
      patientFull: a.patientFull,
      treatment: a.treatment,
      doctor: a.doctor,
      start: new Date(a.start),
      end: new Date(a.end),
      status: a.status as LiveAppointment["status"],
    }));
  }, [data]);

  // 401 ya hizo replace al page; no hace falta render terminal.
  if (error === "error") {
    return (
      <div className={liveStyles.errorWrap}>
        No se pudo cargar la vista en vivo. Reintentando…
      </div>
    );
  }
  if (!data) {
    return <div className={liveStyles.loadingWrap}>Cargando vista en vivo…</div>;
  }

  const elements = data.layout.elements;
  const ox = ORIG_X;
  const oy = ORIG_Y;

  return (
    <div ref={containerRef} className={liveStyles.live}>
      <header className={liveStyles.header}>
        <div className={liveStyles.headerLeft}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={clinicName}
              className={liveStyles.clinicLogo}
            />
          ) : (
            <div className={liveStyles.brandIcon}>
              {clinicName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? "")
                .join("")}
            </div>
          )}
          <div className={liveStyles.headerClinicInfo}>
            <div className={liveStyles.clinicName}>{clinicName}</div>
            <div className={liveStyles.clinicMeta}>
              <span className={liveStyles.liveBadge}>
                <span /> EN VIVO
              </span>
              {city && <span className={liveStyles.clinicCity}>· {city}</span>}
            </div>
          </div>
        </div>
        <div className={liveStyles.headerClockBlock}>
          <div className={liveStyles.headerClockBig}>{fmtHM(now)}</div>
          <div className={liveStyles.headerClockSec}>{fmtHMS(now).slice(-2)}</div>
        </div>
        <div className={liveStyles.headerRight}>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={liveStyles.fullscreenBtn}
            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullscreen ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </header>

      <div className={liveStyles.body}>
        <div className={liveStyles.canvasWrap}>
          <svg
            className={liveStyles.svgRoot}
            viewBox="0 0 1920 1080"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Floor tiles */}
            <g>
              {Array.from({ length: 24 }).map((_, r) =>
                Array.from({ length: 32 }).map((__, c) => {
                  const A = toScreen(c, r, ox, oy);
                  const B = toScreen(c + 1, r, ox, oy);
                  const Cc = toScreen(c + 1, r + 1, ox, oy);
                  const D = toScreen(c, r + 1, ox, oy);
                  return (
                    <polygon
                      key={`t-${c}-${r}`}
                      points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${Cc[0]},${Cc[1]} ${D[0]},${D[1]}`}
                      fill={(c + r) % 2 === 0 ? "rgba(255,255,255,0.4)" : "rgba(232,244,250,0.3)"}
                      stroke="rgba(74,144,226,0.06)"
                      strokeWidth={0.5}
                    />
                  );
                }),
              )}
            </g>
            {/* Elementos */}
            <g>
              {elements
                .slice()
                .sort((a, b) => a.col + a.row - (b.col + b.row))
                .map((el) => {
                  const td = catalog.byKey.get(el.type);
                  if (!td) return null;
                  const [sx, sy] = toScreen(el.col, el.row, ox, oy);
                  return (
                    <g
                      key={el.id}
                      transform={el.rotation ? `rotate(${el.rotation} ${sx} ${sy})` : undefined}
                      dangerouslySetInnerHTML={{ __html: td.draw(sx, sy) }}
                    />
                  );
                })}
            </g>
            {/* Halos En Vivo */}
            <LiveOverlay
              elements={elements}
              ox={ox}
              oy={oy}
              viewTime={viewTime}
              appointments={appointments}
              showFullNames={showPatientNames}
              onHover={setHover}
            />
          </svg>
        </div>
        <aside className={liveStyles.panel}>
          <LiveStatusPanel
            elements={elements}
            chairs={data.chairs}
            viewTime={viewTime}
            appointments={appointments}
            showFullNames={showPatientNames}
          />
          <div style={{ marginTop: 14 }}>
            <WaitingRoom
              waiting={data.waitingRoom ?? []}
              appointments={appointments}
              chairs={data.chairs}
              enableSound={true}
            />
          </div>
        </aside>
      </div>

      <LiveTimeline
        elements={elements}
        chairs={data.chairs}
        viewTime={viewTime}
        appointments={appointments}
        onSeek={setViewTime}
        onResetNow={() => setViewTime(new Date())}
      />

      <footer className={liveStyles.footer}>
        <span>Powered by</span>
        <strong>MediFlow</strong>
      </footer>

      <LiveTooltip data={hover} />
    </div>
  );
}
