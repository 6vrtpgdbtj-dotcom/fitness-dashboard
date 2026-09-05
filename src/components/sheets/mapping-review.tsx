"use client";

import { useState } from "react";
import { canonicalFields, missingRequiredFields } from "@/features/mapping/canonical-fields";
import { saveMappingVersion } from "@/features/mapping/save-mapping-version";
import type { MappingInput, MappingResult, SavedMappingVersion, SaveMappingInput } from "@/features/mapping/types";

type Props = {
  input: Pick<MappingInput, "sourceConnectionId" | "sourceTabId" | "tabTitle" | "domain">;
  result: MappingResult;
  onSave?: (input: SaveMappingInput) => Promise<SavedMappingVersion>;
};

export function MappingReview(props: Props) {
  // Source/schema changes discard stale selections before another save is possible.
  const selectionSignature = JSON.stringify(props.result.fields.map((column) => column.field));
  return <MappingReviewForm key={`${props.input.sourceConnectionId}:${props.input.sourceTabId}:${props.result.mappingFingerprint}:${selectionSignature}`} {...props} />;
}

function MappingReviewForm({ input, result, onSave = saveMappingVersion }: Props) {
  const [selected, setSelected] = useState(() => result.fields.map((column) => column.field ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedMappingVersion | null>(null);
  const definitions = canonicalFields[input.domain];
  const assigned = selected.filter(Boolean);
  const missing = missingRequiredFields(input.domain, assigned);
  const duplicate = new Set(assigned).size !== assigned.length;
  const invalid = duplicate || missing.length > 0 || result.headerRowIndex === null || input.domain !== result.domain;
  const label = (id: string) => definitions.find((field) => field.id === id)?.label ?? id;

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    setError("");
    setSaved(null);
    try {
      const version = await onSave({ sourceConnectionId: input.sourceConnectionId, sourceTabId: input.sourceTabId, domain: input.domain, headerRowIndex: result.headerRowIndex!, columns: result.fields.map((column, index) => ({ sourceHeader: column.sourceHeader, field: selected[index] || null })) });
      setSaved(version);
    } catch {
      setError("매핑을 저장하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="data-panel" aria-labelledby="mapping-review-title">
      <div className="panel-heading">
        <div><p className="eyebrow">열 매핑 확인</p><h2 id="mapping-review-title">{input.tabTitle}</h2></div>
        <span>{result.headerRowIndex === null ? "헤더 확인 필요" : `${result.headerRowIndex + 1}행에서 헤더 발견`}</span>
      </div>
      <p>원본 열을 표준 필드에 연결해 주세요. 저장할 때마다 새 버전이 생성됩니다.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%" }}>
          <thead><tr><th scope="col">원본 헤더</th><th scope="col">예시 값</th><th scope="col">제안 필드</th><th scope="col">신뢰도</th><th scope="col">확정 필드</th></tr></thead>
          <tbody>{result.fields.map((column, index) => (
            <tr key={column.columnIndex}>
              <th scope="row">{column.sourceHeader || `${index + 1}열 (빈 헤더)`}</th>
              <td>{column.sampleValues.join(" · ") || "—"}</td>
              <td>{column.proposedField ? label(column.proposedField) : "확인 필요"}{column.field === null && column.proposedField ? " (미확정)" : ""}</td>
              <td>{Math.round(column.confidence * 100)}%</td>
              <td><select aria-label={`${index + 1}열 ${column.sourceHeader} 표준 필드`} value={selected[index]} disabled={saving || !column.normalizedHeader} onChange={(event) => { setSelected((previous) => previous.map((value, position) => position === index ? event.target.value : value)); setSaved(null); setError(""); }}>
                <option value="">연결 안 함</option>
                {definitions.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
              </select></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {missing.length > 0 && <p className="form-hint">필수 필드 확인: {missing.map(label).join(", ")}</p>}
      {duplicate && <p className="form-hint">같은 표준 필드를 여러 열에 연결할 수 없습니다.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p role="status">매핑 버전 {saved.version}을 저장했습니다.</p>}
      <button className="primary-action" type="button" disabled={invalid || saving} onClick={save}>{saving ? "저장 중…" : "새 매핑 버전 저장"}</button>
    </section>
  );
}
