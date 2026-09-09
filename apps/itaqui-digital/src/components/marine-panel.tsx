"use client";

import { useState } from "react";
import { ArrowUpRight, RefreshCw, Waves } from "lucide-react";
import { seaLevelSegments, type MarineData } from "@/lib/marine";

function timeLabel(time: number, withDate = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(time * 1000);
}

const numberLabel = (value: number | null, unit: string) =>
  value === null
    ? "Sem dado"
    : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unit}`;

export function MarinePanel({
  data,
  error,
  onRetry,
}: {
  data?: MarineData;
  error?: Error;
  onRetry: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  if (!data)
    return (
      <section className="weather-card expanded-weather">
        <div className="section-label">
          <Waves size={16} /> MARÉS E CONDIÇÕES DO MAR
        </div>
        <p className="muted">
          {error
            ? "Não foi possível consultar as condições do mar."
            : "Consultando o nível do mar e as correntes…"}
        </p>
        {error && (
          <button className="text-button" onClick={onRetry}>
            <RefreshCw size={16} /> Tentar novamente
          </button>
        )}
      </section>
    );

  const current = data.current;
  const hours = data.hourly;
  const selected = hours[Math.min(selectedIndex, hours.length - 1)];
  const levels = hours.flatMap((entry) =>
    entry.seaLevel === null ? [] : [entry.seaLevel],
  );
  const min = Math.min(...levels, 0) - 0.2;
  const max = Math.max(...levels, 0) + 0.2;
  const start = hours[0].time;
  const span = Math.max(hours[hours.length - 1].time - start, 1);
  const x = (time: number) => 36 + ((time - start) / span) * 264;
  const y = (value: number) => 10 + ((max - value) / (max - min)) * 88;
  const hasSeaLevel = levels.length > 0;

  return (
    <section className="weather-card expanded-weather marine-card">
      <div className="section-label">
        <span>
          <Waves size={16} /> MARÉS E CONDIÇÕES DO MAR
        </span>
        <button
          className="text-button"
          aria-label="Atualizar condições do mar"
          title="Atualizar condições do mar"
          onClick={onRetry}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {error && (
        <p className="source-note" role="status">
          A atualização falhou. Exibindo a última consulta de{" "}
          {timeLabel(Date.parse(data.fetchedAt) / 1000, true)} BRT.
        </p>
      )}
      <div className="weather-current">
        <div>
          <strong style={{ fontSize: 38 }}>
            {current.seaLevel === null
              ? "—"
              : current.seaLevel.toFixed(2).replace(".", ",")}
            <span style={{ fontSize: 18 }}> m</span>
          </strong>
          <p>Nível do mar · referência MSL</p>
        </div>
        <Waves className="weather-illustration" size={58} strokeWidth={1} />
      </div>
      <p className="source-note">
        Previsão do modelo para {timeLabel(current.time)} BRT · célula marinha a{" "}
        {numberLabel(data.gridDistanceKm, "km")} do porto.
      </p>
      <div className="weather-detail-grid">
        <div>
          <span>Velocidade da corrente</span>
          <b>{numberLabel(current.currentSpeed, "nós")}</b>
        </div>
        <div>
          <span>Corrente em direção a</span>
          <b>
            {current.currentDirection !== null && (
              <ArrowUpRight
                size={14}
                style={{
                  transform: `rotate(${current.currentDirection - 45}deg)`,
                }}
              />
            )}
            {numberLabel(current.currentDirection, "°")}
          </b>
        </div>
        <div>
          <span>Temperatura da água</span>
          <b>{numberLabel(current.waterTemperature, "°C")}</b>
        </div>
        <div>
          <span>Altura significativa das ondas</span>
          <b>{numberLabel(current.waveHeight, "m")}</b>
        </div>
        {current.wavePeriod !== null && (
          <div>
            <span>Período das ondas</span>
            <b>{numberLabel(current.wavePeriod, "s")}</b>
          </div>
        )}
        {current.waveDirection !== null && (
          <div>
            <span>Ondas vindas de</span>
            <b>{numberLabel(current.waveDirection, "°")}</b>
          </div>
        )}
      </div>
      <h3>Nível do mar nas próximas 48 horas</h3>
      {hasSeaLevel ? (
        <>
          <div className="forecast-chart">
            <svg
              viewBox="0 0 310 122"
              role="img"
              aria-label="Previsão horária do nível do mar em metros relativos ao nível médio global"
              style={{ height: 142 }}
            >
              <title>
                Nível do mar previsto, incluindo marés. Metros em relação ao
                nível médio global (MSL).
              </title>
              {[min + 0.2, 0, max - 0.2].map((level, index) => (
                <g key={index}>
                  <line
                    x1="36"
                    x2="300"
                    y1={y(level)}
                    y2={y(level)}
                    stroke="currentColor"
                    opacity="0.15"
                    strokeDasharray="3 3"
                  />
                  <text
                    x="30"
                    y={y(level) + 3}
                    textAnchor="end"
                    fill="currentColor"
                    fontSize="9"
                    opacity="0.8"
                  >
                    {level.toFixed(1)}
                  </text>
                </g>
              ))}
              {seaLevelSegments(hours).map((segment, index) => (
                <polyline
                  key={index}
                  points={segment
                    .map((entry) => `${x(entry.time)},${y(entry.seaLevel!)}`)
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              ))}
              <line
                x1={x(selected.time)}
                x2={x(selected.time)}
                y1="8"
                y2="100"
                stroke="currentColor"
                opacity="0.45"
              />
              {selected.seaLevel !== null && (
                <circle
                  cx={x(selected.time)}
                  cy={y(selected.seaLevel)}
                  r="4"
                  fill="currentColor"
                />
              )}
              <text x="36" y="118" fill="currentColor" fontSize="9">
                {timeLabel(start, true)}
              </text>
              <text
                x="300"
                y="118"
                textAnchor="end"
                fill="currentColor"
                fontSize="9"
              >
                {timeLabel(start + span, true)}
              </text>
            </svg>
          </div>
          <label className="source-note" style={{ display: "block" }}>
            Explorar previsão horária
            <input
              type="range"
              aria-label="Horário da previsão do nível do mar"
              min="0"
              max={hours.length - 1}
              value={Math.min(selectedIndex, hours.length - 1)}
              aria-valuetext={`${timeLabel(selected.time, true)} BRT, ${numberLabel(selected.seaLevel, "metros MSL")}`}
              onChange={(event) => setSelectedIndex(Number(event.target.value))}
              style={{
                width: "100%",
                display: "block",
                margin: "10px 0",
                accentColor: "var(--accent)",
              }}
            />
          </label>
          <p className="source-note" aria-live="polite">
            <b>{timeLabel(selected.time, true)} BRT</b> ·{" "}
            {numberLabel(selected.seaLevel, "m MSL")} · corrente{" "}
            {numberLabel(selected.currentSpeed, "nós")}
          </p>
        </>
      ) : (
        <p className="source-note">
          O provedor não retornou o nível do mar nesta área.
        </p>
      )}
      {current.waveHeight === null && (
        <p className="source-note">
          Ondas: sem estimativa disponível na célula costeira consultada.
        </p>
      )}
      <p className="source-note">
        Modelo oceânico, com marés incluídas; não é medição de marégrafo. MSL é
        o nível médio global, diferente do zero da carta náutica. Resolução
        aproximada de 8 km; não usar para navegação ou calado.
      </p>
      <p className="source-note">
        <a href={data.sourceUrl} target="_blank" rel="noreferrer">
          Open-Meteo Marine
        </a>{" "}
        · Météo-France / Copernicus · consulta{" "}
        {timeLabel(Date.parse(data.fetchedAt) / 1000)} BRT
      </p>
    </section>
  );
}
