---
type: hardware
title: "LILYGO TTGO T-SIM7000G"
description: "ESP32-WROVER-B com modem SIMCom SIM7000G (LTE CAT-M / NB-IoT) e GNSS integrado, para rastreamento de ativos sem gateway intermediário."
timestamp: 2026-09-09T15:30:00Z
tags: [hardware, esp32, sim7000g, lte, cat-m, nb-iot, gnss, celular]
---

# LILYGO TTGO T-SIM7000G

A T-SIM7000G combina um ESP32-WROVER-B com o módulo celular SIMCom SIM7000G, que traz tanto o rádio LTE de baixa potência (CAT-M1 e NB-IoT) quanto um receptor GNSS multiconstelação no mesmo encapsulamento.

O que a diferencia das demais placas sob pesquisa é a **ausência de gateway**: enquanto as tags LoRa e as de Channel Sounding dependem de um concentrador para alcançar a rede, esta placa fala diretamente com a infraestrutura de nuvem pela rede da operadora. Isso a torna a candidata natural para ativos que circulam fora do alcance dos gateways fixos do porto — caminhões em trânsito externo, por exemplo.

## Especificações Técnicas Centrais

*   **Microcontrolador (MCU)**: Espressif ESP32-WROVER-B (Xtensa LX6 dual-core de 32 bits, 240 MHz), com PSRAM externa.
*   **Módulo Celular**: SIMCom SIM7000G, variante global multibanda.
*   **Tecnologias de Rádio**: LTE CAT-M1 (eMTC), NB-IoT e fallback GSM/EDGE (2G).
*   **Receptor GNSS**: integrado ao próprio SIM7000G — GPS, GLONASS e BeiDou. Não há chip GPS separado nem segunda UART: todo o posicionamento é obtido por comandos AT no mesmo barramento do modem.
*   **Memória Flash**: 16 MB no chip ESP32 desta revisão (confirmado por leitura direta com `esptool`). Atenção: o perfil `esp32dev` padrão do PlatformIO particiona apenas 4 MB, deixando o restante sem uso.
*   **Armazenamento Externo**: slot para cartão microSD.
*   **Alimentação**: conector JST para bateria Li-Po com circuito de recarga, entrada USB-C e entrada dedicada para painel solar com ADC de monitoramento.
*   **Antenas**: **dois conectores independentes** — um para LTE e outro para GNSS. Ambos são obrigatórios; a ausência da antena GNSS resulta em zero satélites visíveis indefinidamente.

---

## Mapeamento de Pinos Onboard

Conexões entre o ESP32 e os periféricos, conferidas contra o [repositório oficial da LILYGO](https://github.com/Xinyuan-LilyGO/LilyGO-T-SIM7000G):

| Periférico | Função de Hardware | GPIO do ESP32 |
| :--- | :--- | :---: |
| **Modem SIM7000G** | UART TX (ESP32 → modem RX) | 27 |
| **Modem SIM7000G** | UART RX (ESP32 ← modem TX) | 26 |
| **Modem SIM7000G** | PWRKEY (pulso de liga/desliga) | 4 |
| **Modem SIM7000G** | DTR (controle de suspensão) | 25 |
| **Indicação** | LED de status (lógica invertida, ativo em nível baixo) | 12 |
| **Monitoramento** | ADC de tensão da bateria (divisor 1:2) | 35 |
| **Monitoramento** | ADC de tensão do painel solar | 36 |
| **Cartão SD** | SPI SCLK | 14 |
| **Cartão SD** | SPI MISO | 2 |
| **Cartão SD** | SPI MOSI | 15 |
| **Cartão SD** | Chip Select (CS) | 13 |

---

## Comportamentos de Hardware que Condicionam o Firmware

Três características desta placa não são evidentes na folha de dados e foram levantadas em bancada. Cada uma delas dita uma decisão de projeto no firmware.

### 1. GNSS e dados celulares são mutuamente exclusivos

O manual da LILYGO é explícito: *"Please disconnect the network when positioning, and turn off GPS when connecting to the network."* O módulo não sustenta as duas funções simultaneamente.

A consequência prática é que um ciclo de leitura precisa ser dividido em duas fases que nunca se sobrepõem:

```
Fase GNSS      derrubar sessão de dados → AT+CGNSPWR=1 → consultar AT+CGNSINF → AT+CGNSPWR=0
Fase de rede   anexar APN → transmitir a leitura → encerrar a sessão
```

Manter o receptor ligado enquanto o modem está anexado é a causa mais comum de uma T-SIM7000G "nunca obter fix" numa bancada onde um sketch de GNSS puro sincroniza em segundos. Isso também implica que **reanexar à rede a cada ciclo não é opcional**, o que impõe um piso ao intervalo de transmissão e ao consumo.

### 2. PWRKEY alterna, não liga

O pino 4 é um *toggle*, não um botão de "ligar". O SIM7000G é alimentado pelo VBAT e a linha de reset do ESP32 não o alcança — ou seja, **o modem preserva seu estado através de um reset do ESP32**.

Pulsar o PWRKEY incondicionalmente no boot, portanto, **desliga** um modem que estava ligado. O sintoma é um firmware que trava indefinidamente na inicialização do modem a cada segundo reset, enquanto o primeiro boot após a gravação parece perfeito — porque aquele, de fato, partiu de um modem desligado.

A rotina correta consulta antes de agir: testar se o modem responde a `AT` e só pulsar o PWRKEY em caso de silêncio.

### 3. Picos de corrente de ~2 A na transmissão

O modem exige picos de corrente que muitas portas USB e hubs não sustentam. A bateria Li-Po deve permanecer conectada durante os testes de bancada. O sintoma de subalimentação é uma placa que reinicia no meio de uma transmissão, o que se parece com um defeito de firmware e não com uma falha de energia.

---

## Documentos Relacionados

*   [Backhaul Celular LTE: Validação em Bancada](../experiments/backhaul_celular_lte.md) — resultados dos testes de conectividade desta placa, incluindo a limitação de portas encontrada na rede da operadora.
*   [Arquitetura de Software](../software/system_architecture.md)
