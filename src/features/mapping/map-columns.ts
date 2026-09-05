import { canonicalFields, missingRequiredFields, type CanonicalField } from "./canonical-fields";
import { normalizeHeader } from "./header-normalizer";
import { isNonEmpty, profileColumn, sampleValue } from "./value-profiler";
import type { ColumnMapping, ColumnProfile, ConfirmedMapping, MappingInput, MappingResult, MappingDomain } from "./types";

export function mappingFingerprint(domain: MappingDomain, headerRowIndex: number | null, headers: readonly string[]): string {
  // Canonical JSON is collision-free and portable in both browser and server runtimes.
  // It contains schema only, never sample values, tenant credentials or member data.
  return `mapping:v1:${JSON.stringify([domain, headerRowIndex, headers.map(normalizeHeader)])}`;
}

function aliases(field: CanonicalField): string[] {
  return [field.id, field.label, ...field.synonyms].map(normalizeHeader);
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function compatibility(field: CanonicalField, profile: ColumnProfile): number {
  return field.kinds.reduce((sum, kind) => sum + profile.ratios[kind], 0);
}

export function mapColumns(input: MappingInput, history: ConfirmedMapping[] = []): MappingResult {
  const definitions = canonicalFields[input.domain];
  const scoped = history.filter((entry) => entry.organizationId === input.organizationId && entry.sourceConnectionId === input.sourceConnectionId && entry.sourceTabId === input.sourceTabId && entry.domain === input.domain);
  const latestVersion = Math.max(0, ...scoped.map((entry) => entry.version));
  const latest = scoped.filter((entry) => entry.version === latestVersion);
  const confirmed = new Map<string, string | null>();
  // Conflicting copies of the same version are not a reliable historical signal.
  if (latest.length === 1) {
    for (const column of latest[0].columns) {
      const key = normalizeHeader(column.sourceHeader);
      const duplicates = latest[0].columns.filter((candidate) => normalizeHeader(candidate.sourceHeader) === key);
      if (key && duplicates.length === 1 && (column.field === null || definitions.some((field) => field.id === column.field))) confirmed.set(key, column.field);
    }
  }
  let headerRowIndex: number | null = input.headerRowIndex !== undefined && Number.isInteger(input.headerRowIndex) && input.headerRowIndex >= 0 && input.headerRowIndex < input.rows.length ? input.headerRowIndex : null;
  if (input.headerRowIndex === undefined) {
    let best = 1;
    input.rows.slice(0, 50).forEach((row, index) => {
      const matched = new Set<string>();
      row.forEach((cell) => {
        if (typeof cell !== "string") return;
        const key = normalizeHeader(cell);
        const known = definitions.find((field) => aliases(field).includes(key));
        const historical = confirmed.get(key);
        if (historical) matched.add(historical);
        else if (known) matched.add(known.id);
      });
      if (matched.size > best) { best = matched.size; headerRowIndex = index; }
    });
  }
  const headers = headerRowIndex === null ? [] : input.rows[headerRowIndex].map((value) => typeof value === "string" ? value : "");
  const normalized = headers.map(normalizeHeader);
  const fields: ColumnMapping[] = headers.map((sourceHeader, columnIndex) => {
    const key = normalized[columnIndex];
    const values = input.rows.slice((headerRowIndex ?? -1) + 1).map((row) => row[columnIndex]);
    const profile = profileColumn(values);
    const phoneColumn = confirmed.get(key) === "phone_last4" || definitions.some((field) => field.id === "phone_last4" && aliases(field).includes(key));
    const samples = values.filter(isNonEmpty).slice(0, 3).map((value) => phoneColumn ? `***-****-${String(value).replace(/\D/g, "").slice(-4)}` : sampleValue(value));
    const base: ColumnMapping = { columnIndex, sourceHeader, normalizedHeader: key, sampleValues: samples, profile, field: null, proposedField: null, confidence: 0, margin: 0, match: "none", reason: "unknown" };
    if (!key) return base;
    if (normalized.filter((header) => header === key).length > 1) return { ...base, reason: "duplicate-header" };
    if (confirmed.has(key)) {
      const field = confirmed.get(key)!;
      return { ...base, field, proposedField: field, confidence: 1, margin: 1, match: "history", reason: field ? "accepted" : "confirmed-unmapped" };
    }
    const hasKnown = definitions.some((field) => aliases(field).includes(key));
    const candidates = definitions.map((definition) => {
      const exact = normalizeHeader(definition.id) === key || normalizeHeader(definition.label) === key;
      const synonym = definition.synonyms.some((alias) => normalizeHeader(alias) === key);
      const headerSimilarity = Math.max(...aliases(definition).map((alias) => similarity(key, alias)));
      const typeCompatibility = compatibility(definition, profile);
      const confidence = exact ? 0.98 : synonym ? 0.94 : Math.min(hasKnown ? 0.8 : 0.9, headerSimilarity * 0.65 + typeCompatibility * 0.25);
      return { definition, confidence, typeCompatibility, match: exact ? "exact" as const : synonym ? "synonym" as const : "similarity" as const };
    }).sort((a, b) => b.confidence - a.confidence || a.definition.id.localeCompare(b.definition.id, "en"));
    const first = candidates[0];
    const margin = Number((first.confidence - (candidates[1]?.confidence ?? 0)).toFixed(6));
    const typeConflict = profile.nonEmptyCount > 0 && first.typeCompatibility < 0.75;
    // A name-looking value is never enough to establish a person's identity.
    const identityGuess = first.match === "similarity" && ["name", "external_member_id"].includes(first.definition.id);
    const accepted = !typeConflict && !identityGuess && first.confidence >= 0.88 && margin >= 0.12;
    return { ...base, field: accepted ? first.definition.id : null, proposedField: first.confidence >= 0.5 ? first.definition.id : null, confidence: first.confidence, margin, match: first.match, reason: accepted ? "accepted" : typeConflict && first.confidence >= 0.88 ? "type-conflict" : first.confidence >= 0.88 ? "ambiguous" : "unknown" };
  });
  // Do not silently prefer one source column when two populate the same standard field.
  const targets = fields.map((column) => column.field);
  for (const column of fields) {
    if (column.field && targets.filter((target) => target === column.field).length > 1) { column.field = null; column.reason = "duplicate-target"; }
  }
  const accepted = fields.filter((column) => column.field !== null);
  return {
    domain: input.domain, headerRowIndex, fields,
    confidence: fields.length ? accepted.reduce((sum, column) => sum + column.confidence, 0) / fields.length : 0,
    unmappedHeaders: fields.filter((column) => !column.field).map((column) => column.sourceHeader),
    missingRequiredFields: missingRequiredFields(input.domain, fields.map((column) => column.field)),
    mappingFingerprint: mappingFingerprint(input.domain, headerRowIndex, headers),
  };
}
