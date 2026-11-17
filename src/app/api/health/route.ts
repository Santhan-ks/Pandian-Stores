import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const healthy = await checkDatabase();

  return NextResponse.json(
    { status: healthy ? "ok" : "unavailable" },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
