"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowLeft,
  Home,
  Info,
  RotateCw,
  Ship,
  Tag,
  Waves,
  X,
} from "lucide-react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { BERTHS, localTime } from "@/lib/port-data";
import type { PortData } from "@/lib/types";
import type { PortSceneController, SceneSelection } from "@/lib/port3d/scene";

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw Error("Não foi possível consultar os dados");
  return r.json();
};

const JUMPS = [
  ...BERTHS.map((b) => ({ id: b.id, label: b.id })),
  { id: "tegram", label: "TEGRAM" },
  { id: "liquidos", label: "Tancagem" },
];

const dateTime = (value?: string) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export function Port3DView() {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<PortSceneController | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selection, setSelection] = useState<SceneSelection | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [labels, setLabels] = useState(true);
  const [illustrative, setIllustrative] = useState(false);
  const [berthed, setBerthed] = useState<number | null>(null);
  const [showNote, setShowNote] = useState(false);

  const boundary = useSWR<Feature<Geometry>>(
    "/data/port-boundary.geojson",
    fetcher,
    { revalidateOnFocus: false },
  );
  const cartography = useSWR<FeatureCollection<Geometry>>(
    "/data/port-cartography.geojson?scope=itaqui",
    fetcher,
    { revalidateOnFocus: false },
  );
  const port = useSWR<PortData>("/api/port", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });

  // Monta a cena quando a geometria do porto estiver disponível.
  useEffect(() => {
    if (!host.current || !boundary.data || !cartography.data) return;
    let disposed = false;
    Promise.all([
      import("@/lib/port3d/scene"),
      // Sem a cobertura do solo a cena ainda abre, só com o entorno em cor padrão.
      import("@/lib/port3d/terrain")
        .then(({ loadLandCover }) =>
          loadLandCover(
            "/data/port-landcover.png",
            "/data/port-landcover-meta.json",
          ),
        )
        .catch(() => null),
    ])
      .then(([{ createPortScene }, landcover]) => {
        if (disposed || !host.current) return;
        try {
          controller.current = createPortScene(
            host.current,
            {
              boundary: boundary.data!,
              cartography: cartography.data!,
              landcover,
            },
            { onSelect: setSelection },
          );
          setState("ready");
        } catch (e) {
          console.error(e);
          setState("error");
        }
      })
      .catch(() => setState("error"));
    return () => {
      disposed = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, [boundary.data, cartography.data]);

  // A nota começa aberta só em telas largas, onde não cobre a cena.
  useEffect(() => {
    setShowNote(window.matchMedia("(min-width: 761px)").matches);
  }, []);

  useEffect(() => {
    if (boundary.error || cartography.error) setState("error");
  }, [boundary.error, cartography.error]);

  useEffect(() => {
    if (state !== "ready" || !controller.current) return;
    setBerthed(
      controller.current.setVessels(port.data?.vessels ?? [], illustrative),
    );
    setSelection(null);
  }, [state, port.data, illustrative]);

  useEffect(
    () => controller.current?.setAutoRotate(autoRotate),
    [autoRotate, state],
  );
  useEffect(() => controller.current?.setLabels(labels), [labels, state]);

  const focus = (id: string) => {
    controller.current?.focus(id);
    setSelection(null);
  };

  const status = port.error
    ? "Programação EMAP indisponível; navios ocultos."
    : !port.data || berthed === null
      ? "Consultando a programação EMAP…"
      : port.data.stale
        ? "Programação arquivada; navios ocultos."
        : `${berthed} ${berthed === 1 ? "navio atracado" : "navios atracados"} · EMAP ${localTime(port.data.fetchedAt)}`;

  return (
    <main className="p3d-shell">
      <div
        ref={host}
        className="p3d-stage"
        aria-label="Vista 3D do Porto do Itaqui"
        role="img"
      />
      {state !== "ready" && (
        <div className="p3d-loading" role="status">
          {state === "error" ? (
            <>
              Não foi possível montar a vista 3D. Verifique se o navegador
              suporta WebGL.
            </>
          ) : (
            <>
              <span className="loading-spinner" />
              Construindo o porto em 3D…
            </>
          )}
        </div>
      )}

      <header className="p3d-top">
        <a className="p3d-back" href="/" title="Voltar ao mapa 2D">
          <ArrowLeft size={18} />
          <span>Mapa 2D</span>
        </a>
        <div className="p3d-title">
          <span className="brand-symbol">
            <Waves size={22} />
          </span>
          <div>
            <strong>
              Porto do Itaqui <span className="brand-light">3D</span>
            </strong>
            <small>REPRESENTAÇÃO LOW-POLY</small>
          </div>
        </div>
        <span className="p3d-status" aria-live="polite">
          <span className="tiny-dot" /> {status}
        </span>
      </header>

      <div
        className="p3d-controls"
        role="toolbar"
        aria-label="Controles da vista 3D"
      >
        <button
          className="p3d-tool"
          onClick={() => focus("home")}
          title="Vista inicial"
          aria-label="Vista inicial"
        >
          <Home size={19} />
        </button>
        <button
          className={`p3d-tool ${autoRotate ? "active" : ""}`}
          onClick={() => setAutoRotate((v) => !v)}
          title="Girar automaticamente"
          aria-label="Girar automaticamente"
          aria-pressed={autoRotate}
        >
          <RotateCw size={19} />
        </button>
        <button
          className={`p3d-tool ${labels ? "active" : ""}`}
          onClick={() => setLabels((v) => !v)}
          title="Rótulos"
          aria-label="Rótulos"
          aria-pressed={labels}
        >
          <Tag size={19} />
        </button>
        <button
          className={`p3d-tool ${illustrative ? "active" : ""}`}
          onClick={() => setIllustrative((v) => !v)}
          title="Preencher berços livres com navios ilustrativos"
          aria-label="Navios ilustrativos nos berços livres"
          aria-pressed={illustrative}
        >
          <Ship size={19} />
        </button>
        <button
          className={`p3d-tool ${showNote ? "active" : ""}`}
          onClick={() => setShowNote((v) => !v)}
          title="Sobre esta vista"
          aria-label="Sobre esta vista"
          aria-pressed={showNote}
        >
          <Info size={19} />
        </button>
      </div>

      <nav className="p3d-jump" aria-label="Ir para">
        <span>Ir para</span>
        {JUMPS.map((j) => (
          <button key={j.id} onClick={() => focus(j.id)}>
            {j.label}
          </button>
        ))}
      </nav>

      {selection && (
        <aside className="p3d-card" aria-label="Detalhes">
          <button
            className="icon-button p3d-close"
            onClick={() => setSelection(null)}
            aria-label="Fechar detalhes"
          >
            <X size={18} />
          </button>
          <SelectionDetails selection={selection} />
        </aside>
      )}

      {showNote && !selection && (
        <p className="p3d-note">
          Litoral, perímetro, vias e ferrovias do OpenStreetMap; vegetação e
          manguezais do ESA WorldCover; tanques, armazéns, correias e píeres
          posicionados por imagem de satélite de 2023; berços e navios atracados
          da EMAP. Guindastes, veículos e modelos dos navios são ilustrativos.
          Arraste para girar, role para aproximar e clique nos navios.
        </p>
      )}
    </main>
  );
}

function SelectionDetails({ selection }: { selection: SceneSelection }) {
  if (selection.type === "place")
    return (
      <>
        <div className="eyebrow">ESTRUTURA</div>
        <h2>{selection.place.name}</h2>
        <p>{selection.place.description}</p>
      </>
    );
  if (selection.type === "berth") {
    const { berth, vessel } = selection;
    return (
      <>
        <div className="eyebrow">BERÇO</div>
        <h2>{berth.name}</h2>
        <dl>
          <dt>Comprimento</dt>
          <dd>{berth.length} m</dd>
          <dt>Profundidade</dt>
          <dd>{berth.depth ? `${berth.depth} m` : "—"}</dd>
          <dt>Ocupação</dt>
          <dd>{vessel ? vessel.name : "Sem navio atracado na programação"}</dd>
        </dl>
        <p className="p3d-small">
          Características de referência da EMAP (2023).
        </p>
      </>
    );
  }
  if (selection.type === "illustrative")
    return (
      <>
        <div className="eyebrow">NAVIO ILUSTRATIVO</div>
        <h2>{selection.modelLabel}</h2>
        <p>
          {selection.berth.name} está livre na programação. Este navio só
          ilustra o uso típico do berço e não representa uma embarcação real.
        </p>
      </>
    );
  const { vessel, berth, modelLabel, lengthSource } = selection;
  return (
    <>
      <div className="eyebrow">NAVIO ATRACADO · {berth.name.toUpperCase()}</div>
      <h2>{vessel.name}</h2>
      <dl>
        <dt>Carga</dt>
        <dd>{vessel.cargo || "—"}</dd>
        <dt>Comprimento</dt>
        <dd>
          {vessel.length ? `${vessel.length} m` : "—"}
          {lengthSource === "symbolic" ? " (modelo em escala simbólica)" : ""}
        </dd>
        {vessel.agency && (
          <>
            <dt>Agência</dt>
            <dd>{vessel.agency}</dd>
          </>
        )}
        <dt>Registro EMAP</dt>
        <dd>{dateTime(vessel.updatedAt)}</dd>
      </dl>
      <p className="p3d-small">
        Modelo 3D: {modelLabel.toLowerCase()} ilustrativo, inferido da carga.
        Não reproduz a aparência real do navio.
      </p>
    </>
  );
}
