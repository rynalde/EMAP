---
type: objective
title: "Escopo e Objetivos do Projeto"
description: "Objetivo geral e macroetapas do sistema de monitoramento em tempo real da área portuária."
timestamp: 2026-07-11T18:37:00Z
tags: [scope, goals, emap]
---

# Escopo e Objetivos do Projeto

## Objetivo Geral
O objetivo geral do projeto é desenvolver um sistema de coleta de dados em tempo real, análise e processamento desses dados, registro e comunicação instantânea dos impactos operacionais decorrentes de paradas ou intercorrências na área portuária.

O sistema visa modernizar os processos de coleta de informações sobre a movimentação de veículos e equipamentos móveis na área do porto do Itaqui (EMAP), substituindo fluxos manuais por análises automatizadas e relatórios em tempo real.

## Macroetapas do Projeto

1.  **Sensoriamento com Geolocalização**:
    *   Desenvolvimento e especificação de tags de rastreamento e gateways utilizando placas de desenvolvimento equipadas com tecnologias LoRa, Bluetooth (BLE) e GNSS/GPS.
2.  **Monitoramento e Coleta em Tempo Real**:
    *   Implementação de protocolos de comunicação eficientes para enviar coordenadas de posicionamento e telemetria dos ativos móveis para um servidor centralizado.
3.  **Banco de Dados Dedicado**:
    *   Estruturação de um repositório centralizado para armazenar informações de cadastro de equipamentos, registros de sensoriamento e paradas operacionais.
4.  **Algoritmo e Cálculos Operacionais**:
    *   Implementação de lógicas para determinar indicadores chave como a Eficiência Global de Equipamentos (OEE - Overall Equipment Effectiveness) e para a geração de rotas ótimas de tráfego.
5.  **Sistema de Registro e Notificação**:
    *   Criação de canais de comunicação em massa e instantâneos para notificar equipes operacionais sobre paradas e impactos.
6.  **Painéis (Dashboards) Interativos**:
    *   Desenvolvimento de interfaces visuais intuitivas para acesso aos KPIs operacionais por parte da gerência e supervisores do porto.
