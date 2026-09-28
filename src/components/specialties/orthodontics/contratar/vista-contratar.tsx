// Contratar Ortodoncia — la vista (ws1-t3). Solo pinta lo que recibe: los
// precios y los permisos los resuelve la página
// (`src/app/dashboard/contratar/ortodoncia/page.tsx`).
//
// Decisión de Rafael (28-sep-2026): «que salga con candado y al darle click
// que salga el precio mensual o anual con botón para cambiar. Y también TODO
// lo que contiene, tal vez en categorías, para que sea fácil leer y entender».
import {
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Eye,
  FolderOpen,
  Images,
  LayoutDashboard,
  Lock,
  MessageCircle,
  Receipt,
  Smile,
  Wallet,
  XCircle,
  Hourglass,
  type LucideIcon,
} from "lucide-react";
import {
  CONTENIDO_ORTODONCIA,
  type CategoriaIncluida,
} from "@/lib/orthodontics/contratar-contenido";
import {
  RUTA_CONTRATAR_ORTODONCIA,
  type CicloCobro,
  type EstadoCompra,
  type ResumenDePrecios,
  type SedeHermana,
} from "@/lib/orthodontics/contratar";
import { TarjetaPrecio } from "./TarjetaPrecio";
import { EsperandoActivacion } from "./EsperandoActivacion";
import s from "./contratar.module.css";

const ICONO: Record<CategoriaIncluida["id"], LucideIcon> = {
  casos: FolderOpen,
  cobro: Wallet,
  controles: CalendarClock,
  recepcion: Receipt,
  tablero: LayoutDashboard,
  imagen: Images,
  paciente: MessageCircle,
};

export function VistaContratar({
  precios,
  cicloInicial,
  puedeContratar,
  compra,
  moduloActivo,
  vistaPrevia,
  sedeActualNombre,
  sedesHermanas,
}: {
  precios: ResumenDePrecios;
  cicloInicial: CicloCobro | null;
  puedeContratar: boolean;
  /** Lo que dijo la URL al volver del checkout. */
  compra: EstadoCompra;
  /** Solo puede ser true volviendo de pagar (si no, la página ya redirigió). */
  moduloActivo: boolean;
  /** Se está viendo la clínica «como si no tuviera el módulo» (solo fuera de producción). */
  vistaPrevia: boolean;
  /** Nombre de la sede que está contratando — cada `Clinic` es su propia sede. */
  sedeActualNombre: string;
  /** Otras sedes DENTALES del mismo dueño (ws1-t2, ronda 5). Vacío si no tiene
   *  ninguna otra, o ninguna hermana es dental. Sin datos de pacientes. */
  sedesHermanas: SedeHermana[];
}) {
  return (
    <div className={s.pagina}>
      {vistaPrevia && (
        <div className={`${s.aviso} ${s.avisoAlerta}`} role="note">
          <Eye size={18} strokeWidth={1.9} aria-hidden />
          <div className={s.avisoCuerpo}>
            <strong>Vista previa: esta clínica SÍ tiene Ortodoncia</strong>
            Estás viendo el panel como lo ve una clínica que no la ha contratado. Solo cambia en este navegador.{" "}
            <a className={s.avisoEnlace} href={`${RUTA_CONTRATAR_ORTODONCIA}/vista-previa?salir=1`}>
              Salir de la vista previa
            </a>
          </div>
        </div>
      )}

      {compra === "ok" && <EsperandoActivacion activo={moduloActivo} />}
      {compra === "pendiente" && (
        <div className={`${s.aviso} ${s.avisoAlerta}`} role="status">
          <Hourglass size={18} strokeWidth={1.9} aria-hidden />
          <div className={s.avisoCuerpo}>
            <strong>Tu pago está pendiente</strong>
            En cuanto se confirme, Ortodoncia se activa sola y el candado del menú desaparece.
          </div>
        </div>
      )}
      {compra === "cancelada" && (
        <div className={s.aviso} role="status">
          <XCircle size={18} strokeWidth={1.9} aria-hidden />
          <div className={s.avisoCuerpo}>
            <strong>No se hizo ningún cargo</strong>
            Saliste del pago antes de terminar. Puedes contratar cuando quieras.
          </div>
        </div>
      )}

      <header className={s.cabeza}>
        <span className={s.cabezaIcono} aria-hidden>
          <Smile size={24} strokeWidth={1.8} />
          <span className={s.cabezaCandado}>
            <Lock size={11} strokeWidth={2.4} />
          </span>
        </span>
        <div className={s.cabezaTextos}>
          <p className={s.sobretitulo}>Módulo adicional · sin contratar</p>
          <h1 className={s.titulo}>Ortodoncia</h1>
          <p className={s.subtitulo}>
            Casos, controles y mensualidades en un solo lugar. Tu recepción sabe quién debe y cuánto, y tú ves todos tus
            casos de un vistazo.
          </p>
          <p className={s.sedeNota}>
            <Building2 size={13} strokeWidth={2} aria-hidden />
            Esto contrata Ortodoncia para <strong>{sedeActualNombre}</strong>. Cada sede se contrata por separado: el
            módulo de una no cubre a las demás.
          </p>
        </div>
      </header>

      <div className={s.rejilla}>
        <section className={s.incluye} aria-labelledby="orto-incluye">
          <h2 className={s.incluyeTitulo} id="orto-incluye">
            Todo lo que incluye
          </h2>
          <p className={s.incluyeSub}>
            {CONTENIDO_ORTODONCIA.length} áreas. Lo que ves aquí es lo que tu clínica puede usar desde el primer día.
          </p>
          <ul className={s.categorias}>
            {CONTENIDO_ORTODONCIA.map((c) => {
              const Icono = ICONO[c.id];
              return (
                <li key={c.id} className={s.categoria}>
                  <div className={s.categoriaCabeza}>
                    <span className={s.categoriaIcono} aria-hidden>
                      <Icono size={16} strokeWidth={1.9} />
                    </span>
                    <h3 className={s.categoriaTitulo}>{c.titulo}</h3>
                  </div>
                  <p className={s.categoriaResumen}>{c.resumen}</p>
                  <ul className={s.puntos}>
                    {c.puntos.map((p) => (
                      <li key={p} className={s.punto}>
                        <Check size={14} strokeWidth={2.4} aria-hidden />
                        {p}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className={s.columnaPrecio} aria-label="Precio y contratación">
          <TarjetaPrecio
            precios={precios}
            cicloInicial={cicloInicial}
            puedeContratar={puedeContratar}
            // Con un pago ya hecho (o pendiente de confirmarse) NO se ofrece
            // pagar otra vez: el webhook tarda unos segundos en activar el
            // módulo y, en ese rato, un segundo clic abriría otra suscripción.
            pagoEnCurso={compra === "ok" || compra === "pendiente"}
          />

          {sedesHermanas.length > 0 && (
            <section className={s.sedes} aria-label="Tus otras sedes">
              <h2 className={s.sedesTitulo}>
                <Building2 size={14} strokeWidth={1.9} aria-hidden />
                Tus otras sedes
              </h2>
              <ul className={s.sedesLista}>
                {sedesHermanas.map((sede) => (
                  <li key={sede.clinicId} className={s.sede}>
                    <span className={s.sedeNombre}>{sede.nombre}</span>
                    <span className={sede.activo ? s.sedeActiva : s.sedeInactiva}>
                      {sede.activo ? (
                        <CheckCircle2 size={13} strokeWidth={2} aria-hidden />
                      ) : (
                        <Circle size={13} strokeWidth={2} aria-hidden />
                      )}
                      {sede.activo ? "Ya la tiene" : "Aún no"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
