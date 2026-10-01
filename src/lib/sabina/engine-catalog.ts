import type { SabinaAccion } from "./engine-acciones";
import { herramientaDeAccion } from "./engine-acciones";
import type { SabinaTool } from "./engine-types";
import { CATALOGO_SABINA } from "./tools";
import { proponerHorarios } from "./tools/agenda-acciones";
import { accionAgendarCita, accionCancelarCita, accionReagendarCita } from "./acciones-agenda";
import { accionRegistrarPaciente } from "./acciones-pacientes";
import { accionAvisarSaldo } from "./dinero/avisar-saldo";
import { accionCobrarFactura } from "./dinero/cobrar-factura";
import { accionCrearFactura } from "./dinero/crear-factura";
import { facturasDePaciente } from "./dinero/facturas-de-paciente";
import { caja } from "./tools/caja";
import { compararSedes } from "./tools/comparar-sedes";
import { recetas } from "./tools/recetas";
import { estudiosDelPaciente } from "./tools/estudios-del-paciente";
import { analisisYNotasDeEstudio } from "./tools/analisis-y-notas-de-estudio";
import { procedimientosYPrecios } from "./tools/procedimientos-y-precios";
import { equipoClinica } from "./tools/equipo-clinica";
import { oportunidadesPerdidas } from "./tools/oportunidades-perdidas";
import { odontograma } from "./tools/odontograma";
import { cumpleanos } from "./tools/cumpleanos";
import { pacientesConEtiqueta } from "./tools/pacientes-con-etiqueta";
import { proximasCitas } from "./tools/proximas-citas";
import { estadoMercadoPago } from "./tools/estado-mercado-pago";
import { ayudaDelPanel } from "./tools/ayuda-del-panel";
import { ortoCaso } from "./tools/orto-caso";
import { ortoDiagnostico } from "./tools/orto-diagnostico";
import { ortoControles } from "./tools/orto-controles";
import { ortoCobranza } from "./tools/orto-cobranza";
import { ortoResumen } from "./tools/orto-resumen";
import { presupuestos } from "./tools/presupuestos";

/**
 * El catálogo de Sabina: lo que el modelo puede CONSULTAR y lo que puede
 * PROPONER. Es la única lista que leen el motor (`SABINA_TOOLS`) y la
 * confirmación (`ACCIONES_SABINA`).
 *
 * Mientras motor y herramientas vivían en ramas separadas, esta lista estaba
 * vacía y se decía que integrar era «una línea». No lo era: además de
 * enganchar el catálogo, el motor tenía que pasarles el ctx completo
 * (`crearSabinaCtx`) y ejecutarlas por `correrHerramienta`, que es el que
 * produce `resumen` y `sin_datos`. Lo cubre `__tests__/punta-a-punta.test.ts`.
 */

/* ── CONSULTAS ─────────────────────────────────────────────────────────────
   Las diez de `./tools`, en el orden de `CATALOGO_SABINA`, y `proponer_horarios`
   (ws1-t2), que solo lee. Se ejecutan dentro del bucle, bajo el candado de solo
   lectura. `proponer_horarios` va aquí y no en `CATALOGO_SABINA` porque las
   pruebas de contrato de ese catálogo fijan las diez de consulta; lo mismo
   `facturas_de_paciente` (dinero, ws1-t2), con sus pruebas en dinero/__tests__;
   `caja` (ws1-t3), con sus pruebas en tools/__tests__/caja.test.ts: solo lee;
   Sabina no abre, no retira y no cierra (MAPA-caja §10); las tres de CLÍNICO
   (ws1-t4: recetas, estudios_del_paciente, analisis_y_notas_de_estudio), todas
   de solo lectura; las dos de LA CLÍNICA (ws1-t5: procedimientos_y_precios y
   equipo_clinica), que leen el catálogo de precios y el cuadro de profesionales
   —ninguna escribe: `procedimientos_y_precios` ni siquiera siembra el catálogo,
   que es lo que sí hace `GET /api/procedures` la primera vez—;
   `oportunidades_perdidas` (ws1-t8), que cruza facturas, presupuestos, planes y
   citas para decir qué dinero se está escapando —solo lee, y los pacientes
   fríos los delega en `pacientes_inactivos`—; `odontograma` (ws1-t1, «Sabina
   en todas partes»), que lee los hallazgos que el doctor ya marcó y NO
   diagnostica; y las tres de LA LISTA DE PACIENTES (ws1-t5, «fuera los cuatro
   filtros»): `cumpleanos`, `pacientes_con_etiqueta` y `proximas_citas`, que
   contestan lo que contestaban las chips «Cumple esta semana», «VIP» y
   «Próxima cita» de /dashboard/patients antes de quitarlas. Solo leen; sus
   pruebas están en tools/__tests__/lista-pacientes.test.ts. Y las dos de
   «Sabina sabe del panel» (ws1-t4, 23-sep-2026): `estado_mercado_pago`, que lee
   lo mismo que pinta Configuración → Anticipos por WhatsApp —no conecta, no
   cambia ajustes, no manda links—, y `ayuda_del_panel`, que no lee la base:
   devuelve los pasos en pantalla de UN tema de ./ayuda-del-panel. Pruebas en
   tools/__tests__/sabe-del-panel.test.ts. Y las tres de ORTODONCIA (ws1-t11,
   28-sep-2026): `orto_caso`, `orto_controles` y `orto_cobranza`. Leen con el
   motor del módulo (los mismos cargadores que sus pantallas), solo en sedes con
   el módulo contratado, y dan el enlace a la pantalla donde se hace cada cosa.
   🔴 Son consultas, no acciones: no abren casos, no firman hojas y no cobran
   mensualidades. Pruebas en tools/__tests__/ortodoncia.test.ts. Lo único de
   ortodoncia que Sabina hace es AGENDAR, con la acción de siempre
   (`agendar_cita` + tools/orto-agenda.ts: tipo de cita del catálogo, doctor
   tratante y duración configurada); `cobrar_factura` rechaza lo que sea de un
   caso de ortodoncia (dinero/orto-candado.ts). Pruebas en
   tools/__tests__/ortodoncia-agenda.test.ts. */
const CONSULTAS: ReadonlyArray<SabinaTool<any, any>> = [
  ...CATALOGO_SABINA,
  proponerHorarios,
  facturasDePaciente,
  caja,
  // comparar_sedes (ws1-t4) — la ÚNICA que mira más de una clínica. Quién puede
  // ver qué sede se decide en ./sedes.ts, desde la sesión y en un solo sitio;
  // sus parámetros no nombran ninguna sede. Solo lee.
  compararSedes,
  recetas,
  estudiosDelPaciente,
  analisisYNotasDeEstudio,
  procedimientosYPrecios,
  equipoClinica,
  oportunidadesPerdidas,
  odontograma,
  cumpleanos,
  pacientesConEtiqueta,
  proximasCitas,
  estadoMercadoPago,
  ayudaDelPanel,
  ortoCaso,
  ortoDiagnostico,
  ortoControles,
  ortoCobranza,
  // ws1-t9 (1-oct-2026): el histórico de ortodoncia y los presupuestos. Solo leen. Pruebas en tools/__tests__/orto-resumen.test.ts y consultas-t9-dinero.test.ts.
  ortoResumen,
  presupuestos,
];

/* ── ACCIONES ──────────────────────────────────────────────────────────────
   Lo que ESCRIBE. Cada una se declara con `definirAccion` (engine-acciones.ts)
   y entra aquí con UNA línea, en el orden en que conviene presentárselas al
   modelo. El modelo solo ve su mitad `preparar` (una propuesta); la mitad
   `ejecutar` solo corre desde POST /api/sabina/propuestas/:id/confirmar.

   Al añadir una: importa la acción arriba y pon su línea en su bloque. */
export const ACCIONES_SABINA: ReadonlyArray<SabinaAccion<any, any>> = [
  // agenda (ws1-t2) — adaptadas en acciones-agenda.ts
  accionAgendarCita,
  accionReagendarCita,
  accionCancelarCita,
  // pacientes (ws1-t3) — adaptada en acciones-pacientes.ts
  accionRegistrarPaciente,
  // dinero (ws1-t2) — en dinero/. Timbrar, reembolsar, cancelar y editar precio NO
  // están, a propósito: MAPA-dinero §7.
  accionCobrarFactura,
  accionCrearFactura,
  accionAvisarSaldo,
];

/** Lo que ve el motor: consultas + la mitad «proponer» de cada acción. */
export const SABINA_TOOLS: ReadonlyArray<SabinaTool<any, any>> = [
  ...CONSULTAS,
  ...ACCIONES_SABINA.map((accion) => herramientaDeAccion(accion)),
];

/** Feature de `AiUsageEvent` (columna de texto libre, no una unión cerrada). */
export const AI_FEATURE_SABINA = "sabina";
