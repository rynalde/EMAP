import { getAIS } from "@/lib/ais-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(getAIS(), { headers: { "Cache-Control": "no-store" } });
}
