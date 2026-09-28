// Ortodoncia — esqueleto de carga del módulo (ws1-t3, diseño). Sin él, al
// cambiar de apartado salía el esqueleto genérico del panel (el de «Hoy») y
// el submenú desaparecía hasta que llegaban los datos. Con él, el submenú se
// queda en su sitio (lo pinta el layout) y debajo va la forma de la pantalla.
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export default function OrthodonticsModuleLoading() {
  return (
    <div className={s.pantalla} aria-busy="true" aria-label="Cargando">
      <div className={s.cabeza}>
        <div className={s.cabezaTextos} style={{ flex: 1 }}>
          <span className={`${s.hueso} ${s.huesoTitulo}`} />
          <span className={`${s.hueso} ${s.huesoSub}`} />
        </div>
      </div>
      <div className={s.kpis}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`${s.hueso} ${s.huesoKpi}`} />
        ))}
      </div>
      <div className={s.rejillaPrincipal}>
        <span className={`${s.hueso} ${s.huesoTarjeta}`} />
        <span className={`${s.hueso} ${s.huesoTarjeta}`} />
      </div>
    </div>
  );
}
