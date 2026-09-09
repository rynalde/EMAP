import type { Vessel } from "./types";
export type VesselModelKind = "bulk" | "tanker" | "cargo" | "tug" | "generic";

export const MODEL_CATALOG = {
  bulk: {
    label: "Graneleiro",
    asset: "ship-cargo-b.glb",
    length: 200,
    beamRatio: 0.17,
  },
  tanker: { label: "Navio-tanque", asset: null, length: 200, beamRatio: 0.18 },
  cargo: {
    label: "Cargueiro",
    asset: "ship-cargo-a.glb",
    length: 180,
    beamRatio: 0.17,
  },
  tug: {
    label: "Rebocador",
    asset: "boat-tug-a.glb",
    length: 32,
    beamRatio: 0.32,
  },
  generic: {
    label: "Embarcação genérica",
    asset: "ship-cargo-c.glb",
    length: 100,
    beamRatio: 0.18,
  },
} as const;

/** The cargo suggests an illustration, never a verified vessel class or actual appearance. */
export function getVesselModelInfo(vessel: Vessel) {
  const cargo = (vessel.cargo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let kind: VesselModelKind = "generic";
  if (/rebocad|\btug\b/.test(cargo)) kind = "tug";
  else if (
    /diesel|gasolina|petroleo|combustivel|etanol|alcool|nafta|\bglp\b|liquido|fuel|oil|quimic|soda caustica/.test(
      cargo,
    )
  )
    kind = "tanker";
  else if (
    /soja|milho|farelo|fertiliz|adubo|grao|trigo|carvao|minerio|ferro|manganes|cobre|cloreto|ureia|granel|bauxita|coque/.test(
      cargo,
    )
  )
    kind = "bulk";
  else if (
    /conteiner|container|carga geral|celulose|siderurg|trilho|aco|bobina/.test(
      cargo,
    )
  )
    kind = "cargo";
  const model = MODEL_CATALOG[kind];
  const reportedLength =
    typeof vessel.length === "number" &&
    Number.isFinite(vessel.length) &&
    vessel.length > 0 &&
    vessel.length <= 500;
  const headingKnown =
    typeof vessel.heading === "number" &&
    Number.isFinite(vessel.heading) &&
    vessel.heading >= 0 &&
    vessel.heading < 360;
  return {
    kind,
    label: model.label,
    inferredFromCargo: kind !== "generic",
    lengthMeters: reportedLength ? vessel.length! : model.length,
    lengthSource: reportedLength
      ? ("reported" as const)
      : ("symbolic" as const),
    headingDegrees: headingKnown ? vessel.heading! : 0,
    headingKnown,
    asset: model.asset ? `/models/kenney-watercraft/${model.asset}` : null,
  };
}

export function hasVesselModelPosition(
  vessel: Vessel,
): vessel is Vessel & { coordinates: [number, number] } {
  const p = vessel.coordinates;
  return (
    !vessel.stale &&
    vessel.positionSource !== "none" &&
    !!p &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    Math.abs(p[1]) <= 85.051129
  );
}
