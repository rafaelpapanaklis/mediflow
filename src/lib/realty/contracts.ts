import "server-only";

// ═══════════════════════════════════════════════════════════════════════
// INMUEBLES · CONTRATOS — la capa de datos del módulo.
//
// 🔴 ESTE ES EL ÚNICO ARCHIVO DEL REPO QUE TOCA LAS CINCO TABLAS DE
// CONTRATOS. Están declaradas en prisma/schema.prisma —como manda la regla
// del vertical, "nada vive solo en SQL": `prisma db push` reconcilia la base
// con ese archivo y se lleva por delante lo que no esté ahí—, pero aquí se
// leen y se escriben con SQL crudo parametrizado. Dos motivos:
//   · el módulo se construyó con diez terminales trabajando a la vez sobre
//     schema.prisma, donde no hay garantía de que cada worktree tenga el
//     cliente REGENERADO — y un `prisma.realtyContract` que no existe en el
//     cliente no compila;
//   · las escrituras con guardia de estado (`sealedAt IS NULL` en el WHERE)
//     se leen mejor en la sentencia que las ejecuta.
// Los nombres de columna, índice y constraint del schema están escritos a
// mano (`map:`) para que coincidan con sql/realty-contratos.sql carácter
// por carácter.
//
// ── LAS TRES REGLAS DEL SQL CRUDO DE ESTE ARCHIVO ──────────────────────
// 1. SIEMPRE `prisma.$queryRaw` con plantilla etiquetada (backticks), NUNCA
//    `$queryRawUnsafe` con interpolación de strings. La forma etiquetada
//    parametriza sola: `${valor}` se manda como parámetro, no se pega al
//    texto de la consulta. La única excepción es el DDL de ensureTables,
//    que no lleva un solo dato de nadie.
// 2. TODA consulta de negocio lleva `"accountId" = ${accountId}` en el
//    WHERE. Sin excepción y sin `undefined`: aquí no hay un Prisma que
//    borre el filtro en silencio, pero un WHERE que se me olvide devuelve
//    la tabla entera de todos los inquilinos.
// 3. Las escrituras que dependen de un estado llevan la CONDICIÓN EN EL
//    WHERE, no en un `if` de JavaScript. `sealedAt IS NULL` en el UPDATE es
//    lo que hace imposible editar un contrato firmado, aunque dos pestañas
//    lleguen a la vez.
//
// ⚠️ LAS PLANTILLAS LAS TIENE QUE REVISAR UN ABOGADO antes de que un
// cliente firme con ellas. Las de este archivo son un punto de partida
// honesto y genérico, no un contrato revisado.
// ═══════════════════════════════════════════════════════════════════════

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { formatLongDate } from "@/lib/realty/rent-charges";
import {
  computeDocumentHash,
  hashMatches,
  hashToken,
  looksLikeToken,
  mintSignatureToken,
  signatureLinkExpiry,
  signatureStoragePath,
  signatureUrl,
  strokeHash,
  validateSignatureStroke,
  type SignerEvidence,
} from "@/lib/realty/signature";
import {
  addRealtyStorageBytes,
  downloadRealtyFile,
  pathBelongsToAccount,
  uploadRealtyFile,
} from "@/lib/realty/media";
import {
  CONTRACT_SOURCE,
  MAX_CONTRACT_BODY,
  MAX_PARTIES,
  MAX_TEMPLATE_BODY,
  SIGNATURE_MAX_ATTEMPTS,
  expiryWindowFor,
  formatContractFolio,
  formatContractMoney,
  isContractKind,
  isPartyRole,
  parseContractFolio,
  renderTemplate,
  unknownVariables,
  variableNames,
  type ContractDetailDTO,
  type ContractPartyDTO,
  type ContractRowDTO,
  type ContractSignatureDTO,
  type PublicSigningDTO,
  type RealtyContractKind,
  type RealtyContractStatus,
  type RealtyPartyRole,
} from "@/components/realty/contracts/shared";

// ── Errores tipados ────────────────────────────────────────────────────
/** Regla de negocio rota. La API lo mapea al `status` que trae. */
export class ContractError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ContractError";
    this.status = status;
  }
}

/**
 * Las tablas no están. Se distingue del resto porque la pantalla enseña
 * instrucciones (correr sql/realty-contratos.sql) en vez de "algo falló".
 */
export class ContractTablesMissingError extends Error {
  constructor(readonly detail: string) {
    super("Las tablas de contratos no están disponibles.");
    this.name = "ContractTablesMissingError";
  }
}

// ── Ids ────────────────────────────────────────────────────────────────
/**
 * Id al estilo cuid. Los cinco modelos declaran `id String @id` SIN
 * `@default(cuid())` a propósito: quien inserta es el SQL crudo de este
 * archivo, no el cliente generado, así que un default del schema nunca
 * llegaría a correr y solo serviría para hacer creer que sí. El id lo pone
 * aquí: 12 bytes de aleatoriedad más el reloj — colisión imposible en la
 * práctica y ordena por creación, que ayuda al índice.
 */
function newId(): string {
  return `c${Date.now().toString(36)}${randomBytes(9).toString("hex")}`;
}

// ── 1. Las tablas ──────────────────────────────────────────────────────
/**
 * DDL idempotente, aplicado UNA VEZ por proceso.
 *
 * 🔴 POR QUÉ SE AUTOAPLICA Y NO SE ESPERA A QUE ALGUIEN CORRA EL .sql.
 * Este repo tiene una fila larga de funciones terminadas que llevan meses
 * sin servir porque "falta el sql" — está anotado así en media docena de
 * sitios. Un módulo que solo funciona después de que un humano se acuerde
 * de correr un archivo es un módulo apagado. Todo es CREATE ... IF NOT
 * EXISTS, así que la segunda vez no hace nada.
 *
 * El DDL es el MISMO de sql/realty-contratos.sql y crea los mismos nombres
 * de índice y constraint que generaría Prisma desde schema.prisma: da igual
 * quién llegue primero, la base queda idéntica y sin índices duplicados.
 *
 * En el camino normal esto cuesta UNA consulta, no veinte: primero se
 * pregunta por `to_regclass` de la última tabla de la lista y, si ya está,
 * no se ejecuta un solo CREATE. Es la última a propósito — si un intento
 * anterior se quedó a la mitad, la última es la que falta.
 *
 * Si el rol de la base no puede crear tablas, NO se traga el error: se
 * lanza ContractTablesMissingError y la pantalla dice exactamente qué
 * archivo hay que correr. Fallar en silencio aquí sería peor.
 *
 * La promesa se cachea, no el resultado: si el primer intento falla, el
 * siguiente lo vuelve a intentar en vez de quedarse roto para siempre.
 */
let tablesReady: Promise<void> | null = null;

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "realty_contract_templates" (
     "id" TEXT NOT NULL,
     "accountId" TEXT NOT NULL,
     "kind" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "body" TEXT NOT NULL,
     "version" INTEGER NOT NULL DEFAULT 1,
     "updatedByUserId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "realty_contract_templates_pkey" PRIMARY KEY ("id"),
     CONSTRAINT "realty_contract_templates_accountId_fkey"
       FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "realty_contract_templates_account_kind_key"
     ON "realty_contract_templates" ("accountId", "kind")`,
  `CREATE TABLE IF NOT EXISTS "realty_contracts" (
     "id" TEXT NOT NULL,
     "accountId" TEXT NOT NULL,
     "kind" TEXT NOT NULL,
     "folio" TEXT NOT NULL,
     "title" TEXT NOT NULL,
     "leaseId" TEXT,
     "exclusiveId" TEXT,
     "dealId" TEXT,
     "propertyId" TEXT,
     "contactId" TEXT,
     "body" TEXT NOT NULL,
     "variables" TEXT NOT NULL DEFAULT '{}',
     "documentHash" TEXT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'BORRADOR',
     "effectiveFrom" TIMESTAMP(3),
     "effectiveTo" TIMESTAMP(3),
     "sealedAt" TIMESTAMP(3),
     "signedAt" TIMESTAMP(3),
     "archivedAt" TIMESTAMP(3),
     "voidedAt" TIMESTAMP(3),
     "voidReason" TEXT,
     "replacedById" TEXT,
     "createdByUserId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "realty_contracts_pkey" PRIMARY KEY ("id"),
     CONSTRAINT "realty_contracts_accountId_fkey"
       FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "realty_contracts_account_folio_key"
     ON "realty_contracts" ("accountId", "folio")`,
  `CREATE INDEX IF NOT EXISTS "realty_contracts_account_status_idx"
     ON "realty_contracts" ("accountId", "status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "realty_contracts_account_effectiveto_idx"
     ON "realty_contracts" ("accountId", "effectiveTo")`,
  `CREATE INDEX IF NOT EXISTS "realty_contracts_account_property_idx"
     ON "realty_contracts" ("accountId", "propertyId")`,
  `CREATE INDEX IF NOT EXISTS "realty_contracts_account_contact_idx"
     ON "realty_contracts" ("accountId", "contactId")`,
  `CREATE INDEX IF NOT EXISTS "realty_contracts_account_lease_idx"
     ON "realty_contracts" ("accountId", "leaseId")`,
  `CREATE TABLE IF NOT EXISTS "realty_contract_parties" (
     "id" TEXT NOT NULL,
     "accountId" TEXT NOT NULL,
     "contractId" TEXT NOT NULL,
     "role" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "email" TEXT,
     "phone" TEXT,
     "contactId" TEXT,
     "mustSign" BOOLEAN NOT NULL DEFAULT true,
     "sortOrder" INTEGER NOT NULL DEFAULT 0,
     "signedAt" TIMESTAMP(3),
     "signatureId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "realty_contract_parties_pkey" PRIMARY KEY ("id"),
     CONSTRAINT "realty_contract_parties_contract_fkey"
       FOREIGN KEY ("contractId") REFERENCES "realty_contracts"("id") ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS "realty_contract_parties_contract_idx"
     ON "realty_contract_parties" ("contractId", "sortOrder")`,
  `CREATE INDEX IF NOT EXISTS "realty_contract_parties_account_idx"
     ON "realty_contract_parties" ("accountId")`,
  `CREATE TABLE IF NOT EXISTS "realty_contract_signatures" (
     "id" TEXT NOT NULL,
     "accountId" TEXT NOT NULL,
     "contractId" TEXT NOT NULL,
     "partyId" TEXT NOT NULL,
     "signerName" TEXT NOT NULL,
     "documentHash" TEXT NOT NULL,
     "strokePath" TEXT,
     "strokeInline" TEXT,
     "strokeHash" TEXT NOT NULL,
     "ip" TEXT,
     "userAgent" TEXT,
     "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "tokenId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "realty_contract_signatures_pkey" PRIMARY KEY ("id"),
     CONSTRAINT "realty_contract_signatures_accountId_fkey"
       FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "realty_contract_signatures_party_key"
     ON "realty_contract_signatures" ("contractId", "partyId")`,
  `CREATE INDEX IF NOT EXISTS "realty_contract_signatures_account_idx"
     ON "realty_contract_signatures" ("accountId", "signedAt")`,
  `CREATE TABLE IF NOT EXISTS "realty_signature_tokens" (
     "id" TEXT NOT NULL,
     "accountId" TEXT NOT NULL,
     "contractId" TEXT NOT NULL,
     "partyId" TEXT NOT NULL,
     "tokenHash" TEXT NOT NULL,
     "expiresAt" TIMESTAMP(3) NOT NULL,
     "attempts" INTEGER NOT NULL DEFAULT 0,
     "usedAt" TIMESTAMP(3),
     "revokedAt" TIMESTAMP(3),
     "sentAt" TIMESTAMP(3),
     "sentVia" TEXT,
     "viewedAt" TIMESTAMP(3),
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "realty_signature_tokens_pkey" PRIMARY KEY ("id"),
     CONSTRAINT "realty_signature_tokens_accountId_fkey"
       FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "realty_signature_tokens_hash_key"
     ON "realty_signature_tokens" ("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "realty_signature_tokens_contract_idx"
     ON "realty_signature_tokens" ("contractId", "partyId")`,
  `CREATE INDEX IF NOT EXISTS "realty_signature_tokens_account_idx"
     ON "realty_signature_tokens" ("accountId", "expiresAt")`,
];

export async function ensureContractTables(): Promise<void> {
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      const probe = await prisma.$queryRaw<Array<{ ok: string | null }>>`
        SELECT to_regclass('public.realty_signature_tokens')::text AS ok`;
      if (probe[0]?.ok) return;
      for (const stmt of DDL) {
        // $executeRawUnsafe y no la forma etiquetada porque el DDL no admite
        // parámetros. Son constantes de este archivo: ni un dato de nadie
        // entra a estas cadenas.
        await prisma.$executeRawUnsafe(stmt);
      }
    } catch (e) {
      tablesReady = null; // que el siguiente lo vuelva a intentar
      throw new ContractTablesMissingError((e as Error).message);
    }
  })();
  return tablesReady;
}

// ── 2. Las plantillas base ─────────────────────────────────────────────
/**
 * ⚠️⚠️ AVISO PARA QUIEN LEA ESTO ⚠️⚠️
 * Estas cuatro plantillas las escribió un programa, no un abogado. Cubren
 * la estructura que pide la práctica mexicana (declaraciones, cláusulas,
 * firmas) y dejan las variables en su sitio, pero NINGÚN cliente debería
 * firmar con ellas sin que un abogado las revise y las ajuste al estado
 * donde se firma. Cada inmobiliaria puede reemplazarlas por completo desde
 * /inmobiliaria/contratos/plantillas.
 */
export const REALTY_BASE_TEMPLATES: Record<RealtyContractKind, { name: string; body: string }> = {
  ARRENDAMIENTO: {
    name: "Contrato de arrendamiento",
    body: `CONTRATO DE ARRENDAMIENTO

Folio {{folio}}

En {{fecha.lugar}}, a {{fecha.hoy}}, celebran el presente contrato de arrendamiento, por una parte {{arrendador.nombre}}, a quien en lo sucesivo se le denominará EL ARRENDADOR, y por la otra {{inquilino.nombre}}, a quien en lo sucesivo se le denominará EL ARRENDATARIO, con la intervención de {{aval.nombre}} en su carácter de OBLIGADO SOLIDARIO, al tenor de las siguientes declaraciones y cláusulas.

DECLARACIONES

I. Declara EL ARRENDADOR ser propietario del inmueble ubicado en {{inmueble.direccion}}, colonia {{inmueble.colonia}}, {{inmueble.ciudad}}, {{inmueble.estado}}, código postal {{inmueble.cp}}, y contar con la capacidad legal para celebrar el presente contrato.

II. Declara EL ARRENDATARIO conocer el inmueble materia de este contrato, haberlo revisado a su entera satisfacción y tener la capacidad legal y económica para obligarse en los términos aquí pactados.

III. Declara EL OBLIGADO SOLIDARIO que se constituye como tal, respondiendo solidariamente del cumplimiento de todas las obligaciones de EL ARRENDATARIO.

CLÁUSULAS

PRIMERA. OBJETO. EL ARRENDADOR concede a EL ARRENDATARIO el uso y goce temporal del inmueble descrito en la declaración I, con {{inmueble.recamaras}} recámaras, {{inmueble.banos}} baños y {{inmueble.estacionamientos}} cajones de estacionamiento, con una superficie construida de {{inmueble.m2Construidos}} metros cuadrados.

SEGUNDA. DESTINO. El inmueble se destinará exclusivamente a casa habitación. EL ARRENDATARIO no podrá darle un uso distinto sin consentimiento previo y por escrito de EL ARRENDADOR.

TERCERA. VIGENCIA. El presente contrato tendrá una vigencia forzosa de {{vigencia.meses}} meses, que comenzará el {{vigencia.inicio}} y concluirá el {{vigencia.fin}}, fecha en la que EL ARRENDATARIO deberá desocupar y entregar el inmueble sin necesidad de declaración judicial.

CUARTA. RENTA. EL ARRENDATARIO pagará por concepto de renta mensual la cantidad de {{renta.monto}} ({{renta.montoLetra}}), en moneda {{renta.moneda}}, por mes adelantado, a más tardar el día {{renta.diaPago}} de cada mes.

QUINTA. DEPÓSITO EN GARANTÍA. A la firma de este contrato EL ARRENDATARIO entrega la cantidad de {{renta.deposito}} ({{renta.depositoLetra}}) en depósito, para garantizar el cumplimiento de sus obligaciones y el pago de los daños que llegara a causar al inmueble. Este depósito NO constituye pago de renta alguna y será devuelto dentro de los treinta días naturales siguientes a la entrega del inmueble, previa deducción de lo que en su caso corresponda.

SEXTA. AUMENTO. Al término de cada periodo de doce meses, la renta se ajustará conforme a la regla {{aumento.regla}}, aplicando {{aumento.porcentaje}}.

SÉPTIMA. SERVICIOS. Son por cuenta de EL ARRENDATARIO los consumos de agua, energía eléctrica, gas, telefonía e internet, así como las cuotas ordinarias de mantenimiento que correspondan al inmueble durante la vigencia de este contrato.

OCTAVA. CONSERVACIÓN Y REPARACIONES. EL ARRENDATARIO recibe el inmueble en buen estado y se obliga a conservarlo así. Las reparaciones menores y las derivadas del uso corren por su cuenta; las estructurales corresponden a EL ARRENDADOR.

NOVENA. PROHIBICIÓN DE SUBARRENDAR. EL ARRENDATARIO no podrá subarrendar, ceder ni traspasar total o parcialmente los derechos derivados de este contrato sin autorización previa y por escrito de EL ARRENDADOR.

DÉCIMA. RESCISIÓN. Será causa de rescisión sin necesidad de declaración judicial la falta de pago de dos o más mensualidades, el uso distinto al pactado, el subarrendamiento no autorizado y el incumplimiento de cualquiera de las obligaciones aquí contraídas.

DÉCIMA PRIMERA. OBLIGADO SOLIDARIO. {{aval.nombre}} se constituye como obligado solidario de EL ARRENDATARIO y renuncia a los beneficios de orden y excusión, respondiendo del pago de rentas, servicios y daños.

DÉCIMA SEGUNDA. INTERMEDIACIÓN. Las partes reconocen la intervención de {{inmobiliaria.nombre}} como intermediario en la celebración de este contrato, con domicilio en {{inmobiliaria.direccion}} y teléfono {{inmobiliaria.telefono}}.

DÉCIMA TERCERA. JURISDICCIÓN. Para la interpretación y cumplimiento de este contrato, las partes se someten expresamente a las leyes y tribunales de {{inmueble.ciudad}}, {{inmueble.estado}}, renunciando a cualquier otro fuero que pudiera corresponderles.

Leído que fue el presente contrato y enteradas las partes de su contenido y alcance legal, lo firman de conformidad.`,
  },
  EXCLUSIVA: {
    name: "Contrato de exclusiva de intermediación",
    body: `CONTRATO DE PRESTACIÓN DE SERVICIOS DE INTERMEDIACIÓN INMOBILIARIA EN EXCLUSIVA

Folio {{folio}}

En {{fecha.lugar}}, a {{fecha.hoy}}, celebran el presente contrato, por una parte {{propietario.nombre}}, a quien se le denominará EL PROPIETARIO, y por la otra {{inmobiliaria.razonSocial}}, a quien se le denominará EL INTERMEDIARIO, conforme a lo siguiente.

DECLARACIONES

I. Declara EL PROPIETARIO ser legítimo propietario del inmueble ubicado en {{inmueble.direccion}}, colonia {{inmueble.colonia}}, {{inmueble.ciudad}}, {{inmueble.estado}}, y que dicho inmueble se encuentra libre de gravamen y al corriente en sus contribuciones.

II. Declara EL INTERMEDIARIO ser una persona dedicada a la prestación de servicios de intermediación inmobiliaria, con domicilio en {{inmobiliaria.direccion}}, teléfono {{inmobiliaria.telefono}} y licencia inmobiliaria {{inmobiliaria.licencia}}.

CLÁUSULAS

PRIMERA. OBJETO. EL PROPIETARIO otorga a EL INTERMEDIARIO la EXCLUSIVIDAD para promover, ofertar y gestionar la operación del inmueble descrito, por el precio de lista de {{inmueble.precio}} ({{inmueble.precioLetra}}).

SEGUNDA. VIGENCIA. La exclusividad se otorga por {{exclusiva.meses}} meses, del {{exclusiva.inicio}} al {{exclusiva.fin}}. Concluido este plazo sin que se haya concretado la operación, el contrato terminará sin responsabilidad para las partes, salvo lo previsto en la cláusula quinta.

TERCERA. COMISIÓN. EL PROPIETARIO pagará a EL INTERMEDIARIO una comisión equivalente al {{exclusiva.comisionPct}} del precio final de la operación, más el impuesto al valor agregado correspondiente. La comisión se devengará al momento de la firma de la operación y se pagará contra la entrega del inmueble o la firma de escrituras, lo que ocurra primero.

CUARTA. OBLIGACIONES DE EL INTERMEDIARIO. Promover el inmueble por los medios que estime convenientes, atender a los interesados, coordinar las visitas, informar periódicamente a EL PROPIETARIO sobre la promoción y auxiliarlo en la integración del expediente de la operación.

QUINTA. EXCLUSIVIDAD. Durante la vigencia de este contrato EL PROPIETARIO se obliga a no promover el inmueble por sí mismo ni por conducto de tercero. Si la operación se celebra con un interesado presentado por EL INTERMEDIARIO dentro de los noventa días naturales siguientes a la terminación de este contrato, la comisión pactada se causará íntegramente.

SEXTA. GASTOS DE PROMOCIÓN. Los gastos de promoción corren por cuenta de EL INTERMEDIARIO y no son reembolsables ni se descuentan de la comisión.

SÉPTIMA. TERMINACIÓN ANTICIPADA. Cualquiera de las partes podrá dar por terminado este contrato dando aviso por escrito con quince días naturales de anticipación. La terminación anticipada no libera a EL PROPIETARIO de la obligación prevista en la cláusula quinta.

OCTAVA. JURISDICCIÓN. Las partes se someten a las leyes y tribunales de {{inmueble.ciudad}}, {{inmueble.estado}}, renunciando a cualquier otro fuero.

Leído que fue el presente contrato, las partes lo firman de conformidad.`,
  },
  PROMESA: {
    name: "Contrato de promesa de compraventa",
    body: `CONTRATO DE PROMESA DE COMPRAVENTA

Folio {{folio}}

En {{fecha.lugar}}, a {{fecha.hoy}}, celebran el presente contrato de promesa de compraventa, por una parte {{vendedor.nombre}}, a quien se le denominará EL PROMITENTE VENDEDOR, y por la otra {{comprador.nombre}}, a quien se le denominará EL PROMITENTE COMPRADOR.

DECLARACIONES

I. Declara EL PROMITENTE VENDEDOR ser propietario del inmueble ubicado en {{inmueble.direccion}}, colonia {{inmueble.colonia}}, {{inmueble.ciudad}}, {{inmueble.estado}}, con una superficie de terreno de {{inmueble.m2Terreno}} metros cuadrados y {{inmueble.m2Construidos}} metros cuadrados de construcción.

II. Declara EL PROMITENTE COMPRADOR conocer el inmueble, haberlo revisado a su satisfacción y tener interés en adquirirlo en los términos de este contrato.

CLÁUSULAS

PRIMERA. OBJETO. Las partes se obligan a celebrar el contrato definitivo de compraventa del inmueble descrito, en los términos y plazos aquí pactados.

SEGUNDA. PRECIO. El precio total de la operación es de {{operacion.monto}} ({{operacion.montoLetra}}), que EL PROMITENTE COMPRADOR pagará conforme a lo pactado en la cláusula tercera.

TERCERA. FORMA DE PAGO. Las partes acuerdan la forma y las fechas de pago que se detallan en el anexo de este contrato, quedando el saldo cubierto a más tardar en la fecha de firma de escrituras.

CUARTA. FECHA DE FIRMA. El contrato definitivo se firmará ante el notario público que designe EL PROMITENTE COMPRADOR, a más tardar el {{operacion.cierre}}.

QUINTA. GASTOS. Los gastos, impuestos y derechos que se generen con motivo de la escrituración correrán por cuenta de EL PROMITENTE COMPRADOR, con excepción del impuesto sobre la renta que en su caso corresponda a EL PROMITENTE VENDEDOR y de la cancelación de gravámenes que existan sobre el inmueble.

SEXTA. ENTREGA. La posesión material del inmueble se entregará a EL PROMITENTE COMPRADOR en la fecha de firma de escrituras, libre de ocupantes y al corriente en el pago de servicios y contribuciones.

SÉPTIMA. PENA CONVENCIONAL. La parte que sin causa justificada incumpla la obligación de celebrar el contrato definitivo pagará a la otra, por concepto de pena convencional, la cantidad que las partes hayan pactado por escrito, sin perjuicio de exigir el cumplimiento forzoso.

OCTAVA. INTERMEDIACIÓN. Las partes reconocen la intervención de {{inmobiliaria.nombre}} como intermediario, cuya comisión de {{operacion.comision}} será cubierta conforme a lo pactado por separado.

NOVENA. JURISDICCIÓN. Las partes se someten a las leyes y tribunales de {{inmueble.ciudad}}, {{inmueble.estado}}, renunciando a cualquier otro fuero.

Leído que fue el presente contrato, las partes lo firman de conformidad.`,
  },
  COMISION: {
    name: "Convenio de colaboración y reparto de comisión",
    body: `CONVENIO DE COLABORACIÓN Y REPARTO DE COMISIÓN

Folio {{folio}}

En {{fecha.lugar}}, a {{fecha.hoy}}, celebran el presente convenio {{asesorA.nombre}} y {{asesorB.nombre}}, a quienes conjuntamente se les denominará LOS ASESORES, con la intervención de {{inmobiliaria.nombre}}.

DECLARACIONES

I. Declaran LOS ASESORES dedicarse a la prestación de servicios de intermediación inmobiliaria y tener interés en colaborar en la operación del inmueble ubicado en {{inmueble.direccion}}, colonia {{inmueble.colonia}}, {{inmueble.ciudad}}.

II. Declaran que la operación tiene un valor de {{operacion.monto}} y genera una comisión total de {{comision.total}} ({{comision.totalLetra}}).

CLÁUSULAS

PRIMERA. OBJETO. LOS ASESORES colaborarán en la promoción y cierre de la operación referida, aportando cada uno su cartera, su gestión y su tiempo.

SEGUNDA. REPARTO. La comisión total se repartirá de la siguiente forma: {{comision.pctA}} para {{asesorA.nombre}} y {{comision.pctB}} para {{asesorB.nombre}}.

TERCERA. MOMENTO DEL PAGO. El reparto se pagará dentro de los cinco días hábiles siguientes a que la comisión haya sido efectivamente COBRADA. Si la comisión se cobra en parcialidades, el reparto se hará en la misma proporción y en las mismas fechas.

CUARTA. GASTOS. Cada asesor absorbe sus propios gastos de promoción, traslado y atención a clientes, salvo los que expresamente acuerden por escrito compartir.

QUINTA. CONFIDENCIALIDAD. LOS ASESORES se obligan a no divulgar los datos de los clientes de la contraparte ni a contactarlos directamente para operaciones distintas a la aquí referida, durante la vigencia de este convenio y los doce meses siguientes.

SEXTA. EXCLUSIÓN DE SOCIEDAD. Este convenio no constituye sociedad, asociación en participación ni relación laboral alguna entre LOS ASESORES.

SÉPTIMA. JURISDICCIÓN. Las partes se someten a las leyes y tribunales de {{inmueble.ciudad}}, {{inmueble.estado}}.

Leído que fue el presente convenio, LOS ASESORES lo firman de conformidad.`,
  },
};

// ── 3. Plantilla de la cuenta ──────────────────────────────────────────
interface TemplateRow {
  id: string;
  kind: string;
  name: string;
  body: string;
  version: number;
  updatedAt: Date;
}

export interface ContractTemplateDTO {
  kind: RealtyContractKind;
  name: string;
  body: string;
  /** false = es la plantilla base del sistema, la cuenta no la ha editado. */
  custom: boolean;
  version: number;
  updatedAt: string | null;
}

/** La plantilla que USA la cuenta: la suya si la editó, la base si no. */
export async function getTemplate(
  accountId: string,
  kind: RealtyContractKind,
): Promise<ContractTemplateDTO> {
  await ensureContractTables();
  const rows = await prisma.$queryRaw<TemplateRow[]>`
    SELECT "id", "kind", "name", "body", "version", "updatedAt"
      FROM "realty_contract_templates"
     WHERE "accountId" = ${accountId} AND "kind" = ${kind}
     LIMIT 1`;
  const row = rows[0];
  if (row) {
    return {
      kind,
      name: row.name,
      body: row.body,
      custom: true,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  const base = REALTY_BASE_TEMPLATES[kind];
  return { kind, name: base.name, body: base.body, custom: false, version: 0, updatedAt: null };
}

export async function listTemplates(accountId: string): Promise<ContractTemplateDTO[]> {
  const kinds: RealtyContractKind[] = ["ARRENDAMIENTO", "EXCLUSIVA", "PROMESA", "COMISION"];
  const out: ContractTemplateDTO[] = [];
  for (const k of kinds) out.push(await getTemplate(accountId, k));
  return out;
}

/**
 * Guarda la plantilla de la cuenta.
 *
 * 🔴 LA REJA DE LAS VARIABLES. Antes de guardar se comprueba que TODA
 * `{{x}}` del texto exista en el catálogo de ese tipo de contrato. Una
 * variable inventada —o un dedazo— se rechaza diciendo su nombre. Sin esto,
 * `{{inquilino.nombr}}` se guardaría y el contrato saldría impreso con la
 * llave cruda en medio de una cláusula, que es exactamente "romper la
 * plantilla al editarla".
 */
export async function saveTemplate(
  ctx: RealtyContext,
  kind: RealtyContractKind,
  name: string,
  body: string,
): Promise<ContractTemplateDTO> {
  await ensureContractTables();
  const cleanName = String(name ?? "").trim().slice(0, 120);
  const cleanBody = String(body ?? "");
  if (!cleanName) throw new ContractError("Ponle un nombre a la plantilla.");
  if (!cleanBody.trim()) throw new ContractError("La plantilla no puede quedar vacía.");
  if (cleanBody.length > MAX_TEMPLATE_BODY) {
    throw new ContractError("La plantilla es demasiado larga.", 413);
  }

  const desconocidas = unknownVariables(kind, cleanBody);
  if (desconocidas.length > 0) {
    throw new ContractError(
      desconocidas.length === 1
        ? `La variable {{${desconocidas[0]}}} no existe para este tipo de contrato. Usa una de las fichas de la derecha.`
        : `Estas variables no existen para este tipo de contrato: ${desconocidas
            .map((v) => `{{${v}}}`)
            .join(", ")}.`,
    );
  }

  const now = new Date();
  // ON CONFLICT y no un SELECT + INSERT/UPDATE: dos pestañas guardando a la
  // vez chocarían en el único y una se perdería con un 500 feo.
  await prisma.$executeRaw`
    INSERT INTO "realty_contract_templates"
      ("id","accountId","kind","name","body","version","updatedByUserId","createdAt","updatedAt")
    VALUES (${newId()}, ${ctx.accountId}, ${kind}, ${cleanName}, ${cleanBody}, 1,
            ${ctx.realtyUserId}, ${now}, ${now})
    ON CONFLICT ("accountId","kind") DO UPDATE
       SET "name" = EXCLUDED."name",
           "body" = EXCLUDED."body",
           "version" = "realty_contract_templates"."version" + 1,
           "updatedByUserId" = EXCLUDED."updatedByUserId",
           "updatedAt" = EXCLUDED."updatedAt"`;
  return getTemplate(ctx.accountId, kind);
}

/** Vuelve a la plantilla base. Los contratos YA generados no cambian. */
export async function resetTemplate(
  accountId: string,
  kind: RealtyContractKind,
): Promise<ContractTemplateDTO> {
  await ensureContractTables();
  await prisma.$executeRaw`
    DELETE FROM "realty_contract_templates"
     WHERE "accountId" = ${accountId} AND "kind" = ${kind}`;
  return getTemplate(accountId, kind);
}

// ── 4. Números con letra ───────────────────────────────────────────────
const UNIDADES = [
  "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
  "DIECIOCHO", "DIECINUEVE", "VEINTE",
];
const DECENAS = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

function menorAMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto <= 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`);
    }
  }
  return partes.join(" ");
}

/**
 * Importe con letra al estilo de un contrato mexicano:
 * 18000 → "DIECIOCHO MIL PESOS 00/100 M.N."
 *
 * En un contrato la cantidad SIEMPRE va con letra además de con número: es
 * lo que evita que un cero de más cambie el trato. Los centavos van como
 * fracción, que es la costumbre notarial.
 */
export function numeroALetras(amount: number, moneda = "MXN"): string {
  const n = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const enteros = Math.floor(n);
  const centavos = Math.round((n - enteros) * 100);
  const sufijo = moneda === "USD" ? "DÓLARES" : "PESOS";
  const moneySuffix = moneda === "USD" ? "USD" : "M.N.";
  const frac = `${String(centavos).padStart(2, "0")}/100 ${moneySuffix}`;

  if (enteros === 0) return `CERO ${sufijo} ${frac}`;

  const millones = Math.floor(enteros / 1_000_000);
  const miles = Math.floor((enteros % 1_000_000) / 1000);
  const resto = enteros % 1000;

  const partes: string[] = [];
  if (millones > 0) {
    partes.push(millones === 1 ? "UN MILLÓN" : `${menorAMil(millones)} MILLONES`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? "MIL" : `${menorAMil(miles)} MIL`);
  }
  if (resto > 0) partes.push(menorAMil(resto));

  return `${partes.join(" ").replace(/\s+/g, " ").trim()} ${sufijo} ${frac}`;
}

// ── 5. Resolver las variables desde los datos que ya existen ───────────
export interface ContractSource {
  kind: RealtyContractKind;
  leaseId?: string | null;
  exclusiveId?: string | null;
  dealId?: string | null;
  /** Solo para COMISION, que no sale de ninguna tabla. */
  propertyId?: string | null;
  /** Datos que el asesor escribe a mano (asesorA, asesorB, comision.*). */
  manual?: Record<string, string> | null;
}

export interface ResolvedContract {
  values: Record<string, string>;
  title: string;
  propertyId: string | null;
  contactId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  parties: Array<{ role: RealtyPartyRole; name: string; email: string | null; phone: string | null; contactId: string | null }>;
}

const dash = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return s.trim();
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function mesesEntre(a: Date, b: Date): number {
  return Math.max(
    0,
    Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)),
  );
}

/** Las variables de la cuenta. Iguales en los cuatro tipos. */
function accountValues(ctx: RealtyContext): Record<string, string> {
  const a = ctx.account;
  const licenciaVigente =
    a.licenseExpiresAt && a.licenseExpiresAt.getTime() > Date.now() ? dash(a.licenseNumber) : "";
  return {
    "inmobiliaria.nombre": dash(a.name),
    "inmobiliaria.razonSocial": dash(a.legalName) || dash(a.name),
    "inmobiliaria.direccion": [dash(a.address), dash(a.city), dash(a.state)]
      .filter(Boolean)
      .join(", "),
    "inmobiliaria.telefono": dash(a.phone),
    "inmobiliaria.correo": dash(a.email),
    "inmobiliaria.licencia": licenciaVigente,
    "fecha.hoy": formatLongDate(new Date()),
    "fecha.lugar": [dash(a.city), dash(a.state)].filter(Boolean).join(", "),
  };
}

function propertyValues(p: {
  title: string;
  kind: string;
  address: string | null;
  colonia: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  builtM2: unknown;
  landM2: unknown;
}): Record<string, string> {
  return {
    "inmueble.titulo": dash(p.title),
    "inmueble.tipo": dash(p.kind),
    "inmueble.direccion": dash(p.address),
    "inmueble.colonia": dash(p.colonia),
    "inmueble.ciudad": dash(p.city),
    "inmueble.estado": dash(p.state),
    "inmueble.cp": dash(p.zip),
    "inmueble.recamaras": p.bedrooms === null ? "" : String(p.bedrooms),
    "inmueble.banos": p.bathrooms === null ? "" : String(p.bathrooms),
    "inmueble.estacionamientos": p.parking === null ? "" : String(p.parking),
    "inmueble.m2Construidos": p.builtM2 === null ? "" : String(num(p.builtM2)),
    "inmueble.m2Terreno": p.landM2 === null ? "" : String(num(p.landM2)),
  };
}

function personValues(
  pre: string,
  person: { name?: string | null; phone?: string | null; email?: string | null; rfc?: string | null } | null,
): Record<string, string> {
  return {
    [`${pre}.nombre`]: dash(person?.name),
    [`${pre}.telefono`]: dash(person?.phone),
    [`${pre}.correo`]: dash(person?.email),
    [`${pre}.rfc`]: dash(person?.rfc),
  };
}

/**
 * Lee el contrato de renta / la exclusiva / la operación y arma los valores.
 *
 * 🔴 NO DUPLICA LA LÓGICA DE T4 NI DE T1: lee sus filas tal cual. Este
 * módulo no calcula rentas, ni comisiones, ni vigencias — las copia del
 * sitio donde ya viven. Si mañana T4 cambia cómo se guarda una renta, aquí
 * no hay nada que ajustar.
 */
export async function resolveContractData(
  ctx: RealtyContext,
  source: ContractSource,
): Promise<ResolvedContract> {
  const values: Record<string, string> = { ...accountValues(ctx) };
  const parties: ResolvedContract["parties"] = [];
  let title = "";
  let propertyId: string | null = null;
  let contactId: string | null = null;
  let effectiveFrom: Date | null = null;
  let effectiveTo: Date | null = null;

  if (source.kind === "ARRENDAMIENTO") {
    if (!source.leaseId) throw new ContractError("Elige el contrato de renta del que sale.");
    const lease = await prisma.realtyLease.findFirst({
      where: { id: source.leaseId, accountId: ctx.accountId },
      include: {
        property: { include: { owner: true } },
        parties: { include: { contact: true } },
      },
    });
    if (!lease) throw new ContractError("Ese contrato de renta ya no existe.", 404);

    propertyId = lease.propertyId;
    effectiveFrom = lease.startsAt;
    effectiveTo = lease.endsAt;
    Object.assign(values, propertyValues(lease.property));

    // El ARRENDADOR: el dueño del inmueble. En modo OWNER la cuenta es su
    // propio dueño y la tabla de propietarios está vacía a propósito, así
    // que ahí el arrendador es la cuenta.
    const owner = lease.property.owner;
    const arrendador = owner
      ? { name: owner.name, phone: owner.phone, email: owner.email, rfc: owner.rfc }
      : { name: ctx.account.legalName || ctx.account.name, phone: ctx.account.phone, email: ctx.account.email, rfc: null };
    Object.assign(values, personValues("arrendador", arrendador));
    parties.push({
      role: "ARRENDADOR",
      name: arrendador.name ?? "",
      email: arrendador.email ?? null,
      phone: arrendador.phone ?? null,
      contactId: null,
    });

    const inquilino = lease.parties.find((p) => p.role === "INQUILINO");
    Object.assign(values, personValues("inquilino", inquilino?.contact ?? null));
    if (inquilino) {
      contactId = inquilino.contactId;
      parties.push({
        role: "INQUILINO",
        name: inquilino.contact.name,
        email: inquilino.contact.email,
        phone: inquilino.contact.phone,
        contactId: inquilino.contactId,
      });
    }

    // AVAL o FIADOR: para el contrato son la misma figura (obligado
    // solidario). Se toma el primero que haya.
    const aval = lease.parties.find((p) => p.role === "AVAL" || p.role === "FIADOR");
    Object.assign(values, personValues("aval", aval?.contact ?? null));
    if (aval) {
      parties.push({
        role: "AVAL",
        name: aval.contact.name,
        email: aval.contact.email,
        phone: aval.contact.phone,
        contactId: aval.contactId,
      });
    }

    const renta = num(lease.rentAmount);
    const deposito = num(lease.depositAmount);
    Object.assign(values, {
      "renta.monto": formatContractMoney(renta, lease.currency),
      "renta.montoLetra": numeroALetras(renta, lease.currency),
      "renta.moneda": lease.currency,
      "renta.diaPago": String(lease.paymentDay),
      "renta.deposito": formatContractMoney(deposito, lease.currency),
      "renta.depositoLetra": numeroALetras(deposito, lease.currency),
      "vigencia.inicio": formatLongDate(lease.startsAt),
      "vigencia.fin": formatLongDate(lease.endsAt),
      "vigencia.meses": String(mesesEntre(lease.startsAt, lease.endsAt)),
      "aumento.regla": lease.increaseRule,
      "aumento.porcentaje":
        lease.increasePct === null ? "" : `${num(lease.increasePct).toFixed(2)}%`,
    });
    title = `Arrendamiento · ${lease.property.title}`;
  } else if (source.kind === "EXCLUSIVA") {
    if (!source.exclusiveId) throw new ContractError("Elige la exclusiva de la que sale.");
    const ex = await prisma.realtyExclusive.findFirst({
      where: { id: source.exclusiveId, accountId: ctx.accountId },
      include: { property: true, owner: true },
    });
    if (!ex) throw new ContractError("Esa exclusiva ya no existe.", 404);

    propertyId = ex.propertyId;
    effectiveFrom = ex.startsAt;
    effectiveTo = ex.endsAt;
    Object.assign(values, propertyValues(ex.property));
    Object.assign(values, personValues("propietario", ex.owner));
    parties.push({
      role: "PROPIETARIO",
      name: ex.owner.name,
      email: ex.owner.email,
      phone: ex.owner.phone,
      contactId: null,
    });
    parties.push({
      role: "INMOBILIARIA",
      name: ctx.account.legalName || ctx.account.name,
      email: ctx.account.email,
      phone: ctx.account.phone,
      contactId: null,
    });

    const precio = num(ex.property.price);
    Object.assign(values, {
      "exclusiva.inicio": formatLongDate(ex.startsAt),
      "exclusiva.fin": formatLongDate(ex.endsAt),
      "exclusiva.meses": String(mesesEntre(ex.startsAt, ex.endsAt)),
      "exclusiva.comisionPct": `${num(ex.commissionPct).toFixed(2)}%`,
      "inmueble.precio": formatContractMoney(precio, ex.property.currency),
      "inmueble.precioLetra": numeroALetras(precio, ex.property.currency),
    });
    title = `Exclusiva · ${ex.property.title}`;
  } else if (source.kind === "PROMESA") {
    if (!source.dealId) throw new ContractError("Elige la operación de la que sale.");
    const deal = await prisma.realtyDeal.findFirst({
      where: { id: source.dealId, accountId: ctx.accountId },
      include: { property: { include: { owner: true } }, contact: true },
    });
    if (!deal) throw new ContractError("Esa operación ya no existe.", 404);

    propertyId = deal.propertyId;
    contactId = deal.contactId;
    effectiveFrom = deal.closedAt;
    Object.assign(values, propertyValues(deal.property));

    const owner = deal.property.owner;
    const vendedor = owner
      ? { name: owner.name, phone: owner.phone, email: owner.email, rfc: owner.rfc }
      : { name: ctx.account.legalName || ctx.account.name, phone: ctx.account.phone, email: ctx.account.email, rfc: null };
    Object.assign(values, personValues("vendedor", vendedor));
    Object.assign(values, personValues("comprador", deal.contact));
    parties.push({
      role: "VENDEDOR",
      name: vendedor.name ?? "",
      email: vendedor.email ?? null,
      phone: vendedor.phone ?? null,
      contactId: null,
    });
    if (deal.contact) {
      parties.push({
        role: "COMPRADOR",
        name: deal.contact.name,
        email: deal.contact.email,
        phone: deal.contact.phone,
        contactId: deal.contactId,
      });
    }

    const monto = num(deal.amount);
    Object.assign(values, {
      "operacion.tipo": deal.kind === "RENTA" ? "Renta" : "Venta",
      "operacion.monto": formatContractMoney(monto, deal.property.currency),
      "operacion.montoLetra": numeroALetras(monto, deal.property.currency),
      "operacion.comision": formatContractMoney(num(deal.commissionAmount), deal.property.currency),
      "operacion.cierre": deal.closedAt ? formatLongDate(deal.closedAt) : "",
    });
    title = `Promesa de compraventa · ${deal.property.title}`;
  } else {
    // COMISION — no sale de ninguna tabla; el inmueble es opcional.
    if (source.propertyId) {
      const p = await prisma.realtyProperty.findFirst({
        where: { id: source.propertyId, accountId: ctx.accountId },
      });
      if (!p) throw new ContractError("Ese inmueble ya no existe.", 404);
      propertyId = p.id;
      Object.assign(values, propertyValues(p));
      title = `Colaboración · ${p.title}`;
    } else {
      title = "Convenio de colaboración";
    }
    // El asesor A por defecto es quien lo genera.
    Object.assign(
      values,
      personValues("asesorA", {
        name: `${ctx.user.firstName} ${ctx.user.lastName}`.trim(),
        email: ctx.user.email,
      }),
    );
    Object.assign(values, personValues("asesorB", null));
    Object.assign(values, {
      "operacion.monto": "",
      "comision.total": "",
      "comision.totalLetra": "",
      "comision.pctA": "50.00%",
      "comision.pctB": "50.00%",
    });
    parties.push({
      role: "ASESOR",
      name: `${ctx.user.firstName} ${ctx.user.lastName}`.trim(),
      email: ctx.user.email,
      phone: null,
      contactId: null,
    });
  }

  // Lo que el asesor escribió a mano PISA lo resuelto.
  //
  // 🔴 LA REJA ES EL CATÁLOGO, no las llaves que ya trae `values`. Se
  // comprueba contra variableNames(kind), que es la MISMA lista que valida
  // la plantilla: así un campo de texto no puede meter una llave nueva al
  // documento, y a la vez sí puede llenar una variable del catálogo que el
  // origen dejó vacía (que es justo para lo que sirve).
  if (source.manual) {
    const permitidas = variableNames(source.kind);
    for (const [k, v] of Object.entries(source.manual)) {
      if (typeof v !== "string") continue;
      if (!permitidas.has(k)) continue;
      values[k] = v.slice(0, 400);
    }
    // Si escribieron el monto de la comisión, la cantidad con letra se
    // RECALCULA aquí: dejar que alguien teclee número y letra por separado
    // es exactamente cómo terminan sin coincidir en un contrato.
    const manualTotal = Number(
      String(source.manual["comision.totalRaw"] ?? "").replace(/[^0-9.]/g, ""),
    );
    if (Number.isFinite(manualTotal) && manualTotal > 0) {
      values["comision.total"] = formatContractMoney(manualTotal);
      values["comision.totalLetra"] = numeroALetras(manualTotal);
    }
    const manualOperacion = Number(
      String(source.manual["operacion.montoRaw"] ?? "").replace(/[^0-9.]/g, ""),
    );
    if (Number.isFinite(manualOperacion) && manualOperacion > 0) {
      values["operacion.monto"] = formatContractMoney(manualOperacion);
      values["operacion.montoLetra"] = numeroALetras(manualOperacion);
    }
  }

  return { values, title, propertyId, contactId, effectiveFrom, effectiveTo, parties };
}

// ── 6. Folio ───────────────────────────────────────────────────────────
/**
 * Consecutivo por cuenta. Copia exacta del método de emitReceipt (T4):
 * candado de aviso por cuenta + MAX en SQL, nunca `count + 1`.
 *
 * 🔴 `count + 1` está mal aunque parezca igual: si alguna vez se borra un
 * contrato (solo los borradores se pueden borrar), el conteo baja y el
 * siguiente folio repetiría uno ya usado. El MAX no baja nunca.
 */
/** Lo mínimo que `nextFolio` necesita: sirve el cliente y el de transacción. */
type RawClient = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

async function nextFolio(tx: RawClient, accountId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ max: bigint | number | null }[]>`
    SELECT MAX(CAST(substring("folio" from '([0-9]+)$') AS BIGINT)) AS max
      FROM "realty_contracts"
     WHERE "accountId" = ${accountId}
       AND "folio" ~ '^CTR-[0-9]+$'`;
  const raw = rows[0]?.max ?? 0;
  const current = typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
  return formatContractFolio((Number.isFinite(current) ? current : 0) + 1);
}

/** Dos enteros estables a partir del accountId, para pg_advisory_xact_lock. */
function lockKey(accountId: string): [number, number] {
  let a = 0;
  let b = 0;
  for (let i = 0; i < accountId.length; i += 1) {
    const c = accountId.charCodeAt(i);
    a = (a * 31 + c) | 0;
    b = (b * 37 + c * 7) | 0;
  }
  // El segundo entero identifica a ESTE módulo: así el candado de contratos
  // no se pelea con el de recibos de T4, que usa el mismo accountId.
  return [a, (b ^ 0x43_54_52_00) | 0];
}

// ── 7. Alta del contrato ───────────────────────────────────────────────
export interface CreateContractInput extends ContractSource {
  /** Si no viene, se usa el que resuelva el origen. */
  title?: string | null;
}

export async function createContract(
  ctx: RealtyContext,
  input: CreateContractInput,
): Promise<string> {
  await ensureContractTables();
  if (!isContractKind(input.kind)) throw new ContractError("Tipo de contrato no válido.");

  const resolved = await resolveContractData(ctx, input);
  const template = await getTemplate(ctx.accountId, input.kind);

  const title = String(input.title ?? "").trim().slice(0, 160) || resolved.title;
  if (!title) throw new ContractError("Ponle un título al contrato.");

  const id = newId();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const key = lockKey(ctx.accountId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key[0]}::int4, ${key[1]}::int4)`;
    const folio = await nextFolio(tx, ctx.accountId);

    // El folio entra en el cuerpo Y en el hash: por eso se renderiza DESPUÉS
    // de tenerlo, dentro de la misma transacción.
    const body = renderTemplate(template.body, { ...resolved.values, folio });
    if (body.length > MAX_CONTRACT_BODY) {
      throw new ContractError("El contrato generado es demasiado largo.", 413);
    }
    const documentHash = computeDocumentHash({ kind: input.kind, folio, title, body });

    await tx.$executeRaw`
      INSERT INTO "realty_contracts"
        ("id","accountId","kind","folio","title","leaseId","exclusiveId","dealId",
         "propertyId","contactId","body","variables","documentHash","status",
         "effectiveFrom","effectiveTo","createdByUserId","createdAt","updatedAt")
      VALUES (${id}, ${ctx.accountId}, ${input.kind}, ${folio}, ${title},
              ${input.leaseId ?? null}, ${input.exclusiveId ?? null}, ${input.dealId ?? null},
              ${resolved.propertyId}, ${resolved.contactId}, ${body},
              ${JSON.stringify({ ...resolved.values, folio })}, ${documentHash}, 'BORRADOR',
              ${resolved.effectiveFrom}, ${resolved.effectiveTo},
              ${ctx.realtyUserId}, ${now}, ${now})`;

    let orden = 0;
    for (const p of resolved.parties) {
      if (orden >= MAX_PARTIES) break;
      if (!p.name.trim()) continue; // una parte sin nombre no se puede firmar
      await tx.$executeRaw`
        INSERT INTO "realty_contract_parties"
          ("id","accountId","contractId","role","name","email","phone","contactId",
           "mustSign","sortOrder","createdAt")
        VALUES (${newId()}, ${ctx.accountId}, ${id}, ${p.role}, ${p.name.slice(0, 160)},
                ${p.email}, ${p.phone}, ${p.contactId}, true, ${orden}, ${now})`;
      orden += 1;
    }
  });

  return id;
}

// ── 8. Lectura ─────────────────────────────────────────────────────────
interface ContractRow {
  id: string;
  kind: string;
  folio: string;
  title: string;
  status: string;
  leaseId: string | null;
  exclusiveId: string | null;
  dealId: string | null;
  propertyId: string | null;
  contactId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  sealedAt: Date | null;
  signedAt: Date | null;
  archivedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  documentHash: string;
  createdAt: Date;
  body?: string;
}

interface PartyRow {
  id: string;
  contractId: string;
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  mustSign: boolean;
  sortOrder: number;
  signedAt: Date | null;
}

interface TokenRow {
  partyId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  sentAt: Date | null;
  sentVia: string | null;
}

function daysTo(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function partyLinkState(
  tokens: TokenRow[],
  partyId: string,
  signed: boolean,
): ContractPartyDTO["link"] {
  if (signed) return "USADA";
  const mios = tokens.filter((t) => t.partyId === partyId && !t.revokedAt);
  if (mios.length === 0) return "SIN_ENVIAR";
  const viva = mios.find((t) => !t.usedAt && t.expiresAt.getTime() > Date.now());
  if (viva) return viva.sentAt ? "ENVIADA" : "SIN_ENVIAR";
  return "VENCIDA";
}

function toRowDTO(
  r: ContractRow,
  parties: PartyRow[],
  propertyTitle: string | null,
): ContractRowDTO {
  const mias = parties.filter((p) => p.contractId === r.id);
  const required = mias.filter((p) => p.mustSign).length;
  const signed = mias.filter((p) => p.mustSign && p.signedAt).length;
  const d = daysTo(r.effectiveTo);
  return {
    id: r.id,
    kind: r.kind as RealtyContractKind,
    folio: r.folio,
    title: r.title,
    status: r.status as RealtyContractStatus,
    propertyId: r.propertyId,
    propertyTitle,
    // La bóveda del CONTACTO filtra por aquí. Si se cae de este objeto, el
    // expediente de un inquilino sale vacío y la pantalla no tiene forma de
    // notarlo: no hay error, solo una lista sin nada.
    contactId: r.contactId,
    leaseId: r.leaseId,
    exclusiveId: r.exclusiveId,
    dealId: r.dealId,
    effectiveFrom: r.effectiveFrom ? r.effectiveFrom.toISOString() : null,
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
    signed,
    required,
    daysToEnd: d,
    expiryWindow: expiryWindowFor(d),
  };
}

export interface ListContractsFilters {
  status?: RealtyContractStatus | "TODOS";
  kind?: RealtyContractKind | "TODOS";
  /** Solo los que vencen dentro de N días. */
  expiringInDays?: number;
  propertyId?: string;
  contactId?: string;
  /**
   * Trae también los ARCHIVADOS. Lo usa la BÓVEDA y nada más: el tablero
   * de trabajo no los quiere y por eso el default los deja fuera EN LA
   * BASE. Archivar saca del tablero; no saca del expediente.
   */
  includeArchived?: boolean;
}

export async function listContracts(
  ctx: RealtyContext,
  filters: ListContractsFilters = {},
): Promise<ContractRowDTO[]> {
  await ensureContractTables();

  // Una sola consulta sin filtros dinámicos y el recorte en memoria: una
  // cuenta tiene decenas o cientos de contratos, no millones, y armar SQL
  // dinámico a mano es justo donde se cuelan los errores. Los ARCHIVADOS sí
  // se excluyen en la base porque esos sí crecen sin tope.
  const rows = await prisma.$queryRaw<ContractRow[]>`
    SELECT "id","kind","folio","title","status","leaseId","exclusiveId","dealId",
           "propertyId","contactId","effectiveFrom","effectiveTo","sealedAt",
           "signedAt","archivedAt","voidedAt","voidReason","documentHash","createdAt"
      FROM "realty_contracts"
     WHERE "accountId" = ${ctx.accountId}
       AND ("status" <> 'ARCHIVADO'
            OR ${filters.status === "ARCHIVADO" || filters.includeArchived === true}::boolean)
     ORDER BY "createdAt" DESC
     LIMIT 500`;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const parties = await prisma.$queryRaw<PartyRow[]>`
    SELECT "id","contractId","role","name","email","phone","mustSign","sortOrder","signedAt"
      FROM "realty_contract_parties"
     WHERE "accountId" = ${ctx.accountId} AND "contractId" = ANY(${ids})`;

  const propIds = Array.from(
    new Set(rows.map((r) => r.propertyId).filter((v): v is string => !!v)),
  );
  const props = propIds.length
    ? await prisma.realtyProperty.findMany({
        where: { id: { in: propIds }, accountId: ctx.accountId },
        select: { id: true, title: true },
      })
    : [];
  const titleById = new Map(props.map((p) => [p.id, p.title]));

  let out = rows.map((r) => toRowDTO(r, parties, titleById.get(r.propertyId ?? "") ?? null));

  if (filters.status && filters.status !== "TODOS") {
    out = out.filter((c) => c.status === filters.status);
  }
  if (filters.kind && filters.kind !== "TODOS") out = out.filter((c) => c.kind === filters.kind);
  if (filters.propertyId) out = out.filter((c) => c.propertyId === filters.propertyId);
  if (filters.contactId) out = out.filter((c) => c.contactId === filters.contactId);
  if (filters.expiringInDays && filters.expiringInDays > 0) {
    const w = filters.expiringInDays;
    out = out.filter(
      (c) =>
        c.daysToEnd !== null &&
        c.daysToEnd <= w &&
        c.status !== "ANULADO" &&
        c.status !== "ARCHIVADO",
    );
  }
  return out;
}

export async function getContract(
  ctx: RealtyContext,
  id: string,
): Promise<ContractDetailDTO | null> {
  await ensureContractTables();
  const rows = await prisma.$queryRaw<ContractRow[]>`
    SELECT "id","kind","folio","title","status","leaseId","exclusiveId","dealId",
           "propertyId","contactId","effectiveFrom","effectiveTo","sealedAt",
           "signedAt","archivedAt","voidedAt","voidReason","documentHash","createdAt","body"
      FROM "realty_contracts"
     WHERE "accountId" = ${ctx.accountId} AND "id" = ${id}
     LIMIT 1`;
  const r = rows[0];
  if (!r) return null;

  const parties = await prisma.$queryRaw<PartyRow[]>`
    SELECT "id","contractId","role","name","email","phone","mustSign","sortOrder","signedAt"
      FROM "realty_contract_parties"
     WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}
     ORDER BY "sortOrder" ASC`;

  const tokens = await prisma.$queryRaw<TokenRow[]>`
    SELECT "partyId","expiresAt","usedAt","revokedAt","sentAt","sentVia"
      FROM "realty_signature_tokens"
     WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}
     ORDER BY "createdAt" DESC`;

  const sigs = await prisma.$queryRaw<
    Array<{
      id: string;
      partyId: string;
      signerName: string;
      signedAt: Date;
      documentHash: string;
      ip: string | null;
      userAgent: string | null;
    }>
  >`
    SELECT "id","partyId","signerName","signedAt","documentHash","ip","userAgent"
      FROM "realty_contract_signatures"
     WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}
     ORDER BY "signedAt" ASC`;

  const prop = r.propertyId
    ? await prisma.realtyProperty.findFirst({
        where: { id: r.propertyId, accountId: ctx.accountId },
        select: { title: true },
      })
    : null;

  const base = toRowDTO(r, parties, prop?.title ?? null);

  const partiesDTO: ContractPartyDTO[] = parties.map((p) => {
    const t = tokens.find((x) => x.partyId === p.id && x.sentAt) ?? null;
    return {
      id: p.id,
      role: p.role as RealtyPartyRole,
      name: p.name,
      email: p.email,
      phone: p.phone,
      mustSign: p.mustSign,
      sortOrder: p.sortOrder,
      signedAt: p.signedAt ? p.signedAt.toISOString() : null,
      link: partyLinkState(tokens, p.id, !!p.signedAt),
      sentAt: t?.sentAt ? t.sentAt.toISOString() : null,
      sentVia: t?.sentVia ?? null,
    };
  });

  const signaturesDTO: ContractSignatureDTO[] = sigs.map((s) => ({
    id: s.id,
    partyId: s.partyId,
    signerName: s.signerName,
    signedAt: s.signedAt.toISOString(),
    documentHash: s.documentHash,
    ip: s.ip,
    userAgent: s.userAgent,
    matchesCurrent: hashMatches(s.documentHash, r.documentHash),
  }));

  return {
    ...base,
    body: r.body ?? "",
    documentHash: r.documentHash,
    parties: partiesDTO,
    signatures: signaturesDTO,
    sealedAt: r.sealedAt ? r.sealedAt.toISOString() : null,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
    voidReason: r.voidReason,
  };
}

// ── 9. Edición (solo mientras es BORRADOR) ─────────────────────────────
/**
 * Cambia el cuerpo y RECALCULA el hash.
 *
 * 🔴 `"sealedAt" IS NULL` VA EN EL WHERE. No es un `if` antes del UPDATE:
 * la comprobación y la escritura tienen que ser la misma operación, o dos
 * pestañas —una que sella y otra que edita— se cruzan y el documento
 * firmado deja de ser el que se firmó. Si el UPDATE afecta 0 filas, es que
 * ya estaba sellado y se responde 409.
 */
export async function updateContractBody(
  ctx: RealtyContext,
  id: string,
  body: string,
  title?: string | null,
): Promise<void> {
  await ensureContractTables();
  const clean = String(body ?? "");
  if (!clean.trim()) throw new ContractError("El contrato no puede quedar vacío.");
  if (clean.length > MAX_CONTRACT_BODY) throw new ContractError("El contrato es demasiado largo.", 413);

  const rows = await prisma.$queryRaw<Array<{ kind: string; folio: string; title: string }>>`
    SELECT "kind","folio","title" FROM "realty_contracts"
     WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "sealedAt" IS NULL
     LIMIT 1`;
  const r = rows[0];
  if (!r) {
    throw new ContractError(
      "Este contrato ya se mandó a firmar y no se puede editar. Si hay que cambiarlo, anúlalo y genera uno nuevo.",
      409,
    );
  }

  const newTitle = String(title ?? "").trim().slice(0, 160) || r.title;
  const hash = computeDocumentHash({
    kind: r.kind as RealtyContractKind,
    folio: r.folio,
    title: newTitle,
    body: clean,
  });

  const affected = await prisma.$executeRaw`
    UPDATE "realty_contracts"
       SET "body" = ${clean}, "title" = ${newTitle}, "documentHash" = ${hash},
           "updatedAt" = ${new Date()}
     WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "sealedAt" IS NULL`;
  if (affected === 0) {
    throw new ContractError("El contrato cambió de estado. Vuelve a cargar la pantalla.", 409);
  }
}

/** Reemplaza las partes. Solo mientras es BORRADOR. */
export async function setParties(
  ctx: RealtyContext,
  id: string,
  parties: Array<{ role: string; name: string; email?: string | null; phone?: string | null; mustSign?: boolean }>,
): Promise<void> {
  await ensureContractTables();
  const limpias = parties
    .filter((p) => isPartyRole(p.role) && String(p.name ?? "").trim())
    .slice(0, MAX_PARTIES);
  if (limpias.length === 0) throw new ContractError("Agrega al menos una persona que firme.");
  if (!limpias.some((p) => p.mustSign !== false)) {
    throw new ContractError("Al menos una de las personas tiene que firmar.");
  }

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "realty_contracts"
       WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "sealedAt" IS NULL
       LIMIT 1`;
    if (rows.length === 0) {
      throw new ContractError("Este contrato ya se mandó a firmar: las partes ya no se cambian.", 409);
    }
    await tx.$executeRaw`
      DELETE FROM "realty_contract_parties"
       WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}`;
    const now = new Date();
    let orden = 0;
    for (const p of limpias) {
      await tx.$executeRaw`
        INSERT INTO "realty_contract_parties"
          ("id","accountId","contractId","role","name","email","phone","contactId",
           "mustSign","sortOrder","createdAt")
        VALUES (${newId()}, ${ctx.accountId}, ${id}, ${p.role},
                ${String(p.name).trim().slice(0, 160)},
                ${p.email ? String(p.email).trim().slice(0, 160) : null},
                ${p.phone ? String(p.phone).trim().slice(0, 40) : null},
                null, ${p.mustSign !== false}, ${orden}, ${now})`;
      orden += 1;
    }
  });
}

/** Borra un contrato. SOLO si sigue siendo borrador. */
export async function deleteDraft(ctx: RealtyContext, id: string): Promise<void> {
  await ensureContractTables();
  const affected = await prisma.$executeRaw`
    DELETE FROM "realty_contracts"
     WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "sealedAt" IS NULL`;
  if (affected === 0) {
    throw new ContractError(
      "Un contrato que ya se mandó a firmar no se borra: forma parte del expediente. Archívalo o anúlalo.",
      409,
    );
  }
}

// ── 10. Sellar y emitir las ligas ──────────────────────────────────────
export interface IssuedLink {
  partyId: string;
  partyName: string;
  role: RealtyPartyRole;
  /** Para que quien manda la liga no tenga que volver a consultar la parte. */
  email: string | null;
  phone: string | null;
  /** EN CLARO. Es la única vez que existe: en la base va su sha256. */
  token: string;
  url: string;
  expiresAt: string;
}

/**
 * Sella el contrato y emite una liga por cada parte que tiene que firmar.
 *
 * A partir de aquí el cuerpo YA NO SE TOCA (sealedAt deja de ser null y
 * todos los UPDATE del cuerpo llevan esa condición en el WHERE).
 *
 * `soloPartes` acota a quién se le emite. Es lo que hace posible el
 * "reenviar" de UNA persona del tablero:
 *
 * 🔴 SOLO SE REVOCAN LAS LIGAS DE LAS PARTES A LAS QUE SE REEMITE. Revocar
 * las de todo el contrato sería el error caro de un contrato a tres firmas:
 * reenviarle al aval mataría en silencio la liga que el inquilino tiene
 * abierta en su celular, y nadie entendería por qué de pronto dejó de
 * servir. Reemitirle a alguien invalida LO SUYO y nada más.
 *
 * Devuelve los tokens EN CLARO una sola vez. Quien llama decide si los
 * manda por WhatsApp, por correo, o los enseña para copiar. Después de
 * esta llamada no hay forma de recuperarlos: hay que emitir una liga nueva.
 */
export async function sealAndIssueLinks(
  ctx: RealtyContext,
  id: string,
  origin: string | null,
  soloPartes?: string[] | null,
): Promise<IssuedLink[]> {
  await ensureContractTables();

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ status: string; sealedAt: Date | null }>>`
      SELECT "status","sealedAt" FROM "realty_contracts"
       WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} LIMIT 1`;
    const c = rows[0];
    if (!c) throw new ContractError("Ese contrato ya no existe.", 404);
    if (c.status === "ANULADO") throw new ContractError("Este contrato está anulado.", 409);
    if (c.status === "ARCHIVADO") {
      throw new ContractError("Este contrato está archivado. Desarchívalo para poder mandarlo.", 409);
    }

    const parties = await tx.$queryRaw<PartyRow[]>`
      SELECT "id","contractId","role","name","email","phone","mustSign","sortOrder","signedAt"
        FROM "realty_contract_parties"
       WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}
       ORDER BY "sortOrder" ASC`;
    const filtro = soloPartes && soloPartes.length > 0 ? new Set(soloPartes) : null;
    const pendientes = parties.filter(
      (p) => p.mustSign && !p.signedAt && (!filtro || filtro.has(p.id)),
    );
    if (pendientes.length === 0) {
      throw new ContractError(
        filtro
          ? "Esa persona ya firmó, o ya no tiene que firmar este contrato."
          : "Ya firmaron todas las partes de este contrato.",
        409,
      );
    }

    const now = new Date();
    if (!c.sealedAt) {
      await tx.$executeRaw`
        UPDATE "realty_contracts"
           SET "sealedAt" = ${now}, "status" = 'ENVIADO', "updatedAt" = ${now}
         WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "sealedAt" IS NULL`;
    }

    // Las ligas vivas ANTERIORES DE ESTAS PARTES se revocan: si se reemite,
    // la que anda por ahí en un chat deja de servir. Es lo que se espera de
    // "reenviar" — y lo que NO se espera es que le mate la liga a nadie más.
    const ids = pendientes.map((p) => p.id);
    await tx.$executeRaw`
      UPDATE "realty_signature_tokens"
         SET "revokedAt" = ${now}
       WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}
         AND "partyId" = ANY(${ids})
         AND "usedAt" IS NULL AND "revokedAt" IS NULL`;

    const out: IssuedLink[] = [];
    const expiresAt = signatureLinkExpiry(now);
    for (const p of pendientes) {
      const { token, tokenHash } = mintSignatureToken();
      await tx.$executeRaw`
        INSERT INTO "realty_signature_tokens"
          ("id","accountId","contractId","partyId","tokenHash","expiresAt","createdAt")
        VALUES (${newId()}, ${ctx.accountId}, ${id}, ${p.id}, ${tokenHash}, ${expiresAt}, ${now})`;
      out.push({
        partyId: p.id,
        partyName: p.name,
        role: p.role as RealtyPartyRole,
        email: p.email,
        phone: p.phone,
        token,
        url: signatureUrl(token, origin),
        expiresAt: expiresAt.toISOString(),
      });
    }
    return out;
  });
}

/** Deja constancia de por dónde salió la liga. Best-effort. */
export async function markLinkSent(
  accountId: string,
  contractId: string,
  partyId: string,
  via: "whatsapp" | "correo" | "copiada",
): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "realty_signature_tokens"
         SET "sentAt" = ${new Date()}, "sentVia" = ${via}
       WHERE "accountId" = ${accountId} AND "contractId" = ${contractId}
         AND "partyId" = ${partyId} AND "usedAt" IS NULL AND "revokedAt" IS NULL`;
  } catch (e) {
    console.warn("[realty/contracts] no se pudo marcar el envío:", (e as Error).message);
  }
}

// ── 11. Archivar y anular ──────────────────────────────────────────────
/**
 * Saca el contrato del tablero SIN borrarlo.
 *
 * La bóveda no tiene botón de borrar a propósito: un contrato firmado es la
 * prueba de lo que se pactó, y borrarlo es justo lo que habría que hacer
 * para tapar un problema. Archivar lo quita de la vista y ya.
 */
export async function archiveContract(ctx: RealtyContext, id: string, archive: boolean): Promise<void> {
  await ensureContractTables();
  const now = new Date();
  const affected = archive
    ? await prisma.$executeRaw`
        UPDATE "realty_contracts"
           SET "status" = 'ARCHIVADO', "archivedAt" = ${now}, "updatedAt" = ${now}
         WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "status" <> 'ARCHIVADO'`
    : await prisma.$executeRaw`
        UPDATE "realty_contracts"
           SET "status" = CASE
                 WHEN "voidedAt" IS NOT NULL THEN 'ANULADO'
                 WHEN "signedAt" IS NOT NULL THEN 'FIRMADO'
                 WHEN "sealedAt" IS NULL THEN 'BORRADOR'
                 WHEN EXISTS (SELECT 1 FROM "realty_contract_signatures" s
                               WHERE s."contractId" = "realty_contracts"."id") THEN 'PARCIAL'
                 ELSE 'ENVIADO' END,
               "archivedAt" = NULL, "updatedAt" = ${now}
         WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "status" = 'ARCHIVADO'`;
  if (affected === 0) throw new ContractError("El contrato ya estaba en ese estado.", 409);
}

/**
 * Anula: lo deja SIN EFECTO conservándolo íntegro, con el motivo.
 *
 * El motivo es obligatorio. Una anulación sin motivo, leída dentro de dos
 * años, no le sirve a nadie — misma regla que la revocación del
 * consentimiento del dental.
 */
export async function voidContract(ctx: RealtyContext, id: string, reason: string): Promise<void> {
  await ensureContractTables();
  const motivo = String(reason ?? "").trim().slice(0, 500);
  if (!motivo) throw new ContractError("Escribe el motivo: queda en el expediente.");
  const now = new Date();
  const affected = await prisma.$executeRaw`
    UPDATE "realty_contracts"
       SET "status" = 'ANULADO', "voidedAt" = ${now}, "voidReason" = ${motivo},
           "updatedAt" = ${now}
     WHERE "accountId" = ${ctx.accountId} AND "id" = ${id} AND "voidedAt" IS NULL`;
  if (affected === 0) throw new ContractError("Este contrato ya estaba anulado.", 409);
  // Las ligas vivas mueren con él: nadie firma un contrato anulado.
  await prisma.$executeRaw`
    UPDATE "realty_signature_tokens" SET "revokedAt" = ${now}
     WHERE "accountId" = ${ctx.accountId} AND "contractId" = ${id}
       AND "usedAt" IS NULL AND "revokedAt" IS NULL`;
}

// ── 12. La liga pública ────────────────────────────────────────────────
interface OpenTokenRow {
  tokenId: string;
  contractId: string;
  partyId: string;
  accountId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  attempts: number;
  kind: string;
  folio: string;
  title: string;
  body: string;
  documentHash: string;
  status: string;
  accountName: string;
  accountLocale: string;
  partyName: string;
  partyRole: string;
  partySignedAt: Date | null;
}

/**
 * Abre la liga.
 *
 * 🔴 UN SOLO MOTIVO DE FALLO HACIA FUERA. Devuelve `null` para TODO lo que
 * no sirve: token con forma rara, token que no existe, vencido, revocado o
 * de un contrato anulado. Quien pruebe ligas al azar no aprende NADA de la
 * respuesta — ni siquiera si el token existía. Es lo contrario de lo que
 * hace /share/p del dental, que dice "Link revocado" y con eso confirma que
 * el token era bueno.
 *
 * La liga caduca para FIRMAR, no para LEER: quien ya firmó sigue pudiendo
 * abrir su copia mientras el token no venza. Negarle su propio documento
 * firmado sería esconderle una prueba que es suya.
 */
export async function openSigningToken(token: string): Promise<PublicSigningDTO | null> {
  if (!looksLikeToken(token)) return null;
  await ensureContractTables();

  const rows = await prisma.$queryRaw<OpenTokenRow[]>`
    SELECT t."id" AS "tokenId", t."contractId", t."partyId", t."accountId",
           t."expiresAt", t."usedAt", t."revokedAt", t."attempts",
           c."kind", c."folio", c."title", c."body", c."documentHash", c."status",
           a."name" AS "accountName", a."locale" AS "accountLocale",
           p."name" AS "partyName", p."role" AS "partyRole", p."signedAt" AS "partySignedAt"
      FROM "realty_signature_tokens" t
      JOIN "realty_contracts" c ON c."id" = t."contractId"
      JOIN "realty_contract_parties" p ON p."id" = t."partyId"
      JOIN "realty_accounts" a ON a."id" = t."accountId"
     WHERE t."tokenHash" = ${hashToken(token)}
     LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  if (r.revokedAt) return null;
  if (r.expiresAt.getTime() < Date.now()) return null;
  if (r.status === "ANULADO" || r.status === "BORRADOR") return null;
  if (r.attempts >= SIGNATURE_MAX_ATTEMPTS) return null;

  // Constancia de lectura. Best-effort y una sola vez: que falle esto no
  // puede impedirle a nadie leer lo que está a punto de firmar.
  if (r.usedAt === null) {
    await prisma
      .$executeRaw`UPDATE "realty_signature_tokens" SET "viewedAt" = ${new Date()}
                    WHERE "id" = ${r.tokenId} AND "viewedAt" IS NULL`
      .catch(() => undefined);
  }

  const others = await prisma.$queryRaw<Array<{ name: string; role: string; signedAt: Date | null }>>`
    SELECT "name","role","signedAt" FROM "realty_contract_parties"
     WHERE "contractId" = ${r.contractId} AND "id" <> ${r.partyId} AND "mustSign" = true
     ORDER BY "sortOrder" ASC`;

  const pendientes = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "realty_contract_parties"
     WHERE "contractId" = ${r.contractId} AND "mustSign" = true AND "signedAt" IS NULL`;
  const faltan = Number(pendientes[0]?.n ?? 0);

  return {
    folio: r.folio,
    title: r.title,
    kind: r.kind as RealtyContractKind,
    body: r.body,
    documentHash: r.documentHash,
    accountName: r.accountName,
    locale: r.accountLocale === "en" ? "en" : "es",
    signerName: r.partyName,
    signerRole: r.partyRole as RealtyPartyRole,
    signedAt: r.partySignedAt ? r.partySignedAt.toISOString() : null,
    others: others.map((o) => ({
      name: o.name,
      role: o.role as RealtyPartyRole,
      signed: !!o.signedAt,
    })),
    complete: faltan === 0,
  };
}

export interface SignResult {
  ok: boolean;
  /** true si con esta firma se completó el contrato. */
  complete: boolean;
  signedAt: string;
  documentHash: string;
}

/**
 * Registra una firma.
 *
 * El orden importa y está pensado:
 *   1. Se RESERVA un intento con un incremento atómico. Leer, sumar en
 *      memoria y escribir es un lost update de manual — el mismo que
 *      verifyPortalCode documenta en portal-auth.ts.
 *   2. Se comprueba que el documento sigue siendo el mismo (el hash que vio
 *      el firmante contra el de la base). Si no coincide, NO se firma.
 *   3. Se sube el trazo. Si el bucket falla, se guarda el data URL en la
 *      fila: perder la aceptación que la persona acaba de dar es peor que
 *      guardar 15 KB de más en la base.
 *   4. Se marca la parte con `"signedAt" IS NULL` EN EL WHERE, así dos
 *      toques seguidos en el celular no sobrescriben la hora de la primera
 *      firma ni crean dos evidencias.
 */
export async function registerSignature(args: {
  token: string;
  strokeDataUrl: string;
  /** El hash que la página le enseñó al firmante. */
  seenHash: string;
  evidence: SignerEvidence;
}): Promise<SignResult> {
  if (!looksLikeToken(args.token)) throw new ContractError("Liga no válida.", 404);
  await ensureContractTables();

  const tokenHash = hashToken(args.token);

  // 1. Reservar el intento. El where condicional + increment es UNA sola
  //    sentencia: Postgres serializa el bloqueo de fila y en cuanto attempts
  //    llega al tope, deja de casar y afecta 0 filas.
  const reservado = await prisma.$executeRaw`
    UPDATE "realty_signature_tokens"
       SET "attempts" = "attempts" + 1
     WHERE "tokenHash" = ${tokenHash}
       AND "usedAt" IS NULL AND "revokedAt" IS NULL
       AND "expiresAt" > ${new Date()}
       AND "attempts" < ${SIGNATURE_MAX_ATTEMPTS}`;
  if (reservado === 0) {
    // Ya se usó, venció, se revocó o se acabaron los intentos. Un solo
    // mensaje para los cuatro casos.
    throw new ContractError("Esta liga ya no se puede usar. Pídele una nueva a tu asesor.", 410);
  }

  const rows = await prisma.$queryRaw<OpenTokenRow[]>`
    SELECT t."id" AS "tokenId", t."contractId", t."partyId", t."accountId",
           t."expiresAt", t."usedAt", t."revokedAt", t."attempts",
           c."kind", c."folio", c."title", c."body", c."documentHash", c."status",
           a."name" AS "accountName", a."locale" AS "accountLocale",
           p."name" AS "partyName", p."role" AS "partyRole", p."signedAt" AS "partySignedAt"
      FROM "realty_signature_tokens" t
      JOIN "realty_contracts" c ON c."id" = t."contractId"
      JOIN "realty_contract_parties" p ON p."id" = t."partyId"
      JOIN "realty_accounts" a ON a."id" = t."accountId"
     WHERE t."tokenHash" = ${tokenHash}
     LIMIT 1`;
  const r = rows[0];
  if (!r) throw new ContractError("Esta liga ya no se puede usar.", 410);
  if (r.status === "ANULADO") throw new ContractError("Este contrato fue anulado.", 409);
  if (r.partySignedAt) throw new ContractError("Ya habías firmado este contrato.", 409);

  // 2. ¿Sigue siendo el mismo documento?
  const vivo = computeDocumentHash({
    kind: r.kind as RealtyContractKind,
    folio: r.folio,
    title: r.title,
    body: r.body,
  });
  if (!hashMatches(vivo, r.documentHash)) {
    // La fila y su propio contenido no cuadran: algo se tocó por fuera.
    console.error(`[realty/contracts] hash inconsistente en ${r.contractId}`);
    throw new ContractError("Este documento no se puede firmar. Avísale a tu asesor.", 409);
  }
  if (!hashMatches(args.seenHash, r.documentHash)) {
    throw new ContractError(
      "El documento cambió desde que lo abriste. Vuelve a cargar la página y léelo otra vez antes de firmar.",
      409,
    );
  }

  // 3. El trazo.
  const check = await validateSignatureStroke(args.strokeDataUrl);
  if (check.error) throw new ContractError(check.error, check.status);

  const path = signatureStoragePath(r.accountId, r.contractId, r.partyId);
  let strokePath: string | null = null;
  let strokeInline: string | null = null;
  if (pathBelongsToAccount(path, r.accountId)) {
    try {
      await uploadRealtyFile(path, check.buffer, "image/png");
      strokePath = path;
      // El cupo se apunta pero NO se comprueba: una firma pesa ~10 KB y
      // negarle a alguien firmar su contrato porque la cuenta se quedó sin
      // espacio para fotos sería absurdo. La contabilidad sí tiene que
      // cuadrar, así que los bytes se suman igual.
      await addRealtyStorageBytes(r.accountId, check.buffer.length);
    } catch (e) {
      console.error("[realty/contracts] el trazo no se pudo subir, va en la fila:", (e as Error).message);
      strokeInline = check.dataUrl;
    }
  } else {
    strokeInline = check.dataUrl;
  }

  // 4. Sellar la firma.
  const now = new Date();
  const sigId = newId();
  let complete = false;

  await prisma.$transaction(async (tx) => {
    const marcada = await tx.$executeRaw`
      UPDATE "realty_contract_parties"
         SET "signedAt" = ${now}, "signatureId" = ${sigId}
       WHERE "id" = ${r.partyId} AND "contractId" = ${r.contractId} AND "signedAt" IS NULL`;
    if (marcada === 0) throw new ContractError("Ya habías firmado este contrato.", 409);

    await tx.$executeRaw`
      INSERT INTO "realty_contract_signatures"
        ("id","accountId","contractId","partyId","signerName","documentHash",
         "strokePath","strokeInline","strokeHash","ip","userAgent","signedAt","tokenId","createdAt")
      VALUES (${sigId}, ${r.accountId}, ${r.contractId}, ${r.partyId}, ${r.partyName},
              ${r.documentHash}, ${strokePath}, ${strokeInline}, ${strokeHash(check.buffer)},
              ${args.evidence.ip}, ${args.evidence.userAgent}, ${now}, ${r.tokenId}, ${now})`;

    await tx.$executeRaw`
      UPDATE "realty_signature_tokens" SET "usedAt" = ${now} WHERE "id" = ${r.tokenId}`;

    const pend = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "realty_contract_parties"
       WHERE "contractId" = ${r.contractId} AND "mustSign" = true AND "signedAt" IS NULL`;
    complete = Number(pend[0]?.n ?? 0) === 0;

    // 🔴 EL ESTADO SE MUEVE CON CUIDADO Y LA FECHA SE SELLA SIEMPRE.
    //
    // El caso que obliga a esto: un contrato SELLADO, con ligas fuera, que
    // el asesor archiva antes de que el inquilino firme. La liga sigue viva
    // 14 días, así que la firma SÍ llega. Si aquí se filtrara por
    // `status IN ('ENVIADO','PARCIAL')` —como estaba—, esa firma se
    // guardaba pero el contrato no se enteraba: al desarchivarlo volvía
    // como PARCIAL aunque hubieran firmado todos, y nadie sabría por qué.
    //
    //   · CASE en el status → un ARCHIVADO se queda ARCHIVADO (firmar no
    //     puede desarchivar por la puerta de atrás) y un ENVIADO/PARCIAL
    //     avanza. ANULADO ni llega: se rechaza antes.
    //   · COALESCE en signedAt → se sella la primera vez y NUNCA se pisa.
    //     Con `= ${complete ? now : null}` una firma intermedia borraba la
    //     fecha; con COALESCE eso no puede pasar. Y como archiveContract
    //     reconstruye el estado leyendo `signedAt`, desarchivar devuelve
    //     FIRMADO, que es la verdad.
    //
    // Dos sentencias y no una con parámetros dentro del CASE: `complete` ya
    // se conoce en JavaScript, y una consulta que se lee sola vale más que
    // ahorrar ocho líneas — sobre todo aquí, donde un NULL parametrizado
    // dentro de un COALESCE es justo el sitio donde Postgres se queja de no
    // poder deducir el tipo del parámetro.
    if (complete) {
      await tx.$executeRaw`
        UPDATE "realty_contracts"
           SET "status" = CASE
                 WHEN "status" IN ('ENVIADO','PARCIAL') THEN 'FIRMADO'
                 ELSE "status" END,
               "signedAt" = COALESCE("signedAt", ${now}),
               "updatedAt" = ${now}
         WHERE "id" = ${r.contractId} AND "accountId" = ${r.accountId}`;
    } else {
      await tx.$executeRaw`
        UPDATE "realty_contracts"
           SET "status" = CASE
                 WHEN "status" IN ('ENVIADO','PARCIAL') THEN 'PARCIAL'
                 ELSE "status" END,
               "updatedAt" = ${now}
         WHERE "id" = ${r.contractId} AND "accountId" = ${r.accountId}`;
    }
  });

  return {
    ok: true,
    complete,
    signedAt: now.toISOString(),
    documentHash: r.documentHash,
  };
}

/**
 * Cuando el contrato queda FIRMADO, se apunta en el contrato de renta o en
 * la exclusiva de la que salió.
 *
 * `signedDocUrl` ya existía en los dos modelos y estaba SIN USAR: es
 * literalmente "la liga del documento firmado". Es el enganche con T4 y con
 * T1 sin duplicar una línea de su lógica. Best-effort: que esto falle no
 * puede invalidar una firma que ya ocurrió.
 */
export interface ContractReceipt {
  title: string;
  folio: string;
  documentHash: string;
  accountName: string;
  parties: Array<{ name: string; email: string | null; phone: string | null; contactId: string | null }>;
}

/**
 * A quién hay que mandarle el acuse cuando el contrato queda firmado.
 *
 * Va aparte de getContract porque quien lo llama NO tiene sesión: es la
 * ruta pública de firma, que solo conoce el accountId que salió del token.
 * Devuelve el correo y el teléfono de TODAS las partes —también las que no
 * firmaban— porque el acuse es para todos los que aparecen en el papel.
 */
export async function contractRecipients(
  accountId: string,
  contractId: string,
): Promise<ContractReceipt | null> {
  await ensureContractTables();
  const rows = await prisma.$queryRaw<
    Array<{ title: string; folio: string; documentHash: string; accountName: string }>
  >`
    SELECT c."title", c."folio", c."documentHash", a."name" AS "accountName"
      FROM "realty_contracts" c
      JOIN "realty_accounts" a ON a."id" = c."accountId"
     WHERE c."accountId" = ${accountId} AND c."id" = ${contractId}
     LIMIT 1`;
  const r = rows[0];
  if (!r) return null;

  const parties = await prisma.$queryRaw<
    Array<{ name: string; email: string | null; phone: string | null; contactId: string | null }>
  >`
    SELECT "name","email","phone","contactId" FROM "realty_contract_parties"
     WHERE "accountId" = ${accountId} AND "contractId" = ${contractId}
     ORDER BY "sortOrder" ASC`;

  return {
    title: r.title,
    folio: r.folio,
    documentHash: r.documentHash,
    accountName: r.accountName,
    parties,
  };
}

export async function linkSignedDocToSource(accountId: string, contractId: string): Promise<void> {
  try {
    const rows = await prisma.$queryRaw<Array<{ leaseId: string | null; exclusiveId: string | null; folio: string }>>`
      SELECT "leaseId","exclusiveId","folio" FROM "realty_contracts"
       WHERE "accountId" = ${accountId} AND "id" = ${contractId} AND "status" = 'FIRMADO'
       LIMIT 1`;
    const r = rows[0];
    if (!r) return;
    const url = `/api/realty/contracts/${contractId}/pdf`;
    if (r.leaseId) {
      await prisma.realtyLease.updateMany({
        where: { id: r.leaseId, accountId, signedDocUrl: null },
        data: { signedDocUrl: url },
      });
    }
    if (r.exclusiveId) {
      await prisma.realtyExclusive.updateMany({
        where: { id: r.exclusiveId, accountId, signedDocUrl: null },
        data: { signedDocUrl: url },
      });
    }
  } catch (e) {
    console.warn("[realty/contracts] no se pudo enlazar el firmado:", (e as Error).message);
  }
}

// ── 13. El trazo, para el PDF ──────────────────────────────────────────
export interface StrokeForPdf {
  partyId: string;
  signerName: string;
  role: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  documentHash: string;
  /** data URL listo para <Image src>. "" si no se pudo recuperar. */
  dataUrl: string;
}

/**
 * Trae las firmas con su imagen para dibujarlas en el PDF.
 *
 * @react-pdf no descarga URLs protegidas, así que el trazo se trae a
 * memoria como data URL — igual que hace buildConsentPdf con las firmas del
 * consentimiento.
 */
export async function signaturesForPdf(
  accountId: string,
  contractId: string,
): Promise<StrokeForPdf[]> {
  await ensureContractTables();
  const rows = await prisma.$queryRaw<
    Array<{
      partyId: string;
      signerName: string;
      role: string;
      signedAt: Date;
      ip: string | null;
      userAgent: string | null;
      documentHash: string;
      strokePath: string | null;
      strokeInline: string | null;
    }>
  >`
    SELECT s."partyId", s."signerName", p."role", s."signedAt", s."ip", s."userAgent",
           s."documentHash", s."strokePath", s."strokeInline"
      FROM "realty_contract_signatures" s
      JOIN "realty_contract_parties" p ON p."id" = s."partyId"
     WHERE s."accountId" = ${accountId} AND s."contractId" = ${contractId}
     ORDER BY s."signedAt" ASC`;

  const out: StrokeForPdf[] = [];
  for (const r of rows) {
    let dataUrl = r.strokeInline ?? "";
    if (!dataUrl && r.strokePath) {
      const buf = await downloadRealtyFile(r.strokePath);
      if (buf) dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    }
    out.push({
      partyId: r.partyId,
      signerName: r.signerName,
      role: r.role,
      signedAt: r.signedAt,
      ip: r.ip,
      userAgent: r.userAgent,
      documentHash: r.documentHash,
      dataUrl,
    });
  }
  return out;
}

/** El contrato entero para armar el PDF, sin pasar por el DTO del panel. */
export async function contractForPdf(
  accountId: string,
  contractId: string,
): Promise<{
  kind: RealtyContractKind;
  folio: string;
  title: string;
  body: string;
  documentHash: string;
  status: RealtyContractStatus;
  createdAt: Date;
  signedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  accountName: string;
  parties: Array<{ id: string; role: string; name: string; mustSign: boolean; signedAt: Date | null }>;
} | null> {
  await ensureContractTables();
  const rows = await prisma.$queryRaw<
    Array<{
      kind: string;
      folio: string;
      title: string;
      body: string;
      documentHash: string;
      status: string;
      createdAt: Date;
      signedAt: Date | null;
      voidedAt: Date | null;
      voidReason: string | null;
      accountName: string;
    }>
  >`
    SELECT c."kind", c."folio", c."title", c."body", c."documentHash", c."status",
           c."createdAt", c."signedAt", c."voidedAt", c."voidReason",
           a."name" AS "accountName"
      FROM "realty_contracts" c
      JOIN "realty_accounts" a ON a."id" = c."accountId"
     WHERE c."accountId" = ${accountId} AND c."id" = ${contractId}
     LIMIT 1`;
  const r = rows[0];
  if (!r) return null;

  const parties = await prisma.$queryRaw<
    Array<{ id: string; role: string; name: string; mustSign: boolean; signedAt: Date | null }>
  >`
    SELECT "id","role","name","mustSign","signedAt" FROM "realty_contract_parties"
     WHERE "accountId" = ${accountId} AND "contractId" = ${contractId}
     ORDER BY "sortOrder" ASC`;

  return {
    kind: r.kind as RealtyContractKind,
    folio: r.folio,
    title: r.title,
    body: r.body,
    documentHash: r.documentHash,
    status: r.status as RealtyContractStatus,
    createdAt: r.createdAt,
    signedAt: r.signedAt,
    voidedAt: r.voidedAt,
    voidReason: r.voidReason,
    accountName: r.accountName,
    parties,
  };
}

/** El contrato al que pertenece una liga, para el PDF público del acuse. */
export async function contractIdForToken(
  token: string,
): Promise<{ accountId: string; contractId: string } | null> {
  if (!looksLikeToken(token)) return null;
  await ensureContractTables();
  const rows = await prisma.$queryRaw<Array<{ accountId: string; contractId: string; expiresAt: Date; revokedAt: Date | null }>>`
    SELECT "accountId","contractId","expiresAt","revokedAt" FROM "realty_signature_tokens"
     WHERE "tokenHash" = ${hashToken(token)} LIMIT 1`;
  const r = rows[0];
  if (!r || r.revokedAt || r.expiresAt.getTime() < Date.now()) return null;
  return { accountId: r.accountId, contractId: r.contractId };
}

// ── 14. Vencimientos ───────────────────────────────────────────────────
export interface ExpiringBoard {
  /** Contratos propios por vencer, ya con su ventana. */
  contracts: ContractRowDTO[];
  /** Contratos de RENTA de T4 por vencer que NO tienen contrato generado. */
  leasesSinContrato: Array<{ id: string; title: string; endsAt: string; daysToEnd: number }>;
  /** Exclusivas de T1 por vencer que NO tienen contrato generado. */
  exclusivasSinContrato: Array<{ id: string; title: string; endsAt: string; daysToEnd: number }>;
}

/**
 * El tablero de vencimientos a 30 / 60 / 90 días.
 *
 * 🔴 LEE LOS DATOS DE T4 Y DE T1, NO LOS DUPLICA. Las fechas de vencimiento
 * de un arrendamiento viven en RealtyLease.endsAt y las de una exclusiva en
 * RealtyExclusive.endsAt; aquí solo se consultan. Lo único propio es qué
 * contratos generó este módulo, que es justamente lo que las otras dos
 * pantallas no pueden saber.
 */
export async function expiringBoard(ctx: RealtyContext, days: number): Promise<ExpiringBoard> {
  await ensureContractTables();
  const ventana = days > 0 ? days : 90;
  const limite = new Date(Date.now() + ventana * 24 * 60 * 60 * 1000);
  const hoy = new Date();

  const contracts = (await listContracts(ctx, { expiringInDays: ventana })).filter(
    (c) => c.daysToEnd !== null && c.daysToEnd >= 0,
  );

  const conContrato = await prisma.$queryRaw<Array<{ leaseId: string | null; exclusiveId: string | null }>>`
    SELECT "leaseId","exclusiveId" FROM "realty_contracts"
     WHERE "accountId" = ${ctx.accountId} AND "status" NOT IN ('ANULADO')`;
  const leasesConContrato = new Set(
    conContrato.map((r) => r.leaseId).filter((v): v is string => !!v),
  );
  const exclusivasConContrato = new Set(
    conContrato.map((r) => r.exclusiveId).filter((v): v is string => !!v),
  );

  const leases = await prisma.realtyLease.findMany({
    where: {
      accountId: ctx.accountId,
      status: { in: ["ACTIVO", "VENCIDO"] },
      endsAt: { gte: hoy, lte: limite },
    },
    select: { id: true, endsAt: true, property: { select: { title: true } } },
    orderBy: { endsAt: "asc" },
    take: 100,
  });

  const exclusivas = await prisma.realtyExclusive.findMany({
    where: { accountId: ctx.accountId, endsAt: { gte: hoy, lte: limite } },
    select: { id: true, endsAt: true, property: { select: { title: true } } },
    orderBy: { endsAt: "asc" },
    take: 100,
  });

  const dias = (d: Date): number => Math.ceil((d.getTime() - Date.now()) / 86_400_000);

  return {
    contracts,
    leasesSinContrato: leases
      .filter((l) => !leasesConContrato.has(l.id))
      .map((l) => ({
        id: l.id,
        title: l.property.title,
        endsAt: l.endsAt.toISOString(),
        daysToEnd: dias(l.endsAt),
      })),
    exclusivasSinContrato: exclusivas
      .filter((e) => !exclusivasConContrato.has(e.id))
      .map((e) => ({
        id: e.id,
        title: e.property.title,
        endsAt: e.endsAt.toISOString(),
        daysToEnd: dias(e.endsAt),
      })),
  };
}

/** Los orígenes disponibles para generar un contrato nuevo. */
export async function contractSources(ctx: RealtyContext): Promise<{
  leases: Array<{ id: string; label: string }>;
  exclusives: Array<{ id: string; label: string }>;
  deals: Array<{ id: string; label: string }>;
  properties: Array<{ id: string; label: string }>;
}> {
  const [leases, exclusives, deals, properties] = await Promise.all([
    prisma.realtyLease.findMany({
      where: { accountId: ctx.accountId },
      select: {
        id: true,
        property: { select: { title: true } },
        parties: { where: { role: "INQUILINO" }, select: { contact: { select: { name: true } } }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.realtyExclusive.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, property: { select: { title: true } }, owner: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.realtyDeal.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, property: { select: { title: true } }, contact: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 300,
    }),
  ]);

  return {
    leases: leases.map((l) => ({
      id: l.id,
      label: `${l.property.title} — ${l.parties[0]?.contact.name ?? "sin inquilino"}`,
    })),
    exclusives: exclusives.map((e) => ({ id: e.id, label: `${e.property.title} — ${e.owner.name}` })),
    deals: deals.map((d) => ({
      id: d.id,
      label: `${d.property.title} — ${d.contact?.name ?? "sin comprador"}`,
    })),
    properties: properties.map((p) => ({ id: p.id, label: p.title })),
  };
}

/** Vista previa de una plantilla con los datos de un origen real. */
export async function previewTemplate(
  ctx: RealtyContext,
  kind: RealtyContractKind,
  body: string,
  source: ContractSource | null,
): Promise<string> {
  // Los datos de la CUENTA salen siempre, con o sin origen: el nombre, el
  // domicilio y la fecha son reales desde el primer momento y hacen que la
  // vista previa se parezca al papel de verdad. Lo demás sale con su línea.
  let values: Record<string, string> = accountValues(ctx);
  if (source) {
    try {
      values = { ...values, ...(await resolveContractData(ctx, { ...source, kind })).values };
    } catch {
      // Un origen que ya no existe NO tumba la vista previa: es para ver el
      // TEXTO, no para validar los datos.
    }
  }
  values.folio = values.folio ?? "CTR-000001";
  return renderTemplate(body, values);
}

export { parseContractFolio };
