"""Restrict the published cartography to the OSM Porto do Itaqui polygon."""
from copy import deepcopy
from shapely import make_valid
from shapely.geometry import shape, mapping, Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import unary_union

BOUNDARY_ID = "osm-relation-10189309"

def only_dimension(geometry, dimension):
    if geometry.is_empty:
        return None
    accepted = (Polygon, MultiPolygon) if dimension == 2 else (LineString, MultiLineString)
    if isinstance(geometry, accepted):
        return geometry
    if hasattr(geometry, "geoms"):
        parts = [part for child in geometry.geoms if (part := only_dimension(child, dimension)) is not None]
        return unary_union(parts) if parts else None
    return None

def restrict_to_port(features):
    boundary_feature = next((f for f in features if f["properties"]["id"] == BOUNDARY_ID), None)
    if boundary_feature is None:
        raise ValueError("Porto do Itaqui boundary missing; refusing to publish an unbounded snapshot")
    boundary = make_valid(shape(boundary_feature["geometry"]))
    if not isinstance(boundary, (Polygon, MultiPolygon)) or boundary.is_empty:
        raise ValueError("Invalid port boundary")
    kept = []
    for original in features:
        geometry = make_valid(shape(original["geometry"]))
        # Keep building footprints intact, and reject every footprint crossing the perimeter.
        if original["properties"]["category"] == "building":
            if not boundary.covers(geometry):
                continue
            clipped = geometry
        else:
            dimension = 2 if geometry.geom_type in ("Polygon", "MultiPolygon") else 1
            clipped = only_dimension(geometry.intersection(boundary), dimension)
            if clipped is None or clipped.is_empty:
                continue
        feature = deepcopy(original)
        feature["geometry"] = mapping(clipped)
        feature["properties"]["clippedToPort"] = not geometry.equals(clipped)
        kept.append(feature)
    return kept, deepcopy(boundary_feature)
