import type { Metadata } from "next";
import { Port3DView } from "@/components/port-3d-view";
export const metadata: Metadata = {
  title: "Itaqui Digital — Porto do Itaqui em 3D",
  description:
    "Vista 3D low-poly do Porto do Itaqui, com cais, berços, vias e ferrovias do OpenStreetMap e navios atracados da programação EMAP.",
};
export default function Page() {
  return <Port3DView />;
}
