"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import {
  DIRECTORY_API,
  getCategoryBySlug,
  type DirectoryClinicsResponse,
} from "@/lib/directory/types";
import { ClinicGrid } from "./ClinicGrid";
import { BookingPopupController } from "./BookingPopupController";

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador client del directorio: buscador con debounce (350 ms) +
// (children: sección de categorías server-rendered) + resultados paginados +
// montaje del popup de reserva.
//
// La búsqueda y la página viven en la URL (?q=&page=) vía window.location +
// history.replaceState DENTRO de efectos — nada de useSearchParams/useRouter
// (romperían el SSG con Suspense). Solo se tocan las llaves "q" y "page";
// las de reserva (reservar/servicio/doctor/fecha/hora) las maneja booking-state.
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
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DirectoryClinicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  /** q/page leídos de la URL al montar: el fetch espera a que el estado los refleje. */
  const pendingRestore = useRef<{ q: string; page: number } | null>(null);
  /** Ancla del heading de resultados para el scroll suave al paginar. */
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const category = initialCategory ? getCategoryBySlug(initialCategory) : undefined;

  // Estado inicial desde la URL (al montar; sin useSearchParams para no romper el SSG).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q") ?? "";
    const rawPage = parseInt(params.get("page") ?? "", 10);
    const urlPage = Number.isFinite(rawPage) && rawPage > 1 ? rawPage : 1;
    if (urlQ === "" && urlPage === 1) return;
    pendingRestore.current = { q: urlQ, page: urlPage };
    if (urlQ !== "") {
      setQ(urlQ);
      setQDebounced(urlQ);
    }
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

  // Fetch de resultados + sync de la URL (solo "q" y "page"; page=1 se borra).
  useEffect(() => {
    const pending = pendingRestore.current;
    if (pending && (pending.q !== qDebounced || pending.page !== page)) return;
    pendingRestore.current = null;

    const url = new URL(window.location.href);
    if (qDebounced) url.searchParams.set("q", qDebounced);
    else url.searchParams.delete("q");
    if (page > 1) url.searchParams.set("page", String(page));
    else url.searchParams.delete("page");
    window.history.replaceState(window.history.state, "", url.toString());

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (initialCategory) params.set("category", initialCategory);
    if (qDebounced) params.set("q", qDebounced);
    params.set("page", String(page));

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
  }, [qDebounced, page, initialCategory, retryTick]);

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    const anchor = resultsRef.current;
    if (anchor) {
      const top = anchor.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
    }
  };

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
      </div>

      {children}

      {/* Resultados */}
      <section className="mfh-section--tight" aria-label="Resultados del directorio">
        <div className="mfh-container">
          <div
            ref={resultsRef}
            style={{
              display: "flex",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "6px 12px",
              marginBottom: 22,
            }}
          >
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
        </div>
      </section>

      <BookingPopupController />
    </>
  );
}
