"use client";
import { useRef, useState } from "react";
import { MappingReview } from "@/components/sheets/mapping-review";
import type { AdminTab } from "@/features/admin/types";
import type { MappingDomain, MappingResult } from "@/features/mapping/types";
import { previewMapping } from "@/features/admin/preview-mapping";
export function MappingWorkspace({ tabs }: { tabs: AdminTab[] }) {
  const [id,setId] = useState(tabs[0]?.id ?? "");
  const tab = tabs.find(t => t.id === id);
  return <section className="admin-section"><div className="admin-section-heading"><div><p className="eyebrow">SOURCE MAPPING</p><h2>원본 열 매핑</h2></div><label className="admin-field">원본 탭<select value={id} onChange={e => setId(e.target.value)}><option value="">탭 선택</option>{tabs.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>{tab ? <TabMapping key={tab.id} tab={tab} /> : <p className="admin-empty">점검할 원본 탭이 없습니다.</p>}</section>;
}
function TabMapping({ tab }: { tab: AdminTab }) {
  const [domain,setDomain] = useState<MappingDomain>(tab.domain ?? tab.mappingResult.domain);
  const [header,setHeader] = useState(String((tab.mappingResult.headerRowIndex ?? 0) + 1));
  const [result,setResult]=useState<MappingResult|null>(tab.mappingResult.headerRowIndex===null?null:tab.mappingResult);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const requestSequence=useRef(0);
  const validHeader=Number.isInteger(Number(header)) && Number(header)>=1 && Number(header)<=10000;
  function invalidate(){requestSequence.current++;setResult(null);setError("");setBusy(false);}
  async function preview(){
    const sequence=++requestSequence.current;
    setBusy(true);setResult(null);setError("");
    try {
      const next=await previewMapping({sourceTabId:tab.id,domain,headerRowIndex:Number(header)-1});
      if(sequence!==requestSequence.current) return;
      if(next.domain!==domain || next.headerRowIndex!==Number(header)-1) throw new Error("Preview changed");
      setResult(next);
    } catch { if(sequence===requestSequence.current) setError("선택한 행의 미리보기를 만들지 못했습니다. 원본 스냅샷과 헤더 행을 확인해 주세요."); }
    finally { if(sequence===requestSequence.current) setBusy(false); }
  }
  return <div className="admin-mapping"><div className="admin-inline-form"><label className="admin-field">데이터 분야<select value={domain} disabled={!!tab.domain} onChange={e => {invalidate();setDomain(e.target.value as MappingDomain);}}><option value="member">회원</option><option value="registration">등록</option><option value="lead">상담</option><option value="class">수업</option></select></label><label className="admin-field">헤더 행<input type="number" min={1} max={10000} value={header} onChange={e => {invalidate();setHeader(e.target.value);}} /></label><button className="quiet-button" disabled={!validHeader || busy} onClick={preview}>선택한 행 미리보기</button></div>
    <p className="form-hint">분야·헤더 행을 바꾸면 미리보기를 다시 확인해야 저장할 수 있습니다. 매핑은 다음 동기화부터 적용됩니다.</p>{busy && <p role="status">원본 행을 확인하고 있습니다…</p>}{error && <p className="form-error" role="alert">{error}</p>}{result ? <MappingReview input={{ sourceConnectionId: tab.source_connection_id, sourceTabId: tab.id, tabTitle: tab.title, domain:result.domain }} result={result} /> : !busy && <p className="admin-empty">헤더 행을 선택하고 미리보기를 불러오세요.</p>}
  </div>;
}
