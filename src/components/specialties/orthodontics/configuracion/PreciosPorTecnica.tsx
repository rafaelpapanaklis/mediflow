"use client";
// Ortodoncia — Configuración: precio del tratamiento POR TÉCNICA (ws1-t10, decisión 2
// de Rafael). Es la tabla que el alta del caso usa para PROPONER el costo al elegir la
// técnica; cada paciente puede pactar otro. Se guarda aparte (su propio botón).

import { useId, useState } from "react";
import toast from "react-hot-toast";
import { Tag } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import { guardarPreciosPorTecnicaDeLaClinica } from "@/app/actions/orthodontics/guardarPreciosPorTecnica";
import { isFailure } from "@/app/actions/orthodontics/result";
import { TECNICAS_ORTO, normalizarPrecios, type PreciosPorTecnica } from "@/lib/orthodontics/precios-por-tecnica";

export function PreciosPorTecnica({ iniciales }: { iniciales: PreciosPorTecnica }) {
  const idBase = useId();
  const [campos, setCampos] = useState<Record<string, string>>(() =>
    Object.fromEntries(TECNICAS_ORTO.map((t) => [t.key, iniciales[t.key] != null ? String(iniciales[t.key]) : ""])),
  );
  const [guardadas, setGuardadas] = useState<PreciosPorTecnica>(iniciales);
  const [guardando, setGuardando] = useState(false);

  const invalidos = TECNICAS_ORTO.filter((t) => {
    const v = campos[t.key].trim();
    return v !== "" && Object.keys(normalizarPrecios({ [t.key]: v })).length === 0;
  });
  const actuales = normalizarPrecios(campos);
  const sinCambios = JSON.stringify(actuales) === JSON.stringify(guardadas);

  async function guardar() {
    if (invalidos.length > 0) {
      toast.error(`Revisa el precio de: ${invalidos.map((t) => t.label).join(", ")}.`);
      return;
    }
    setGuardando(true);
    try {
      const r = await guardarPreciosPorTecnicaDeLaClinica({ precios: campos });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      setGuardadas(r.data.precios);
      toast.success("Precios por técnica guardados.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta
      icono={Tag}
      titulo="Precio por técnica"
      sub="Cuánto cuesta el tratamiento completo según la técnica. Al abrir un caso, el costo se propone con el precio de la técnica elegida; puedes cambiarlo para cada paciente. Deja vacía la técnica que no manejes."
    >
      <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TECNICAS_ORTO.map((t) => {
          const id = `${idBase}-${t.key}`;
          const malo = invalidos.some((x) => x.key === t.key);
          return (
            <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label className={s.campoEtiqueta} htmlFor={id} style={{ flex: "1 1 220px" }}>
                {t.label}
              </label>
              <input
                id={id}
                className="input-new"
                style={{ flex: "0 0 150px" }}
                inputMode="decimal"
                placeholder="Sin precio"
                value={campos[t.key]}
                aria-invalid={malo}
                onChange={(e) => setCampos((c) => ({ ...c, [t.key]: e.target.value }))}
              />
              <span style={{ fontSize: 12, color: "var(--pr-texto-3)" }}>MXN</span>
            </div>
          );
        })}
        <div>
          <ButtonNew variant="primary" onClick={guardar} disabled={guardando || sinCambios || invalidos.length > 0}>
            {guardando ? "Guardando…" : "Guardar precios"}
          </ButtonNew>
        </div>
      </div>
    </Tarjeta>
  );
}
