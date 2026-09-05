import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { createSheetConnection, getOrganizationId, readSpreadsheetMetadata } from "@/lib/google/sheets";

const spreadsheetUrl = z.string().url().transform((value, context) => {
  const match = new URL(value).pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (new URL(value).hostname !== "docs.google.com" || !match) {
    context.addIssue({ code: "custom", message: "A Google Sheets URL is required." });
    return z.NEVER;
  }
  return match[1];
});

const requestSchema = z.object({
  spreadsheetUrl,
  trainerId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (user.role !== "admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid Google Sheets URL." }, { status: 400 });

  try {
    const organizationId = await getOrganizationId(user.id);
    const metadata = await readSpreadsheetMetadata(parsed.data.spreadsheetUrl, user.id);
    const connection = await createSheetConnection({
      organizationId,
      connectedBy: user.id,
      trainerId: parsed.data.trainerId,
      metadata,
    });
    return NextResponse.json({ id: connection.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The sheet could not be connected. Confirm Google authorization and access, then try again." }, { status: 422 });
  }
}
