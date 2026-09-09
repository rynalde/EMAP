"use client";
import {
  CloudSun,
  CloudRain,
  Cloud,
  Sun,
  Wind,
  Droplets,
  Eye,
  Sunrise,
  Sunset,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import type { WeatherData } from "@/lib/types";
import { weatherLabel, localTime } from "@/lib/port-data";
export function WeatherPanel({
  data,
  error,
  compact = false,
  onRetry,
}: {
  data?: WeatherData;
  error?: Error;
  compact?: boolean;
  onRetry: () => void;
}) {
  if (!data)
    return (
      <section className="weather-card">
        <div className="section-label">
          <CloudSun size={16} /> CONDIÇÕES NO PORTO
        </div>
        <p className="muted">
          {error
            ? "Não foi possível consultar o clima."
            : "Consultando as condições do tempo…"}
        </p>
        {error && (
          <button className="text-button" onClick={onRetry}>
            <RefreshCw size={16} /> Tentar novamente
          </button>
        )}
      </section>
    );
  const c = data.current;
  const CurrentIcon =
    c.weather_code >= 51
      ? CloudRain
      : c.weather_code === 0
        ? Sun
        : c.weather_code >= 3
          ? Cloud
          : CloudSun;
  const hours = data.hourly.time
    .map((t, i) => ({
      t,
      temp: data.hourly.temperature_2m[i],
      rain: data.hourly.precipitation_probability[i],
      wind: data.hourly.wind_speed_10m[i],
    }))
    .filter((x) => x.t >= c.time)
    .slice(0, compact ? 5 : 12);
  const min = Math.min(...hours.map((x) => x.temp)) - 1,
    max = Math.max(...hours.map((x) => x.temp)) + 1;
  return (
    <section className={`weather-card ${compact ? "" : "expanded-weather"}`}>
      <div className="section-label">
        <span>
          <CloudSun size={16} /> CONDIÇÕES NO PORTO
        </span>
        <span className="tiny-dot" />{" "}
      </div>
      <div className="weather-current">
        <div>
          <strong>
            {Math.round(c.temperature_2m)}
            <span>°</span>
          </strong>
          <p>{weatherLabel(c.weather_code)}</p>
        </div>
        <CurrentIcon
          className="weather-illustration"
          size={68}
          strokeWidth={1}
        />
      </div>
      <div className="weather-metrics">
        <span>
          <Wind size={16} />
          <b>{Math.round(c.wind_speed_10m)}</b> km/h
        </span>
        <span>
          <Droplets size={16} />
          <b>{c.relative_humidity_2m}</b>%
        </span>
        <span>
          <Eye size={16} />
          <b>{(c.visibility / 1000).toFixed(0)}</b> km
        </span>
      </div>
      {!compact && (
        <>
          <div className="weather-detail-grid">
            <div>
              <span>Sensação</span>
              <b>{Math.round(c.apparent_temperature)} °C</b>
            </div>
            <div>
              <span>Rajadas</span>
              <b>{Math.round(c.wind_gusts_10m)} km/h</b>
            </div>
            <div>
              <span>Direção do vento</span>
              <b>
                <ArrowUpRight
                  size={14}
                  style={{
                    transform: `rotate(${c.wind_direction_10m - 45}deg)`,
                  }}
                />
                {c.wind_direction_10m}°
              </b>
            </div>
            <div>
              <span>Precipitação</span>
              <b>{c.precipitation} mm</b>
            </div>
          </div>
          <h3>Próximas horas</h3>
          <div
            className="forecast-chart"
            aria-label="Previsão de temperatura nas próximas 12 horas"
          >
            <svg
              viewBox="0 0 300 70"
              role="img"
              aria-label="Curva de temperatura"
            >
              <polyline
                points={hours
                  .map(
                    (x, i) =>
                      `${(i / (hours.length - 1)) * 300},${62 - ((x.temp - min) / (max - min)) * 54}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </div>
        </>
      )}
      <div className="forecast-hours">
        {hours
          .filter((_, i) => compact || i % 3 === 0)
          .map((x) => (
            <div key={x.t}>
              <span>{localTime(x.t)}</span>
              {x.rain >= 50 ? <CloudRain size={18} /> : <CloudSun size={18} />}
              <b>{Math.round(x.temp)}°</b>
              {!compact && <small>{x.rain}% chuva</small>}
            </div>
          ))}
      </div>
      {!compact && (
        <div className="sun-times">
          <span>
            <Sunrise size={20} /> Nascer do sol{" "}
            <b>{localTime(data.daily.sunrise[0])}</b>
          </span>
          <span>
            <Sunset size={20} /> Pôr do sol{" "}
            <b>{localTime(data.daily.sunset[0])}</b>
          </span>
        </div>
      )}
      <p className="source-note">
        Modelo meteorológico ·{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        · {localTime(c.time)} BRT
      </p>
    </section>
  );
}
