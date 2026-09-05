export type MappingDomain = "member" | "registration" | "lead" | "class";
export type ValueKind = "date" | "integer" | "money" | "percentage" | "status" | "identifier" | "freeText";
export type ColumnProfile = {
  kind: ValueKind | "empty";
  nonEmptyCount: number;
  confidence: number;
  ratios: Record<ValueKind, number>;
};
export type MappingScope = { organizationId: string; sourceConnectionId: string; sourceTabId: string };
export type MappingInput = MappingScope & {
  domain: MappingDomain;
  tabTitle: string;
  rows: unknown[][];
  /** Zero-based. Omit to discover within the first 50 rows. */
  headerRowIndex?: number;
};
export type ConfirmedColumn = { sourceHeader: string; field: string | null };
export type ConfirmedMapping = MappingScope & {
  domain: MappingDomain;
  version: number;
  /** Include the saved header row and complete ordered columns for positional reuse. */
  headerRowIndex?: number;
  columns: readonly ConfirmedColumn[];
};
export type ColumnMapping = {
  columnIndex: number;
  sourceHeader: string;
  normalizedHeader: string;
  sampleValues: string[];
  profile: ColumnProfile;
  /** Only accepted mappings. Consumers must never use proposedField for ingestion. */
  field: string | null;
  proposedField: string | null;
  confidence: number;
  margin: number;
  match: "history" | "exact" | "synonym" | "similarity" | "none";
  reason: "accepted" | "unknown" | "ambiguous" | "type-conflict" | "duplicate-header" | "duplicate-target" | "confirmed-unmapped";
};
export type MappingResult = {
  domain: MappingDomain;
  headerRowIndex: number | null;
  fields: ColumnMapping[];
  confidence: number;
  unmappedHeaders: string[];
  missingRequiredFields: string[];
  mappingFingerprint: string;
};

export type SaveMappingInput = {
  sourceConnectionId: string;
  sourceTabId: string;
  domain: MappingDomain;
  headerRowIndex: number;
  columns: ConfirmedColumn[];
};
export type SavedMappingVersion = { id: string; version: number };
