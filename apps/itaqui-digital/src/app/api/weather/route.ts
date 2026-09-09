export async function GET() {
  const params = new URLSearchParams({
    latitude: "-2.57735",
    longitude: "-44.3702884",
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation",
    hourly: "temperature_2m,precipitation_probability,wind_speed_10m",
    daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
    timezone: "America/Fortaleza",
    timeformat: "unixtime",
    forecast_days: "2",
  });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw Error("weather");
    const data = await r.json();
    if (!data.current || typeof data.current.temperature_2m !== "number")
      throw Error("weather");
    return Response.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch {
    return Response.json(
      { error: "Clima temporariamente indisponível. Tente atualizar." },
      { status: 503 },
    );
  }
}
