// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { previewMapping } from "../preview-mapping";
const mocks = vi.hoisted(() => ({ role:"admin",rpc:vi.fn() }));
vi.mock("@/lib/auth/require-user",()=>({requireUser:async()=>({role:mocks.role})}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
const id="00000000-0000-4000-8000-000000000001";
beforeEach(()=>{mocks.role="admin";mocks.rpc.mockReset().mockResolvedValue({data:{tabs:[{id,organization_id:"org",source_connection_id:"connection",domain:null,title:"원본",rows:[["이전"],["회원명","등록일","연락처"],["민수 010-1234-5678","2026-09-10","010-9876-4321"]],mapping:null}]},error:null});});
it("computes fields, requirements and redacted samples from the selected row and domain",async()=>{
  const result=await previewMapping({sourceTabId:id,domain:"registration",headerRowIndex:1});
  expect(result.headerRowIndex).toBe(1);
  expect(result.fields.map(f=>f.sourceHeader)).toEqual(["회원명","등록일","연락처"]);
  expect(result.fields[1].field).toBe("registration_date");
  expect(result.missingRequiredFields).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("010-1234-5678");
  expect(JSON.stringify(result)).not.toContain("010-9876-4321");
});
it("rejects unauthorized users and source tabs outside the scoped workspace",async()=>{
  mocks.role="trainer";
  await expect(previewMapping({sourceTabId:id,domain:"member",headerRowIndex:0})).rejects.toThrow("Administrator");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.role="admin";
  await expect(previewMapping({sourceTabId:"00000000-0000-4000-8000-000000000002",domain:"member",headerRowIndex:0})).rejects.toThrow("source tab");
});
it("rejects an absent row instead of returning an apparently confirmed header",async()=>{
  await expect(previewMapping({sourceTabId:id,domain:"member",headerRowIndex:9})).rejects.toThrow("header row");
});
