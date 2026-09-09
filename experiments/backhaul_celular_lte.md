---
type: experiment
title: "Backhaul Celular LTE: Validação em Bancada da T-SIM7000G"
description: "Bring-up da tag celular e investigação da falha de transmissão HTTPS, com isolamento camada a camada até a causa raiz na rede da operadora."
timestamp: 2026-09-09T15:30:00Z
tags: [experiment, sim7000g, lte, cat-m, tls, apn, bring-up, conectividade]
---

# Experimento: Backhaul Celular LTE em Bancada

## Contexto e Motivação

A tag celular baseada na [LILYGO T-SIM7000G](../hardware/lilygo_t_sim7000g.md) é a única placa do projeto que dispensa gateway: ela obtém a própria posição por GNSS e transmite diretamente à infraestrutura de nuvem pela rede da operadora. Isso a torna a candidata para ativos que circulam fora do alcance dos gateways fixos.

Este experimento registra o bring-up completo da placa e a investigação da falha que impediu a transmissão. O registro é detalhado de propósito: várias hipóteses plausíveis foram levantadas e **derrubadas por medição**, e conhecer os caminhos que não levam a lugar nenhum economiza o tempo de quem repetir o trajeto.

## Metodologia

Bancada com a placa conectada por USB, gravação via PlatformIO e captura da saída serial. Para as investigações de rede foi gravado um firmware auxiliar de *passthrough* AT, expondo o barramento do modem diretamente ao computador — indispensável para diferenciar o que o modem responde do que a biblioteca interpreta.

Princípio adotado após um resultado falso: **toda varredura carrega um controle conhecido**. Uma porta sabidamente aberta é testada no início e no fim de cada rodada. Sem isso, uma degradação do aparato (contexto de dados caído, aplicação AT travada) é indistinguível do fenômeno investigado — e produziu, de fato, duas rodadas inteiras de resultados inválidos.

## Resultados por Camada

### Camadas validadas

| Camada | Resultado |
| :--- | :--- |
| Gravação e boot | ESP32-D0WD-V3 rev 3.1, 16 MB de flash, hashes verificados |
| Modem | SIM7000G, firmware R1529, responde a AT |
| Registro na rede | Anexa, CSQ entre 13 e 17 |
| APN e contexto PDP | Ativa, IP atribuído na faixa CGNAT (100.64.0.0/10) |
| DNS | Resolve nomes corretamente |
| TCP porta 80 | Conecta (`+CAOPEN: 0`) |
| Sequenciamento GNSS | Fases exclusivas funcionando conforme projetado |
| RPC de ingestão no backend | Validado com o payload exato que o firmware constrói |

### Falha: nenhuma porta capaz de TLS

Varredura com SSL **desligado** — ou seja, medindo a porta, não o handshake. Controle na porta 80 no início e no fim:

| Porta | Resultado |
| :--- | :--- |
| 80, 8080 | `+CAOPEN: 0` — aberta |
| 443, 2053, 2083, 2087, 2096, 8443 | `+CAOPEN: 23` — recusada |
| 3000, 8081, 12345, 5222 | `+CAOPEN: 23` — recusada |

Portas altas arbitrárias são recusadas exatamente como a 443. Trata-se, portanto, de uma **lista branca de portas HTTP**, e não de uma regra sobre TLS.

### A APN não é a causa

O modem consultou a própria rede sobre qual APN usar:

```
AT+CGNAPN  →  +CGNAPN: 1,"zap.vivo.com.br"
```

Forçar outra APN não altera nada. Pela pilha TCP/IP legada, onde a APN é explícita e não pode ser ignorada (`AT+CSTT` → `AT+CIICR` → `AT+CIPSTART`), tanto `zap.vivo.com.br` quanto `internet.vivo.com.br` ativam contexto e **ambas entregam o mesmo resultado**: porta 80 `CONNECT OK`, porta 443 `CONNECT FAIL`. As variantes M2M (`smart.m2m`, `allcom`, `tmdata`) comportam-se de forma idêntica.

### A restrição é aplicada ao dispositivo, não ao SIM

O mesmo chip, inserido num telefone celular, navega em HTTPS normalmente. Logo, a assinatura e o plano estão íntegros; o que difere é o tratamento que a rede dá a **esta anexação**. Perfilamento por classe de dispositivo (leitura do TAC do IMEI) é o mecanismo usual, mas isso **não é verificável a partir do módulo** — do lado de dentro só se observa o efeito, não a razão.

### Observação independente: SSL indisponível no módulo

Com `AT+CASSLCFG=<cid>,"ssl",1`, o `CAOPEN` retorna resultado **7 = "Not support the function"**. Não é falha de handshake: o módulo recusa a função. A firmware R1529 é antiga e problemas de SSL nesta família são conhecidos; atualizá-la é o caminho a investigar, mas só faz sentido depois que a porta 443 estiver acessível.

Registro que economiza tempo: boa parte da investigação inicial atacou certificado, SNI, suítes de cifra e validade de relógio, perseguindo um handshake que o módulo nunca chegou a tentar. A tabela de códigos abaixo — ausente dos manuais consultados e extraída do código-fonte da biblioteca TinyGSM — é o que permitiu interpretar corretamente os números:

| Código | Significado | Código | Significado |
| :---: | :--- | :---: | :--- |
| 0 | Sucesso | 13 | Falha ao escutar a porta |
| 1 | Erro de socket | 20 | Não resolveu o host |
| 2 | Sem memória | 21 | Rede não ativa |
| 3 | Limite de conexões | 23 | **Recusa remota** |
| 4 | Parâmetro inválido | 24 | Certificado expirado |
| 6 | Endereço IP inválido | 25 | Nome comum do certificado não confere |
| 7 | **Função não suportada** | 26 | Nome comum e validade incorretos |
| 12 | Falha ao vincular a porta | 27 | Falha de conexão |

## Conclusão

O bloqueio não está no firmware, na placa, na APN, na pilha TCP escolhida nem no backend. A rede da operadora restringe esta anexação a portas HTTP, e essa restrição acompanha o dispositivo, não o chip.

Nenhuma alteração de código na placa abre a porta 443.

## Encaminhamentos

Dois caminhos, que não competem entre si:

1.  **SIM cuja assinatura contemple módulos** — chip M2M/IoT de revenda, ou SIM IoT internacional que entra em roaming com núcleo próprio. Restaura TLS fim a fim e o firmware atual volta a operar sem alteração. A pergunta a fazer ao fornecedor é técnica e específica: *"esta APN permite conexão TCP de saída na porta 443?"*
2.  **Relay HTTP na porta 80** — funciona com o chip atual. A placa assina a leitura com HMAC-SHA256 e a credencial de ingestão nunca trafega pelo enlace; o relay valida e repassa ao backend por HTTPS. O custo é que a posição trafega em claro e a tag deixa de ser autônoma.

O segundo destrava a operação imediatamente; o primeiro é o destino. E o relay não se torna descartável quando o chip adequado chegar — permanece como rota de contingência para qualquer tag em rede degradada.

## Pendência Aberta

A antena GNSS registrou zero satélites durante todo o experimento (`sats=0/0` após 90 s de busca), enquanto o LTE anexou normalmente. O comportamento é compatível com antena no conector trocado ou ausência de vista de céu, e **não** com defeito de firmware — mas não foi confirmado, por ter sido conduzido em ambiente fechado.
