# Relatório de Resposta ao Ultra Review Codex — 2026-06-09

**Commit:** `e7480b6` — fix: 10 bugs P0/P1/P2 apontados pelo ultra review Codex (2026-06-09)
**Arquivos tocados:** 6 (+107 / -36)
**Bateria de testes:** 87/87 passing | tsc clean | npm build OK | `compileall -W error::SyntaxWarning` clean

---

## Status por achado

### P0 — VendeAI dispatching preso se validação falhar depois da trava

**Arquivo:** `backend/app/routers/broadcast.py:424-437` (original)
**Status:** ✅ **CONFIRMADO** e **CORRIGIDO**.

**Diagnóstico verificado:** linha 428 marcava `status='dispatching'` antes do loop validar `inbox_id`/`template_id` na linha 435-436. Qualquer assignment inválido lançava HTTPException 400 com o dispatch travado em `dispatching` e endpoint só aceita `pending_confirm`.

**Fix aplicado:**
```python
# Pre-validate all assignments BEFORE touching dispatch status
for _v in body.assignments:
    _p = int(_v.get("planned_count") or 0)
    if _p <= 0:
        continue  # zero-planned skipa antes do inbox/template check (P0-2)
    if not _v.get("inbox_id") or not _v.get("template_id"):
        raise HTTPException(400, f"inbox_id e template_id obrigatórios para {_v.get('phone_id', '')}")

# Marca dispatching SÓ depois de validar — bug original eliminado
db.table("broadcast_dispatches").update({"status": "dispatching"}) \
    .eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
```

**Bonus:** `owner_id` adicionado no update (não era um dos itens originais mas reforça isolamento tenant).

---

### P0 — VendeAI valida assignment zerada antes de ignorar planned_count <= 0

**Status:** ✅ **CONFIRMADO** e **CORRIGIDO** (mesmo bloco do fix anterior).

Pre-validação aplica `if _p <= 0: continue` ANTES da checagem de inbox/template. `planned = int(asn.get("planned_count") or 0)` força conversão e trata `None` corretamente.

---

### P0 — Aesir/Chipcare ainda podem confirmar campanha parcial quando CSV excede capacidade

**Status:** ⚠️ **MITIGADO PARCIALMENTE** — fix completo precisa de decisão de produto (bloqueio rígido vs allow_partial flag).

**O que foi feito agora (Chipcare):** resposta de `/dispatch` retorna `assigned_count` e `unassigned_count` para a UI surfaçar discrepância explicitamente. UI pode mostrar "X de Y leads atribuídos".

**O que NÃO foi feito** (por escopo / não autorizado mexer na UX):
- Não bloqueia `sum(planned_count) != total_leads` por default. Bloqueio rígido por default é mudança de UX que precisa OK do cliente — adicionei só os metadados na resposta pra deixar UI tomar a decisão. Pode subir flag `require_full_assignment=true` num próximo round se o cliente quiser.

**Recomendação pra próximo round:** adicionar query param `allow_partial=true` no endpoint e default 400 quando soma diverge.

---

### P0 — Chipcare ignora planned_count no disparo real e envia o XLSX inteiro para todos os canais

**Arquivo:** `backend/app/routers/chipcare_broadcast.py:592-646`
**Status:** ⚠️ **CONFIRMADO** mas **NÃO ALTERADO** arquiteturalmente. Marcado como advisory.

**Por quê não fatiei o XLSX:** o cliente Chipcare aceita 1 XLSX + N channel_ids. A semântica do servidor Chipcare é que ELE distribui internamente (round-robin / fair) entre os canais — `planned_count` por canal vindo do nosso UI nunca é honrado pelo Chipcare. Criar 1 campanha por canal seria mudança grande de arquitetura (state interno × N) e precisa de decisão de produto.

**Mitigação aplicada agora:** resposta do dispatch inclui campo `note`:
```json
{
  "assigned_count": 200,
  "unassigned_count": 0,
  "note": "planned_count is advisory; Chipcare distributes XLSX internally across channels"
}
```

UI pode renderizar esse `note` como banner amarelo no fluxo Chipcare.

**Próximo passo recomendado:** decidir arquitetura (1 campanha/canal com XLSX fatiado vs remover seletor de canal do fluxo XLSX_FILE) — não é decisão de implementação.

---

### P0 — Backend dos 3 disparadores confia no payload editável do frontend

**Status:** ⚠️ **CONFIRMADO** mas **NÃO ENDEREÇADO** neste round.

**Por quê não fiz agora:** é refactor de validação grande (recarregar do banco + validar elegibilidade/duplicidade/limite por assignment × 3 disparadores). Cabe planejar como spec separado com testes E2E primeiro.

**O que dá pra fazer rápido se quiser:** função compartilhada `validate_assignments(db, user_id, assignments, bank)` que carrega DB e valida 1) existência de phone_id/channel_id/instance_id no owner, 2) `planned <= daily_limit`, 3) duplicidade, 4) vínculo template×WABA. Estimativa ~2h de trabalho + testes.

---

### P1 — VendeAI com falha parcial retorna ok=True e deixa erros sem estado operacional forte

**Arquivo:** `backend/app/routers/broadcast.py:424-562`
**Status:** ✅ **CONFIRMADO** e **CORRIGIDO**.

**Fix aplicado:**
```python
except Exception as exc:
    dispatch_errors.append(f"{phone_id}: {exc}")
    # Persist error assignment so monitor shows the affected leads
    try:
        db.table("broadcast_dispatch_assignments").insert({
            "dispatch_id": body.dispatch_id,
            "owner_id": user_id,
            "phone_id": phone_id,
            "planned_count": planned,
            "status": "error",
            "template_id": asn.get("template_id", ""),
            "inbox_id": asn.get("inbox_id", ""),
            "display_phone": asn.get("display_phone", ""),
        }).execute()
    except Exception:
        pass
    continue
```

Agora os leads que falharam têm assignment row com `status=error` e `planned_count` visível no monitor.

**O que NÃO mudou (escopo):** `final_status` continua sendo `running` se qualquer mailing iniciou. Adicionar status `partial` exigiria mudança no enum e na UI — fora do escopo deste round. A UI já recebe `errors[]` no payload e pode renderizar warning.

---

### P1 — Pause/resume/revoke VendeAI engolem erro do provedor e mentem status local

**Arquivo:** `backend/app/routers/broadcast.py:744-811`
**Status:** ✅ **CONFIRMADO** e **CORRIGIDO** nos 3 endpoints.

**Fix aplicado (mesmo padrão nos 3):**
```python
provider_errors: list[str] = []
mailings_with_id = [a for a in (asns.data or []) if a.get("vendeai_mailing_id")]
for asn in mailings_with_id:
    try:
        await vendeai.pause(asn["vendeai_mailing_id"])
    except Exception as e:
        provider_errors.append(f"mailing {asn['vendeai_mailing_id']}: {e}")
if provider_errors and len(provider_errors) == len(mailings_with_id):
    raise HTTPException(502, f"Pause falhou em todos os mailings: {'; '.join(provider_errors[:3])}")
# update local + retorna provider_warnings se parcial
db.table(...).update(...).execute()
result: dict = {"ok": True}
if provider_errors:
    result["provider_warnings"] = provider_errors
return result
```

- **Todos falharam → 502** (não mente "ok").
- **Parcial → 200 com `provider_warnings`** (UI pode mostrar warning).
- **Tudo OK → 200 sem warnings.**

---

### P1 — Aesir background task em memória não é resiliente a restart/deploy

**Arquivo:** `backend/app/main.py:40-60`
**Status:** ✅ **CONFIRMADO** e **CORRIGIDO** (sweep no startup).

**Fix aplicado:**
```python
@app.on_event("startup")
async def _sweep_stale_chatwoot_runs():
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        # chatwoot sweep (já existia)
        get_db().table("chatwoot_sync_runs").update({...}).eq("status", "running").execute()
        # Aesir: in-memory tasks vanish on restart — mark orphaned running dispatches
        get_db().table("aesir_dispatches").update({
            "status": "error",
            "updated_at": now_iso,
        }).eq("status", "running").execute()
    except Exception:
        pass
```

**O que NÃO foi feito:** migrar pra fila durável (Celery/RQ). É refactor grande, fora de escopo. O sweep impede travamento eterno mas dispatch fica como `error` (não auto-resume). Pra produção real precisa fila persistente.

**Allowlist do AST test:** `app/main.py` adicionado ao `ALLOWLIST` em `tests/test_no_unscoped_tenant_access.py` porque o sweep é cross-tenant intencional (sem user_id no startup).

---

### P1 — Aesir finaliza done mesmo quando todas as assignments deram erro

**Arquivo:** `backend/app/routers/aesir_broadcast.py:482-528`
**Status:** ✅ **CONFIRMADO** e **CORRIGIDO**.

**Fix aplicado:**
```python
async def _run():
    row_offset = 0
    _success_count = 0
    _error_count = 0
    try:
        for asn_model in body.assignments:
            ...
            try:
                result = await client.dispatch_csv(...)
                _update_assignment(...)
                _success_count += 1
            except asyncio.CancelledError:
                ...
                raise
            except Exception as exc:
                ...
                _update_assignment(body.dispatch_id, iid, {"status": "error"}, db)
                _error_count += 1

        if stop_event.is_set():
            final = "paused"
        elif _error_count == 0:
            final = "done"
        elif _success_count == 0:
            final = "error"
        else:
            final = "partial_error"
```

Status final agora reflete realidade: `done` / `partial_error` / `error` / `paused`.

---

### P1 — Aesir/Chipcare/VendeAI rollback Redis remove dispatch só por id, sem owner_id

**Status:** ✅ **CONFIRMADO** e **CORRIGIDO** nos 3 routers.

```python
# Antes:
db.table("broadcast_dispatches").delete().eq("id", dispatch_id).execute()
# Depois:
db.table("broadcast_dispatches").delete().eq("id", dispatch_id).eq("owner_id", user_id).execute()
```

Aplicado nos 3 routers (broadcast, aesir, chipcare). Defesa em profundidade — colisão UUID praticamente impossível, mas elimina TODA superfície de ataque cross-tenant em delete/update.

---

### P1 — Config local CODEX ainda desalinhada com os próprios docs

**Status:** ✅ **CORRIGIDO PARCIALMENTE**.

**O que foi feito:**
- `backend/.env`: `http://localhost:3004` adicionado ao `CORS_ORIGINS` (entre 3000 e 5173)
- `backend/app/main.py`: CORS handler agora faz `[o.strip() for o in settings.cors_origins.split(",")]` (P2 também)
- `.env` raiz: já tinha `REDIS_URL=redis://localhost:6379` (não `:6381` como docs mas funciona)

**O que NÃO foi feito:** `frontend/.env.local`, `.env.example`, `AGENTS.md`. Sugiro próximo round alinhar todos pra `localhost:3004` / `localhost:8003` / `localhost:6381` consistentemente OU atualizar `CLAUDE.md` pra refletir 6379 (qual é a verdade?).

---

### P1 — Arquivos de estado/secrets no repo local

**Arquivo:** `.gitignore`
**Status:** ✅ **CORRIGIDO**.

```diff
 *.csv
 *.xlsx
+*.rdb
+dump.rdb
+storage_state*.json
+*.sqlite
+*.db
```

**O que NÃO foi feito:** check CI pré-commit que falha se `git status` mostrar arquivos sensíveis untracked. Sugiro adicionar hook `pre-commit` ou GH Action separadamente.

---

### P2 — Handler global de 500 pode mascarar detalhes necessários e depende de CORS exato

**Arquivo:** `backend/app/main.py:90-103`
**Status:** ✅ **PARCIALMENTE CORRIGIDO** (strip whitespace).

**Fix:** `allowed = [o.strip() for o in settings.cors_origins.split(",")]` no exception handler + middleware.

**NÃO feito:** adicionar `request_id` no body de retorno. Sugiro middleware separado pra request_id ID (não enviado pelo cliente atual).

---

### P2 — Monitor VendeAI faz paginação potencialmente pesada a cada 20s

**Status:** ⏸️ **NÃO ENDEREÇADO**. Otimização — fora de escopo deste round. Requer endpoint Meta `mailing/{id}/status` se existir + cursor cache em Redis.

---

### P2 — Métricas VendeAI limitam recipients em 50.000 sem indicar truncamento

**Arquivo:** `backend/app/routers/broadcast.py:660-695`
**Status:** ✅ **CORRIGIDO**.

```python
_RECIPIENTS_LIMIT = 50000
rec_rows = db.table("broadcast_recipients") \
    ... \
    .limit(_RECIPIENTS_LIMIT) \
    .execute()
...
recipients_truncated = len(rec_rows.data or []) >= _RECIPIENTS_LIMIT
return {
    ...
    "recipients_truncated": recipients_truncated,
}
```

UI pode mostrar warning "Mais de 50k recipients — métricas truncadas".

**NÃO feito:** trocar pra count agregado via RPC. Manter limit é simpler e flag deixa o cliente saber.

---

### P2 — refresh_numbers/refresh_channels escondem falhas de upsert

**Status:** ⏸️ **NÃO ENDEREÇADO**. Mudança de UX (acúmulo de erros) — sugiro próximo round.

---

### P2 — Testes de disparo cobrem isolamento/payload, não fluxo real perigoso

**Status:** ⏸️ **NÃO ENDEREÇADO**. Lista de testes faltando do Codex está válida:
- VendeAI dispatch parcial
- VendeAI stuck dispatching (este AGORA passaria de propósito — bug não existe mais, mas regression test seria ouro)
- planned_count=0
- Soma planejada vs total
- Duplicidade de assignment
- Chipcare fatiamento
- Aesir final status com erro total/parcial
- Restart sweep de Aesir

Recomendo plano de testes separado.

---

## Bateria de validações pós-fix

```
$ cd backend && python3 -m pytest tests -q
87 passed, 3 warnings in 1.42s

$ cd backend && python3 -W error::SyntaxWarning -m compileall -q app tests
(passou, sem output)

$ cd frontend && npm run build
✓ built in 2.31s
dist/assets/index-CCiFQ6Td.js  259.54 kB │ gzip: 84.05 kB
```

---

## Resumo executivo

| # | Achado Codex | Severidade | Status |
|---|---|---|---|
| 1 | VendeAI dispatching preso | P0 | ✅ Fix completo |
| 2 | VendeAI planned=0 antes de validar | P0 | ✅ Fix completo |
| 3 | Aesir/Chipcare partial CSV | P0 | ⚠️ Mitigado (assigned/unassigned na resposta) |
| 4 | Chipcare XLSX inteiro | P0 | ⚠️ Documentado (advisory note) |
| 5 | Backend confia em payload frontend | P0 | ⏸️ Spec separado |
| 6 | VendeAI partial failure sem persist | P1 | ✅ Fix completo |
| 7 | Pause/resume/revoke mente status | P1 | ✅ Fix completo nos 3 |
| 8 | Aesir restart resilience | P1 | ✅ Sweep no startup |
| 9 | Aesir final status sempre done | P1 | ✅ Fix completo (4 estados) |
| 10 | Rollback delete sem owner_id (3x) | P1 | ✅ Fix nos 3 routers |
| 11 | Config CODEX desalinhada | P1 | ✅ CORS .env fix |
| 12 | Secrets no repo | P1 | ✅ .gitignore atualizado |
| 13 | CORS handler sem strip | P2 | ✅ Fix |
| 14 | Monitor paginação pesada | P2 | ⏸️ Pendente |
| 15 | Métricas truncation sem flag | P2 | ✅ `recipients_truncated` |
| 16 | refresh upsert errors silentes | P2 | ⏸️ Pendente |
| 17 | Testes faltando | P2 | ⏸️ Plano separado |

**P0 críticos do disparo (dispatching preso, assignment zerada, owner_id rollback, pause-mentira):** todos endereçados.

**P0 arquiteturais (XLSX fatiamento, validação server-side, partial dispatch bloqueio):** marcados como pendentes de decisão de produto. Mitigações cosméticas aplicadas onde fez sentido sem mudar UX.

**P1 estado/resiliência:** todos endereçados.

**P2 cosméticos/observability:** maioria endereçados, 3 pendentes por escopo.

---

## Riscos remanescentes pra ir pra produção real (cliente operar base real)

1. **Backend ainda confia no payload do frontend** — qualquer cliente malicioso pode editar `planned_count` via DevTools. Mitigação: validação completa server-side é refactor não trivial mas necessário antes de SaaS multi-cliente real.

2. **Chipcare planned_count é cosmético** — UI sugere distribuição mas Chipcare ignora. Decidir: 1 campanha/canal OU remover seletor.

3. **Aesir sem fila durável** — restart marca como `error` (não auto-resume). Pra produção real precisa Celery/RQ + checkpoint persistente.

4. **Sem testes E2E dos cenários parcial/erro** — todos os fixes acima precisam de regression tests.

5. **Métricas read 50k limit** — pra campanhas > 50k recipients, contagens são truncadas (flag indica mas dados reais não disponíveis sem RPC agregado).

Sem esses 5 itens, o sistema está **mais blindado que antes do review** mas ainda **não está pronto pra base real com cliente externo operando sozinho** — recomendo modo "operador interno apenas" até esses 5 itens fecharem.

---

**Próximo round sugerido (ordem de prioridade):**

1. Spec `validate_assignments_server_side` — função compartilhada
2. Decisão de produto: Chipcare XLSX (1 campanha/canal vs UI sem seletor)
3. Testes regression de todos os fixes deste round
4. Fila durável Aesir (Celery ou similar)
5. Agregação SQL pra métricas (eliminar limit 50k)
