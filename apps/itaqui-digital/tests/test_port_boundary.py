import json
from pathlib import Path
import sys
import unittest
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from port_boundary import restrict_to_port, BOUNDARY_ID

class PortBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.features = json.loads((ROOT / "public/data/port-cartography.geojson").read_text())["features"]
        self.boundary = shape(json.loads((ROOT / "public/data/port-boundary.geojson").read_text())["geometry"])

    def test_no_published_geometry_extends_outside_port(self):
        for feature in self.features:
            self.assertTrue(self.boundary.buffer(1e-12).covers(shape(feature["geometry"])), feature["properties"]["id"])

    def test_adjacent_terminal_and_school_are_excluded(self):
        identities = {feature["properties"]["id"] for feature in self.features}
        self.assertIn(BOUNDARY_ID, identities)
        self.assertNotIn("osm-relation-10189307", identities)
        self.assertNotIn("osm-relation-20125198", identities)
        self.assertTrue(all(f["properties"].get("building") not in ("school", "house", "church") for f in self.features))

    def test_updater_fails_closed_without_port_polygon(self):
        with self.assertRaises(ValueError):
            restrict_to_port([f for f in self.features if f["properties"]["id"] != BOUNDARY_ID])

    def test_whole_buildings_only_and_clipped_road_segments(self):
        self.assertTrue(any(f["properties"].get("clippedToPort") for f in self.features if f["properties"]["category"] == "road"))
        self.assertTrue(all(not f["properties"].get("clippedToPort") for f in self.features if f["properties"]["category"] == "building"))

if __name__ == "__main__":
    unittest.main()
