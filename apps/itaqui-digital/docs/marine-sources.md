# Condições marítimas do Itaqui

`GET /api/marine` consulta a [API Marine do Open-Meteo](https://open-meteo.com/en/docs/marine-weather-api). O painel apresenta nível do mar, correntes e temperatura da água, com previsão horária de 48 horas. Ondas aparecem quando o provedor retorna valores. A consulta pública funciona sem nova chave neste protótipo; [uso comercial exige plano apropriado](https://open-meteo.com/en/pricing).

Endpoint implementado e verificado em 5 de setembro de 2026:

```text
https://marine-api.open-meteo.com/v1/marine?latitude=-2.57735&longitude=-44.3702884&current=sea_level_height_msl,wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&hourly=sea_level_height_msl,wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&timezone=America/Fortaleza&timeformat=unixtime&forecast_hours=48&cell_selection=sea&wind_speed_unit=kn
```

A chamada HTTP 200 resolveu a célula `[-44.374985, -2.5416641]`, aproximadamente 4 km ao norte do ponto solicitado. A verificação retornou nível `0,25 m MSL`, corrente `2,7 nós`, direção `21°` e água `29,3 °C`. As variáveis de ondas vieram `null`: o painel informa a ausência, sem trocar por zero ou por uma localização distante. Esses números registram a verificação; não são dados de reserva do aplicativo.

O nível inclui marés e outros efeitos oceânicos. Seu datum é o nível médio global (MSL), diferente do datum da carta náutica. Correntes e nível usam modelos Météo-France/Copernicus de aproximadamente 8 km, com precisão costeira limitada. Não são leituras de marégrafo nem dados apropriados para navegação. O aplicativo não calcula preamar/baixamar a partir da série horária. [Definições e fontes primárias](https://open-meteo.com/en/docs/marine-weather-api#hourly-parameter-definition).

Os timestamps são Unix UTC, formatados explicitamente em `America/Fortaleza` (BRT). `fetchedAt` é a hora da consulta; `current.time` identifica a previsão exibida. O endpoint valida unidades, posição da célula e idade dos dados. Erros retornam HTTP 503 sem dados simulados. A resposta pode permanecer no cache HTTP por 60 segundos no navegador e 15 minutos no servidor intermediário.

[WorldTides](https://www.worldtides.info/apidocs) foi avaliado: oferece alturas, extremos e datums, mas requer chave e créditos. Não foi ativado nem houve contratação.

Validação local: `npx tsx --test tests/marine.test.ts`.
