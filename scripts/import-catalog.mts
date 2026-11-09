// Loads a SIS catalog export into the current semester.
// Usage: pnpm db:import-catalog data/mef-catalog-2026-fall.json
//
// The export is made by hand from the logged-in SIS page
// /dersler/dersprogrami/tumprogram (see CLAUDE.md → Course catalog).
import { readFileSync } from "node:fs";
import { parseCatalog } from "../lib/catalog";
import { importCatalog } from "../lib/db/import-catalog";
import { currentSemesterId } from "../lib/db/queries";

const path = process.argv[2];
if (!path) throw new Error("Usage: pnpm db:import-catalog <catalog.json>");

const catalog = parseCatalog(JSON.parse(readFileSync(path, "utf8")));
const semesterId = await currentSemesterId();
const result = await importCatalog(semesterId, catalog);
console.log(`semester ${semesterId}: ${result.sections} sections, ${result.meetings} meetings`);
