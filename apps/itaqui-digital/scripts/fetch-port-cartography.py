#!/usr/bin/env python3
"""Refresh the Itaqui OSM snapshot (Python + Shapely; no API key).

Usage: python3 scripts/fetch-port-cartography.py
Optional: --input /path/to/overpass.json to rebuild an already downloaded response.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
import urllib.parse
import urllib.request
from port_boundary import restrict_to_port, BOUNDARY_ID

ROOT = Path(__file__).resolve().parent.parent
BBOX = [-44.375, -2.586, -44.359, -2.566]
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
RADIUS = 6371008.8
FILTERS = [
    'nwr["building"]',
    'nwr["man_made"~"^(storage_tank|silo|pier|quay|works|wastewater_plant)$"]',
    'way["highway"]',
    'way["railway"]',
    'nwr["landuse"~"^(industrial|commercial|retail|railway|port|storage|forest|grass|construction|brownfield|residential)$"]',
    'nwr["natural"~"^(water|wetland|wood|scrub|beach|coastline)$"]',
    'way["waterway"]',
    'nwr["amenity"="parking"]',
    'nwr["power"~"^(substation|plant)$"]',
    'nwr["industrial"]',
    'nwr["harbour"="yes"]',
]
query_bbox = f"({BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]})"
QUERY = "[out:json][timeout:90];(relation(10189309);" + "".join(f"{f}{query_bbox};" for f in FILTERS) + ");out body geom;"


def classification(tags):
    made = tags.get("man_made", "")
    if made in ("pier", "quay"):
        return "pier", made
    if made in ("storage_tank", "silo"):
        return "building", made
    if tags.get("building") not in (None, "no"):
        return "building", tags["building"]
    if "railway" in tags:
        return "railway", tags["railway"]
    if "highway" in tags:
        return "road", tags["highway"]
    if tags.get("natural") in ("water", "coastline") or "waterway" in tags:
        return "water", tags.get("waterway", tags.get("natural"))
    for key in ("landuse", "natural", "amenity", "industrial", "power", "man_made", "harbour"):
        if key in tags:
            return "area", tags[key]
    return None, None


def fallback_name(category, kind):
    names = {
        "storage_tank": "Tanque de armazenamento", "silo": "Silo",
        "warehouse": "Armazém", "roof": "Cobertura", "office": "Edifício de escritórios",
        "industrial": "Área industrial" if category == "area" else "Edificação industrial",
        "commercial": "Área comercial", "retail": "Área de comércio",
        "service": "Via de serviço", "residential": "Área residencial" if category == "area" else "Rua residencial",
        "unclassified": "Via local", "track": "Caminho de acesso", "footway": "Caminho de pedestres",
        "path": "Trilha", "primary": "Via principal", "secondary": "Via secundária",
        "tertiary": "Via coletora", "trunk": "Via expressa", "motorway": "Rodovia",
        "pier": "Píer", "quay": "Cais", "rail": "Linha ferroviária",
        "parking": "Estacionamento", "substation": "Subestação", "plant": "Instalação de energia",
        "forest": "Área florestal", "wood": "Vegetação arbórea", "scrub": "Vegetação arbustiva",
        "grass": "Área gramada", "wetland": "Área úmida", "beach": "Praia",
        "coastline": "Linha de costa", "water": "Corpo d’água", "stream": "Curso d’água",
        "drain": "Canal de drenagem", "ditch": "Vala de drenagem", "river": "Rio",
        "port": "Área portuária", "storage": "Área de armazenamento", "construction": "Área em construção",
        "brownfield": "Terreno industrial", "works": "Instalação industrial",
    }
    generic = {"building": "Edificação", "road": "Via mapeada", "railway": "Infraestrutura ferroviária", "area": "Área mapeada", "pier": "Estrutura de atracação", "water": "Hidrografia"}
    return names.get(kind, generic[category])


def coordinates(geometry):
    return [[p["lon"], p["lat"]] for p in geometry if p and "lon" in p and "lat" in p]


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def orient(ring, outer=True):
    return ring if (signed_area(ring) > 0) == outer else list(reversed(ring))


def join_rings(parts):
    """Join connected OSM member ways; never close an incomplete ring artificially."""
    remaining = [p[:] for p in parts if len(p) >= 2]
    rings = []
    while remaining:
        ring = remaining.pop()
        while ring[0] != ring[-1]:
            match = None
            for index, part in enumerate(remaining):
                if ring[-1] == part[0]:
                    ring.extend(part[1:])
                elif ring[-1] == part[-1]:
                    ring.extend(reversed(part[:-1]))
                elif ring[0] == part[-1]:
                    ring = part[:-1] + ring
                elif ring[0] == part[0]:
                    ring = list(reversed(part[1:])) + ring
                else:
                    continue
                match = index
                break
            if match is None:
                break
            remaining.pop(match)
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def contains(ring, point):
    inside = False
    x, y = point
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def geometry_for(element, category):
    if element["type"] == "node":
        return {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
    if element["type"] == "way":
        points = coordinates(element.get("geometry", []))
        if len(points) < 2:
            return None
        tags = element.get("tags", {})
        is_polygon = len(points) >= 4 and points[0] == points[-1] and (
            category in ("building", "area", "pier") or tags.get("area") == "yes" or tags.get("natural") == "water"
        ) and tags.get("area") != "no"
        return {"type": "Polygon", "coordinates": [orient(points)]} if is_polygon else {"type": "LineString", "coordinates": points}
    if element.get("tags", {}).get("type") not in ("multipolygon", "boundary"):
        return None
    members = element.get("members", [])
    outers = join_rings([coordinates(m.get("geometry", [])) for m in members if m.get("role", "") in ("outer", "") and m["type"] == "way"])
    inners = join_rings([coordinates(m.get("geometry", [])) for m in members if m.get("role") == "inner" and m["type"] == "way"])
    if not outers:
        return None
    polygons = [[orient(outer)] for outer in outers]
    for inner in inners:
        candidates = [(abs(signed_area(poly[0])), poly) for poly in polygons if contains(poly[0], inner[0])]
        if candidates:
            min(candidates, key=lambda item: item[0])[1].append(orient(inner, False))
    return {"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1 else {"type": "MultiPolygon", "coordinates": polygons}


def line_length(points):
    total = 0
    for a, b in zip(points, points[1:]):
        lat_a, lat_b = math.radians(a[1]), math.radians(b[1])
        d_lat, d_lon = lat_b - lat_a, math.radians(b[0] - a[0])
        h = math.sin(d_lat / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(d_lon / 2) ** 2
        total += 2 * RADIUS * math.asin(min(1, math.sqrt(h)))
    return round(total, 1)


def ring_area(ring):
    return abs(sum(math.radians(b[0] - a[0]) * (math.sin(math.radians(a[1])) + math.sin(math.radians(b[1]))) for a, b in zip(ring, ring[1:]))) * RADIUS ** 2 / 2


def measurements(geometry):
    if geometry["type"] == "LineString":
        return {"lengthM": line_length(geometry["coordinates"])}
    if geometry["type"] == "MultiLineString":
        return {"lengthM": round(sum(line_length(line) for line in geometry["coordinates"]), 1)}
    if geometry["type"] in ("Polygon", "MultiPolygon"):
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        return {"areaM2": round(sum(ring_area(poly[0]) - sum(ring_area(hole) for hole in poly[1:]) for poly in polygons), 1)}
    return {}


def download():
    for endpoint in ENDPOINTS:
        try:
            request = urllib.request.Request(endpoint, data=urllib.parse.urlencode({"data": QUERY}).encode(), headers={"User-Agent": "ItaquiDigitalPrototype/0.1 (OpenStreetMap cartography snapshot)", "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.load(response)
            if "remark" in payload:
                raise RuntimeError(payload["remark"])
            return payload, endpoint
        except Exception as error:
            print(f"Overpass request failed at {endpoint}: {error}", file=sys.stderr)
    raise SystemExit("No complete Overpass response; existing snapshot was left unchanged.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    args = parser.parse_args()
    payload, endpoint = (json.loads(args.input.read_text()), "local Overpass response") if args.input else download()
    features, skipped = [], Counter()
    for element in payload["elements"]:
        tags = element.get("tags", {})
        category, kind = classification(tags)
        if not category:
            skipped["unclassified"] += 1
            continue
        geometry = geometry_for(element, category)
        if not geometry:
            skipped["unsupportedOrIncompleteGeometry"] += 1
            continue
        identity = f"osm-{element['type']}-{element['id']}"
        actual_name = tags.get("name:pt") or tags.get("name")
        properties = {**tags, "id": identity, "osmType": element["type"], "osmId": str(element["id"]), "name": actual_name or fallback_name(category, kind), "named": bool(actual_name), "category": category, "kind": kind, "source": "OpenStreetMap", "sourceUrl": f"https://www.openstreetmap.org/{element['type']}/{element['id']}", "tags": json.dumps(tags, ensure_ascii=False, separators=(",", ":")), **measurements(geometry)}
        if "building:levels" in tags:
            properties["levels"] = tags["building:levels"]
        features.append({"type": "Feature", "id": identity, "geometry": geometry, "properties": properties})
    if not features:
        raise SystemExit("No valid features; existing snapshot was left unchanged.")
    features, boundary_feature = restrict_to_port(features)
    for feature in features:
        feature["properties"].pop("areaM2", None)
        feature["properties"].pop("lengthM", None)
        feature["properties"].update(measurements(feature["geometry"]))
    features.sort(key=lambda item: item["id"])
    counts = {category: 0 for category in ("building", "road", "railway", "area", "pier", "water")}
    counts.update(Counter(feature["properties"]["category"] for feature in features))
    meta = {"fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "osmTimestamp": payload.get("osm3s", {}).get("timestamp_osm_base"), "source": "OpenStreetMap via Overpass API", "endpoint": endpoint, "attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0", "licenseUrl": "https://www.openstreetmap.org/copyright", "bbox": BBOX, "counts": counts, "total": len(features), "named": sum(bool(feature["properties"]["named"]) for feature in features), "geometryCounts": dict(Counter(feature["geometry"]["type"] for feature in features)), "skipped": dict(skipped), "query": QUERY, "limitations": ["Cobertura colaborativa: áreas e edificações ausentes no OpenStreetMap não são inventadas.", "Nomes genéricos identificam apenas o tipo mapeado; não confirmam a função ou ocupante atual.", "Recorte estrito pelo polígono Porto do Itaqui do OpenStreetMap (relação 10189309), referência cartográfica e não limite legal certificado.", "Edifícios fora do perímetro são excluídos. Vias e áreas são recortadas no perímetro; não se estendem às instalações vizinhas.", "Áreas e comprimentos são aproximações calculadas da geometria; não constituem levantamento cadastral."]}
    meta["boundary"] = {"id": BOUNDARY_ID, "sourceUrl": boundary_feature["properties"]["sourceUrl"], "name": "Porto do Itaqui", "method": "Buildings wholly within; lines and areas intersected with port polygon"}
    target = ROOT / "public" / "data"
    target.mkdir(parents=True, exist_ok=True)
    for filename, data in (("port-cartography.geojson", {"type": "FeatureCollection", "features": features}), ("port-cartography-meta.json", meta), ("port-boundary.geojson", boundary_feature)):
        temporary = target / f".{filename}.tmp"
        temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
        temporary.replace(target / filename)
    print(json.dumps({"total": len(features), "counts": counts, "geometryCounts": meta["geometryCounts"], "osmTimestamp": meta["osmTimestamp"], "skipped": dict(skipped)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
