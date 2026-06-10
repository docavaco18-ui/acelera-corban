# RELATORIO DE AUDITORIA TECNICA PRE-DEPLOY

Projeto: ACELERA CORBAN CODEX

Data da auditoria: 2026-06-09

Auditor: Codex

Modo de atuacao: auditoria tecnica sênior, sem correcao de codigo de produto.

Escopo solicitado: revisar estrutura, dependencias, frontend, backend, banco, seguranca, performance, UX, responsividade, testes e deploy antes de liberar o projeto para producao.

Resultado deste artefato: relatorio tecnico detalhado para o Claude Code corrigir antes do deploy.

Observacao importante: nenhum segredo, token, senha, cookie ou valor sensivel foi reproduzido neste relatorio.

Observacao operacional: a existencia fisica de arquivos sensiveis foi registrada apenas por nome/categoria.

Repositorio auditado: `/Users/macbookdegabriel/projetos/ACELERA CORBAN CODEX`.

Branch local: `main`.

Estado Git observado: branch local `main` estava `ahead 22` de `origin/main`.

Mudancas pre-existentes observadas no inicio: `AGENTS.md`, `CLAUDE.md`, `PROMPT_CLAUDE_DESIGN_SECOES_SISTEMA.json`, `PROMPT_CLAUDE_DESIGN_V2_COMPLETO.json`.

Este relatorio foi criado dentro de `docs/` e e o unico artefato novo planejado pela auditoria.

---

## 1. Resumo Executivo

Status geral: o projeto ainda nao deve ser considerado pronto para deploy sem correcoes.

Classificacao geral: pre-deploy com bloqueios tecnicos.

Pontos positivos: o backend possui cobertura automatizada relevante.

Pontos positivos: os testes backend executaram com sucesso quando o ambiente Python 3.12 foi usado.

Pontos positivos: o build frontend executou com sucesso localmente.

Pontos positivos: endpoints protegidos retornaram 401/403 sem token, indicando barreira de autenticacao ativa.

Pontos positivos: a tela de login renderizou em desktop e mobile sem overflow horizontal.

Pontos positivos: ha testes especificos para isolamento multi-tenant, broadcast, credenciais e webhooks.

Bloqueio 1: deploy Docker do frontend pode gerar app sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

Bloqueio 2: endpoints de estatisticas Mercantil e VCTex usam `MAX_ROWS` sem definicao no modulo.

Bloqueio 3: ha divergencia entre portas documentadas, Docker Compose, `.env` locais e CORS.

Bloqueio 4: ha arquivos sensiveis e operacionais no diretorio do projeto, mesmo que ignorados pelo Git.

Bloqueio 5: frontend nao possui scripts oficiais de lint ou teste.

Bloqueio 6: ambiente padrao `python3` da maquina e 3.13, mas o projeto declara Python 3.12 e falha ao instalar dependencias antigas nesse Python.

Risco alto: extensao Chrome coleta cookies, localStorage e sessionStorage completos e usa token deterministico.

Risco alto: `docker compose config` expande variaveis de `.env` e pode vazar segredos em logs de suporte/CI.

Risco alto: app usa Supabase service key global no backend; a seguranca depende fortemente de scoping por `owner_id`.

Risco medio: varios blocos `except Exception` ocultam falhas de integracao e estado.

Risco medio: WebSockets usam token de acesso em query string.

Risco medio: chunks frontend grandes indicam potencial problema de carregamento inicial.

Risco medio: componentes frontend muito extensos aumentam risco de regressao e dificultam manutencao.

Risco baixo/medio: login tem problemas de acessibilidade e falta favicon.

Conclusao executiva: corrigir primeiro deploy/env, `MAX_ROWS`, drift de portas/CORS, higiene de segredos e gates de CI.

Conclusao executiva: depois disso, rodar E2E autenticado real em todas as telas operacionais.

Conclusao executiva: somente apos essa segunda passada o sistema deve ir para VPS/producao.

---

## 2. Stack Identificada

Backend principal: FastAPI.

Linguagem backend: Python.

Versao declarada nas instrucoes do projeto: Python 3.12.

Servidor ASGI: Uvicorn.

Automacao de navegadores: Playwright.

Banco/API de dados: Supabase.

Autenticacao: Supabase Auth/JWT.

Cache/fila/estado auxiliar: Redis.

Frontend principal: React.

Bundler/frontend dev server: Vite.

Linguagem frontend: TypeScript.

HTTP client frontend: Axios.

Cliente Supabase frontend: `@supabase/supabase-js`.

Roteamento frontend: `react-router-dom`.

Visualizacao/graficos: `recharts`, `reactflow`.

Containerizacao: Dockerfile backend, Dockerfile frontend, Docker Compose local e compose de producao.

Proxy web em producao: Caddy na frente de Nginx do frontend.

Proxy de API em container frontend: `frontend/nginx.conf`.

Extensao de navegador: Chrome extension para captura de sessao Mercantil.

Modulos de negocio observados: V8, VCTex, Mercantil, Presenca Bank, CRM, Chatwoot, broadcast VendeAI, Aesir, Chipcare, PowerHub, Admin e Central de Controle.

Dependencias backend principais observadas em `backend/requirements.txt`: `fastapi==0.115.0`, `uvicorn==0.30.0`, `supabase==2.9.0`, `redis==5.0.8`, `playwright==1.47.0`, `pytest==8.3.3`.

Dependencias frontend principais observadas em `frontend/package.json`: React 19, Vite 5, Supabase JS, Axios, Router 7, Recharts.

Banco de dados local nao foi executado diretamente; a app usa Supabase remoto via variaveis de ambiente.

RLS nao foi validado diretamente no banco remoto nesta auditoria.

As verificacoes de isolamento foram baseadas nos testes automatizados e leitura de codigo.

---

## 3. Estrutura do Projeto

Diretorio raiz auditado: `/Users/macbookdegabriel/projetos/ACELERA CORBAN CODEX`.

Pastas principais: `backend`, `frontend`, `migrations`, `chrome-extension`, `docs`, `scripts`.

Arquivos de instrucao encontrados: `AGENTS.md` e `CLAUDE.md`.

Arquivos Docker encontrados: `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`.

Arquivos de ambiente fisicos encontrados: `.env`, `.env.bak`, `backend/.env`, `frontend/.env`, `frontend/.env.local`.

Arquivos de ambiente versionados observados: `.env.example`.

Arquivos de dados fisicos encontrados no diretorio raiz: CSVs de mailing/teste e `dump.rdb`.

Artefatos temporarios encontrados no diretorio raiz: scripts `tmp_*.py`.

Artefatos de estado sensivel encontrados: `backend/.bot_state/mercantil/*.json`.

Volume de codigo aproximado excluindo `node_modules`, `dist` e caches: mais de 38 mil linhas.

Diretorio frontend `src` concentra aproximadamente 16 mil linhas.

Diretorio backend `app` concentra aproximadamente 19 mil linhas.

Componentes frontend grandes observados: `CRM.tsx`, `DisparoAesir.tsx`, `DisparoChipcare.tsx`, `ModoDeUso.tsx`, `CentralControle.tsx`.

Risco estrutural: muitos estilos parecem embutidos nos componentes, com pouca centralizacao visual.

Risco estrutural: raiz do projeto contem prompts, relatórios antigos, dados e temporarios que nao deveriam compor o pacote operacional.

Risco estrutural: ambiente local e ambiente Docker divergem em portas.

Risco estrutural: producao depende de uma combinacao de Caddy, Nginx, Vite build-time env e backend env.

Recomendacao estrutural: separar claramente artefatos de auditoria, dados locais, backups e runtime state do pacote de deploy.

Recomendacao estrutural: criar uma pasta `docs/audits/` para relatorios historicos ou mover os relatórios antigos para la.

Recomendacao estrutural: remover scripts temporarios da raiz ou mover para `scripts/dev/` com nomes e propositos claros.

Recomendacao estrutural: manter somente exemplos sanitizados de env no repositorio.

---

## 4. Comandos Executados

Comando: leitura de estado Git com `git status --short --branch`.

Resultado: branch `main` ahead 22 e worktree ja estava sujo antes da auditoria.

Comando: instalacao frontend com `npm ci`.

Resultado: sucesso.

Comando: build frontend com `npm run build`.

Resultado: sucesso.

Comando: lint frontend com `npm run lint`.

Resultado: falhou porque nao existe script `lint`.

Comando: testes frontend com `npm test`.

Resultado: falhou porque nao existe script `test`.

Comando: auditoria npm com `npm audit --json`.

Resultado: 2 vulnerabilidades moderadas ligadas a Vite/esbuild.

Comando: checagem de pacotes frontend com `npm outdated --json`.

Resultado: varias dependencias com versoes mais novas disponiveis; Vite major novo disponivel.

Comando: instalacao backend com `python3 -m pip install -r requirements.txt`.

Resultado: falhou no Python 3.13 por incompatibilidade de compilacao de dependencia antiga do Playwright/greenlet.

Comando: execucao backend com `uv run --python 3.12 --with-requirements requirements.txt python -m pytest -q`.

Resultado: 106 testes passaram.

Comando: compile check backend com `python3 -m compileall -q app tests`.

Resultado: sucesso.

Comando: auditoria Python com `pip-audit` em ambiente Python 3.12 via `uv run`.

Resultado: nenhuma vulnerabilidade conhecida detectada nas dependencias Python instaladas.

Comando: `uvx ruff check app tests --output-format=concise`.

Resultado: 155 achados, incluindo `MAX_ROWS` indefinido em Mercantil e VCTex.

Comando: health backend em `http://localhost:8003/health`.

Resultado: `{"status":"ok"}`.

Comando: health backend em `http://localhost:8003/api/health`.

Resultado: `{"status":"ok"}`.

Comando: leitura OpenAPI em `http://localhost:8003/openapi.json`.

Resultado: API respondeu com titulo `Acelera Corban` e 154 paths.

Comando: testes de endpoints protegidos sem token.

Resultado: endpoints retornaram 401/403, conforme esperado para ausencia de autenticacao.

Comando: preflight CORS com origem `http://localhost:3004`.

Resultado: origem aceita.

Comando: preflight CORS com origem `http://127.0.0.1:3004`.

Resultado: origem rejeitada com `400 Disallowed CORS origin`.

Comando: dev server frontend em `npm run dev -- --host 127.0.0.1 --port 3004`.

Resultado: frontend abriu em `http://127.0.0.1:3004/`.

Comando: Playwright visual para desktop e mobile.

Resultado: login renderizou em desktop e mobile, sem overflow horizontal.

Comando: requisicao `favicon.ico` no frontend local.

Resultado: 404.

---

## 5. Testes Realizados

Teste de build frontend: aprovado.

Evidencia: `npm run build` concluiu com Vite.

Observacao: build gerar bundle nao garante que o app de producao esteja autenticando, porque Supabase env e injetado em build time.

Teste de lint frontend: nao executavel.

Evidencia: `frontend/package.json` nao possui script `lint`.

Teste unitario frontend: nao executavel.

Evidencia: `frontend/package.json` nao possui script `test`.

Teste backend automatizado: aprovado em Python 3.12.

Evidencia: `106 passed`.

Teste backend no Python padrao da maquina: ambiente inconsistente.

Evidencia: `python3` local e 3.13.5 e instalacao limpa falhou.

Teste de compilacao backend: aprovado.

Teste de auditoria de vulnerabilidades Python: aprovado.

Teste de auditoria npm: encontrou vulnerabilidades moderadas.

Teste de health backend: aprovado.

Teste de OpenAPI backend: aprovado.

Teste de autorizacao sem token: aprovado para endpoints testados.

Teste CORS `localhost`: aprovado.

Teste CORS `127.0.0.1`: reprovado.

Teste visual desktop da tela de login: aprovado com ressalvas de acessibilidade.

Teste visual mobile da tela de login: aprovado com ressalvas de acessibilidade.

Teste de telas internas autenticadas: nao concluido.

Motivo: nao havia sessao Supabase autenticada disponivel para navegar pelas telas internas.

Teste real dos bots bancarios: nao executado.

Motivo: exigiria credenciais bancarias, sessoes e ambiente operacional externo.

Teste real de envio WhatsApp/VendeAI/Aesir/Chipcare: nao executado.

Motivo: risco operacional de disparo real e ausencia de credenciais/sessao aprovadas para teste.

Teste direto de banco/RLS remoto: nao executado.

Motivo: auditoria local sem aplicar queries remotas de verificacao de RLS.

Teste Docker build completo: nao executado ate o fim.

Motivo: a leitura de configuracao ja evidenciou problema de env build-time; ainda assim deve virar gate obrigatorio.

---

## 6. Problemas Criticos

### Critico 1 - Frontend Docker de producao pode buildar sem variaveis Supabase

Arquivo: `docker-compose.prod.yml`.

Linhas: `docker-compose.prod.yml:20-24`.

Evidencia: o compose passa `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` como build args.

Arquivo: `frontend/Dockerfile`.

Linhas: `frontend/Dockerfile:1-6`.

Evidencia: o Dockerfile nao declara `ARG VITE_SUPABASE_URL` nem `ARG VITE_SUPABASE_ANON_KEY`.

Arquivo: `frontend/src/lib/supabase.ts`.

Linhas: `frontend/src/lib/supabase.ts:3-8`.

Evidencia: o frontend cria o cliente Supabase diretamente a partir de `import.meta.env.VITE_SUPABASE_URL` e `import.meta.env.VITE_SUPABASE_ANON_KEY`.

Impacto: app em producao pode subir com login quebrado ou cliente Supabase invalido.

Impacto: o erro apareceria no navegador, possivelmente apos o deploy ja estar no ar.

Causa provavel: variaveis Vite foram tratadas como runtime env, mas Vite injeta no build.

Recomendacao: adicionar `ARG` e `ENV` no Dockerfile do frontend antes de `npm run build`.

Recomendacao: adicionar `.env.production.example` com as chaves `VITE_*` obrigatorias.

Recomendacao: falhar o build explicitamente quando `VITE_SUPABASE_URL` ou `VITE_SUPABASE_ANON_KEY` estiverem vazias.

Instrucao Claude Code: corrigir `frontend/Dockerfile`, `docker-compose.prod.yml` e adicionar validação de env no frontend.

Instrucao Claude Code: rodar `docker compose -f docker-compose.prod.yml config` e garantir que nao existam warnings de variavel ausente.

Instrucao Claude Code: rodar build Docker do frontend em ambiente limpo, sem depender de `frontend/.env` local.

### Critico 2 - `MAX_ROWS` indefinido derruba endpoints Mercantil

Arquivo: `backend/app/routers/mercantil.py`.

Linhas: `backend/app/routers/mercantil.py:247` e `backend/app/routers/mercantil.py:311`.

Evidencia: `while offset < MAX_ROWS` usa simbolo inexistente no modulo.

Impacto: `/api/mercantil/stats/dashboard` pode retornar 500 para usuario autenticado.

Impacto: `/api/mercantil/batches/{batch_id}/stats` pode retornar 500 para usuario autenticado.

Impacto: dashboards e acompanhamento de lote Mercantil quebram em producao.

Causa provavel: codigo copiado de routers que declaram `MAX_ROWS`, sem importar/definir constante.

Recomendacao: definir constante local `MAX_ROWS` com o mesmo criterio dos demais routers ou centralizar em modulo comum.

Recomendacao: adicionar teste de rota autenticada cobrindo dashboard e batch stats Mercantil.

Instrucao Claude Code: corrigir definicao de `MAX_ROWS` e criar teste que falhe antes da correcao.

Instrucao Claude Code: validar com payload Supabase mockado para cobrir paginacao.

### Critico 3 - `MAX_ROWS` indefinido derruba endpoints VCTex

Arquivo: `backend/app/routers/vctex.py`.

Linhas: `backend/app/routers/vctex.py:132` e `backend/app/routers/vctex.py:195`.

Evidencia: `while offset < MAX_ROWS` usa simbolo inexistente no modulo.

Impacto: `/api/vctex/stats/dashboard` pode retornar 500 para usuario autenticado.

Impacto: `/api/vctex/batches/{batch_id}/stats` pode retornar 500 para usuario autenticado.

Impacto: dashboards e acompanhamento de lote VCTex quebram em producao.

Causa provavel: mesmo padrao de copia de router sem constante.

Recomendacao: mesma correcao aplicada ao Mercantil.

Recomendacao: incluir `ruff` ou pyflakes no CI para bloquear `F821 undefined name`.

Instrucao Claude Code: corrigir VCTex junto com Mercantil e adicionar teste especifico.

### Critico 4 - Drift de portas e CORS pode causar Network Error local e deploy errado

Arquivo: `AGENTS.md`.

Linhas relevantes: instrucoes locais apontam frontend 3004, backend 8003 e Redis 6381.

Arquivo: `docker-compose.yml`.

Linhas: `docker-compose.yml:7`, `docker-compose.yml:20`, `docker-compose.yml:27`.

Evidencia: compose local publica backend 8002, frontend 3002 e Redis 6381.

Arquivo: `backend/app/config.py`.

Linhas: `backend/app/config.py:15` e `backend/app/config.py:18`.

Evidencia: defaults sao Redis 6379 e CORS `http://localhost:3000`.

Arquivo: `backend/app/main.py`.

Linhas: `backend/app/main.py:68-74`.

Evidencia: CORS aceita apenas origens listadas em env.

Evidencia de runtime: `http://localhost:3004` passou CORS; `http://127.0.0.1:3004` falhou.

Impacto: o usuario pode abrir a URL impressa pelo Vite em 127.0.0.1 e receber erro de rede.

Impacto: automacoes e scripts podem mirar portas erradas.

Impacto: CODEX fork pode conflitar com instancia original se compose/nome de projeto nao forem isolados.

Recomendacao: escolher uma matriz oficial de portas por ambiente e aplicar em docs, compose, env example, frontend e scripts.

Recomendacao: incluir `http://127.0.0.1:3004` em CORS local ou forcar dev server a imprimir/usar `localhost`.

Recomendacao: reduzir uso de URL absoluta no frontend em dev, usando proxy relativo `/api`.

Instrucao Claude Code: corrigir `docker-compose.yml`, `.env.example`, docs e scripts para uma unica verdade.

Instrucao Claude Code: adicionar smoke test CORS para `localhost` e `127.0.0.1`.

### Critico 5 - Arquivos sensiveis existem fisicamente no workspace

Arquivos observados: `.env`, `.env.bak`, `backend/.env`, `frontend/.env`, `frontend/.env.local`.

Artefatos observados: `backend/.bot_state/mercantil/*.json`.

Dados observados: CSVs de mailing/teste e `dump.rdb`.

Evidencia Git: arquivos sensiveis principais estao ignorados, mas existem no diretorio.

Impacto: copia manual, zip, rsync, suporte remoto ou deploy mal configurado pode vazar segredos e PII.

Impacto: `.env.bak` e estado de navegador sao especialmente perigosos por parecerem backups esquecidos.

Impacto: `docker compose config` pode expandir variaveis de `.env` em logs.

Causa provavel: operacao local com artefatos reais dentro da raiz do projeto.

Recomendacao: mover segredos e estados para pasta externa ao repo.

Recomendacao: apagar backups locais sensiveis apos migrar para cofre/secret manager.

Recomendacao: rotacionar segredos que ficaram em arquivos locais ou foram expostos em terminais/logs.

Recomendacao: adicionar checagem de secrets no CI e no pre-deploy.

Instrucao Claude Code: nao imprimir valores de `.env` em logs.

Instrucao Claude Code: criar script seguro que verifique existencia de arquivos sensiveis sem mostrar conteudo.

Instrucao Claude Code: adicionar `.dockerignore` impedindo envio de `.env*`, `.bot_state`, CSVs, RDBs e temporarios ao contexto Docker.

---

## 7. Problemas de Alta Severidade

### Alta 1 - Extensao Chrome tem permissao ampla e captura sessao completa

Arquivo: `chrome-extension/manifest.json`.

Linhas relevantes: permissoes e host permissions incluem HTTP local e padroes amplos.

Arquivo: `chrome-extension/content.js`.

Linhas relevantes: coleta cookies, localStorage e sessionStorage.

Arquivo: `backend/app/routers/mercantil.py`.

Linhas: `backend/app/routers/mercantil.py:32-49`.

Evidencia: token da extensao e deterministico a partir de user_id e segredo de app.

Impacto: vazamento de token ou payload da extensao pode virar tomada de sessao.

Impacto: extensao com permissao ampla aumenta superficie de coleta acidental.

Causa provavel: solucao operacional rapida para importar sessao Mercantil.

Recomendacao: limitar host permissions ao dominio Mercantil estritamente necessario.

Recomendacao: substituir token deterministico por token curto, rotativo e com expiracao.

Recomendacao: registrar auditoria de importacao de sessao por usuario.

Recomendacao: criptografar estado de navegador em repouso ou guardar fora do repo.

Instrucao Claude Code: revisar manifest, content script, endpoint de importacao e modelo de token.

### Alta 2 - Ambiente Python padrao nao reproduz stack declarada

Evidencia: `python3` local e Python 3.13.5.

Evidencia: instalacao direta com `python3 -m pip install -r requirements.txt` falhou.

Evidencia: o mesmo projeto funcionou com Python 3.12 via `uv run --python 3.12`.

Impacto: novo desenvolvedor, VPS ou CI sem Python 3.12 pode falhar antes dos testes.

Impacto: a falha aparece em dependencia compilada, dificil de diagnosticar para operador nao tecnico.

Causa provavel: falta de pin de runtime executavel no repo.

Recomendacao: adicionar `.python-version` com `3.12`.

Recomendacao: documentar `uv run --python 3.12` como caminho oficial.

Recomendacao: considerar `uv.lock` ou container dev para reproducibilidade.

Instrucao Claude Code: criar setup de ambiente que falhe cedo quando Python != 3.12.

### Alta 3 - Frontend nao possui lint nem testes

Arquivo: `frontend/package.json`.

Evidencia: scripts disponiveis sao build/dev/preview; lint e test ausentes.

Impacto: regressao de UI, hooks, acessibilidade e contratos de API so aparecem manualmente.

Impacto: app tem muitos componentes grandes, aumentando risco sem teste.

Causa provavel: foco em entrega operacional sem pipeline frontend.

Recomendacao: adicionar ESLint com regras React Hooks e TypeScript.

Recomendacao: adicionar Vitest para utilitarios e componentes criticos.

Recomendacao: adicionar Playwright E2E para login, roteamento e principais telas com mocks.

Instrucao Claude Code: criar scripts `lint`, `test` e `test:e2e` sem bloquear a primeira correcao em refactor grande.

### Alta 4 - Vite/esbuild com vulnerabilidades moderadas

Arquivo: `frontend/package-lock.json`.

Evidencia: `npm audit --json` apontou 2 vulnerabilidades moderadas.

Pacotes afetados: cadeia Vite/esbuild.

Impacto: dev server pode ficar exposto a comportamento inseguro se usado em rede.

Impacto: scanners de deploy/empresa podem reprovar o pacote.

Causa provavel: Vite 5 ainda no projeto.

Recomendacao: planejar upgrade de Vite/plugin React com teste de build e preview.

Recomendacao: nao expor Vite dev server fora de localhost.

Instrucao Claude Code: avaliar menor upgrade seguro ou migracao para versao suportada, validando build e rotas.

### Alta 5 - Service key Supabase global exige disciplina perfeita de scoping

Arquivo: `backend/app/database.py`.

Evidencia: backend usa cliente Supabase com service key.

Evidencia positiva: ha helper `scoped` e testes de isolamento.

Impacto: qualquer endpoint novo sem `owner_id` pode vazar dados entre tenants.

Impacto: updates globais de manutencao podem afetar todos os usuarios.

Arquivo: `backend/app/main.py`.

Linhas: `backend/app/main.py:47-56`.

Evidencia: startup marca runs Chatwoot/Aesir globais como interrompidos.

Causa provavel: service role usada para backend SaaS.

Recomendacao: manter testes AST de scoping e expandir lista de tabelas protegidas.

Recomendacao: tratar operacoes globais como tarefas administrativas auditadas.

Instrucao Claude Code: revisar todos os endpoints novos e adicionar teste de guardrail para tabelas tenant-owned.

### Alta 6 - `docker compose config` pode vazar segredos

Arquivo: `docker-compose.yml`.

Linhas: `docker-compose.yml:8`.

Evidencia: compose carrega `.env`.

Arquivo: `docker-compose.prod.yml`.

Linhas: `docker-compose.prod.yml:6`.

Evidencia: compose de producao tambem carrega `.env`.

Impacto: comando de diagnostico pode imprimir variaveis expandidas.

Impacto: logs de CI, prints e anexos de suporte podem expor segredos.

Recomendacao: orientar time a nunca anexar saida bruta de compose config.

Recomendacao: usar secret manager ou env externo no host.

Instrucao Claude Code: adicionar script `scripts/check_compose_sanitized.sh` ou doc de diagnostico seguro.

### Alta 7 - Exportacoes usam URL absoluta em alguns pontos

Arquivo: `frontend/src/lib/api.ts`.

Linhas: `frontend/src/lib/api.ts:6-7`.

Evidencia: `BASE_URL` depende de `VITE_API_URL` ou string vazia.

Risco: quando `VITE_API_URL` e absoluto, bypassa proxy Vite/Nginx e depende de CORS.

Impacto: dev/prod podem ter comportamento diferente para downloads e chamadas.

Recomendacao: preferir URLs relativas em producao.

Instrucao Claude Code: revisar exportacoes/downloads que constroem URL manualmente e padronizar via axios/proxy.

---

## 8. Problemas de Media Severidade

### Media 1 - `except Exception` silencioso no startup

Arquivo: `backend/app/main.py`.

Linhas: `backend/app/main.py:40-58`.

Evidencia: falha ao marcar runs interrompidos e engolida com `pass`.

Impacto: inconsistencias operacionais podem permanecer sem alerta.

Recomendacao: logar excecao com contexto e manter app subindo se for desejado.

Instrucao Claude Code: trocar `pass` por log estruturado e teste de falha controlada.

### Media 2 - FastAPI `on_event` depreciado

Arquivo: `backend/app/main.py`.

Linha: `backend/app/main.py:40`.

Evidencia: testes emitiram aviso de deprecacao.

Impacto: risco de manutencao futura.

Recomendacao: migrar para lifespan.

Instrucao Claude Code: migrar startup tasks para lifespan sem mudar comportamento.

### Media 3 - Pydantic `class Config` depreciado

Arquivo: `backend/app/config.py`.

Linhas: `backend/app/config.py:62-63`.

Evidencia: testes emitiram aviso Pydantic V2.

Impacto: ruido em testes e risco de quebra futura.

Recomendacao: usar `SettingsConfigDict`.

Instrucao Claude Code: substituir por `model_config = SettingsConfigDict(env_file=".env")`.

### Media 4 - Tokens WebSocket em query string

Arquivos: hooks frontend de WebSocket e `backend/app/routers/ws.py`.

Evidencia: token e passado como parametro `token`.

Impacto: query string pode aparecer em logs, historico de proxy e ferramentas.

Recomendacao: usar ticket curto de WS, cookie seguro ou subprotocol quando aplicavel.

Instrucao Claude Code: desenhar migracao sem quebrar clientes existentes imediatamente.

### Media 5 - Login mostra erro bruto do Supabase

Arquivo: `frontend/src/pages/Login.tsx`.

Linhas: `frontend/src/pages/Login.tsx:16-20`.

Evidencia: `setErr(error.message)` renderiza mensagem direta do provedor.

Impacto: UX inconsistente e possivel exposicao de detalhe interno.

Recomendacao: mapear erros comuns para mensagens amigaveis.

Instrucao Claude Code: normalizar mensagens de login e manter detalhe tecnico no console/log se necessario.

### Media 6 - Labels do login nao estao associados aos inputs

Arquivo: `frontend/src/pages/Login.tsx`.

Linhas: `frontend/src/pages/Login.tsx:40-62`.

Evidencia: `label` visual sem `htmlFor`, inputs sem `id` e sem `name`.

Impacto: acessibilidade e autofill prejudicados.

Recomendacao: adicionar `id`, `name`, `htmlFor` e `autoComplete`.

Instrucao Claude Code: corrigir login e adicionar teste acessivel basico.

### Media 7 - Favicon ausente

Arquivo: `frontend/index.html`.

Evidencia de runtime: `GET /favicon.ico` retornou 404.

Impacto: acabamento de produto e ruido no console.

Recomendacao: adicionar favicon e link no HTML.

Instrucao Claude Code: incluir asset simples ou oficial do produto.

### Media 8 - Componentes frontend grandes demais

Arquivos: `frontend/src/pages/CRM.tsx`, `DisparoAesir.tsx`, `DisparoChipcare.tsx`, `ModoDeUso.tsx`, `CentralControle.tsx`.

Evidencia: arquivos entre centenas e mais de mil linhas.

Impacto: manutencao e revisao ficam lentas.

Impacto: alteracoes pequenas podem quebrar areas distantes.

Recomendacao: extrair hooks, componentes de tabela, forms e clients.

Instrucao Claude Code: nao fazer refactor massivo antes dos bloqueios; planejar em etapas apos estabilizar deploy.

### Media 9 - Chunks frontend grandes

Evidencia build: `vendor-charts` ~402 kB bruto.

Evidencia build: `index` ~260 kB bruto.

Evidencia build: `vendor-supabase` ~206 kB bruto.

Evidencia build: `Higienizacao` ~206 kB bruto.

Impacto: carregamento inicial pode ficar pesado em conexoes fracas.

Recomendacao: lazy-load por rota e importar graficos apenas onde necessario.

Instrucao Claude Code: medir bundle apos correcoes criticas e aplicar split por rota.

### Media 10 - Navegacao por hover pode ser ruim em touch/teclado

Arquivo: `frontend/src/App.tsx`.

Evidencia: dropdowns de navegacao dependem de eventos de mouse.

Impacto: mobile/tablet e acessibilidade de teclado podem falhar.

Recomendacao: suportar click/touch, foco e ARIA.

Instrucao Claude Code: validar nav em mobile com Playwright depois da correcao.

### Media 11 - Operacoes admin destrutivas dependem de confirm no frontend

Arquivo: `backend/app/routers/admin.py`.

Evidencia: backend valida admin, mas nao exige reautenticacao/segunda confirmacao.

Impacto: conta admin sequestrada ou sessao aberta permite acoes destrutivas.

Recomendacao: exigir reautenticacao para delete/promote/ban.

Instrucao Claude Code: avaliar MFA/reauth Supabase para acoes sensiveis.

### Media 12 - Senha interna CRM usa hash simples

Arquivo: `backend/app/routers/crm.py`.

Evidencia: senha CRM usa SHA256 com salt e aceita tamanho minimo baixo.

Impacto: se hash vazar, resistencia a brute force e limitada.

Recomendacao: usar Argon2/bcrypt ou reautenticacao Supabase.

Instrucao Claude Code: migrar sem quebrar usuarios existentes.

### Media 13 - Webhook deveria tratar JSON invalido explicitamente

Arquivo: `backend/app/routers/webhook.py`.

Evidencia: parsing JSON precisa responder 400 para body invalido.

Impacto: payload malformado pode virar erro interno generico.

Recomendacao: capturar erro de JSON e retornar 400 com mensagem segura.

Instrucao Claude Code: adicionar teste de webhook com JSON invalido.

### Media 14 - Uso de alert/confirm no frontend

Arquivos: paginas Admin, Dashboard, Chatwoot e outras.

Evidencia: UI usa `alert`/`confirm` nativos em fluxos de operacao.

Impacto: UX inconsistente e testes E2E mais frageis.

Recomendacao: criar modal/toast padronizado.

Instrucao Claude Code: priorizar acoes destrutivas e erros operacionais.

### Media 15 - Raiz do projeto contem artefatos de auditoria e prompts soltos

Arquivos observados: prompts JSON e relatorios anteriores.

Impacto: aumenta chance de deploy com arquivos desnecessarios.

Recomendacao: mover para `docs/` ou excluir artefatos obsoletos apos aprovacao.

Instrucao Claude Code: nao apagar sem confirmacao; propor limpeza em PR separado.

---

## 9. Problemas de Baixa Severidade

Baixa 1: o titulo HTML existe, mas favicon nao.

Baixa 2: login tem texto cinza com contraste que deve ser medido contra fundo escuro.

Baixa 3: botao de login usa uppercase e letter spacing, mas nao tem estado de foco customizado visivel.

Baixa 4: telas internas nao foram verificadas visualmente por falta de sessao.

Baixa 5: `.env.example` precisa ficar mais completo para ambiente CODEX.

Baixa 6: docs citam muitas portas e modos; reduzir duplicacao diminuiria erro humano.

Baixa 7: comandos oficiais deveriam estar em um `Makefile` ou `justfile`.

Baixa 8: scripts temporarios deveriam ter dono e descricao.

Baixa 9: mensagens de erro backend sao majoritariamente seguras, mas a consistencia entre routers varia.

Baixa 10: `npm outdated` mostra varios upgrades disponiveis que nao sao emergenciais, mas devem entrar no ciclo de manutencao.

Baixa 11: o build frontend nao mostrou erro de tamanho de chunk, mas a tendencia merece acompanhamento.

Baixa 12: varios arquivos grandes poderiam ter comentarios de arquitetura no topo.

Baixa 13: docs de deploy devem incluir smoke checklist pos-subida.

Baixa 14: relatorios antigos na raiz podem confundir proximo agente.

Baixa 15: o healthcheck atual retorna apenas status ok, sem checar dependencias.

Baixa 16: Caddyfile e Nginx precisam de comentario curto explicando quem roteia `/api` e `/ws`.

Baixa 17: o frontend usa muitos estilos inline, dificultando revisao visual automatizada.

Baixa 18: algumas mensagens internas misturam portugues tecnico e nomes de modulo; padronizar ajuda suporte.

Baixa 19: o projeto poderia ter uma matriz oficial de ambientes: dev local, docker local, VPS staging, VPS prod.

Baixa 20: o repositorio poderia ter template de PR com checklist de tenant isolation e secrets.

---

## 10. Frontend

Build: passou com `npm run build`.

Dev server: subiu em `http://127.0.0.1:3004/`.

Rota inicial: redirecionou para `/login` sem sessao.

Login desktop: renderizou corretamente.

Login mobile: renderizou corretamente.

Overflow horizontal no login: nao observado.

Problema: `favicon.ico` retorna 404.

Problema: labels do login nao sao semanticamente associados a inputs.

Problema: inputs de login nao possuem `name`/`autoComplete`.

Problema: erro de login renderiza mensagem bruta do Supabase.

Problema: frontend depende de `VITE_SUPABASE_*` em build time.

Problema: `VITE_API_URL` absoluto pode criar CORS inconsistente.

Problema: algumas exportacoes podem montar URLs fora do proxy.

Problema: nao ha scripts oficiais de lint/test.

Problema: componentes grandes reduzem confiabilidade de mudancas.

Problema: navegacao de menus precisa ser validada em mobile/touch/teclado.

Problema: uso de `alert`/`confirm` nativo em fluxos sensiveis.

Boa pratica observada: Axios injeta Authorization via sessao Supabase.

Boa pratica observada: interceptador faz signout em 401.

Risco: signout automatico em qualquer 401 pode derrubar usuario em falha momentanea de endpoint.

Recomendacao: diferenciar 401 real de auth e erros operacionais.

Recomendacao: adicionar boundary visual para erro global de API.

Recomendacao: adicionar Playwright E2E autenticado com usuario de teste.

Recomendacao: adicionar testes de contrato para clients frontend.

Recomendacao: separar componentes grandes em blocos testaveis.

Instrucao Claude Code: corrigir primeiro env/build, acessibilidade do login e scripts de teste/lint.

Instrucao Claude Code: depois executar uma rodada visual em todas as telas autenticadas.

---

## 11. Backend / API

Health endpoints: `/health` e `/api/health` responderam ok.

OpenAPI: respondeu com 154 paths.

Autenticacao: endpoints protegidos testados bloquearam ausencia de token.

Framework: FastAPI.

Config: Pydantic Settings.

Banco: Supabase client service role.

Roteadores principais: leads, bot, stats, webhook, ws, admin, batches, crm, chatwoot, command center, vctex, mercantil, presenca, broadcast, powerhub, aesir, chipcare.

Problema critico: `MAX_ROWS` indefinido em Mercantil.

Problema critico: `MAX_ROWS` indefinido em VCTex.

Problema medio: `on_event` depreciado.

Problema medio: startup sweep engole excecao.

Problema medio: algumas rotas podem responder erros inconsistentes entre modulos.

Problema medio: token WS em query string.

Problema medio: operacoes globais de startup afetam tabelas sem filtro de usuario.

Boa pratica observada: muitos endpoints usam `Depends(require_user)`.

Boa pratica observada: muitos acessos a tabela usam `scoped(db, table, user.user_id)`.

Boa pratica observada: testes automatizados cobrem varios guardrails.

Risco: qualquer novo endpoint sem scoping vira vazamento cross-tenant.

Risco: service key global no backend torna falhas de codigo mais graves.

Recomendacao: tornar `ruff` obrigatorio no backend.

Recomendacao: adicionar mypy/pyright gradualmente.

Recomendacao: criar testes para Mercantil/VCTex stats.

Recomendacao: transformar warnings em trabalho planejado de manutencao.

Instrucao Claude Code: aplicar correcao minima e teste antes de refactors maiores.

---

## 12. Banco de Dados

Banco remoto: Supabase.

Validacao direta de RLS: nao executada nesta auditoria.

Inferencia: app depende de `owner_id` para isolamento multi-tenant.

Evidencia positiva: testes backend incluem isolamento e guardrails.

Risco: service key no backend bypassa RLS se codigo nao filtrar.

Risco: operacoes globais de manutencao podem tocar dados de todos os tenants.

Risco: migracoes precisam ser verificadas contra ambiente real antes de deploy.

Risco: CSVs locais podem conter PII e nao devem ir para ambiente de deploy.

Risco: dumps locais podem conter dados sensiveis.

Recomendacao: rodar checklist SQL de RLS em staging.

Recomendacao: confirmar indices de `owner_id`, `batch_id`, `status` nas tabelas de alto volume.

Recomendacao: confirmar constraints/unique keys em IDs externos, como `consult_id`.

Recomendacao: adicionar smoke que cria dois usuarios de teste e valida isolamento ponta a ponta.

Recomendacao: guardar service key somente no backend em secret manager.

Recomendacao: nunca expor service key ao frontend ou build logs.

Instrucao Claude Code: revisar migrations e criar script read-only de validacao de RLS.

Instrucao Claude Code: nao aplicar migration destrutiva sem backup e confirmacao.

---

## 13. Seguranca

Ponto positivo: endpoints sem token retornaram 401/403 nos testes executados.

Ponto positivo: `.gitignore` ignora `.env` e familias de ambiente.

Ponto positivo: `.gitignore` ignora `.bot_state` e alguns arquivos de dados.

Ponto critico: arquivos sensiveis existem fisicamente no workspace.

Ponto critico: `.env.bak` existe e e um padrao perigoso.

Ponto critico: storage state Mercantil existe em disco.

Ponto alto: extensao Chrome captura estado de sessao completo.

Ponto alto: token de extensao deterministico nao e ideal.

Ponto alto: host permissions da extensao devem ser reduzidas.

Ponto medio: WebSocket com token em query string.

Ponto medio: logs de compose/config podem vazar env.

Ponto medio: erros de login vindos do Supabase aparecem diretamente na UI.

Ponto medio: admin destructive actions deveriam exigir reauth.

Ponto medio: CRM password hashing deveria usar KDF adequado.

Ponto medio: falta scanner de secrets como gate.

Ponto medio: falta SBOM/dependency scan padronizado.

Recomendacao: rotacionar segredos presentes em arquivos locais.

Recomendacao: separar credenciais de desenvolvimento, staging e producao.

Recomendacao: adicionar gitleaks/trufflehog em CI.

Recomendacao: adicionar `pip-audit` e `npm audit` em CI com politica definida.

Recomendacao: criar runbook de incidente para vazamento de `.env`.

Instrucao Claude Code: implementar controles sem registrar nenhum valor secreto em output.

---

## 14. Performance

Frontend build passou.

Bundle observado: chunks principais relevantes acima de 200 kB brutos.

Maior chunk observado: `vendor-charts`.

Risco: graficos podem pesar em rotas que nao precisam deles.

Risco: componentes grandes dificultam code splitting efetivo.

Risco: Supabase client e charts entram em partes grandes do bundle.

Backend: health respondeu rapido localmente.

Backend: testes automatizados passaram em poucos segundos.

Backend: bots Playwright podem consumir muita memoria.

Config backend: VCTex e Mercantil possuem tetos de workers menores, o que e bom.

Risco backend: startup cria tarefas de monitoramento sem health detalhado.

Risco backend: healthcheck atual nao verifica Redis, Supabase ou filas.

Risco Docker: `playwright install --with-deps chromium` aumenta imagem backend.

Risco Docker: sem `.dockerignore`, contexto de build pode incluir dados/artefatos desnecessarios.

Recomendacao: adicionar `.dockerignore` urgente.

Recomendacao: medir tamanho final das imagens Docker.

Recomendacao: adicionar route-level lazy loading.

Recomendacao: adicionar Lighthouse/Web Vitals em staging.

Recomendacao: criar health detalhado interno protegido ou endpoint readiness para dependencias.

Instrucao Claude Code: nao otimizar performance antes de corrigir bloqueios de deploy e bugs 500.

---

## 15. UX / UI

Tela de login: visualmente consistente em dark theme.

Tela de login: centralizada em desktop.

Tela de login: coube em mobile.

Problema UX: mensagem de erro do login nao e normalizada.

Problema UX: falta autofill/autocomplete nos campos.

Problema UX: labels nao sao clicaveis/associadas.

Problema UX: falta favicon.

Problema UX: menus por hover podem falhar em touch.

Problema UX: alerts/confirms nativos passam sensacao menos profissional.

Problema UX: telas internas nao foram visualmente auditadas por falta de sessao.

Risco UX: dashboards quebrados por `MAX_ROWS` geram erro tecnico em tela.

Risco UX: Network Error por CORS/porta transmite instabilidade.

Risco UX: se frontend prod buildar sem env, usuario nao conseguira logar.

Recomendacao: criar usuario de staging para QA visual.

Recomendacao: criar checklist de telas com screenshots desktop/mobile.

Recomendacao: padronizar estados loading/empty/error.

Recomendacao: substituir `alert`/`confirm` por componentes controlados.

Recomendacao: testar teclado e leitor de tela nos fluxos principais.

Instrucao Claude Code: corrigir login e navegacao antes da rodada final de QA.

---

## 16. Responsividade

Login desktop: aprovado visualmente.

Login mobile: aprovado visualmente.

Overflow horizontal no login: nao observado.

Viewport desktop testado: 1440 px de largura.

Viewport mobile testado: 390 px de largura.

Limite: apenas rota de login foi auditada visualmente.

Limite: telas autenticadas nao foram abertas.

Risco: componentes grandes e tabelas operacionais podem ter overflow em mobile.

Risco: dashboards com graficos podem quebrar em telas estreitas.

Risco: paginas de disparo com tabelas/forms longos podem exigir scroll mal controlado.

Risco: menus por hover podem nao funcionar bem em mobile.

Recomendacao: criar smoke visual mobile para cada rota interna.

Recomendacao: testar pelo menos larguras 390, 768, 1024 e 1440.

Recomendacao: testar tabelas com dados longos, mensagens de erro e loading.

Recomendacao: incluir caso de usuario sem dados e com muitos dados.

Instrucao Claude Code: depois de liberar login/test user, rodar Playwright screenshots em todas as rotas.

---

## 17. Dependencias

Frontend instalou com `npm ci`.

Frontend possui 2 vulnerabilidades moderadas em auditoria npm.

Frontend tem dependencias com updates maiores disponiveis.

Vite atual no lock esta em familia 5.

Upgrade para Vite major mais novo deve ser planejado com teste.

Backend dependencies instalaram e testaram em Python 3.12 via `uv`.

Backend falhou em instalacao limpa no Python 3.13.

Python dependencies nao apresentaram vulnerabilidades conhecidas no `pip-audit` local.

Avisos backend: pytest-asyncio fixture loop scope.

Avisos backend: Pydantic class Config deprecada.

Avisos backend: FastAPI on_event deprecado.

Avisos backend: pacote gotrue deprecado.

Risco: sem lock Python, ambientes podem divergir.

Risco: sem CI, upgrades podem ficar acumulados.

Recomendacao: criar politica de atualizacao mensal.

Recomendacao: pin de runtime Python 3.12.

Recomendacao: gerar lock Python com ferramenta escolhida.

Recomendacao: adicionar Renovate/Dependabot com agrupamento controlado.

Instrucao Claude Code: nao atualizar tudo junto antes do deploy; priorizar vulnerabilidades e runtime reproducivel.

---

## 18. Variaveis de Ambiente

Arquivos reais encontrados: `.env`, `.env.bak`, `backend/.env`, `frontend/.env`, `frontend/.env.local`.

Arquivo exemplo encontrado: `.env.example`.

Risco: real env no workspace facilita vazamento por backup/copia.

Risco: `.env.bak` e padrao de segredo esquecido.

Risco: root `.env`, backend `.env` e frontend `.env.local` podem divergir.

Risco: Vite precisa de variaveis no build, nao apenas no runtime.

Risco: Compose prod usa `VITE_*` mas Dockerfile nao injeta.

Risco: CORS local nao cobre 127.0.0.1.

Risco: Redis aparece como 6379 em backend env e 6381 em docs/compose host.

Risco: `VITE_WS_URL` local pode ficar stale e confundir, especialmente se o codigo nao usar mais esse padrao.

Recomendacao: criar tabela oficial de env por ambiente.

Recomendacao: validar env no startup backend com mensagens claras.

Recomendacao: validar env no build frontend com erro claro.

Recomendacao: manter `.env.example` completo e sem valores reais.

Recomendacao: manter `.env.production.example` para build Vite.

Recomendacao: remover backups sensiveis da pasta do repo.

Instrucao Claude Code: implementar script `check_env.py` ou equivalente que mascara valores no output.

---

## 19. Build / Deploy

Build frontend local: passou.

Build backend Docker nao foi executado nesta auditoria ate imagem final.

Compose local: mapeia portas 8002 e 3002.

Docs locais CODEX: apontam 8003 e 3004.

Compose producao: usa Caddy na porta 80/443.

Nginx frontend: deve rotear `/api` e `/ws` para backend interno.

Risco critico: frontend prod pode buildar sem Supabase env.

Risco alto: `.dockerignore` ausente pode enviar arquivos sensiveis e pesados ao build context.

Risco alto: compose `name: acelera-corban` pode conflitar com outra copia do projeto.

Risco medio: healthcheck frontend so checa `/`, nao auth/API.

Risco medio: healthcheck backend so checa health simples.

Risco medio: deploy nao tem checklist visivel de migracoes e smoke pos-subida.

Recomendacao: adicionar `.dockerignore`.

Recomendacao: alinhar portas de compose local com fork CODEX ou documentar modo Docker separado.

Recomendacao: usar `COMPOSE_PROJECT_NAME` especifico para CODEX.

Recomendacao: adicionar `scripts/predeploy_check.sh`.

Recomendacao: rodar `docker compose -f docker-compose.prod.yml build --no-cache` em staging.

Recomendacao: rodar smoke via Caddy/Nginx, nao apenas via Vite.

Instrucao Claude Code: bloquear deploy enquanto build frontend Docker nao provar que `VITE_*` foi injetado.

---

## 20. Testes A/B de Comportamentos

Teste A: origem CORS `http://localhost:3004`.

Resultado A: aceita.

Teste B: origem CORS `http://127.0.0.1:3004`.

Resultado B: rejeitada.

Conclusao: comportamento muda por host, apesar de apontar para a mesma maquina.

Teste A: backend com Python 3.12 via `uv`.

Resultado A: testes passam.

Teste B: instalacao backend com Python 3.13 padrao.

Resultado B: falha ao instalar dependencias.

Conclusao: runtime precisa ser fixado.

Teste A: endpoints protegidos sem Authorization.

Resultado A: 401/403.

Teste B: endpoints com sessao real.

Resultado B: nao executado por falta de token/sessao.

Conclusao: barreira sem token funciona, mas fluxos autenticados ainda precisam QA.

Teste A: build Vite local com env local presente.

Resultado A: passa.

Teste B: build Docker prod limpo com build args.

Resultado B: nao validado; leitura indica risco de env nao injetada.

Conclusao: build local nao prova deploy Docker.

Teste A: login desktop.

Resultado A: renderiza.

Teste B: login mobile.

Resultado B: renderiza.

Conclusao: login esta visualmente aceitavel, mas acessibilidade precisa ajuste.

Teste A: `localhost` para frontend.

Resultado A: tende a alinhar com CORS configurado.

Teste B: `127.0.0.1` impresso pelo Vite.

Resultado B: pode gerar Network Error nas chamadas de API.

Conclusao: dev server e CORS devem usar o mesmo host.

---

## 21. Testes Manuais Necessarios Antes do Deploy

Manual 1: login com usuario comum real de staging.

Manual 2: login com usuario admin real de staging.

Manual 3: logout e expiracao de sessao.

Manual 4: acesso negado a `/admin` para usuario comum.

Manual 5: dashboard geral com dados vazios.

Manual 6: dashboard geral com dados reais.

Manual 7: Higienizacao V8 upload CSV pequeno.

Manual 8: Higienizacao V8 export CSV.

Manual 9: VCTex dashboard apos correcao de `MAX_ROWS`.

Manual 10: VCTex batch stats apos correcao de `MAX_ROWS`.

Manual 11: Mercantil dashboard apos correcao de `MAX_ROWS`.

Manual 12: Mercantil batch stats apos correcao de `MAX_ROWS`.

Manual 13: Mercantil SMS bridge com fluxo controlado.

Manual 14: extensao Chrome Mercantil com permissao reduzida.

Manual 15: Presenca Bank fluxo basico.

Manual 16: CRM criar proposta.

Manual 17: CRM mover proposta no funil.

Manual 18: CRM deletar proposta com confirmacao.

Manual 19: Chatwoot sincronizacao com credencial de teste.

Manual 20: Broadcast VendeAI sem disparo real, usando sandbox/mock.

Manual 21: Aesir dispatch em modo seguro.

Manual 22: Chipcare dispatch em modo seguro.

Manual 23: PowerHub bot start/stop/status.

Manual 24: Central de Controle com cada modulo.

Manual 25: Configuracoes de credenciais por usuario.

Manual 26: usuario A nao enxerga dados do usuario B.

Manual 27: admin ve lista de usuarios.

Manual 28: admin nao consegue apagar a propria conta sem protecao adicional.

Manual 29: responsividade mobile das tabelas.

Manual 30: teclado navega pelo menu e formulario.

Manual 31: reload direto em rotas internas funciona via Nginx.

Manual 32: `/api/health` via dominio publico funciona.

Manual 33: `/ws` via dominio publico conecta.

Manual 34: CORS prod aceita somente dominio esperado.

Manual 35: logs nao mostram tokens, Authorization nem cookies.

Manual 36: erro de Supabase indisponivel mostra mensagem amigavel.

Manual 37: Redis indisponivel falha de forma observavel.

Manual 38: restart backend nao perde estado de forma silenciosa.

Manual 39: deploy rollback documentado.

Manual 40: backup de banco antes de migration confirmado.

---

## 22. Testes Automatizados Recomendados

Automatizado 1: `ruff check backend/app backend/tests`.

Automatizado 2: `pytest -q` em Python 3.12.

Automatizado 3: `python -m compileall -q app tests`.

Automatizado 4: `pip-audit` em ambiente Python 3.12.

Automatizado 5: `npm ci`.

Automatizado 6: `npm run build`.

Automatizado 7: `npm audit --audit-level=moderate` com politica decidida.

Automatizado 8: ESLint frontend.

Automatizado 9: TypeScript check separado de build.

Automatizado 10: Vitest frontend para clients e hooks.

Automatizado 11: Playwright E2E login.

Automatizado 12: Playwright E2E rotas protegidas.

Automatizado 13: Playwright E2E CORS/proxy via preview ou Nginx.

Automatizado 14: teste backend Mercantil stats com Supabase mockado.

Automatizado 15: teste backend VCTex stats com Supabase mockado.

Automatizado 16: teste de importacao extension token com expiracao.

Automatizado 17: teste de webhook JSON invalido.

Automatizado 18: teste de admin destructive action com usuario comum.

Automatizado 19: teste de admin destructive action com admin sem reauth, apos nova politica.

Automatizado 20: teste AST para chamadas Supabase sem `scoped` em tabelas tenant-owned.

Automatizado 21: teste de CORS para `localhost:3004`.

Automatizado 22: teste de CORS para `127.0.0.1:3004`.

Automatizado 23: build Docker frontend limpo com args.

Automatizado 24: build Docker backend limpo.

Automatizado 25: smoke Docker Compose prod local.

Automatizado 26: scanner de secrets.

Automatizado 27: scanner de arquivos grandes/sensiveis no contexto Docker.

Automatizado 28: teste de bundle size max.

Automatizado 29: teste visual mobile de rotas criticas.

Automatizado 30: teste de acessibilidade com axe na tela de login e nav.

---

## 23. Instrucoes Diretas para Claude Code

Instrucao 1: nao aplicar refactor amplo antes de corrigir os bloqueios criticos.

Instrucao 2: criar branch/commit separado para cada grupo logico.

Instrucao 3: preservar mudancas pre-existentes em `AGENTS.md` e `CLAUDE.md`.

Instrucao 4: nao apagar arquivos sensiveis sem confirmacao do usuario, mas criar plano de limpeza.

Instrucao 5: nunca imprimir valores de `.env` ou cookies.

Instrucao 6: corrigir `frontend/Dockerfile` para receber `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

Instrucao 7: corrigir `docker-compose.prod.yml` se necessario para refletir build args reais.

Instrucao 8: adicionar validacao frontend de env obrigatoria.

Instrucao 9: adicionar `.dockerignore` com `.env*`, `.bot_state`, CSVs, RDBs, dumps, `node_modules`, `dist`, caches e temporarios.

Instrucao 10: corrigir `MAX_ROWS` em Mercantil.

Instrucao 11: corrigir `MAX_ROWS` em VCTex.

Instrucao 12: adicionar testes para os quatro endpoints afetados.

Instrucao 13: adicionar `ruff` como gate minimo backend.

Instrucao 14: configurar `.python-version` ou equivalente para Python 3.12.

Instrucao 15: documentar comando oficial com `uv run --python 3.12`.

Instrucao 16: alinhar portas em docs, compose, env example e scripts.

Instrucao 17: decidir se dev oficial usa `localhost` ou `127.0.0.1`.

Instrucao 18: corrigir CORS para o host dev escolhido.

Instrucao 19: evitar `VITE_API_URL` absoluto em producao quando proxy relativo resolve.

Instrucao 20: adicionar scripts `lint` e `test` no frontend.

Instrucao 21: corrigir acessibilidade do login.

Instrucao 22: adicionar favicon.

Instrucao 23: reduzir permissoes da extensao Chrome.

Instrucao 24: substituir token deterministico da extensao por mecanismo expiravel.

Instrucao 25: logar excecoes de startup sem derrubar a app desnecessariamente.

Instrucao 26: migrar FastAPI startup para lifespan em tarefa separada se nao couber no hotfix.

Instrucao 27: migrar Pydantic `Config` para `SettingsConfigDict`.

Instrucao 28: adicionar scanner de secrets.

Instrucao 29: rodar todos os comandos de verificacao antes de entregar.

Instrucao 30: entregar resumo com evidencias e screenshots novas das rotas corrigidas.

---

## 24. Plano de Prioridade

Prioridade P0.1: corrigir env/build do frontend Docker.

Prioridade P0.2: corrigir `MAX_ROWS` Mercantil.

Prioridade P0.3: corrigir `MAX_ROWS` VCTex.

Prioridade P0.4: alinhar CORS/portas locais para eliminar Network Error.

Prioridade P0.5: adicionar `.dockerignore` para impedir build context inseguro.

Prioridade P0.6: fixar runtime Python 3.12.

Prioridade P0.7: criar testes backend que cubram os bugs `MAX_ROWS`.

Prioridade P1.1: adicionar `ruff` no CI/local check.

Prioridade P1.2: adicionar scripts frontend lint/test.

Prioridade P1.3: resolver ou planejar vulnerabilidades Vite/esbuild.

Prioridade P1.4: corrigir acessibilidade basica do login.

Prioridade P1.5: adicionar favicon.

Prioridade P1.6: endurecer extensao Chrome.

Prioridade P1.7: criar checklist seguro de secrets e rotacao.

Prioridade P1.8: ajustar `docker-compose.yml` e `docker-compose.prod.yml` para nomes/portas sem conflito.

Prioridade P2.1: migrar `on_event` para lifespan.

Prioridade P2.2: migrar Pydantic settings para padrao V2.

Prioridade P2.3: substituir alert/confirm por modais/toasts.

Prioridade P2.4: criar Playwright E2E autenticado.

Prioridade P2.5: rodar auditoria visual em telas internas.

Prioridade P2.6: otimizar chunks e lazy loading.

Prioridade P2.7: refatorar componentes gigantes em etapas.

Prioridade P3.1: melhorar health/readiness.

Prioridade P3.2: criar runbook de deploy e rollback.

Prioridade P3.3: criar matriz de ambiente em docs.

Prioridade P3.4: adicionar template PR com checklist multi-tenant e secrets.

Ordem recomendada de PR 1: P0.1, P0.5 e env validation.

Ordem recomendada de PR 2: P0.2, P0.3 e testes backend.

Ordem recomendada de PR 3: P0.4, P0.6 e docs de runtime.

Ordem recomendada de PR 4: P1.1, P1.2 e CI minimo.

Ordem recomendada de PR 5: seguranca extensao e secrets.

Ordem recomendada de PR 6: UX/acessibilidade e QA visual.

---

## 25. Checklist Final Antes de Deploy

Checklist 1: `git status` revisado e sem mudancas inesperadas.

Checklist 2: segredos reais nao versionados.

Checklist 3: `.env.bak` removido ou movido para cofre fora do repo.

Checklist 4: `.bot_state` fora do contexto Docker.

Checklist 5: CSVs/PII fora do contexto Docker.

Checklist 6: `.dockerignore` criado e validado.

Checklist 7: `frontend/Dockerfile` injeta `VITE_*` corretamente.

Checklist 8: build Docker frontend limpo aprovado.

Checklist 9: build Docker backend limpo aprovado.

Checklist 10: `docker compose -f docker-compose.prod.yml config` sem warnings de variavel ausente.

Checklist 11: saida de compose config nao anexada em lugar publico.

Checklist 12: Python 3.12 fixado.

Checklist 13: `pytest -q` passa.

Checklist 14: `ruff check` passa ou tem baseline aceito.

Checklist 15: `npm ci` passa.

Checklist 16: `npm run build` passa.

Checklist 17: `npm run lint` passa.

Checklist 18: `npm test` passa.

Checklist 19: `npm audit` tratado conforme politica.

Checklist 20: `pip-audit` passa.

Checklist 21: Mercantil stats nao retorna 500.

Checklist 22: VCTex stats nao retorna 500.

Checklist 23: CORS local e staging validado.

Checklist 24: login staging funciona.

Checklist 25: admin staging funciona.

Checklist 26: usuario comum nao acessa admin.

Checklist 27: usuario A nao acessa dados de usuario B.

Checklist 28: Caddy/Nginx roteia `/api`.

Checklist 29: Caddy/Nginx roteia `/ws`.

Checklist 30: favicon responde 200.

Checklist 31: login acessivel com labels e autocomplete.

Checklist 32: screenshots desktop/mobile das telas criticas salvos.

Checklist 33: logs nao contem Authorization.

Checklist 34: logs nao contem cookies.

Checklist 35: logs nao contem service key.

Checklist 36: extensao Chrome revisada.

Checklist 37: token de extensao tem expiracao ou mitigacao aceita.

Checklist 38: runbook de rollback escrito.

Checklist 39: backup Supabase confirmado antes de migration.

Checklist 40: smoke pos-deploy definido.

Checklist 41: health publico retorna ok.

Checklist 42: readiness interno verifica dependencias ou tem plano.

Checklist 43: Redis configurado no host correto.

Checklist 44: Supabase env de producao separado de dev.

Checklist 45: API key/backend secrets rotacionados se necessario.

Checklist 46: dominio de producao incluido no CORS.

Checklist 47: dominios locais removidos do CORS de producao, se aplicavel.

Checklist 48: scanners de secrets rodaram limpos.

Checklist 49: deploy staging validado antes de prod.

Checklist 50: aprovacao humana final registrada.

---

## 26. Conclusao

O projeto tem base funcional, mas ainda tem bloqueios reais para deploy seguro.

O backend mostra maturidade maior que o frontend em termos de testes.

Os testes backend passando nao cobriram dois bugs importantes de `MAX_ROWS`.

O frontend buildando localmente nao prova que o Docker de producao funcionara.

O maior risco de deploy esta na combinacao de Vite build-time env e Dockerfile sem ARG/ENV.

O segundo maior risco e operacional: portas, CORS e Redis nao estao expressos como uma unica verdade.

O terceiro maior risco e seguranca operacional: segredos, backups, estado de navegador e dados locais existem na arvore do projeto.

O quarto maior risco e a extensao Chrome, que toca dados de sessao muito sensiveis.

O quinto maior risco e a falta de gates frontend.

Minha recomendacao e nao enviar para producao antes dos itens P0.

Depois dos P0, executar uma auditoria curta de verificacao.

Depois dessa verificacao, executar QA autenticado em staging.

Se staging passar, o deploy pode avancar com runbook e rollback prontos.

Este relatorio deve ser usado como fila de trabalho do Claude Code.

O Claude Code deve corrigir com commits pequenos e verificaveis.

Nao recomendo refactor visual amplo antes de estabilizar deploy, env, CORS e bugs 500.

Nao recomendo upgrade massivo de dependencias antes de separar vulnerabilidades urgentes de modernizacao.

Nao recomendo apagar artefatos sensiveis automaticamente sem confirmacao do dono do projeto.

Recomendo rotacionar segredos expostos em arquivos locais se houver qualquer chance de compartilhamento externo.

Recomendo manter este relatorio como referencia ate todos os checklists P0/P1 serem fechados.

Fim do relatorio.
