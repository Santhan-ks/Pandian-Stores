import { z } from "zod";
import { currentActor } from "@/modules/auth/server";
import { getDatabase } from "@/lib/db/connection";
import { getDashboard } from "@/modules/reporting/dashboard";
import { errorResponse } from "@/modules/catalog/http";
export async function GET(request: Request) {
  try {
    return Response.json(
      await getDashboard(
        getDatabase(),
        await currentActor(request.headers),
        z
          .enum(["real", "demo"])
          .parse(new URL(request.url).searchParams.get("scope") ?? "real"),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
