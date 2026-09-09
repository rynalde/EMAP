"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  Anchor,
  ArrowLeft,
  ArrowUpRight,
  Box,
  ChevronDown,
  ChevronRight,
  CloudSun,
  Compass,
  ExternalLink,
  HelpCircle,
  Layers3,
  Map,
  MapPin,
  Maximize,
  Menu,
  Minus,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Ship,
  Waves,
  X,
} from "lucide-react";
import { BERTHS, PLACES, OFFICIAL_LINKS, localTime } from "@/lib/port-data";
import type {
  AISData,
  Layers,
  MapCommand,
  PortData,
  WeatherData,
} from "@/lib/types";
import type { MapSelection } from "./port-map";
import { CartographyPanel } from "./cartography-panel";
import {
  CATEGORY_LABELS,
  featureCenter,
  featureBounds,
  searchText,
  type CartographyData,
  type CartographyMeta,
} from "@/lib/cartography";
import { MarinePanel } from "./marine-panel";
import type { MarineData } from "@/lib/marine";
import { WeatherPanel } from "./weather-panel";
import { VesselList } from "./vessel-list";
import { SelectionCard } from "./selection-card";
const PortMap = dynamic(() => import("./port-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <span className="loading-spinner" />
      Carregando o mapa do porto…
    </div>
  ),
});
const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw Error("Não foi possível consultar os dados");
  return r.json();
};
type Tab =
  "overview" | "vessels" | "structures" | "weather" | "marine" | "sources";
const NAV = [
  { id: "overview", label: "Visão geral", icon: Compass },
  { id: "vessels", label: "Navios", icon: Ship },
  { id: "structures", label: "Infraestrutura", icon: Box },
  { id: "weather", label: "Clima", icon: CloudSun },
  { id: "marine", label: "Marés", icon: Waves },
  { id: "sources", label: "Fontes e dados", icon: Radio },
] as const;
export function PortDashboard() {
  const [tab, setTab] = useState<Tab>("overview"),
    [panelOpen, setPanelOpen] = useState(true),
    [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [layersOpen, setLayersOpen] = useState(false),
    [basemap, setBasemap] = useState<"satellite" | "street">("satellite");
  const [layers, setLayers] = useState<Layers>({
      buildings: true,
      roads: true,
      railways: true,
      areas: true,
      vessels: true,
      berths: true,
      labels: true,
    }),
    [command, setCommand] = useState<MapCommand | null>(null),
    [selection, setSelection] = useState<MapSelection | null>(null),
    [ready, setReady] = useState(false),
    [time, setTime] = useState(""),
    [help, setHelp] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    searchRef = useRef<HTMLInputElement>(null);
  const port = useSWR<PortData>("/api/port", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });
  const weather = useSWR<WeatherData>("/api/weather", fetcher, {
    refreshInterval: 600000,
    revalidateOnFocus: false,
  });
  const marine = useSWR<MarineData>("/api/marine", fetcher, {
    refreshInterval: 900000,
    revalidateOnFocus: false,
  });
  const ais = useSWR<AISData>("/api/vessels", fetcher, {
    refreshInterval: (d) => (d?.configured ? 5000 : 60000),
    revalidateOnFocus: false,
  });
  const cartography = useSWR<CartographyData>(
    "/data/port-cartography.geojson?scope=itaqui",
    fetcher,
    { revalidateOnFocus: false },
  );
  const cartographyMeta = useSWR<CartographyMeta>(
    "/data/port-cartography-meta.json?scope=itaqui",
    fetcher,
    { revalidateOnFocus: false },
  );
  useEffect(() => {
    if (
      selection?.type === "cartography" &&
      cartography.data &&
      !cartography.data.features.some(
        (feature) => feature.properties.id === selection.feature.properties.id,
      )
    )
      setSelection(null);
  }, [cartography.data, selection]);
  const vessels = useMemo(
    () => [...(ais.data?.vessels || []), ...(port.data?.vessels || [])],
    [ais.data?.vessels, port.data?.vessels],
  );
  const activeVessels = vessels.filter((v) => !v.stale),
    berthed = activeVessels.filter((v) => v.status === "atracado");
  const send = useCallback(
    (type: MapCommand["type"], args: Partial<MapCommand> = {}) =>
      setCommand({ type, ...args, nonce: performance.now() }),
    [],
  );
  const select = useCallback(
    (s: MapSelection) => {
      setSelection(s);
      setSearchOpen(false);
      setQuery("");
      if (window.matchMedia("(max-width: 760px)").matches) setPanelOpen(false);
      const c =
        s.type === "vessel"
          ? s.vessel.coordinates
          : s.type === "place"
            ? s.place.coordinates
            : featureCenter(s.feature);
      if (s.type === "cartography") {
        const key = (
          {
            building: "buildings",
            road: "roads",
            railway: "railways",
            area: "areas",
            pier: "areas",
            water: "areas",
          } as const
        )[s.feature.properties.category];
        setLayers((previous) => ({ ...previous, [key]: true }));
        send("fly", { bounds: featureBounds(s.feature) });
        return;
      }
      if (c) send("fly", { coordinates: c });
    },
    [send],
  );
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("pt-BR", {
          timeZone: "America/Fortaleza",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setLayersOpen(false);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (help) dialog.current?.showModal();
    else dialog.current?.close();
  }, [help]);
  const cartographyResults = useMemo(
    () =>
      cartography.data?.features.map((feature) => ({
        label: feature.properties.name,
        sub: `${CATEGORY_LABELS[feature.properties.category]} · ${feature.properties.operator ?? feature.properties.ref ?? feature.properties.id}`,
        selection: { type: "cartography", feature } as MapSelection,
      })) ?? [],
    [cartography.data],
  );
  const searchResults = [
    ...PLACES.map((place) => ({
      label: place.name,
      sub: place.category === "berth" ? "Berço de atracação" : "Infraestrutura",
      selection: { type: "place", place } as MapSelection,
    })),
    ...vessels.map((vessel) => ({
      label: vessel.name,
      sub: vessel.cargo || vessel.status,
      selection: { type: "vessel", vessel } as MapSelection,
    })),
    ...cartographyResults,
  ]
    .filter((x) =>
      searchText(`${x.label} ${x.sub}`).includes(searchText(query)),
    )
    .slice(0, 8);
  const openTab = (id: Tab) => {
    setTab(id);
    setPanelOpen(true);
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Itaqui Digital início">
          <span className="brand-symbol">
            <Waves size={26} />
          </span>
          <span>
            itaqui<span className="brand-light">digital</span>
            <small>MAPA E OPERAÇÕES DO PORTO</small>
          </span>
        </a>
        <div className="header-location">
          <MapPin size={16} />
          <span>
            Porto do Itaqui <span className="muted">/ São Luís, MA</span>
          </span>
        </div>
        <div className="header-right">
          <span className="prototype-badge">
            MAPA DO PORTO <span>β</span>
          </span>
          <span className="clock">
            {time || "--:--:--"} <small>BRT</small>
          </span>
          <button
            className="icon-button"
            title="Como navegar"
            aria-label="Como navegar"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={19} />
          </button>
          <span className="emap-mark">
            EMAP<small>PORTO DO ITAQUI</small>
          </span>
        </div>
      </header>
      <div className="workspace">
        <nav className="nav-rail" aria-label="Navegação principal">
          <div>
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`rail-button ${tab === n.id && panelOpen ? "active" : ""}`}
                onClick={() => openTab(n.id)}
                title={n.label}
                aria-label={n.label}
                aria-pressed={tab === n.id && panelOpen}
              >
                <n.icon size={22} />
                <span>{n.label}</span>
              </button>
            ))}
          </div>
          <button
            className="rail-button rail-help"
            onClick={() => setHelp(true)}
            title="Ajuda"
            aria-label="Ajuda"
          >
            <HelpCircle size={21} />
          </button>
        </nav>
        <aside
          className={`side-panel ${panelOpen ? "open" : ""}`}
          aria-label="Informações do porto"
        >
          <div className="panel-heading">
            <span>
              <span className="tiny-dot" /> BAÍA DE SÃO MARCOS
            </span>
            <button
              className="icon-button"
              aria-label="Recolher painel"
              onClick={() => setPanelOpen(false)}
            >
              <ArrowLeft size={17} />
            </button>
          </div>
          <div className="panel-scroll">
            {tab === "overview" && (
              <>
                <div className="overview-intro">
                  <div className="eyebrow">BEM-VINDO A BORDO</div>
                  <h1>
                    Um novo olhar
                    <br />
                    sobre o <em>Itaqui.</em>
                  </h1>
                  <p>
                    Explore a infraestrutura e acompanhe o movimento de um porto
                    que conecta o Brasil ao mundo.
                  </p>
                  <div className="location-caption">
                    <MapPin size={13} /> São Luís, Maranhão{" "}
                    <span>02°34′ S · 44°22′ W</span>
                  </div>
                </div>
                <div className="port-stats">
                  <div>
                    <span className="stat-icon">
                      <Anchor size={18} />
                    </span>
                    <strong>09</strong>
                    <span>berços operacionais</span>
                  </div>
                  <div>
                    <span className="stat-icon">
                      <Waves size={18} />
                    </span>
                    <strong>23 m</strong>
                    <span>profundidade do canal</span>
                  </div>
                </div>
                <WeatherPanel
                  data={weather.data}
                  error={weather.error}
                  onRetry={() => weather.mutate()}
                  compact
                />
                <section className="movement-section">
                  <div className="section-heading">
                    <h2>Movimento no porto</h2>
                    <button
                      className="text-button"
                      onClick={() => openTab("vessels")}
                    >
                      Ver todos <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="movement-summary">
                    <span className="tiny-dot" />
                    <span>
                      {port.isLoading
                        ? "Consultando programação"
                        : `${berthed.length} atracados com registro recente`}
                    </span>
                    <span className="source-chip">EMAP</span>
                  </div>
                  <VesselList
                    vessels={vessels}
                    compact
                    loading={port.isLoading}
                    onSelect={(v) => select({ type: "vessel", vessel: v })}
                  />
                </section>
                <p className="sidebar-disclaimer">
                  Protótipo independente. As posições por berço são aproximadas.
                  Consulte a data e a origem de cada registro.
                </p>
              </>
            )}
            {tab === "vessels" && (
              <>
                <div className="section-intro">
                  <div className="eyebrow">PORTO AGORA</div>
                  <h1>Navios e operações</h1>
                  <p>
                    Programação oficial e embarcações na Baía de São Marcos.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      send("region");
                      setSelection(null);
                      if (window.matchMedia("(max-width: 760px)").matches)
                        setPanelOpen(false);
                    }}
                  >
                    <Radio size={16} /> Ver baía e fundeadouros{" "}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                <VesselList
                  vessels={vessels}
                  loading={port.isLoading}
                  ais={ais.data}
                  onSelect={(v) => select({ type: "vessel", vessel: v })}
                />
                {port.error && (
                  <p className="detail-note">
                    Consulta indisponível.{" "}
                    <button
                      className="text-button"
                      onClick={() => port.mutate()}
                    >
                      Tentar novamente
                    </button>
                  </p>
                )}
              </>
            )}
            {tab === "structures" && (
              <>
                <div className="section-intro">
                  <div className="eyebrow">CADA DETALHE, UMA CONEXÃO</div>
                  <h1>Infraestrutura</h1>
                  <p>
                    Navegue entre os berços, terminais e áreas de armazenagem.
                  </p>
                </div>
                <div className="infrastructure-facts">
                  <div>
                    <b>23 m</b>
                    <span>profundidade do canal</span>
                  </div>
                  <div>
                    <b>101 km</b>
                    <span>canal de acesso</span>
                  </div>
                </div>
                <CartographyPanel
                  data={cartography.data}
                  error={cartography.error}
                  onRetry={() => cartography.mutate()}
                  onSelect={(feature) =>
                    select({ type: "cartography", feature })
                  }
                />
                <h2 className="list-heading">
                  Berços de atracação <span>09</span>
                </h2>
                {BERTHS.map((b) => (
                  <button
                    className="structure-row"
                    key={b.id}
                    onClick={() => select({ type: "place", place: b })}
                  >
                    <span className="berth-number">
                      {b.id.padStart(3, "0")}
                    </span>
                    <span>
                      <b>{b.name}</b>
                      <small>
                        {b.length} m de comprimento · {b.depth} m de
                        profundidade
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                <h2 className="list-heading">Terminais e estruturas</h2>
                {PLACES.filter((p) => p.category !== "berth").map((p) => (
                  <button
                    key={p.id}
                    className="structure-row"
                    onClick={() => select({ type: "place", place: p })}
                  >
                    <Box size={20} />
                    <span>
                      <b>{p.name}</b>
                      <small>Localizar no mapa</small>
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
                <p className="source-note">
                  Características dos berços: tabela EMAP de 2023. Consulte a
                  autoridade portuária para limites vigentes.
                </p>
              </>
            )}
            {tab === "weather" && (
              <>
                <div className="section-intro">
                  <div className="eyebrow">OLHOS NO HORIZONTE</div>
                  <h1>Clima no Itaqui</h1>
                  <p>Condições atuais e previsão para a região do porto.</p>
                </div>
                <WeatherPanel
                  data={weather.data}
                  error={weather.error}
                  onRetry={() => weather.mutate()}
                />
                <div className="connection-note">
                  <Waves size={22} />
                  <div>
                    <b>Marés e condições de navegação</b>
                    <p>
                      Consulte a previsão de nível do mar e correntes, ou a
                      tábua oficial no painel de fontes.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => openTab("marine")}
                    >
                      Ver marés e correntes <ArrowUpRight size={15} />
                    </button>
                  </div>
                </div>
              </>
            )}
            {tab === "marine" && (
              <>
                <div className="section-intro">
                  <div className="eyebrow">BAÍA DE SÃO MARCOS</div>
                  <h1>Marés e condições do mar</h1>
                  <p>
                    Previsão de nível do mar, correntes e temperatura da água
                    para a região do porto.
                  </p>
                </div>
                <MarinePanel
                  data={marine.data}
                  error={marine.error}
                  onRetry={() => marine.mutate()}
                />
                <button
                  className="text-button"
                  onClick={() => openTab("sources")}
                >
                  Consultar tábua oficial de marés <ArrowUpRight size={15} />
                </button>
              </>
            )}
            {tab === "sources" && (
              <>
                <div className="section-intro">
                  <div className="eyebrow">INFORMAÇÃO COM ORIGEM</div>
                  <h1>Fontes e conexões</h1>
                  <p>Saiba de onde vêm os dados e quando foram consultados.</p>
                </div>
                <div className="data-source">
                  <span className="tiny-dot" />
                  <div>
                    <b>Programação EMAP</b>
                    <p>
                      {port.data?.stale
                        ? "Consulta arquivada, fonte indisponível"
                        : port.data
                          ? `Consultada às ${localTime(port.data.fetchedAt)} BRT · atualização a cada 5 min`
                          : "Aguardando consulta"}
                    </p>
                    <small>
                      A página inicial e a tabela detalhada podem divergir.
                      Usamos os registros da tabela, com a data de cada navio.
                    </small>
                  </div>
                </div>
                <div className="data-source">
                  <span
                    className={`tiny-dot ${!ais.data?.configured ? "inactive" : ""}`}
                  />
                  <div>
                    <b>AISStream</b>
                    <p>
                      {ais.data?.configured
                        ? `Estado: ${ais.data.state}`
                        : "Aguardando configuração da chave no servidor"}
                    </p>
                    <small>
                      Integração preparada. Posições envelhecem após 15 minutos
                      e são removidas. A cobertura local depende das estações do
                      provedor.
                    </small>
                    <a
                      className="text-button"
                      href="https://aisstream.io/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Obter acesso ao AISStream <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
                <div className="data-source">
                  <span className="tiny-dot" />
                  <div>
                    <b>Marés e condições do mar</b>
                    <p>Open-Meteo Marine · Météo-France / Copernicus</p>
                    <small>
                      Nível do mar com marés, correntes e temperatura da água.
                      Previsão regional relativa ao nível médio global (MSL),
                      com célula próxima ao porto.
                    </small>
                    <a
                      className="text-button"
                      href="https://open-meteo.com/en/docs/marine-weather-api"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Consultar a API <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
                <div className="data-source">
                  <span className="tiny-dot" />
                  <div>
                    <b>Cartografia detalhada</b>
                    <p>Esri World Imagery + OpenStreetMap</p>
                    <small>
                      {cartography.data?.features.length.toLocaleString(
                        "pt-BR",
                      ) ?? "—"}{" "}
                      elementos OSM dentro do recorte do Porto do Itaqui.{" "}
                      {cartographyMeta.data
                        ? `Consulta de ${new Date(cartographyMeta.data.fetchedAt).toLocaleDateString("pt-BR")}. `
                        : ""}
                      Contornos e atributos colaborativos. Imagens de satélite
                      históricas; centros dos berços aproximados.
                    </small>
                  </div>
                </div>
                <div className="data-source">
                  <span className="tiny-dot" />
                  <div>
                    <b>Modelos das embarcações</b>
                    <p>Kenney Watercraft Kit · CC0</p>
                    <small>
                      Formas ilustrativas por carga, sem reproduzir o navio
                      real. Comprimento conforme a fonte quando disponível;
                      demais proporções simbólicas.
                    </small>
                    <a
                      className="text-button"
                      href="https://kenney.nl/assets/watercraft-kit"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver modelos e licença <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
                <h2 className="list-heading">Documentos do porto</h2>
                {[...(port.data?.links || []), ...OFFICIAL_LINKS].map((l) => (
                  <a
                    key={l.url}
                    className="source-link"
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{l.label}</span>
                    <ArrowUpRight size={16} />
                  </a>
                ))}
              </>
            )}
          </div>
          <footer className="panel-footer">
            <span className="tiny-dot" />
            <span>
              {ais.data?.configured
                ? "Integração AIS habilitada"
                : "Programação EMAP · AIS não conectado"}
            </span>
            <button
              className="icon-button"
              aria-label="Atualizar dados"
              onClick={() => {
                port.mutate();
                weather.mutate();
                marine.mutate();
                ais.mutate();
              }}
            >
              <RefreshCw
                size={14}
                className={port.isValidating ? "spin" : ""}
              />
            </button>
          </footer>
        </aside>
        <section className="map-region" aria-label="Explorador geográfico">
          <PortMap
            layers={layers}
            cartography={cartography.data}
            selectedFeatureId={
              selection?.type === "cartography"
                ? selection.feature.properties.id
                : undefined
            }
            basemap={basemap}
            vessels={vessels}
            command={command}
            onSelect={select}
            onReady={onReady}
          />
          <div className="map-vignette" />
          <div className="map-top-controls">
            {!panelOpen && (
              <button
                className="glass icon-button panel-toggle"
                aria-label="Abrir painel"
                onClick={() => setPanelOpen(true)}
              >
                <Menu size={20} />
              </button>
            )}
            <div className="map-search glass">
              <Search size={18} />
              <input
                ref={searchRef}
                aria-label="Buscar navio, edifício, via ou área"
                placeholder="Buscar navio, edifício, via ou área"
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults[0])
                    select(searchResults[0].selection);
                }}
              />
              <kbd>⌘ K</kbd>
              {searchOpen && (
                <div className="search-results glass">
                  <div className="search-label">
                    {query ? "RESULTADOS" : "EXPLORE O PORTO"}
                    <button
                      className="icon-button"
                      aria-label="Fechar busca"
                      onClick={() => setSearchOpen(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {searchResults.length ? (
                    searchResults.map((r, i) => (
                      <button key={i} onClick={() => select(r.selection)}>
                        <MapPin size={17} />
                        <span>
                          <b>{r.label}</b>
                          <small>{r.sub}</small>
                        </span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))
                  ) : (
                    <p>Nenhum resultado para “{query}”.</p>
                  )}
                </div>
              )}
            </div>
            <div className="map-view-badge glass">
              <span className="tiny-dot" />
              {ready ? "MAPA 2D" : "CARREGANDO"}
            </div>
          </div>
          <div className="map-title">
            <span>
              BRASIL <span>/</span> MARANHÃO
            </span>
            <h2>Porto do Itaqui</h2>
            <p>Uma nova perspectiva. O mesmo horizonte.</p>
          </div>
          <div className="map-right-controls">
            <div className="control-group glass">
              <button aria-label="Aumentar zoom" onClick={() => send("zoomIn")}>
                <Plus size={20} />
              </button>
              <button
                aria-label="Diminuir zoom"
                onClick={() => send("zoomOut")}
              >
                <Minus size={20} />
              </button>
            </div>
            <div className="control-group glass">
              <button
                aria-label="Centralizar no porto"
                onClick={() => {
                  send("home");
                  setSelection(null);
                }}
              >
                <MapPin size={19} />
              </button>
              <button
                aria-label="Ver navios nos arredores"
                title="Baía e arredores"
                onClick={() => {
                  send("region");
                  setSelection(null);
                }}
              >
                <Radio size={19} />
              </button>
              <button
                aria-label="Tela cheia"
                onClick={() => {
                  if (document.fullscreenElement) document.exitFullscreen();
                  else
                    document.documentElement
                      .requestFullscreen?.()
                      .catch(() => setHelp(true));
                }}
              >
                <Maximize size={18} />
              </button>
            </div>
          </div>
          {selection && (
            <SelectionCard
              selection={selection}
              onClose={() => setSelection(null)}
              onFocus={(c) => send("fly", { coordinates: c, zoom: 18.3 })}
            />
          )}
          {layersOpen && (
            <section className="layers-popover glass">
              <div className="section-heading">
                <h2>Camadas do mapa</h2>
                <button
                  className="icon-button"
                  aria-label="Fechar camadas"
                  onClick={() => setLayersOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="muted">Contornos OSM e embarcações.</p>
              {(
                [
                  ["buildings", "Edifícios e tanques"],
                  ["roads", "Vias e acessos"],
                  ["railways", "Ferrovias"],
                  ["areas", "Áreas, cais e costa"],
                  ["vessels", "Navios e posições"],
                  ["berths", "Identificação dos berços"],
                  ["labels", "Terminais e acessos"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="layer-switch">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={() =>
                      setLayers((l) => ({ ...l, [key]: !l[key] }))
                    }
                  />
                  <span className="switch-track" />
                </label>
              ))}
            </section>
          )}
          <div className="map-bottom">
            <div className="view-toolbar glass">
              <button
                className={basemap === "satellite" ? "active" : ""}
                onClick={() => setBasemap("satellite")}
              >
                <span className="satellite-thumb" />
                Satélite
              </button>
              <button
                className={basemap === "street" ? "active" : ""}
                onClick={() => setBasemap("street")}
              >
                <Map size={17} />
                Mapa
              </button>
              <span className="toolbar-divider" />
              <button
                className={layersOpen ? "active" : ""}
                aria-expanded={layersOpen}
                onClick={() => setLayersOpen((v) => !v)}
              >
                <Layers3 size={17} />
                Camadas <ChevronDown size={13} />
              </button>
            </div>
          </div>
          <div className="map-footnote">
            <span>
              <MapPin size={12} /> Posições por berço aproximadas
            </span>
            <button onClick={() => setHelp(true)}>
              Como navegar <HelpCircle size={12} />
            </button>
          </div>
        </section>
      </div>
      <dialog
        ref={dialog}
        className="help-dialog"
        onClose={() => setHelp(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setHelp(false);
        }}
      >
        <div className="dialog-top">
          <span className="brand-symbol">
            <Compass size={26} />
          </span>
          <button
            className="icon-button"
            aria-label="Fechar ajuda"
            onClick={() => setHelp(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="eyebrow">O PORTO ESTÁ NAS SUAS MÃOS</div>
        <h2>Explore o Porto do Itaqui.</h2>
        <p>Encontre terminais, berços e informações dos navios.</p>
        <div className="help-rows">
          <div>
            <Navigation size={21} />
            <span>
              <b>Mover pelo mapa</b>Arraste com o botão esquerdo ou um dedo.
            </span>
          </div>
          <div>
            <Plus size={21} />
            <span>
              <b>Aproximar e afastar</b>Use a rolagem, o gesto de pinça ou os
              botões + e −.
            </span>
          </div>
          <div>
            <MapPin size={21} />
            <span>
              <b>Consultar um local</b>Clique nos edifícios, vias, áreas ou
              marcadores. Use a busca para chegar mais rápido.
            </span>
          </div>
        </div>
        <p className="detail-note">
          As posições por berço são aproximadas. A programação EMAP não
          representa posições AIS. Consulte “Fontes e dados” para ver a origem e
          as limitações.
        </p>
        <button className="primary-button" onClick={() => setHelp(false)}>
          Vamos explorar <ArrowUpRight size={18} />
        </button>
      </dialog>
    </main>
  );
}
