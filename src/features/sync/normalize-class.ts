import { normalizeFields } from "./normalize-fields";
import type { CanonicalRow } from "./types";
export const normalizeClass = (row: CanonicalRow) => normalizeFields("class", row);
