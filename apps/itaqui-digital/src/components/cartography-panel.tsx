"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import {
  CATEGORY_LABELS,
  featureSummary,
  distanceFromPort,
  searchText,
  type CartographyData,
  type CartographyFeature,
  type CartographyCategory,
} from "@/lib/cartography";
export function CartographyPanel({
  data,
  error,
  onSelect,
  onRetry,
}: {
  data?: CartographyData;
  error?: unknown;
  onSelect: (feature: CartographyFeature) => void;
  onRetry: () => void;
}) {
  const [category, setCategory] = useState<CartographyCategory>("building");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(15);
  const filtered = useMemo(
    () =>
      data?.features
        .filter(
          (f) =>
            f.properties.category === category &&
            searchText(
              `${f.properties.name} ${f.properties.operator ?? ""} ${f.properties.ref ?? ""} ${f.properties.id}`,
            ).includes(searchText(query)),
        )
        .sort((a, b) => distanceFromPort(a) - distanceFromPort(b)) ?? [],
    [category, data, query],
  );
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    data?.features.forEach((f) => {
      const c = f.properties.category;
      result[c] = (result[c] ?? 0) + 1;
    });
    return result;
  }, [data]);
  return (
    <section className="cartography-panel" aria-label="Cadastro cartográfico">
      <div className="section-heading">
        <h2>Explore o território</h2>
        <span className="source-chip">OSM</span>
      </div>
      <p className="detail-note">
        Edifícios, vias e áreas dentro do recorte do Porto do Itaqui. Selecione
        um elemento para consultar seus atributos.
      </p>
      <div className="cartography-categories">
        {(
          Object.entries(CATEGORY_LABELS) as [CartographyCategory, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={category === key ? "active" : ""}
            aria-pressed={category === key}
            onClick={() => {
              setCategory(key);
              setLimit(15);
            }}
          >
            <span>{label}</span>
            <b>{data ? (counts[key] ?? 0) : "—"}</b>
          </button>
        ))}
      </div>
      <label className="cartography-search">
        <Search size={16} />
        <input
          aria-label="Filtrar elementos cartográficos"
          placeholder="Nome, operador ou referência"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(15);
          }}
        />
      </label>
      {error ? (
        <p className="detail-note">
          Não foi possível carregar os detalhes.{" "}
          <button className="text-button" onClick={onRetry}>
            Tentar novamente
          </button>
        </p>
      ) : !data ? (
        <p className="detail-note">Carregando cartografia…</p>
      ) : (
        <>
          <p className="source-note">
            {filtered.length.toLocaleString("pt-BR")} elementos nesta seleção
          </p>
          {filtered.slice(0, limit).map((feature) => (
            <button
              className="structure-row"
              key={feature.properties.id}
              onClick={() => onSelect(feature)}
            >
              <span className={`cartography-key key-${category}`} />
              <span>
                <b>{feature.properties.name}</b>
                <small>{featureSummary(feature)}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!filtered.length && (
            <p className="detail-note">Nenhum elemento encontrado.</p>
          )}
          {limit < filtered.length && (
            <button
              className="text-button cartography-more"
              onClick={() => setLimit((n) => n + 30)}
            >
              Mostrar mais {Math.min(30, filtered.length - limit)} elementos
            </button>
          )}
        </>
      )}
      <p className="source-note">
        Cobertura colaborativa, sem contornos inventados. Nomes genéricos
        identificam o tipo cadastrado. Recorte pelo polígono do porto no
        OpenStreetMap.
      </p>
    </section>
  );
}
