# Representações das embarcações

Fontes verificadas em 5 de setembro de 2026. Os modelos são símbolos de navegação e identificação; não reproduzem a aparência real de um navio específico.

## Modelos incorporados

O [Watercraft Kit 2.1, de Kenney](https://kenney.nl/assets/watercraft-kit) oferece 45 modelos sob [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). O arquivo original `License.txt` acompanha os quatro modelos selecionados em `public/models/kenney-watercraft/`. Os arquivos GLB e a textura local são distribuídos sem alterações. Somente a orientação e as proporções são ajustadas em memória para a representação cartográfica.

| Arquivo original | Utilização | Tamanho |
| --- | --- | --- |
| `ship-cargo-a.glb` | Carga geral e contêineres | 98.052 bytes |
| `ship-cargo-b.glb` | Granéis sólidos | 79.844 bytes |
| `ship-cargo-c.glb` | Embarcação de classe desconhecida | 31.600 bytes |
| `boat-tug-a.glb` | Rebocador quando descrito explicitamente pela fonte | 41.036 bytes |
| `Textures/colormap.png` | Textura compartilhada | 8.814 bytes |

Download primário: [pacote original da Kenney](https://kenney.nl/media/pages/assets/watercraft-kit/a335cfed49-1713519620/kenney_watercraft-pack.zip). A página original e a licença contida no ZIP confirmam CC0. Não é necessário atribuir, mas a procedência é preservada aqui e na aplicação.

O pacote não inclui um navio-tanque adequado. Essa representação é uma malha original do projeto: casco, convés, ponte, tubulações, tampas de tanques, passarelas, mastros e equipamentos de convés. Malhas originais simplificadas também servem de substituição imediata caso um GLB não carregue. Não foram utilizados modelos sem licença verificável.

## O que o símbolo significa

- O tipo visual é inferido da descrição da carga publicada pela EMAP. Não é uma classe de navio confirmada. Sem descrição reconhecida, usa-se a embarcação genérica.
- O comprimento informado pela fonte é usado em metros quando disponível. Sem ele, aplica-se um comprimento simbólico por categoria (32 a 200 m); boca e altura são sempre ilustrativas.
- Posições AIS são utilizadas exatamente como recebidas, sem deslocamento visual nem interpolação inventada. O centro do símbolo fica sobre a coordenada fornecida; não há dimensões da antena AIS que permitam determinar o centro físico do casco.
- A orientação usa o rumo/curso recebido. Na ausência de orientação, o símbolo aponta para norte por convenção, e essa orientação não deve ser interpretada como medição.
- As posições provenientes de berços continuam aproximadas. Registros desatualizados, sem coordenadas válidas ou com `positionSource: none` não recebem modelos no mapa.

## Renderização

A camada segue o exemplo oficial [MapLibre: Add a 3D model using Three.js](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/) e a interface `CustomLayerInterface` da versão instalada. Os modelos compartilham o canvas e o contexto WebGL do mapa. Geometrias, materiais e textura são reutilizados entre embarcações; a renderização ocorre quando o mapa ou os dados mudam. A navegação do mapa permanece em 2D e com o norte para cima.
