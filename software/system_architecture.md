---
type: software
title: "Arquitetura Lógica do Sistema"
description: "Visão sistêmica da comunicação de dados, armazenamento e interfaces do sistema de rastreamento portuário."
timestamp: 2026-07-11T18:37:00Z
tags: [software, architecture, data-flow, diagram]
---

# Arquitetura Lógica do Sistema

Este documento descreve o fluxo de dados e os módulos lógicos que compõem o sistema de monitoramento em tempo real das intercorrências operacionais na área do porto de Itaqui (EMAP).

## Visão Geral do Fluxo de Informação

O sistema divide-se em três camadas principais:
1.  **Camada de Sensoriamento e Borda (Edge)**: Dispositivos móveis instalados nos ativos portuários (carros e equipamentos) e Gateways receptores.
2.  **Camada de Servidor e Processamento**: Servidores de armazenamento de dados e execução de algoritmos operacionais.
3.  **Camada de Apresentação e Controle**: Dashboards gerenciais e sistemas de alerta.

```mermaid
graph TD
    subgraph Camada_de_Borda [Camada de Borda]
        Tag1["Tags Móveis (T-Beam / T-Echo / XIAO) <br> (Coleta GPS, BLE, Ultrassom)"]
        GW["Gateways de Campo (LoRa32 V2.1) <br> (Recepção LoRa / BLE -> Wi-Fi)"]
        Tag1 -- "LoRa / BLE" --> GW
    end

    subgraph Servidor_Central [Camada de Processamento]
        DB[("Banco de Dados Relacional <br> (Cadastro, Telemetria, Paradas)")]
        AlgOEE["Algoritmo OEE <br> (Disponibilidade, Performance, Qualidade)"]
        AlgRota["Algoritmo de Rota Ótima <br> (Estocástico / Tempo Real)"]
        
        GW -- "HTTP / MQTT (Wi-Fi)" --> DB
        DB <--> AlgOEE
        DB <--> AlgRota
    end

    subgraph Apresentacao [Camada de Apresentação]
        DashKPI["Dashboard de Relatórios <br> (OEE, Produtividade, Ociosidade)"]
        DashRota["Interface de Rota Ótima <br> (Instruções para Operadores)"]
        Alert["Sistema de Notificação <br> (Alertas instantâneos de intercorrência)"]
        
        DB --> DashKPI
        AlgRota --> DashRota
        DB --> Alert
    end
```

---

## Detalhamento dos Componentes

### 1. Camada de Borda (Tags e Gateways)
*   **Tags Móveis**: Acopladas nos carros e guindastes. Coletam coordenadas GPS/GNSS (outdoor) ou coordenadas ultrassônicas (indoor/maquete), calculando velocidade e status de ignição. Utilizam BLE para detectar a proximidade de tags de equipamentos vizinhos.
*   **Gateways**: Espalhados pela planta do porto. Recebem as transmissões de rádio (LoRa) em longo alcance das tags móveis e empacotam esses dados, repassando-os via rede local Wi-Fi ou ethernet corporativa para o servidor.

### 2. Camada de Servidor (Armazenamento e Inteligência)
*   **Banco de Dados**: Armazena a telemetria histórica de cada ativo, cadastro de operadores e turnos, além do registro manual/automático de intercorrências portuárias (ex: paradas por quebra de correia transportadora, espera de berço de navio).
*   **Algoritmo OEE (Eficiência Global de Equipamentos)**:
    *   *Disponibilidade*: Tempo de operação real vs. tempo de operação programado.
    *   *Performance*: Velocidade real de carga/movimentação vs. capacidade nominal.
    *   *Qualidade*: Movimentações corretas de carga vs. retrabalhos logísticos.
*   **Algoritmo de Rota Ótima**: Calcula o trajeto terrestre mais curto ou mais rápido para veículos de transporte interno do porto, considerando congestionamentos dinâmicos e intercorrências temporárias nos cruzamentos ferroviários.

### 3. Camada de Apresentação (Interfaces)
*   **Painéis Gerenciais**: Gráficos dinâmicos que demonstram gargalos de tempo de parada e ociosidade física.
*   **Notificações Instantâneas**: Disparo de e-mails, SMS ou mensagens de chat para supervisores de turno assim que um equipamento móvel crítico interrompe suas atividades por mais de 5 minutos sem justificativa pré-programada.
