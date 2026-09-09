import { MARINE_API_URL, parseMarineData } from "@/lib/marine";

export async function GET() {
  try {
    const response = await fetch(MARINE_API_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Marine provider unavailable");
    return Response.json(parseMarineData(await response.json()), {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=900" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Condições do mar temporariamente indisponíveis. Tente atualizar.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
