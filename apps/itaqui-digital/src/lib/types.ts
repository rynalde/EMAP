export type VesselStatus = "atracado" | "fundeado" | "esperado" | "navegando";
export type Vessel = {
  id: string;
  name: string;
  imo?: string;
  mmsi?: string;
  status: VesselStatus;
  berth?: string;
  cargo?: string;
  quantity?: string;
  length?: number;
  beam?: number;
  shipType?: number;
  draft?: string;
  agency?: string;
  eta?: string;
  updatedAt: string;
  coordinates?: [number, number];
  heading?: number;
  speed?: number;
  positionSource: "berth" | "ais" | "none";
  stale?: boolean;
};
export type PortData = {
  vessels: Vessel[];
  fetchedAt: string;
  source: string;
  stale: boolean;
  error?: string;
  links: { label: string; url: string }[];
};
export type AISData = {
  configured: boolean;
  state: "disabled" | "connecting" | "connected" | "error";
  vessels: Vessel[];
  lastMessageAt: string | null;
  error?: string;
};
export type WeatherData = {
  current: {
    time: number;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    visibility: number;
    precipitation: number;
  };
  hourly: {
    time: number[];
    temperature_2m: number[];
    precipitation_probability: number[];
    wind_speed_10m: number[];
  };
  daily: {
    time: number[];
    sunrise: number[];
    sunset: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
  fetchedAt: string;
};
export type Place = {
  id: string;
  name: string;
  category: "berth" | "terminal" | "building";
  coordinates: [number, number];
  description: string;
  length?: number;
  depth?: number;
  heading?: number;
};
export type Layers = {
  buildings: boolean;
  roads: boolean;
  railways: boolean;
  areas: boolean;
  vessels: boolean;
  berths: boolean;
  labels: boolean;
};
export type MapCommand = {
  type: "home" | "zoomIn" | "zoomOut" | "fly" | "region";
  coordinates?: [number, number];
  zoom?: number;
  bounds?: [[number, number], [number, number]];
  nonce: number;
};
