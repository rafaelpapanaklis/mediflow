export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Baby,
  CalendarClock,
  Check,
  ClipboardList,
  Droplet,
  HeartPulse,
  Mail,
  PersonStanding,
  Phone,
  Pill,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission, type EduPermissionKey } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import {
  eduAntecedentesChips,
  eduPatientFichaChips,
  eduPatientFullName,
  type EduAlertChipKind,
  type EduFichaChipKind,
} from "@/lib/edu/pacientes-core";
import { listEduStudentOptions, listEduSupervisorOptions } from "@/lib/edu/agenda";
import { listEduChairOptions } from "@/lib/edu/sillones";
import { listEduPrograms } from "@/lib/edu/padron";
import { eduTodayISO } from "@/lib/edu/agenda-core";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";
import { getEduPatientKpis } from "@/lib/edu/resumen";
import { eduMoney } from "@/lib/edu/dinero-core";
import {
  EDU_PATIENT_STATUS_LABELS,
  EDU_SEX_LABELS,
  type EduPatientStatus,
} from "@/lib/edu/types";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacienteTabs, type EduPacienteTab } from "@/components/edu/expediente/paciente-tabs";
import { EduPacienteAcciones } from "@/components/edu/expediente/paciente-acciones";

export const metadata: Metadata = {
  title: "Paciente · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/** Icono por clase de chip de alerta. Rojo = contraindica (alergias);
 *  ámbar = a tener en cuenta (padecimientos, y el aviso de "sin
 *  registrar"); info = medicamentos; gota = tipo de sangre. */
/** El MISMO reparto de tonos que la lista de pacientes: si la píldora de
 *  «Dado de alta» es gris en la lista, aquí no puede ser verde. */
const ESTADO_TONO: Record<EduPatientStatus, string> = {
  NEW: "edu-tag--info",
  ACTIVE: "edu-tag--ok",
  DISCHARGED: "edu-tag--muted",
  INACTIVE: "edu-tag--warn",
};

const ALERT_ICONS: Record<EduAlertChipKind, LucideIcon> = {
  "sin-registrar": AlertTriangle,
  "no-refiere": Check,
  alergia: AlertTriangle,
  padecimiento: HeartPulse,
  medicamento: Pill,
  sangre: Droplet,
  mas: HeartPulse,
};

/** Los dos chips que NO salen de los antecedentes: «menor · tutor» y
 *  «embarazo/lactancia».
 *
 *  🔴 MAPA APARTE, sobre `EduFichaChipKind` y no sobre `EduAlertChipKind`.
 *  Los dos Record de arriba son EXHAUSTIVOS: meter "menor" y "embarazo" en
 *  la unión de las alertas obligaría a ALERT_ICONS a cubrirlos y tumbaría
 *  la build de este archivo. Por eso `pacientes-core.ts` los declara con
 *  tipo propio y aquí se les da su propio mapa. Está fijado por una prueba
 *  en edu-ficha-completa.test.ts. */
const FICHA_ICONS: Record<EduFichaChipKind, LucideIcon> = {
  menor: PersonStanding,
  embarazo: Baby,
};

/**
 * Shell de la ficha de UN paciente: encabezado + ACCIONES + pestañas.
 *
 * Por qué es un LAYOUT y no un encabezado repetido en cada página: Next
 * conserva el layout al navegar entre rutas hermanas, así que cambiar de
 * pestaña NO vuelve a consultar el paciente. Con el encabezado dentro de
 * cada página, cada clic haría una consulta más — nueve consultas para
 * mirar nueve pestañas del mismo paciente.
 *
 * 🔴 EL PACIENTE SE BUSCA DENTRO DEL ALCANCE (getEduPatient). El id de la
 * URL no basta: uno de otra escuela —o de otro alumno— da 404, igual que
 * uno que no existe. Un 403 confirmaría que ese folio existe.
 *
 * ⚠️ Este layout exige "pacientes.view" y NADA más. Cada pestaña vuelve a
 * exigir la suya (expediente.view, odontograma.view, estudios.view): la
 * lista de pestañas filtrada es una comodidad visual, no un candado.
 * Esconder una pestaña no cierra ninguna puerta — basta con teclear la URL.
 * Y por eso CAJA puede abrir esta ficha (recibe y cobra, necesita los
 * datos) y no ve ni una de las tres pestañas del expediente.
 *
 * ── Ola 12 · LAS ACCIONES ───────────────────────────────────────────────
 * La ficha deja de ser de solo lectura: agendar cita, abrir caso, subir
 * estudio y cobrar, cada una detrás de SU permiso. Los desplegables que
 * las alimentan (alumnos, sillones, docentes, especialidades) SOLO se
 * consultan —y solo viajan al navegador— cuando quien mira puede usar
 * alguna acción que los necesite: es la lección del P1-4 de la auditoría
 * (el padrón completo no viaja en el payload RSC de un alumno).
 */
export default async function InstitutoPacienteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "pacientes.view")) {
    return (
      <EduDenied
        permission="pacientes.view"
        what="La ficha de un paciente: sus datos, sus casos y su expediente clínico."
      />
    );
  }

  const paciente = await getEduPatient(ctx, params.id);
  if (!paciente) notFound();

  const base = `/instituto/pacientes/${paciente.id}`;

  // Las iniciales del recuadro de la cabecera. Mismo cálculo que el avatar
  // de la sesión en (panel)/layout.tsx: dos letras como mucho, y si no hay
  // ni nombre ni apellido, la primera del nombre completo.
  const nombreCompleto = eduPatientFullName(paciente);
  const iniciales =
    [paciente.firstName, paciente.lastName]
      .filter(Boolean)
      .map((parte) => parte.trim().charAt(0).toUpperCase())
      .join("")
      .slice(0, 2) || nombreCompleto.charAt(0).toUpperCase();

  // ── Ola 12 · lo que necesitan las acciones ────────────────────────────
  const canAgendar = hasEduPermission(permUser, "agenda.manage");
  const canAbrirCaso = hasEduPermission(permUser, "casos.assign");
  const canSubirEstudio = hasEduPermission(permUser, "estudios.upload");
  const canCobrar = hasEduPermission(permUser, "caja.charge");

  const now = new Date();
  // Los sillones del modal respetan la SEDE elegida (Ola 11): agendar en
  // un sillón de una sede a la que no entras se rebota igual en el
  // servidor, pero el desplegable no debe ni ofrecerlo.
  const sede = canAgendar ? await getEduCampusScope(ctx) : null;
  const [alumnos, sillones, docentes, programas] = await Promise.all([
    canAgendar || canAbrirCaso ? listEduStudentOptions(ctx, now) : Promise.resolve([]),
    canAgendar && sede ? listEduChairOptions(eduWithCampus(ctx, sede)) : Promise.resolve([]),
    canAgendar ? listEduSupervisorOptions(ctx) : Promise.resolve([]),
    canAbrirCaso ? listEduPrograms(ctx) : Promise.resolve([]),
  ]);

  // `permission` cierra la pestaña con UNA key; `permissionAny` la abre con
  // CUALQUIERA de varias. La segunda forma la estrenó la Ola 9 y hacía falta:
  // la pestaña de WhatsApp la usan dos personas distintas por dos motivos
  // distintos —el alumno manda la carta de consentimiento, caja manda el
  // recibo— y ninguna de las dos keys sirve para las dos. Con una sola habría
  // que elegir a quién dejar fuera.
  const definicion: {
    key: string;
    href: string;
    label: string;
    permission: EduPermissionKey | null;
    permissionAny?: EduPermissionKey[];
    exact?: boolean;
  }[] =
    [
      {
        // Ola 12. La PRIMERA y la que abre la ficha: cuántas veces ha
        // venido, su próxima cita, sus casos y su saldo — cada bloque
        // recortado (o ni consultado) según quien mira.
        key: "resumen",
        href: base,
        label: "Resumen",
        permission: null,
        // Su href es la BASE de todos los demás: sin esto, cualquier ruta
        // hija sin pestaña propia encendería «Resumen».
        exact: true,
      },
      {
        // Era la portada hasta la Ola 12; los datos de contacto siguen
        // aquí, intactos, un toque a la derecha.
        key: "datos",
        href: `${base}/datos`,
        label: "Datos",
        permission: null,
      },
      {
        // Ola 12. Las citas pasadas y futuras de ESTE paciente, con
        // alumno, sillón, sede y estado. La misma key que la agenda
        // general: ver la agenda de un paciente ES ver agenda.
        key: "agenda",
        href: `${base}/agenda`,
        label: "Agenda",
        permission: "agenda.view",
      },
      { key: "casos", href: `${base}/casos`, label: "Casos", permission: "casos.view" },
      {
        key: "expediente",
        href: `${base}/expediente`,
        label: "Expediente",
        permission: "expediente.view",
      },
      {
        key: "odontograma",
        href: `${base}/odontograma`,
        label: "Odontograma",
        permission: "odontograma.view",
      },
      { key: "estudios", href: `${base}/estudios`, label: "Estudios", permission: "estudios.view" },
      {
        // ws2-t2. FOTOS CLÍNICAS, separada de Estudios a propósito:
        // «radiografía es radiografía y foto clínica es foto clínica». Es
        // la pestaña donde se ve el antes y el después, y por eso va justo
        // después de Estudios y antes de Consentimientos.
        //
        // MISMO permiso que Estudios (`estudios.view`) y ninguna key
        // nueva: una foto clínica es un archivo del expediente, y quien
        // puede ver una radiografía puede ver una foto. Una key nueva
        // empieza en cero para todo el mundo y obliga a un backfill por
        // rol — a quien tenga overrides guardados no le llegaría, y
        // simplemente no vería la pestaña, sin error y sin pista.
        key: "fotos",
        href: `${base}/fotos`,
        label: "Fotos",
        permission: "estudios.view",
      },
      {
        // Ola 3B. Con permiso propio porque es la única
        // pestaña del expediente que CAJA sí puede abrir: la carta se
        // imprime y se entrega en el mostrador. Las tres de arriba siguen
        // cerradas para caja por partida doble (permiso + alcance).
        key: "consentimientos",
        href: `${base}/consentimientos`,
        label: "Consentimientos",
        permission: "consentimientos.view",
      },
      {
        // Ola 9. Va después de Consentimientos y con DOS permisos
        // alternativos, que es la forma nueva: aquí se le
        // manda al paciente su carta para firmar (consentimientos.view) o el
        // recibo de un cobro (caja.view), y son dos trabajos de dos personas
        // distintas. NO exige "whatsapp.view" —que solo tiene la dirección—
        // porque esa key es la de CONFIGURAR la conexión del instituto, no la
        // de mandarle un documento a un paciente.
        key: "whatsapp",
        href: `${base}/whatsapp`,
        label: "WhatsApp",
        permission: null,
        permissionAny: ["consentimientos.view", "caja.view"],
      },
      {
        // Ola 14. Documento clínico: CAJA no la ve (ni por permiso ni por
        // alcance — se lee con "cases", que para caja es "none"). Aquí el
        // alumno PROPONE la receta; quien la expide con su cédula es el
        // docente, desde su bandeja de autorizaciones.
        key: "recetas",
        href: `${base}/recetas`,
        label: "Recetas",
        permission: "recetas.view",
      },
      {
        // La ruta /pagos existía, funcionaba y NO estaba aquí: caja abría
        // la ficha de un paciente que paga a meses y no veía sus
        // mensualidades por ningún lado. La única puerta en todo el panel
        // era Caja → Pagos a meses → el plan → su recibo → "Ver al
        // paciente". Efecto secundario que se va con esto: estando en
        // /pagos la pestaña encendida era «Resumen», porque su href es el
        // prefijo de todas (ver `exact` en paciente-tabs.tsx).
        //
        // "caja.view" es la MISMA key que exige la página; el alcance de
        // "charges" sigue siendo la segunda cerradura, así que un alumno
        // con la key encendida a mano seguiría sin ver una sola fila.
        key: "pagos",
        href: `${base}/pagos`,
        label: "Pagos",
        permission: "caja.view",
      },
    ];

  // ── LOS KPI DE LA CABECERA ────────────────────────────────────────────
  // Próxima cita, última visita y —solo con permiso Y alcance— el saldo,
  // visibles en LAS DOCE pestañas y no solo en el Resumen.
  //
  // 🔴 UNA SOLA LLAMADA, y la comparte con el Resumen. `getEduPatientKpis`
  // va memoizada por petición con el `cache()` de React, así que en la
  // pestaña Resumen esto se ejecuta una vez y `getEduPatientResumen`
  // reutiliza el resultado en lugar de repetir las cinco consultas. En las
  // otras once pestañas es esa única llamada y nada más: la ficha NO paga
  // el resumen entero por cambiar de pestaña.
  const kpis = await getEduPatientKpis(
    ctx.institutionId,
    ctx.role,
    ctx.eduUserId,
    paciente.id,
    ctx.institution.timezone,
  );
  // El saldo lleva DOBLE candado, igual que en el Resumen: el alcance
  // decide si se consultó (`kpis.saldo === null` = no se consultó, no
  // viaja en el payload) y el permiso decide si se pinta.
  const veSaldo = kpis.saldo !== null && hasEduPermission(permUser, "caja.view");

  const tabs: EduPacienteTab[] = definicion
    .filter((t) => {
      if (t.permissionAny) return t.permissionAny.some((k) => hasEduPermission(permUser, k));
      return t.permission === null || hasEduPermission(permUser, t.permission);
    })
    .map(({ key, href, label, exact }) => ({ key, href, label, exact }));

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/pacientes" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Pacientes
        </Link>
      </p>

      {/* ── LA CABECERA DE LA FICHA ────────────────────────────────────────
          Antes era una tarjeta blanca lisa —la misma superficie que
          cualquier fila de la lista de la que vienes—, con el nombre a
          19 px (más chico que el título de esa lista, que mide 27) y con
          edad, sexo, teléfono, correo, estado y casos unidos por
          `.join(" · ")` en UNA línea gris de 13 px: el teléfono, que es a
          lo que se entra, pesaba lo mismo que el sexo.

          Ahora: banda de marca, iniciales, nombre grande, los datos clave
          como píldoras (el teléfono, clicable), las alertas médicas DENTRO
          y los KPI. Todo con tokens que ya existían — ni una paleta nueva.

          🔴 EL RECUADRO NO ES UNA FOTO, son las INICIALES. Este vertical
          no guarda la cara de nadie, y guardarla sería columna, bucket,
          subida y recorte: otra tarea, no un `<img>`. */}
      <header className="edu-fichahero">
        <div className="edu-fichahero__main">
          <span className="edu-fichahero__avatar" aria-hidden="true">
            {iniciales}
          </span>

          <div className="edu-fichahero__info">
            <span className="edu-fichahero__folio">Folio {paciente.folio}</span>
            <h1 className="edu-fichahero__name">{nombreCompleto}</h1>
            <span className="edu-fichahero__estado">
              <span className={`edu-tag ${ESTADO_TONO[paciente.status]}`}>
                {EDU_PATIENT_STATUS_LABELS[paciente.status]}
              </span>
            </span>
          </div>

          <div className="edu-fichahero__datos">
            {paciente.phone ? (
              /* `tel:` y no texto plano: es el dato al que se viene, y en
                 un teléfono —o en un portátil con la app de llamadas— un
                 toque marca. */
              <a className="edu-fichadato" href={`tel:${paciente.phone.replace(/[^+\d]/g, "")}`}>
                <Phone size={13} strokeWidth={1.9} aria-hidden />
                {paciente.phone}
              </a>
            ) : (
              <span className="edu-fichadato">
                <Phone size={13} strokeWidth={1.9} aria-hidden />
                Sin teléfono
              </span>
            )}

            {paciente.email && (
              <a className="edu-fichadato" href={`mailto:${paciente.email}`}>
                <Mail size={13} strokeWidth={1.9} aria-hidden />
                {paciente.email}
              </a>
            )}

            <span className="edu-fichadato">
              <User size={13} strokeWidth={1.9} aria-hidden />
              {[
                paciente.ageYears !== null ? `${paciente.ageYears} años` : "Sin fecha de nacimiento",
                paciente.sex !== "UNSPECIFIED" ? EDU_SEX_LABELS[paciente.sex] : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>

            {paciente.openCases > 0 && (
              <span className="edu-fichadato">
                <ClipboardList size={13} strokeWidth={1.9} aria-hidden />
                {`${paciente.openCases} caso${paciente.openCases === 1 ? "" : "s"} abierto${
                  paciente.openCases === 1 ? "" : "s"
                }`}
              </span>
            )}
          </div>
        </div>

        {/* ── LOS KPI, EN LAS DOCE PESTAÑAS ────────────────────────────
            Estaban solo en el Resumen: quien estaba en Estudios o en
            Recetas no sabía si el paciente tenía cita mañana sin volver a
            la portada. No cuestan una consulta por pestaña — ver
            `getEduPatientKpis` arriba. */}
        <div className="edu-fichahero__kpis">
          <div className={`edu-fichakpi ${kpis.proximaCita ? "" : "edu-fichakpi--alerta"}`}>
            <span className="edu-fichakpi__label">
              <CalendarClock size={11} strokeWidth={2} aria-hidden /> Próxima cita
            </span>
            <span className="edu-fichakpi__value">
              {kpis.proximaCita ? kpis.proximaCita.label : "No tiene"}
            </span>
          </div>

          <div className="edu-fichakpi">
            <span className="edu-fichakpi__label">Última visita</span>
            <span className="edu-fichakpi__value">
              {kpis.ultimaVisita ? kpis.ultimaVisita.label : "Nunca ha venido"}
            </span>
          </div>

          <div className="edu-fichakpi">
            <span className="edu-fichakpi__label">
              Visitas{kpis.recortado ? " (las tuyas)" : ""}
            </span>
            <span className="edu-fichakpi__value">{kpis.visitas}</span>
          </div>

          {veSaldo && (
            <div
              className={`edu-fichakpi ${
                kpis.saldo!.pendienteCents > 0 ? "edu-fichakpi--alerta" : ""
              }`}
            >
              <span className="edu-fichakpi__label">
                <Wallet size={11} strokeWidth={2} aria-hidden /> Saldo pendiente
              </span>
              <span className="edu-fichakpi__value">{eduMoney(kpis.saldo!.pendienteCents)}</span>
            </div>
          )}
        </div>

        {/* ── LAS ALERTAS MÉDICAS, AHORA DENTRO DE LA CABECERA ─────────
            Siguen viviendo en el LAYOUT a propósito: se ven en TODAS las
            pestañas, no escondidas en "Datos". Un alumno a punto de
            infiltrar anestesia tiene que ver "Alergia: lidocaína" esté
            donde esté de la ficha. Lo único que cambia es que ahora están
            DENTRO del hero, donde ganan su contraste en vez de colgar
            sueltas sobre el lienzo.

            🔴 "Sin antecedentes registrados" NO es "sin alergias": el chip
            ámbar es una tarea pendiente, no una respuesta clínica — la
            distinción la deriva eduAntecedentesChips de historyRecordedAt
            y confundirlas es como se mata a alguien. CAJA también las ve
            (ella las captura): este bloque cuelga de pacientes.view, no
            del alcance clínico. */}
        <div className="edu-fichahero__chips" role="group" aria-label="Alertas y avisos del paciente">
          {eduAntecedentesChips(paciente.antecedentes).map((chip, i) => {
            const Icon = ALERT_ICONS[chip.kind] ?? AlertTriangle;
            return (
              <span
                key={`${chip.kind}-${i}`}
                className={`edu-tag edu-tag--${chip.tone}`}
                title={chip.detail}
              >
                <Icon size={12} strokeWidth={1.75} aria-hidden />
                {chip.text}
              </span>
            );
          })}

          {/* ── LOS DOS DE LA FICHA: «menor · tutor» y «embarazo» ────────
              Van DESPUÉS de los antecedentes y no antes: las alergias son
              rojas y encabezan la fila por una razón, y colar delante un
              chip azul de «Menor · tutor: X» las empuja a segunda lectura.
              Pero van en la MISMA fila y no en otra: quien va a tomar una
              radiografía mira una fila de chips, no dos.

              🔴 Su propio mapa de iconos (FICHA_ICONS) y su propio tipo.
              Ver la nota de ALERT_ICONS: ampliar EduAlertChipKind rompe
              este archivo.

              La regla de tres estados es de la función, no de aquí:
              `pregnancy: null` NO pinta nada —nadie preguntó ≠ no está
              embarazada— y «Menor sin tutor registrado» sale ámbar porque
              es una tarea pendiente, no un dato. */}
          {eduPatientFichaChips({
            ageYears: paciente.ageYears,
            guardianName: paciente.guardianName,
            guardianRelation: paciente.guardianRelation,
            pregnancy: paciente.pregnancy,
            isChild: paciente.isChild,
          }).map((chip, i) => {
            const Icon = FICHA_ICONS[chip.kind] ?? AlertTriangle;
            return (
              <span
                key={`ficha-${chip.kind}-${i}`}
                className={`edu-tag edu-tag--${chip.tone}`}
                title={chip.detail}
              >
                <Icon size={12} strokeWidth={1.75} aria-hidden />
                {chip.text}
              </span>
            );
          })}

          <Link href={`${base}/datos#antecedentes`} className="edu-fichaalertas__link">
            <ClipboardList size={12} strokeWidth={1.75} aria-hidden />
            Antecedentes
          </Link>
        </div>
      </header>

      <EduPacienteAcciones
        patientId={paciente.id}
        patientName={eduPatientFullName(paciente)}
        base={base}
        todayISO={eduTodayISO(ctx.institution.timezone, now)}
        canAgendar={canAgendar}
        canAbrirCaso={canAbrirCaso}
        canSubirEstudio={canSubirEstudio}
        canCobrar={canCobrar}
        alumnos={alumnos}
        sillones={sillones}
        docentes={docentes}
        programas={programas.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))}
      />

      <EduPacienteTabs tabs={tabs} />

      {children}
    </div>
  );
}
