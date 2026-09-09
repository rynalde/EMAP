import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as PortMap,
} from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Vessel } from "./types";

import {
  MODEL_CATALOG,
  getVesselModelInfo,
  hasVesselModelPosition,
  type VesselModelKind,
} from "./vessel-model-info";
/** Original fallback meshes; units are fractions of one metre of overall length, bow is +Y. */
function fallbackModel(kind: VesselModelKind): THREE.Group {
  const group = new THREE.Group();
  const colors = {
    hull: 0x253b4a,
    deck: kind === "tanker" ? 0x8bc5a9 : 0xa7b8bd,
    white: 0xeaf2ed,
    glass: 0x2e6c88,
    pipe: 0xdbcf9f,
    hatch: 0x69899c,
    orange: 0xe88d56,
  };
  const materials = Object.fromEntries(
    Object.entries(colors).map(([key, color]) => [
      key,
      new THREE.MeshLambertMaterial({ color }),
    ]),
  ) as Record<keyof typeof colors, THREE.MeshLambertMaterial>;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  function block(
    x: number,
    y: number,
    z: number,
    w: number,
    l: number,
    h: number,
    color: keyof typeof colors,
  ) {
    const mesh = new THREE.Mesh(box, materials[color]);
    mesh.position.set(x, y, z + h / 2);
    mesh.scale.set(w, l, h);
    group.add(mesh);
  }
  function cap(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
  ) {
    const mesh = new THREE.Mesh(cylinder, materials.pipe);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z + height / 2);
    mesh.scale.set(radius, height, radius);
    group.add(mesh);
  }
  const width = MODEL_CATALOG[kind].beamRatio;
  const hull = new THREE.Shape();
  hull.moveTo(-width * 0.36, -0.5);
  hull.lineTo(-width / 2, -0.44);
  hull.lineTo(-width / 2, 0.3);
  hull.lineTo(-width * 0.33, 0.42);
  hull.lineTo(0, 0.5);
  hull.lineTo(width * 0.33, 0.42);
  hull.lineTo(width / 2, 0.3);
  hull.lineTo(width / 2, -0.44);
  hull.lineTo(width * 0.36, -0.5);
  hull.closePath();
  const hullMesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(hull, {
      depth: 0.037,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.006,
      bevelThickness: 0.008,
      curveSegments: 1,
    }),
    materials.hull,
  );
  hullMesh.position.z = 0.008;
  group.add(hullMesh);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(hull), materials.deck);
  deck.scale.set(0.93, 0.98, 1);
  deck.position.z = 0.054;
  group.add(deck);
  block(0, -0.34, 0.055, width * 0.75, 0.13, 0.045, "white");
  block(0, -0.33, 0.1, width * 0.82, 0.064, 0.014, "glass");
  block(0, -0.33, 0.114, width * 0.85, 0.071, 0.007, "white");
  block(width * 0.18, -0.42, 0.055, 0.022, 0.04, 0.054, "orange");
  block(0, -0.34, 0.12, 0.003, 0.003, 0.039, "white");
  block(0, -0.34, 0.15, 0.045, 0.003, 0.004, "white");
  for (const side of [-1, 1]) {
    block(side * width * 0.43, -0.03, 0.058, 0.003, 0.79, 0.011, "white");
    block(side * width * 0.38, -0.35, 0.066, 0.018, 0.065, 0.019, "orange");
    cap(side * width * 0.2, 0.38, 0.055, 0.012, 0.014);
  }
  if (kind === "tanker") {
    for (let i = 0; i < 7; i++) {
      const y = -0.2 + i * 0.087;
      for (const side of [-1, 1])
        cap(side * width * 0.23, y, 0.055, 0.02, 0.012);
      block(0, y, 0.063, width * 0.7, 0.004, 0.005, "pipe");
    }
    for (const x of [-0.012, 0, 0.012])
      block(x, 0.07, 0.075, 0.005, 0.6, 0.006, "pipe");
  } else if (kind === "bulk" || kind === "cargo") {
    for (let i = 0; i < 5; i++) {
      const y = -0.2 + i * 0.116;
      block(
        0,
        y,
        0.056,
        width * 0.72,
        0.096,
        kind === "cargo" ? 0.043 : 0.008,
        i % 2 ? "hatch" : "orange",
      );
      block(0, y, kind === "cargo" ? 0.1 : 0.065, 0.003, 0.095, 0.002, "white");
    }
  }
  return group;
}

function normalizeAsset(model: THREE.Group, kind: VesselModelKind) {
  // Kenney assets are Y-up and point along +Z. Rotate to Z-up with bow along +Y.
  const oriented = new THREE.Group();
  model.rotation.x = Math.PI / 2;
  oriented.rotation.z = Math.PI;
  oriented.add(model);
  oriented.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(oriented),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3());
  const translated = new THREE.Group();
  oriented.position.set(-center.x, -center.y, -bounds.min.z);
  translated.add(oriented);
  translated.scale.set(
    MODEL_CATALOG[kind].beamRatio / size.x,
    1 / size.y,
    (kind === "tug" ? 0.27 : 0.13) / size.z,
  );
  return translated;
}

function disposeObjects(objects: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  for (const root of objects)
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}

export type VesselModelLayer = CustomLayerInterface & {
  update(vessels: Vessel[]): void;
  setVisible(visible: boolean): void;
  pick(point: { x: number; y: number }): Vessel | null;
};

/** One event-driven renderer on MapLibre's existing canvas; no second WebGL context or render loop. */
export function createVesselModelLayer(): VesselModelLayer {
  let map: PortMap | undefined,
    renderer: THREE.WebGLRenderer | undefined,
    removed = false,
    visible = true;
  let vessels: Vessel[] = [];
  const scene = new THREE.Scene(),
    camera = new THREE.Camera();
  const templates = new Map<VesselModelKind, THREE.Group>(),
    retired: THREE.Group[] = [];
  const requested = new Set<VesselModelKind>();
  const instances = new Map<
    string,
    { kind: VesselModelKind; group: THREE.Group }
  >();
  const origin = MercatorCoordinate.fromLngLat([-44.37, -2.577], 0);
  const meter = origin.meterInMercatorCoordinateUnits();
  const originMatrix = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(meter, -meter, meter));
  const loader = new GLTFLoader();

  function template(kind: VesselModelKind) {
    let model = templates.get(kind);
    if (!model) {
      model = fallbackModel(kind);
      templates.set(kind, model);
    }
    const file = MODEL_CATALOG[kind].asset;
    if (file && !requested.has(kind)) {
      requested.add(kind);
      loader.load(
        `/models/kenney-watercraft/${file}`,
        (gltf) => {
          if (removed) {
            disposeObjects([gltf.scene]);
            return;
          }
          const previous = templates.get(kind);
          if (previous) retired.push(previous);
          const loaded = normalizeAsset(gltf.scene, kind);
          templates.set(kind, loaded);
          for (const instance of instances.values())
            if (instance.kind === kind) {
              instance.group.clear();
              instance.group.add(loaded.clone(true));
            }
          map?.triggerRepaint();
        },
        undefined,
        () => {
          /* The original fallback remains usable if a local asset fails. */
        },
      );
    }
    return model;
  }

  function update() {
    if (!renderer || removed) return;
    const active = new Set<string>();
    for (const vessel of vessels) {
      if (!hasVesselModelPosition(vessel)) continue;
      const info = getVesselModelInfo(vessel),
        point = MercatorCoordinate.fromLngLat(vessel.coordinates, 0);
      active.add(vessel.id);
      let instance = instances.get(vessel.id);
      if (instance?.kind !== info.kind) {
        if (instance) scene.remove(instance.group);
        const group = new THREE.Group();
        group.userData.vesselId = vessel.id;
        group.add(template(info.kind).clone(true));
        instance = { group, kind: info.kind };
        instances.set(vessel.id, instance);
        scene.add(group);
      }
      // Preserve the supplied coordinate exactly. The model is centered there, including AIS antenna positions.
      instance.group.position.set(
        (point.x - origin.x) / meter,
        -(point.y - origin.y) / meter,
        1,
      );
      instance.group.rotation.z = (-info.headingDegrees * Math.PI) / 180;
      instance.group.scale.setScalar(
        (info.lengthMeters * point.meterInMercatorCoordinateUnits()) / meter,
      );
    }
    for (const [id, instance] of instances)
      if (!active.has(id)) {
        scene.remove(instance.group);
        instances.delete(id);
      }
    map?.triggerRepaint();
  }

  return {
    id: "vessel-models",
    type: "custom",
    renderingMode: "3d",
    onAdd(addedMap, gl) {
      map = addedMap;
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGL2RenderingContext,
        antialias: true,
      });
      renderer.autoClear = false;
      scene.add(new THREE.AmbientLight(0xffffff, 1.8));
      const sun = new THREE.DirectionalLight(0xfff4dc, 2.3);
      sun.position.set(-100, 180, 300);
      scene.add(sun);
      update();
    },
    render(_gl, args) {
      if (!renderer || !visible || !instances.size) return;
      camera.projectionMatrix
        .fromArray(args.defaultProjectionData.mainMatrix)
        .multiply(originMatrix);
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
    },
    pick(point) {
      if (!map || !visible || !renderer || !instances.size) return null;
      const canvas = map.getCanvas();
      const x = (point.x / canvas.clientWidth) * 2 - 1;
      const y = 1 - (point.y / canvas.clientHeight) * 2;
      const inverse = camera.projectionMatrix.clone().invert();
      const near = new THREE.Vector3(x, y, -1).applyMatrix4(inverse);
      const far = new THREE.Vector3(x, y, 1).applyMatrix4(inverse);
      const raycaster = new THREE.Raycaster(near, far.sub(near).normalize());
      scene.updateMatrixWorld(true);
      const hit = raycaster.intersectObjects(
        [...instances.values()].map((v) => v.group),
        true,
      )[0];
      let object: THREE.Object3D | null = hit?.object ?? null;
      while (object && !object.userData.vesselId) object = object.parent;
      return vessels.find((v) => v.id === object?.userData.vesselId) ?? null;
    },
    update(next) {
      vessels = next;
      update();
    },
    setVisible(next) {
      visible = next;
      map?.triggerRepaint();
    },
    onRemove() {
      removed = true;
      disposeObjects([scene, ...templates.values(), ...retired]);
      scene.clear();
      templates.clear();
      instances.clear();
      retired.length = 0;
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },
  };
}
