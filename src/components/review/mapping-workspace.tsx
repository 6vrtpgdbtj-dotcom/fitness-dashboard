"use client";
import { useState } from "react";
import { MappingReview } from "@/components/sheets/mapping-review";
import type { AdminTab } from "@/features/admin/types";
import type { MappingDomain } from "@/features/mapping/types";
export function MappingWorkspace({ tabs }: { tabs: AdminTab[] }) {
  const [id,setId] = useState(tabs[0]?.id ?? "");
  const tab = tabs.find(t => t.id === id);
  return <section className="admin-section"><div className="admin-section-heading"><div><p className="eyebrow">SOURCE MAPPING</p><h2>원본 열 매핑</h2></div><label className="admin-field">원본 탭<select value={id} onChange={e => setId(e.target.value)}><option value="">탭 선택</option>{tabs.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>{tab ? <TabMapping key={tab.id} tab={tab} /> : <p className="admin-empty">점검할 원본 탭이 없습니다.</p>}</section>;
}
function TabMapping({ tab }: { tab: AdminTab }) {
  const [domain,setDomain] = useState<MappingDomain>(tab.domain ?? tab.mappingResult.domain);
  const [header,setHeader] = useState((tab.mappingResult.headerRowIndex ?? 0) + 1);
  const result = { ...tab.mappingResult, domain, headerRowIndex: header - 1, fields: tab.mappingResult.fields.map(f => domain === tab.mappingResult.domain ? f : { ...f, field: null, proposedField: null }) };
  return <div className="admin-mapping"><div className="admin-inline-form"><label className="admin-field">데이터 분야<select value={domain} disabled={!!tab.domain} onChange={e => setDomain(e.target.value as MappingDomain)}><option value="member">회원</option><option value="registration">등록</option><option value="lead">상담</option><option value="class">수업</option></select></label><label className="admin-field">헤더 행<input type="number" min={1} max={10000} value={header} onChange={e => setHeader(Math.max(1,Number(e.target.value) || 1))} /></label></div>
    <p className="form-hint">매핑 저장 후 다음 동기화부터 적용됩니다. 신뢰도가 낮거나 연결되지 않은 열을 먼저 확인하세요.</p><MappingReview input={{ sourceConnectionId: tab.source_connection_id, sourceTabId: tab.id, tabTitle: tab.title, domain }} result={result} />
  </div>;
}
