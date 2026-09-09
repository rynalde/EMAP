"use client";
import { useState } from "react";
import {
  Ship,
  Anchor,
  ArrowUpRight,
  Clock3,
  Radio,
  ChevronRight,
} from "lucide-react";
import type { Vessel, AISData } from "@/lib/types";
import { localTime } from "@/lib/port-data";
export function VesselList({
  vessels,
  onSelect,
  compact = false,
  loading = false,
  ais,
}: {
  vessels: Vessel[];
  onSelect: (v: Vessel) => void;
  compact?: boolean;
  loading?: boolean;
  ais?: AISData;
}) {
  const [filter, setFilter] = useState("todos");
  const active = vessels.filter((v) => !v.stale);
  const shown = compact
    ? active.filter((v) => v.status === "atracado").slice(0, 3)
    : vessels.filter(
        (v) =>
          filter === "todos" ||
          (filter === "ais" ? v.positionSource === "ais" : v.status === filter),
      );
  return (
    <div className="vessel-list">
      {!compact && (
        <>
          <div
            className={`connection-note ${ais?.configured ? "connected" : ""}`}
          >
            <Radio size={18} />
            <div>
              <b>
                {ais?.configured
                  ? ais.state === "connected"
                    ? "AIS conectado"
                    : ais.state === "error"
                      ? "Conexão AIS indisponível"
                      : "Conectando ao AIS…"
                  : "Rastreamento AIS disponível"}
              </b>
              <p>
                {ais?.configured
                  ? ais.error ||
                    (ais.vessels.length
                      ? `${ais.vessels.length} embarcações com posição AIS na região. Atualização a cada 5 segundos.`
                      : "Aguardando posições na região. A cobertura depende do provedor; nenhum navio é inventado.")
                  : "Aguardando chave do provedor. Abaixo, programação pública da EMAP."}
              </p>
            </div>
          </div>
          <div className="filter-tabs" aria-label="Filtrar navios">
            {[
              ["todos", "Todos"],
              ["ais", "AIS na região"],
              ["atracado", "Atracados"],
              ["fundeado", "Fundeados"],
              ["esperado", "Esperados"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={filter === id ? "active" : ""}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {loading && (
        <p className="muted empty-message">
          Consultando a programação da EMAP…
        </p>
      )}
      {!loading && !shown.length && (
        <p className="muted empty-message">Nenhum navio nesta seleção.</p>
      )}
      {shown.map((v) => (
        <button
          key={v.id}
          className={`vessel-row ${v.stale ? "stale-row" : ""}`}
          onClick={() => onSelect(v)}
        >
          <span className="vessel-icon">
            {v.status === "fundeado" ? (
              <Anchor size={20} />
            ) : (
              <Ship size={20} />
            )}
          </span>
          <span className="vessel-copy">
            <b>{v.name}</b>
            <span>
              {v.cargo || "Embarcação AIS"}{" "}
              <span className="divider-dot">·</span>{" "}
              {v.berth ? `Berço ${v.berth.padStart(3, "0")}` : v.status}
            </span>
            <small>
              {v.stale
                ? "Registro antigo · posição oculta"
                : v.positionSource === "ais"
                  ? `AIS · ${localTime(v.updatedAt)} BRT`
                  : v.updatedAt
                    ? `EMAP · ${new Date(v.updatedAt).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })}`
                    : "Data não informada"}
            </small>
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
      {!compact && (
        <p className="source-note">
          A programação pode mudar. A posição pelo berço é aproximada. Registros
          da EMAP com mais de 7 dias ficam sem posição no mapa.
        </p>
      )}
    </div>
  );
}
