# Mercantil — Mapeamento do Fluxo (Consignado Privado MTE)

**Portal:** https://meu.bancomercantil.com.br  
**Stack portal:** Angular + Angular Material (componentes `mat-*`, atributos `ng-*`)  
**Atenção:** URLs contêm UUIDs dinâmicos por lead — bot captura via `page.url()` após redirect.

---

## FLUXO COMPLETO — CENÁRIO A (lead já autorizado)

### PASSO 1 — Dashboard
- **URL:** `https://meu.bancomercantil.com.br/dashboard`
- **Ação:** clicar em "Digite aqui uma nova proposta"
- **Seletor:** `button:has-text('Digite aqui uma nova proposta')`

---

### PASSO 2 — Simular Proposta
- **URL:** `https://meu.bancomercantil.com.br/simular-proposta`

| Campo | Tipo | Seletor | Valor |
|-------|------|---------|-------|
| UF | mat-select | `mat-select` (1º) | qualquer UF (ex: SP) |
| Convênio | mat-select | `mat-select` (2º) | `MINISTERIO DO TRABALHO E EMPREGO MTE` |
| CPF do cliente | input tel+máscara | `input[mask="000.000.000-00"]` | CPF do lead |
| Instituição | mat-select | `mat-select` (3º) | aparece após convênio selecionado |

- **Botão Consultar:** `button:has-text('Consultar')`
- **Após Consultar:** modal "Nova operação" → `button:has-text('Nova operação')` → redirect UUID

---

### PASSO 3 — Consignado Privado
- **URL:** `https://meu.bancomercantil.com.br/consignado-privado/{UUID}`

**Pipeline de status:**
```
Consulta solicitada → Consulta autorizada → Retorno em processamento → Retorno disponível
```

**Detectar autorizado:** todos os 4 pontos do pipeline verdes + seção "Produtos disponíveis" visível.

**Produtos disponíveis (após autorizado):**
- Card **Contrato Novo** → `button:has-text('Iniciar')` (primeiro card)
- Card **Refinanciamento** → `button:has-text('Iniciar')` (segundo card)
- Bot sempre clica no **primeiro** Iniciar (Contrato Novo)
- Redirect para: `https://meu.bancomercantil.com.br/simulacao/{UUID}/simulacao`

---

### PASSO 4 — Simulação
- **URL:** `https://meu.bancomercantil.com.br/simulacao/{UUID}/simulacao`
- **Título:** "Simulação - Consignado Privado / Contrato Novo"
- **Dados visíveis no header:** Nome | CPF | Telefone

**Seção "Opções de simulação":**
- Dropdown: `NOVO - DIGITAL- CONSIGNADO PRIVADO CORBA` (padrão, não alterar)
- **Botão Simular:** `button:has-text('Simular')`

**Stepper "Evolução Proposta" (referência, bot não interage):**
1. Simulação
2. Dados do cliente
3. Dados bancários
4. Inclusão da proposta
5. Concluir proposta

---

### PASSO 5 — Resultado

**INELEGÍVEL — mensagens conhecidas (todas = `inelegivel`):**

| Mensagem | Motivo |
|---------|--------|
| `"Trabalhador não possui margem disponível."` | sem margem consignável |
| `"Simulação não atendida pela política de crédito no momento."` | reprovado por política de crédito |

- Detectar qualquer alert vermelho após clicar Simular → status `inelegivel`
- Seletor genérico: elemento visível contendo `"não possui margem"` OU `"política de crédito"`
- Estrutura: popup vermelho com ícone ⊗ e título "Atenção"

**ELEGÍVEL — resultado aprovado:**

Detectar: seção `"Valores disponíveis"` aparece na página (em vez de alert vermelho).

**Campos de entrada (preenchidos pelo bot antes de simular):**
| Campo | Seletor | Observação |
|-------|---------|-----------|
| Valor da parcela | `input[currencymask][placeholder="R$ 0,00"]` | máscara moeda, pré-preenchido pelo portal |
| Prazo | `input[type="number"][min="1"][max="48"]` | número entre 1-48, pré-preenchido (ex: 48) |

**Seção "Resumo da operação" — campos a extrair:**
| Campo | Como extrair | Exemplo |
|-------|-------------|---------|
| `valor_liberado` | `strong.valorLiberado` (texto) | R$ 13.012,36 |
| `taxa_juros_mes` | texto após "Taxa juros (mês)" no card azul | 4.74 (%) |
| `valor_financiado` | texto após label "Valor financiado" | R$ 14.027,69 |
| `valor_emprestimo` | texto após label "Valor empréstimo" | R$ 13.554,54 |
| `quantidade_parcelas` | texto após label "Quantidade de parcelas" | 48 |
| `data_vencimento` | texto após label "Data 1º vencimento" | 04/08/2026 |
| `capital_segurado` | texto após label "Capital Segurado" | R$ 13.554,54 |
| `valor_seguro_prestamista` | texto após label "Valor Seguro Prestamista" | R$ 542,18 |
| `valor_iof` | texto após label "Valor IOF" | R$ 473,15 |

- Status final: `elegivel`
- Checkbox "Seguro Prestamista" aparece marcado por padrão — bot **não** altera

**Após extrair dados — voltar para próximo lead:**
- Clicar no painel expansível de "Nova proposta" no canto inferior esquerdo
- Seletor: `mat-expansion-panel-header:has(mat-icon:has-text('note_add'))`
- Após expandir: retorna ao formulário UF + Convênio + CPF para próximo lead

---

## FLUXO COMPLETO — CENÁRIO B (lead NÃO autorizado → precisa DataPrev)

Este cenário ocorre quando após "Nova operação" o portal redireciona para `/solicitar-dataprev/` em vez de `/consignado-privado/`.

---

### B.1 — Solicitar DataPrev
- **URL:** `https://meu.bancomercantil.com.br/solicitar-dataprev/{UUID}`
- Pergunta: "Deseja solicitar permissão de consulta a DataPrev ao cliente?"
- Radio pré-selecionado: "Solicitar via SMS"
- **Campo telefone:** `input[mask="(00) 00000-0000"]` (ID dinâmico — não usar `#mat-input-22`)
  - Se preenchido: manter o valor existente
  - Se vazio ou inválido: gerar número aleatório com formato `(DD) 9XXXX-XXXX`
  - DDDs válidos BR: 11,12,13,14,15,16,17,18,19, 21,22,24, 27,28, 31,32,33,34,35,37,38, 41,42,43,44,45,46,47,48,49, 51,53,54,55, 61,62,63,64,65,66,67,68,69, 71,73,74,75,77,79, 81,82,83,84,85,86,87,88,89, 91,92,93,94,95,96,97,98,99
  - Exemplo: `(61) 91234-5678` — DDD 61 + 9 obrigatório + 8 dígitos aleatórios
- **Botão:** `button:has-text('Solicitar')`
- Após clicar: redireciona para `/consignado-privado/{UUID}` com QR + link curto

---

### B.2 — Capturar Link de Autorização
- **URL:** `https://meu.bancomercantil.com.br/consignado-privado/{UUID}`
- Página mostra QR Code + campo de texto com link curto (ex: `https://bml.b.br/FH9AS`)
- Pipeline está em "Consulta solicitada" apenas (1/4 verde)
- **Botão copiar link:** `button:has(mat-icon:has-text('content_copy'))` ou `button[class*="mat-flat-button"]:has(mat-icon)`
- Alternativa: ler o texto do campo ao lado do botão copiar (contém a URL completa)
- Bot deve extrair URL do campo de texto (mais confiável que clipboard)

---

### B.3 — Assinar Autorização (nova aba)
**Domínio diferente:** `autorizacoesdigitais.meu.bancomercantil.com.br`

**⚠️ CRÍTICO:** página pede permissão de geolocalização → Playwright precisa conceder via `context.grant_permissions(['geolocation'])` antes de abrir a aba.

**Etapa 1 de 2:**
- URL: `https://autorizacoesdigitais.meu.bancomercantil.com.br/autorizacoes?token=eyJ...`
- Título: "Autorizo o Banco Mercantil a consultar os meus dados na DataPrev..."
- Dados exibidos: Correspondente, Nome, CPF, Data de nascimento
- Checkbox (MDC, não MAT): `input#mat-mdc-checkbox-0-input` → marcar
- Botão **Iniciar** fica habilitado após checkbox: `button:has-text('Iniciar')` / `span.mdc-button__label:has-text('Iniciar')`

**Etapa 2 de 2:**
- Mesma URL (SPA, não muda)
- Título: "Autorizo o Banco Mercantil a consultar meus dados no sistema de informações de crédito do Banco Central"
- Checkbox: `input#mat-mdc-checkbox-0-input` → marcar
- Botão **Autorizar** fica habilitado após checkbox: `button:has-text('Autorizar')` / `span.mdc-button__label:has-text('Autorizar')`
- Classe do botão desabilitado: `mat-mdc-button-disabled` → aguardar sumir antes de clicar

**Tela de sucesso:**
- Fundo verde, texto: "Pronto! Finalizamos sua assinatura com sucesso."
- Protocolo: `#XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
- Detectar sucesso: `div#sucesso` ou `div.tela-finalizadora` ou texto "Finalizamos sua assinatura"
- Fechar aba e voltar para `/consignado-privado/{UUID}`

---

### B.4 — Aguardar Pipeline Completar
- Após autorização, pipeline avança: Consulta autorizada → Retorno em processamento → Retorno disponível
- Bot faz polling na página `/consignado-privado/{UUID}` até "Produtos disponíveis" aparecer
- Detectar retorno disponível: seção `h2:has-text('Produtos disponíveis')` ou verificar todos os 4 dots verdes
- **Tempo de espera:** pode levar minutos (Dataprev é lento — igual ao VCTex)
- Após aparecer: clicar "Iniciar" no Contrato Novo → segue Passo 4 do Cenário A

---

## SELETORES ANGULAR MATERIAL — REGRAS

| Componente | Seletor correto |
|-----------|----------------|
| Dropdown (mat-select) | `page.click('mat-select')` → `page.click('mat-option:has-text("texto")')` |
| Input com máscara | `input[mask="000.000.000-00"]` (não usar ID gerado dinamicamente) |
| Botão padrão | `button:has-text('texto')` |
| Checkbox MDC (autorização) | `input#mat-mdc-checkbox-0-input` |
| Alert/toast erro | `mat-snack-bar-container` ou elemento com texto da mensagem |
| Ícone copiar | `mat-icon:has-text('content_copy')` → clicar no pai `button` |

---

## STATUS DE MAPEAMENTO

- [x] Fluxo Cenário A — lead já autorizado, sem margem (inelegível)
- [x] Fluxo Cenário B — lead não autorizado → DataPrev → Plurio → retorno
- [x] Resultado ELEGÍVEL com valores — `strong.valorLiberado`, resumo da operação completo
- [ ] Seletores exatos mat-select confirmados via HTML
- [ ] Como detectar "Retorno disponível" por classe CSS (verde ativo vs cinza)
- [ ] Tela de login (campos + SMS token 6 dígitos separados)
