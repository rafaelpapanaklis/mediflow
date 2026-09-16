"use client";

import { Grid3x3, Lightbulb } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Indicador, Panel, FiltroPeriodo, Selector, Aviso, Vacio, Cargando } from "@/components/dashboard/analitica-rediseno/piezas";
import { MapaCalor } from "@/components/dashboard/analitica-rediseno/graficas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import { PRESETS, type OccupancyData, type Resource, type Doctor } from "./occupancy-client";

export function OccupancyRediseno({
  resources,
  doctors,
  preset,
  setPreset,
  resourceId,
  setResourceId,
  doctorId,
  setDoctorId,
  data,
  loading,
}: {
  resources: Resource[];
  doctors: Doctor[];
  preset: string;
  setPreset: (v: string) => void;
  resourceId: string;
  setResourceId: (v: string) => void;
  doctorId: string;
  setDoctorId: (v: string) => void;
  data: OccupancyData | null;
  loading: boolean;
}) {
  const t = useT();
  return (
    <MarcoAnalitica
      title={t("analytics.occupancy.title")}
      subtitle={t("analytics.occupancy.subtitle")}
      acciones={
        <FiltroPeriodo value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ id: p.id, label: t(p.labelKey) }))} />
      }
    >
      <div className={s.selectores}>
        <Selector
          label={t("analytics.occupancy.chairFilter")}
          value={resourceId}
          onChange={setResourceId}
          options={[{ id: "", label: t("common.all") }, ...resources.map((r) => ({ id: r.id, label: r.name }))]}
        />
        <Selector
          label={t("analytics.occupancy.doctorFilter")}
          value={doctorId}
          onChange={setDoctorId}
          options={[{ id: "", label: t("common.all") }, ...doctors.map((d) => ({ id: d.id, label: `${d.firstName} ${d.lastName}` }))]}
        />
      </div>

      {loading ? (
        <Cargando>{t("analytics.occupancy.calculatingHeatmap")}</Cargando>
      ) : !data ? (
        // Sin respuesta de la API (no «sin citas»): mismo texto que hoy, ícono en rojo.
        <Vacio icon={Grid3x3} title={t("analytics.occupancy.noData")} peligro />
      ) : (
        <div className={s.pila}>
          <Panel>
            <MapaCalor data={data.heatmap} hours={data.hours} />
          </Panel>

          <div className={s.indicadores}>
            <Indicador label={t("analytics.occupancy.apptsInRange")} value={data.insights.totalAppts.toLocaleString("es-MX")} tone="neutro" />
            <Indicador label={t("analytics.occupancy.activeChairs")} value={String(data.totalChairs)} tone="neutro" />
          </div>

          {data.insights.leastUsedResource && (
            <Aviso tono="alerta" icon={Lightbulb}>
              <strong className={s.fuerte}>{data.insights.leastUsedResource.name}</strong>{" "}
              {t("analytics.occupancy.leastUsedHint", { pct: data.insights.leastUsedResource.pct })}
            </Aviso>
          )}
        </div>
      )}
    </MarcoAnalitica>
  );
}
