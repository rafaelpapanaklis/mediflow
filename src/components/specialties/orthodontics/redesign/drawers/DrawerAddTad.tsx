"use client";
// Ortodoncia — hallazgo ws1-t4 §9: «Agregar TAD» pedía marca, tamaño,
// ubicación y torque con 4 `window.prompt()` seguidos — sin validación
// visible, sin poder corregir un campo sin cancelar los cuatro, y sin el
// aspecto del resto del panel. Mismo patrón que el resto de cajones
// chicos de esta carpeta (DrawerCobrarExtra, DrawerElegirDescuento…).

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { TAD_BRAND_LABELS, type OrthoTadBrand } from "../types";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

export interface DrawerAddTadSubmit {
  brand: OrthoTadBrand;
  size: string;
  location: string;
  torqueNcm: number | null;
}

export interface DrawerAddTadProps {
  onClose: () => void;
  onSubmit: (payload: DrawerAddTadSubmit) => Promise<void> | void;
}

const BRANDS: OrthoTadBrand[] = ["DENTOS", "SPIDER", "IMTEC", "OTHER"];

export function DrawerAddTad(props: DrawerAddTadProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const [brand, setBrand] = useState<OrthoTadBrand>("DENTOS");
  const [size, setSize] = useState("");
  const [location, setLocation] = useState("");
  const [torque, setTorque] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setError(null);
    if (!size.trim()) {
      setError("El tamaño es obligatorio.");
      return;
    }
    if (!location.trim()) {
      setError("La ubicación es obligatoria (p. ej. \"entre 14 y 15\").");
      return;
    }
    const matches = location.match(/\b\d{2}\b/g) ?? [];
    const fdiInvalido = matches.some((m) => {
      const n = parseInt(m, 10);
      const ones = n % 10;
      return n < 11 || n > 48 || ones < 1 || ones > 8;
    });
    if (fdiInvalido) {
      setError("La ubicación tiene un número de diente (FDI) fuera de rango (11-48).");
      return;
    }
    const torqueNcm = torque.trim() ? parseInt(torque, 10) : null;
    if (torque.trim() && (!Number.isFinite(torqueNcm) || (torqueNcm as number) < 0 || (torqueNcm as number) > 50)) {
      setError("El torque debe ser un número entre 0 y 50 N·cm.");
      return;
    }
    setSaving(true);
    try {
      await props.onSubmit({ brand, size: size.trim(), location: location.trim(), torqueNcm });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={`${orto.cajon} ${orto.cajonEstrecho}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-add-tad-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Auxiliares</div>
            <h3 id="drawer-add-tad-title" className={orto.cajonTitulo}>
              Agregar TAD
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error ? (
            <div className={`${orto.aviso} ${orto.avisoPeligro}`} role="alert">
              <span className={orto.avisoTexto}>{error}</span>
            </div>
          ) : null}

          <div className={orto.campo}>
            <div className={orto.campoEtiqueta}>Marca</div>
            <select value={brand} onChange={(e) => setBrand(e.target.value as OrthoTadBrand)} className={orto.entrada}>
              {BRANDS.map((b) => (
                <option key={b} value={b}>
                  {TAD_BRAND_LABELS[b]}
                </option>
              ))}
            </select>
          </div>

          <div className={orto.campo}>
            <div className={orto.campoEtiqueta}>Tamaño</div>
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="p. ej. 1.6 × 8 mm"
              className={orto.entrada}
              autoFocus
            />
          </div>

          <div className={orto.campo}>
            <div className={orto.campoEtiqueta}>Ubicación</div>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder='p. ej. "entre 14 y 15, vestibular"'
              className={orto.entrada}
            />
          </div>

          <div className={orto.campo}>
            <div className={orto.campoEtiqueta}>Torque (N·cm) — opcional</div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={torque}
              onChange={(e) => setTorque(e.target.value)}
              className={orto.entrada}
            />
          </div>
        </div>

        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose} disabled={saving}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            size="md"
            icon={<Check className="w-3.5 h-3.5" aria-hidden />}
            onClick={guardar}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Registrar TAD"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}
