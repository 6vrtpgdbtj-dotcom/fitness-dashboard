import { normalizeFields } from "./normalize-fields";
import type { CanonicalRow } from "./types";
export const normalizeLead = (row: CanonicalRow) => normalizeFields("lead", row);
