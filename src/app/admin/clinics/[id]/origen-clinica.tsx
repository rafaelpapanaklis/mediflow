"use client";

/**
 * Origen de la clínica en su ficha (ws1-t10): de dónde llegó — «Meta · campaña ·
 * anuncio», «Google Ads», «Orgánico»… — y los UTM del primer y del último toque.
 * Sólo PRESENTACIÓN: recibe el DTO ya calculado (@/lib/admin/origen-clinica) y
 * no llama a nada. Vive en su propio archivo para no tocar la lógica de
 * `clinic-detail-client.tsx`.
 */
import { Megaphone } from "lucide-react";
import { Chip, type TonoChip } from "@/components/admin/rediseno/piezas";
import { mismoUtm, resumenUtm, type OrigenClinicaDTO, type UtmDTO } from "@/lib/ads/origen";
import { fechaAdmin } from "@/lib/admin/zona-horaria";

const TONO: Record<OrigenClinicaDTO["canal"], TonoChip> = {
  meta: "info", google: "brand", otro: "neutral", organico: "neutral",
};

function Toque({ rotulo, utm }: { rotulo: string; utm: UtmDTO }) {
  return (
    <span>
      <strong>{rotulo}:</strong> {resumenUtm(utm)}
      {utm.at ? ` · ${fechaAdmin(utm.at)}` : ""}
    </span>
  );
}

export function OrigenClinica({ origen }: { origen: OrigenClinicaDTO }) {
  const d = origen.detalle;
  const igual = d ? mismoUtm(d.primero, d.ultimo) : false;
  return (
    <div className="dcp-dato-caja" data-testid="origen-clinica">
      <div className="dcp-dato-caja__label"><Megaphone size={13} aria-hidden />Origen</div>
      <div style={{ marginTop: 8 }}>
        <Chip tono={TONO[origen.canal]}>{origen.etiqueta}</Chip>
      </div>
      <div className="dcp-datos">
        {!d && <span>No se guardó clic de anuncio ni UTM en su alta (llegó directo, o se registró antes de medirlo).</span>}
        {d && d.conClicMeta && <span><strong>Clic de Meta (fbclid):</strong> sí</span>}
        {d && d.conClicGoogle && <span><strong>Clic de Google Ads:</strong> sí</span>}
        {d && d.primero && <Toque rotulo={igual ? "Primer y último toque" : "Primer toque"} utm={d.primero} />}
        {d && d.ultimo && !igual && <Toque rotulo="Último toque" utm={d.ultimo} />}
        {d && !d.primero && !d.ultimo && <span>Sin UTM en el enlace.</span>}
      </div>
    </div>
  );
}
