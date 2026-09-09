"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { mapColumns } from "@/features/mapping/map-columns";
import { redactPhones } from "@/features/sync/normalize-fields";
import type { MappingDomain, MappingResult } from "@/features/mapping/types";
const schema=z.object({sourceTabId:z.string().uuid(),domain:z.enum(["member","registration","lead","class"]),headerRowIndex:z.number().int().min(0).max(9999)}).strict();
type PreviewTab = {id:string;organization_id:string;source_connection_id:string;title:string;domain:MappingDomain|null;rows:unknown[][]|null;mapping:{domain:MappingDomain;headerRowIndex:number;fields:{sourceHeader:string;field:string|null}[]}|null};
function scrub(value:unknown):unknown {
  if(typeof value==="string") return redactPhones(value);
  if(Array.isArray(value)) return value.map(scrub);
  if(value && typeof value==="object") return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,scrub(item)]));
  return value;
}
export async function previewMapping(value:{sourceTabId:string;domain:MappingDomain;headerRowIndex:number}):Promise<MappingResult> {
  if((await requireUser()).role!=="admin") throw new Error("Administrator access is required.");
  const input=schema.parse(value);
  const {data,error}=await (await createClient()).rpc("admin_workspace");
  if(error || !data) throw new Error("Could not read the source tab.");
  const tab=(data.tabs as PreviewTab[]).find(tab=>tab.id===input.sourceTabId);
  if(!tab || (tab.domain && tab.domain!==input.domain)) throw new Error("The source tab was not found for this domain.");
  if(!tab.rows || input.headerRowIndex>=tab.rows.length) throw new Error("The selected header row is not available.");
  const scope={organizationId:tab.organization_id,sourceConnectionId:tab.source_connection_id,sourceTabId:tab.id};
  const result=mapColumns({...scope,domain:input.domain,tabTitle:tab.title,rows:tab.rows,headerRowIndex:input.headerRowIndex},tab.mapping?[{...scope,domain:tab.mapping.domain,version:1,headerRowIndex:tab.mapping.headerRowIndex,columns:tab.mapping.fields}]:[]);
  return scrub(result) as MappingResult;
}
