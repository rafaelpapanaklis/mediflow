"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Search, X, List, Map as MapIcon, LocateFixed, Loader2 } from "lucide-react";
import {
  DIRECTORY_API,
  DIRECTORY_CITY_PARAM,
  DIRECTORY_MAP_MAX,
  getCategoryBySlug,
  type DirectoryClinic,
  type DirectoryClinicsResponse,
  type GeoPoint,
} from "@/lib/directory/types";
import { ClinicGrid } from "./ClinicGrid";
import { ClinicCard } from "./ClinicCard";
import { CityFilter } from "./CityFilter";
import { BookingPopupController } from "./BookingPopupController";

// Leaflet solo se carga al activar el mapa: dynamic import client-only (ssr:false)
// para no engordar el bundle inicial del directorio ni romper el SSG.
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-full min-h-[420px] place-items-center rounded-[18px] border border-[var(--line,#e9e7f3)] bg-[var(--v50,#f5f3ff)]"
      role="status"
      aria-label="Cargando mapa"
    >
      <Loader2 className="h-7 w-7 animate-spin text-[var(--b2,#6d28d9)]" aria-hidden="true" />
    </div>
  ),
});

type ViewMode = "list" | "map";
type GeoStatus = "idle" | "locating" | "on" | "denied" | "unsupported" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador client del directorio: buscador con debounce (350 ms) + filtro de
// ciudad + (children: sección de categorías server-rendered) + resultados
// paginados (lista o mapa) + montaje del popup de reserva.
//
// La búsqueda, la ciudad y la página viven en la URL (?q=&city=&page=) vía
// window.location + history.replaceState DENTRO de efectos — nada de
// useSearchParams/useRouter (romperían el SSG con Suspense). Solo se tocan las
// llaves "q", "city" y "page"; las de reserva (reservar/servicio/doctor/fecha/
// hora) las maneja booking-state.
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectoryExplorerProps {
  /** Slug de categoría cuando se renderiza en /descubre/[categoria] */
  initialCategory?: string;
  /** Bloque de categorías (server-rendered) que va entre buscador y resultados */
  children?: ReactNode;
}

export function DirectoryExplorer({ initialCategory, children }: DirectoryExplorerProps) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DirectoryClinicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // Mapa + "cerca de mí"
  const [view, setView] = useState<ViewMode>("list");
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [mapData, setMapData] = useState<DirectoryClinic[] | null>(null);
  const [mapLoading, setMapLoading] = useState(false);

  /** q/city/page leídos de la URL al montar: el fetch espera a que el estado los refleje. */
  const pendingRestore = useRef<{ q: string; city: string; page: number } | null>(null);
  /** Ancla del heading de resultados para el scroll suave al paginar. */
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const category = initialCategory ? getCategoryBySlug(initialCategory) : undefined;

  // Estado inicial desde la URL (al montar; sin useSearchParams para no romper el SSG).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q") ?? "";
    const urlCity = params.get(DIRECTORY_CITY_PARAM) ?? "";
    const rawPage = parseInt(params.get("page") ?? "", 10);
    const urlPage = Number.isFinite(rawPage) && rawPage > 1 ? rawPage : 1;
    if (urlQ === "" && urlCity === "" && urlPage === 1) return;
    pendingRestore.current = { q: urlQ, city: urlCity, page: urlPage };
    if (urlQ !== "") {
      setQ(urlQ);
      setQDebounced(urlQ);
    }
    if (urlCity !== "") setCity(urlCity);
    if (urlPage !== 1) setPage(urlPage);
  }, []);

  // Debounce de la búsqueda: 350 ms; un cambio efectivo de q regresa a página 1.
  useEffect(() => {
    if (q === qDebounced) return;
    const timer = setTimeout(() => {
      setQDebounced(q);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [q, qDebounced]);

  // Fetch de resultados + sync de la URL (solo "q", "city" y "page"; page=1 se borra).
  useEffect(() => {
    const pending = pendingRestore.current;
    if (pending && (pending.q !== qDebounced || pending.city !== city || pending.page !== page)) return;
    pendingRestore.current = null;

    const url = new URL(window.location.href);
    if (qDebounced) url.searchParams.set("q", qDebounced);
    else url.searchParams.delete("q");
    if (city) url.searchParams.set(DIRECTORY_CITY_PARAM, city);
    else url.searchParams.delete(DIRECTORY_CITY_PARAM);
    if (page > 1) url.searchParams.set("page", String(page));
    else url.searchParams.delete("page");
    window.history.replaceState(window.history.state, "", url.toString());

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (initialCategory) params.set("category", initialCategory);
    if (qDebounced) params.set("q", qDebounced);
    if (city) params.set(DIRECTORY_CITY_PARAM, city);
    params.set("page", String(page));
    // "Cerca de mí": ordena la lista por distancia y agrega "a X km" a las cards.
    if (geo) {
      params.set("lat", String(geo.lat));
      params.set("lng", String(geo.lng));
    }

    setLoading(true);
    setError(null);
    fetch(`${DIRECTORY_API}?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DirectoryClinicsResponse>;
      })
      .then((json) => {
        // Página fuera de rango (URL compartida/vieja): regresar a la última
        // válida en vez de un vacío engañoso sin controles de paginación.
        if (json.totalPages > 0 && json.page > json.totalPages) {
          setPage(json.totalPages);
          return;
        }
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError("No pudimos cargar el directorio");
        setLoading(false);
      });
    return () => controller.abort();
  }, [qDebounced, city, page, initialCategory, retryTick, geo]);

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    const anchor = resultsRef.current;
    if (anchor) {
      const top = anchor.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
    }
  };

  // "Cerca de mí": pide geolocalización del navegador. Toggle: si ya está activa,
  // la apaga. Fallback elegante si el navegador no la soporta o el usuario niega.
  const handleNearMe = () => {
    if (geo) {
      setGeo(null);
      setGeoStatus("idle");
      setPage(1);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("on");
        setPage(1);
      },
      (err) => {
        setGeoStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  };

  // Datos del mapa: hasta DIRECTORY_MAP_MAX clínicas CON pin para los markers,
  // respetando categoría/búsqueda/ciudad (+ cerca de mí). Solo con el mapa activo.
  useEffect(() => {
    if (view !== "map") return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (initialCategory) params.set("category", initialCategory);
    if (qDebounced) params.set("q", qDebounced);
    if (city) params.set(DIRECTORY_CITY_PARAM, city);
    params.set("limit", String(DIRECTORY_MAP_MAX));
    if (geo) {
      params.set("lat", String(geo.lat));
      params.set("lng", String(geo.lng));
    }
    setMapLoading(true);
    fetch(`${DIRECTORY_API}?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DirectoryClinicsResponse>;
      })
      .then((json) => {
        setMapData(json.items ?? []);
        setMapLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMapData((prev) => prev ?? []);
        setMapLoading(false);
      });
    return () => controller.abort();
  }, [view, qDebounced, city, initialCategory, geo, retryTick]);

  const total = data?.total ?? 0;

  return (
    <>
      {/* Buscador prominente que remata el hero */}
      <div className="mfh-container" style={{ position: "relative", zIndex: 1, marginTop: -28 }}>
        <div
          role="search"
          aria-label="Buscador de clínicas"
          className="mfh-card"
          style={{
            maxWidth: 640,
            margin: "0 auto",
            borderRadius: 16,
            boxShadow: "var(--sh)",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Search aria-hidden="true" style={{ width: 20, height: 20, color: "var(--b)", flexShrink: 0 }} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca por nombre o ciudad…"
            aria-label="Buscar clínica"
            autoComplete="off"
            enterKeyHint="search"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 16,
              color: "var(--ink)",
              padding: "12px 0",
              fontFamily: "inherit",
            }}
          />
          {q !== "" && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Limpiar búsqueda"
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                border: "none",
                background: "var(--v50)",
                color: "var(--b2)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flexShrink: 0,
                padding: 0,
              }}
            >
              <X style={{ width: 16, height: 16 }} />
            </button>
          )}
        </div>

        {/* Filtro de ciudad (ciudades reales de la DB; se oculta solo si no hay) */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 8,
            maxWidth: 640,
            margin: "12px auto 0",
          }}
        >
          <CityFilter
            category={initialCategory}
            value={city}
            onChange={(c) => {
              setCity(c);
              setPage(1);
            }}
          />
        </div>
      </div>

      {children}

      {/* Resultados */}
      <section className="mfh-section--tight" aria-label="Resultados del directorio">
        <div className="mfh-container">
          <div ref={resultsRef} style={{ marginBottom: 22 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "6px 12px", minWidth: 0 }}>
                <h2
                  className="mfh-h2"
                  style={{ fontSize: "clamp(22px, 2.6vw, 30px)", minWidth: 0, overflowWrap: "anywhere" }}
                >
                  {qDebounced ? `Resultados para «${qDebounced}»` : "Clínicas disponibles"}
                </h2>
                {data && (
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>
                    {total === 1 ? "1 clínica" : `${total} clínicas`}
                  </span>
                )}
              </div>

              {/* Controles: cerca de mí + toggle Lista | Mapa */}
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleNearMe}
                  aria-pressed={!!geo}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 13px",
                    borderRadius: 11,
                    border: `1px solid ${geo ? "var(--b,#7c3aed)" : "var(--line,#e9e7f3)"}`,
                    background: geo ? "var(--v50,#f5f3ff)" : "#fff",
                    color: geo ? "var(--b2,#6d28d9)" : "var(--ink,#0f172a)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {geoStatus === "locating" ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <LocateFixed size={15} aria-hidden="true" />
                  )}
                  Cerca de mí
                  {geo && <X size={14} aria-hidden="true" />}
                </button>

                <div
                  role="tablist"
                  aria-label="Vista del directorio"
                  style={{
                    display: "inline-flex",
                    padding: 3,
                    gap: 2,
                    borderRadius: 12,
                    background: "var(--v50,#f5f3ff)",
                    border: "1px solid var(--line,#e9e7f3)",
                  }}
                >
                  {([
                    { id: "list", label: "Lista", Icon: List },
                    { id: "map", label: "Mapa", Icon: MapIcon },
                  ] as const).map((opt) => {
                    const active = view === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setView(opt.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "7px 13px",
                          borderRadius: 9,
                          border: "none",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                          color: active ? "#fff" : "var(--b2,#6d28d9)",
                          background: active
                            ? "linear-gradient(180deg, var(--b,#7c3aed), var(--b2,#6d28d9))"
                            : "transparent",
                        }}
                      >
                        <opt.Icon size={15} aria-hidden="true" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {(geoStatus === "denied" || geoStatus === "unsupported" || geoStatus === "error") && (
              <p style={{ marginTop: 10, fontSize: 13, color: "var(--muted,#64748b)" }}>
                {geoStatus === "denied"
                  ? "Permite el acceso a tu ubicación para ver las clínicas más cercanas primero."
                  : geoStatus === "unsupported"
                    ? "Tu navegador no permite compartir tu ubicación."
                    : "No pudimos obtener tu ubicación. Inténtalo de nuevo."}
              </p>
            )}
          </div>
          {view === "list" ? (
            <ClinicGrid
              items={data?.items ?? null}
              loading={loading}
              error={error}
              total={total}
              page={page}
              totalPages={data?.totalPages ?? 0}
              onPageChange={handlePageChange}
              onRetry={() => setRetryTick((t) => t + 1)}
              categoryLabel={category?.plural}
              searchQuery={qDebounced || undefined}
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
              {/* Lista compacta a la izquierda (solo desktop); en móvil manda el mapa */}
              <div className="hidden max-h-[72vh] space-y-4 overflow-y-auto pr-1 lg:block">
                {mapData && mapData.length > 0 ? (
                  <>
                    {mapData.slice(0, 50).map((c) => (
                      <ClinicCard key={c.id} clinic={c} />
                    ))}
                    {mapData.length > 50 && (
                      <p className="px-1 py-2 text-center text-[13px] text-[var(--muted,#64748b)]">
                        +{mapData.length - 50} más en el mapa →
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-[var(--muted,#64748b)]">
                    {mapLoading ? "Cargando clínicas…" : "No hay clínicas con ubicación para estos filtros."}
                  </p>
                )}
              </div>
              {/* Mapa */}
              <div className="h-[72vh] min-h-[420px] w-full">
                <MapView clinics={mapData ?? []} userLocation={geo} loading={mapLoading} />
              </div>
            </div>
          )}
        </div>
      </section>

      <BookingPopupController />
    </>
  );
}
