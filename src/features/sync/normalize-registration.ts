import { normalizeFields } from "./normalize-fields";
import type { CanonicalRow } from "./types";
export const normalizeRegistration = (row: CanonicalRow) => normalizeFields("registration", row);
