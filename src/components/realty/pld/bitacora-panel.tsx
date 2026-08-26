"use client";

// ═══════════════════════════════════════════════════════════════════════
// LA BITÁCORA DE LA BÓVEDA — quién consultó qué y cuándo.
//
// La conservación de diez años tiene dos mitades: no borrar el papel, y
// poder decir quién lo miró. Esta es la segunda, y es la que casi todo el
// mundo olvida.
//
// SE CARGA BAJO DEMANDA y no viene con la pantalla: son renglones que solo
// se miran cuando alguien audita, y traerlos en cada pintada del tablero
// sería trabajo de más en el 99 % de las visitas.
//
// 🔴 `t` NO VA EN LAS DEPENDENCIAS DEL EFECTO. makeRealtyT devuelve una
// función NUEVA en cada render: meterla ahí convierte la carga en un bucle
// infinito de peticiones contra la base.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Boton, Tarjeta } from "@/components/realty/calc/ui";
import type { TFunction } from "@/i18n/t";
import { PLD_ACCESS_ACTION_LABELS, type PldAccessAction } from "@/lib/realty/pld/contrato";
import { fmtFechaHora } from "@/lib/realty/pld/formato";
import { ErrorLinea, Tabla, Td, Th, Vacio } from "./ui";

interface RenglonBitacora {
  id: string;
  action: PldAccessAction;
  userName: string | null;
  fileId: string | null;
  documentId: string | null;
  subject: string | null;
  sobre: string | null;
  ip: string | null;
  createdAt: string;
}

export function PanelBitacora({
  timeZone,
  locale,
  t,
}: {
  timeZone: string;
  locale: string;
  t: TFunction;
}) {
  const [renglones, setRenglones] = useState<RenglonBitacora[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Un contador basta para volver a pedir: cambiarlo dispara el efecto sin
  // tener que memorizar la función de carga ni meterla en las dependencias.
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fetch("/api/realty/pld/bitacora", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          renglones?: RenglonBitacora[];
          error?: string;
        };
        if (!vivo) return;
        if (!res.ok) {
          setError(json.error || "No pudimos leer la bitácora. Inténtalo otra vez.");
          return;
        }
        setRenglones(json.renglones ?? []);
      })
      .catch(() => {
        if (vivo) setError("No pudimos leer la bitácora. Inténtalo otra vez.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    // El desmontaje corta el setState: cambiar de pestaña mientras la
    // petición vuela no puede escribir en un componente que ya no está.
    return () => {
      vivo = false;
    };
  }, [vuelta]);

  return (
    <Tarjeta
      titulo={t("bitacora.titulo")}
      accion={
        <Boton icon={<RefreshCw size={13} />} onClick={() => setVuelta((v) => v + 1)}>
          {t("bitacora.actualizar")}
        </Boton>
      }
      padded={false}
    >
      {error && (
        <div style={{ padding: "14px 18px" }}>
          <ErrorLinea texto={error} />
        </div>
      )}

      {cargando ? (
        <Vacio texto={t("bitacora.cargando")} />
      ) : renglones.length === 0 ? (
        <Vacio texto={t("bitacora.sinRenglones")} />
      ) : (
        <Tabla>
          <thead>
            <tr>
              <Th>{t("bitacora.columnaCuando")}</Th>
              <Th>{t("bitacora.columnaQuien")}</Th>
              <Th>{t("bitacora.columnaQue")}</Th>
              <Th>{t("bitacora.columnaSobre")}</Th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((r) => (
              <tr key={r.id}>
                <Td>{fmtFechaHora(r.createdAt, timeZone, locale)}</Td>
                <Td>
                  <div>{r.userName ?? "—"}</div>
                  {r.ip && (
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>{r.ip}</div>
                  )}
                </Td>
                <Td>{PLD_ACCESS_ACTION_LABELS[r.action]}</Td>
                {/* `sobre` es el contacto del expediente; `subject`, el
                    periodo del que se bajó un archivo. Nunca los dos. */}
                <Td>{r.sobre ?? r.subject ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </Tarjeta>
  );
}
