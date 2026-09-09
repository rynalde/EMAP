"use client";
import { X, MapPin, Ship, ArrowUpRight, Box } from "lucide-react";
import {
  CATEGORY_LABELS,
  featureCenter,
  featureAttributes,
} from "@/lib/cartography";
import { getVesselModelInfo } from "@/lib/vessel-model-info";
import type { MapSelection } from "./port-map";
import { localTime, SOURCE_URL } from "@/lib/port-data";
export function SelectionCard({
  selection,
  onClose,
  onFocus,
}: {
  selection: MapSelection;
  onClose: () => void;
  onFocus: (c: [number, number]) => void;
}) {
  const vessel = selection.type === "vessel" ? selection.vessel : null,
    place = selection.type === "place" ? selection.place : null,
    feature = selection.type === "cartography" ? selection.feature : null;
  const model = vessel ? getVesselModelInfo(vessel) : null;
  const coordinates =
    vessel?.coordinates ||
    place?.coordinates ||
    (feature ? featureCenter(feature) : undefined);
  const title = vessel?.name || place?.name || feature?.properties.name;
  return (
    <section
      className="selection-card glass"
      aria-label={`Detalhes de ${title}`}
    >
      <div className="selection-top">
        <span className="section-label">
          {vessel ? <Ship size={16} /> : <Box size={16} />}{" "}
          {vessel
            ? "EMBARCAÇÃO"
            : place?.category === "berth"
              ? "INFRAESTRUTURA PORTUÁRIA"
              : feature
                ? CATEGORY_LABELS[feature.properties.category]
                : "LOCAL DO PORTO"}
        </span>
        <button
          className="icon-button"
          aria-label="Fechar detalhes"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <h2>{title}</h2>
      {vessel ? (
        <>
          <span className={`status-pill ${vessel.stale ? "warning" : ""}`}>
            <span className="tiny-dot" />
            {vessel.stale ? "Registro desatualizado" : vessel.status}
          </span>
          <div className="detail-grid">
            <div>
              <span>IMO / MMSI</span>
              <b>{vessel.imo || vessel.mmsi || "—"}</b>
            </div>
            <div>
              <span>Comprimento</span>
              <b>{vessel.length ? `${vessel.length} m` : "Não informado"}</b>
            </div>
            <div>
              <span>Carga</span>
              <b>{vessel.cargo || "Não informada"}</b>
            </div>
            <div>
              <span>
                {vessel.positionSource === "ais"
                  ? "Velocidade"
                  : "Volume informado"}
              </span>
              <b>
                {vessel.positionSource === "ais"
                  ? vessel.speed != null
                    ? `${vessel.speed} nós`
                    : "Não informado"
                  : vessel.quantity
                    ? `${vessel.quantity} t`
                    : "—"}
              </b>
            </div>
          </div>
          <p className="detail-note">
            {vessel.positionSource === "ais"
              ? `Posição AIS recebida às ${localTime(vessel.updatedAt)} BRT.`
              : vessel.positionSource === "berth"
                ? "Posição aproximada do berço da programação EMAP. Não é uma posição AIS em tempo real."
                : "O registro não contém uma posição atual verificada."}
          </p>
          {model && (
            <p className="source-note">
              Forma ilustrativa: {model.label.toLocaleLowerCase("pt-BR")}
              {model.inferredFromCargo ? " (inferida da carga)" : ""}.{" "}
              {model.lengthSource === "reported"
                ? "Comprimento informado pela fonte."
                : "Tamanho simbólico; dimensões não informadas."}{" "}
              {!model.headingKnown ? "Orientação não informada." : ""}
            </p>
          )}
          <p className="source-note">
            Atualização da fonte:{" "}
            {vessel.updatedAt
              ? new Date(vessel.updatedAt).toLocaleString("pt-BR", {
                  timeZone: "America/Fortaleza",
                })
              : "Não informada"}
          </p>
        </>
      ) : feature ? (
        <>
          <p className="detail-note">
            {CATEGORY_LABELS[feature.properties.category]} · cadastro
            OpenStreetMap
          </p>
          <dl className="cartography-attributes">
            {featureAttributes(feature).map((attribute) => (
              <div key={attribute.label}>
                <dt>{attribute.label}</dt>
                <dd>{attribute.value}</dd>
              </div>
            ))}
          </dl>
          <p className="source-note">
            Medidas calculadas do trecho exibido dentro do porto. Atributos
            cadastrados pela comunidade; não confirmam o uso atual da
            instalação.
          </p>
          <a
            className="text-button"
            href={feature.properties.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Consultar elemento no OpenStreetMap <ArrowUpRight size={14} />
          </a>
        </>
      ) : (
        <>
          <p className="detail-note">{place?.description}</p>
          {place?.length && (
            <div className="detail-grid">
              <div>
                <span>Comprimento estrutural</span>
                <b>{place.length} m</b>
              </div>
              {place?.depth && (
                <div>
                  <span>Profundidade de referência</span>
                  <b>{place.depth} m</b>
                </div>
              )}
            </div>
          )}
          {place?.category === "berth" && (
            <a
              className="source-note"
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Tabela EMAP (2023) · consultar condições vigentes{" "}
              <ArrowUpRight size={12} />
            </a>
          )}
        </>
      )}
      {coordinates && (
        <button className="primary-button" onClick={() => onFocus(coordinates)}>
          <MapPin size={16} /> Aproximar no mapa <ArrowUpRight size={16} />
        </button>
      )}
    </section>
  );
}
