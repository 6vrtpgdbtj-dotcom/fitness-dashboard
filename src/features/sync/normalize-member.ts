import { normalizeFields } from "./normalize-fields";
import type { CanonicalRow } from "./types";
export const normalizeMember = (row: CanonicalRow) => normalizeFields("member", row);
