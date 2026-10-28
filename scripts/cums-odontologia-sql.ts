/**
 * Escribe sql/cums-odontologia-2026-10.sql a partir del seed del catálogo.
 * Run: npm run cums:sql
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUMS_ESSENTIALS } from "../src/lib/seeds/cums-essentials";
import { sqlDelCatalogo } from "../src/lib/seeds/cums-sql";

const destino = join(__dirname, "..", "sql", "cums-odontologia-2026-10.sql");
writeFileSync(destino, sqlDelCatalogo(CUMS_ESSENTIALS, "Catálogo de medicamentos (CUMS) · ampliación odontológica ws1-t10, 28-oct-2026"));
console.log(`escrito ${destino} (${CUMS_ESSENTIALS.length} filas)`);
