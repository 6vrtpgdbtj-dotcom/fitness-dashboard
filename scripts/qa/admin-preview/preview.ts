import type {MappingDomain,MappingResult} from "@/features/mapping/types";
export async function previewMapping(input:{sourceTabId:string;domain:MappingDomain;headerRowIndex:number}):Promise<MappingResult>{
  const response=await fetch("/__qa_mapping_preview",{method:"POST",body:JSON.stringify(input)});
  if(!response.ok) throw new Error("Fixture preview failed");
  return response.json();
}
