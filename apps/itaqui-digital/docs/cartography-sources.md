# Cartografia restrita ao Porto do Itaqui

O recorte segue exclusivamente o polígono [Porto do Itaqui — relação OSM 10189309](https://www.openstreetmap.org/relation/10189309). É uma referência cartográfica colaborativa, não uma certificação do limite legal.

Após o recorte: 109 elementos, sendo 6 edifícios/tanques, 85 trechos de vias, 16 trechos ferroviários, o polígono da área portuária e 1 elemento de hidrografia. O cadastro OSM de edifícios dentro do porto é parcial. Nenhuma edificação ausente é inventada. Os nove marcadores de berços e os pontos de interesse EMAP continuam independentes desse cadastro.

Edifícios precisam estar inteiramente contidos no polígono; não se cortam edifícios pela metade. Vias, ferrovias, áreas e hidrografia são intersectadas com o perímetro e suas medidas recalculadas somente para a parte exibida. Elementos externos são removidos tanto do mapa quanto da busca e da lista. Ponta da Madeira, bairros e instalações vizinhas não fazem parte dessa camada.

A restrição é aplicada antes de publicar `public/data/port-cartography.geojson`, usando `scripts/port_boundary.py`. O contorno de referência acompanha os dados em `public/data/port-boundary.geojson`. O script de atualização inclui explicitamente a relação e se recusa a publicar sem ela.

Atualização: `python3 scripts/fetch-port-cartography.py`, com Python e Shapely (`scripts/requirements.txt`). Requer internet. A consulta menor ainda passa pelo recorte poligonal. Uma falha de download preserva o snapshot. `--input caminho.json` aceita uma resposta Overpass já obtida.

Fonte/licença: [OpenStreetMap, ODbL](https://www.openstreetmap.org/copyright). IDs, atributos, links de origem, data da consulta e timestamp da base são preservados. Os dados AIS de navios nos arredores não são submetidos a esse recorte terrestre.
