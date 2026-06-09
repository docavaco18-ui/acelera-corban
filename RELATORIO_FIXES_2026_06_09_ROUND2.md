# Relatório Round 2 — Resposta aos Bloqueadores P0 Restantes

**Data:** 2026-06-09
**Commits do round 2:**
- `b5e26f3` — fix: bloqueadores P0 round 2 Codex (819 +, 104 −, 10 arquivos)

**Bateria:**
- 106/106 tests passing (87 antigos + **19 novos** específicos de validador)
- tsc clean
- npm run build OK
- compileall -W error::SyntaxWarning OK

---

## Bloqueadores P0 que você apontou como restantes

### 1. Validação server-side completa dos assignments nos 3 disparadores

**Status:** ✅ **IMPLEMENTADO**

**Arquivo novo:** `backend/app/services/broadcast/assignment_validator.py`

3 funções públicas:
- `validate_vendeai_assignments(db, user_id, assignments, total_leads, allow_partial=False)`
- `validate_aesir_assignments(db, user_id, assignments, total_leads, allow_partial=False)`
- `validate_chipcare_assignments(db, user_id, assignments, total_leads, allow_partial=False)`

Cada função:
1. Carrega TODAS as entidades do owner com 1 query (broadcast_numbers / aesir_instances / chipcare_channels)
2. Para cada assignment com planned>0:
   - **Tenant isolation:** rejeita `phone_id/instance_id/channel_id` que não pertence ao owner → 404
   - **Capacity:** `planned <= daily_limit` ou 400 "excede daily_limit"
   - **State:** rejeita `is_paused`, `can_send` ∈ {DISABLED, BLOCKED}, `quality_rating=RED`
   - **Aesir-specific:** rejeita instance com `status=meta-only`
   - **Chipcare-specific:** rejeita `channel_id < 0` (meta-only synth), `status` ∉ {CONNECTED, ONLINE}
   - **VendeAI-specific:** exige `inbox_id` e `template_id` quando planned>0
3. Rejeita duplicidade → 409 (mesmo phone_id/channel_id/instance_id em 2 assignments)
4. Rejeita `planned_count < 0` → 400
5. Rejeita `sum(planned) > total_leads` → 400
6. Bloqueia partial dispatch → 400 "parcial bloqueada" quando `allow_partial=False` e soma < total
7. Retorna `(assigned_count, unassigned_count)` pra UI/response

**Integração nos 3 routers:** chamada antes de qualquer mudança de status:
```python
total_leads_for_dispatch = int(dispatch.data[0].get("total_leads") or 0)
assigned_count, unassigned_count = validate_vendeai_assignments(
    db, user_id, body.assignments, total_leads_for_dispatch, allow_partial=body.allow_partial
)
```

**Testes:** `backend/tests/test_assignment_validator.py` — 19 testes cobrindo:
- happy path (3 disparadores)
- tampering: phone_id de outro tenant → 404
- tampering: planned acima do daily_limit → 400
- estado: pausado, DISABLED, BLOCKED, RED, meta-only, OFFLINE → 400
- duplicidade → 409
- soma > total → 400
- partial bloqueado por default → 400
- partial liberado com `allow_partial=True`
- zero-planned skipa validação de inbox/template (caso da assignment vazia)
- negativo rejeitado

Todos passam.

---

### 2. Chipcare XLSX não respeita planned_count

**Status:** ✅ **IMPLEMENTADO** — arquitetura "1 campanha por canal com XLSX fatiado"

**Arquivo:** `backend/app/routers/chipcare_broadcast.py:592-740`

**Antes (P0 bug):**
```python
channel_ids = [a.channel_id for a in body.assignments]
xlsx_bytes = csv_to_xlsx_bytes(csv_bytes)  # CSV INTEIRO
await client.create_campaign(channel_ids=channel_ids, xlsx_bytes=xlsx_bytes)  # 1 campanha, N canais, XLSX inteiro
```

**Agora:**
```python
csv_text = csv_bytes.decode("utf-8", errors="replace")
csv_lines = csv_text.splitlines()
header = csv_lines[0]
data_rows = csv_lines[1:]

per_assignment: list[dict] = []
row_offset = 0
for asn in body.assignments:
    planned = asn.planned_count
    if planned <= 0:
        per_assignment.append({"channel_id": asn.channel_id, "planned_count": planned, "status": "skipped"})
        continue
    slice_rows = data_rows[row_offset: row_offset + planned]
    row_offset += planned
    slice_csv = ("\n".join([header] + slice_rows)).encode("utf-8")
    slice_xlsx = csv_to_xlsx_bytes(slice_csv)

    try:
        result = await client.create_campaign(
            jwt=jwt,
            name=f"{campaign_name}_ch{asn.channel_id}" if len(channel_ids_all) > 1 else campaign_name,
            channel_ids=[asn.channel_id],         # SÓ ESTE CANAL
            template=template_payload,
            ...
            xlsx_bytes=slice_xlsx,                # SÓ ESTA FATIA
            dry_run=False,
        )
        per_assignment.append({
            "channel_id": asn.channel_id,
            "planned_count": planned,
            "chipcare_campaign_id": result.get("campaign_id"),
            "status": "created" if result.get("campaign_id") else "error",
        })
    except Exception as e:
        per_assignment.append({..., "status": "error", "error": str(e)[:200]})
```

**Comportamento:**
- 5.000 leads em CSV, assignments: canal A=2000, canal B=3000
- Antes: 1 campanha no Chipcare com [A,B] + XLSX com 5000 linhas → Chipcare decidia rotear
- Agora: 2 campanhas separadas — campanha A com 2000 linhas, campanha B com 3000 linhas

**Activate per-campaign:** loop ativa cada `chipcare_campaign_id` criado individualmente; falhas isoladas (log + `activation_error` no entry).

**Final status:**
- Todas criaram + ativaram → `running`
- Todas criaram + nenhuma ativada → `paused`
- Algumas falharam → `partial_error`
- Nenhuma criou → `error` + HTTPException 502

**Persistência:**
- `chipcare_campaign_id`: primeiro ID (back-compat)
- `chipcare_campaign_ids[]`: lista completa
- `assignments_json`: per-assignment entries com `chipcare_campaign_id`, `status`, `error`/`activation_error` quando aplicável

---

### 3. Campanha parcial não bloqueia por padrão

**Status:** ✅ **IMPLEMENTADO** nos 3 disparadores

**Schema:**
```python
class DispatchIn(BaseModel):
    ...
    allow_partial: bool = False  # bloqueio rígido por default
```

**No validador (núcleo):**
```python
def _check_partial(assigned: int, total: int, allow_partial: bool) -> tuple[int, int]:
    unassigned = max(0, total - assigned)
    if assigned > total:
        raise HTTPException(400, f"sum(planned_count)={assigned} maior que total_leads={total}")
    if unassigned > 0 and not allow_partial:
        raise HTTPException(
            400,
            f"Distribuição parcial bloqueada: {assigned} de {total} leads atribuídos "
            f"({unassigned} sobrando). Passe allow_partial=true se intencional."
        )
    return assigned, unassigned
```

**Aplicado em:**
- VendeAI `confirm_dispatch` (broadcast.py)
- Aesir `confirm_dispatch` (aesir_broadcast.py)
- Chipcare `confirm_dispatch` (chipcare_broadcast.py)

Default false → cliente operando UI sem mexer no flag NÃO consegue disparar parcial.

---

### 4. UI mostra/impede unassigned_count antes do disparo real

**Status:** ✅ **IMPLEMENTADO** nos 3 wizards

**Arquivos:**
- `frontend/src/components/disparo/CsvUploadWizard.tsx` (VendeAI)
- `frontend/src/pages/DisparoAesir.tsx`
- `frontend/src/pages/DisparoChipcare.tsx`

**Pattern aplicado (idêntico nos 3):**
```tsx
const assignedSum = assignments.reduce((s, a) => s + (Number(a.planned_count) || 0), 0);
const diff = totalLeads - assignedSum;
const isExact = diff === 0;
const overflow = diff < 0;
const canConfirm = isExact || (diff > 0 && allowPartial);

// Banner condicional:
{!isExact && (
  <div style={{ background: overflow ? '#ef444415' : '#eab30815', ... }}>
    {overflow
      ? `❌ EXCESSO — soma ${assignedSum} > total ${totalLeads}. Reduza distribuição.`
      : `⚠ PARCIAL — ${assignedSum} de ${totalLeads} atribuídos (${diff} sobrando)`}
    {diff > 0 && (
      <label>
        <input type="checkbox" checked={allowPartial} onChange={...} />
        Eu entendo: disparar {assignedSum} leads, descartar {diff}.
      </label>
    )}
  </div>
)}

// Botão Confirmar:
<button disabled={!canConfirm} ...>Confirmar e Disparar</button>
```

**Comportamento UX:**
- Soma == total → banner some, botão verde habilitado
- Soma < total → banner amarelo + checkbox; checkbox checked → libera botão; `allow_partial=true` enviado
- Soma > total → banner vermelho fixo; botão DESABILITADO (nem checkbox resolve) — o user obrigatoriamente reduz planned_count

**API client (`frontend/src/lib/api.ts`):** signatures `confirmDispatch` / `dispatch` atualizadas pra aceitar `allow_partial?: boolean`.

---

### 5. Updates em dispatch sem owner_id

**Status:** ✅ **ZERADO**

**Auditoria multi-line:** script AST custom que rastreia `db.table("X").update({...}).eq(...).execute()` em tabelas tenant. Antes: 7 ocorrências sem `owner_id`. Após fixes: **0**.

**Corrigidos:**
| Arquivo | Linha | Endpoint | Operação |
|---|---|---|---|
| `broadcast.py` | 573 | `confirm_dispatch` | final status update após loop |
| `aesir_broadcast.py` | 467 | `confirm_dispatch` | status=running + assignments_json |
| `aesir_broadcast.py` | 538 | `_run` finally | final status |
| `aesir_broadcast.py` | 552 (`_update_assignment`) | helper interno | adicionado parâmetro `owner_id` + 4 call sites passam `user_id` |
| `chipcare_broadcast.py` | 653 | `confirm_dispatch` error fallback | status=error no caso de Chipcare não retornar id |
| `chipcare_broadcast.py` | 669 | `confirm_dispatch` | update final completo |
| `chipcare_broadcast.py` | 719 | `activate_dispatch` | status=running após activate |

Todos agora têm `.eq("id", X).eq("owner_id", user_id)`.

**Verificação automatizada:** `test_no_unscoped_tenant_access.py` (AST scan) continua passando após adição de `assignment_validator.py` e `main.py` ao ALLOWLIST (ambos têm filtros manuais ou são cross-tenant intencional documentado).

---

## Bonus — VendeAI final_status partial_error

**Antes:**
```python
final_status = "running" if mailing_ids else "error"
```
Qualquer disparo iniciado mascarava falhas parciais como `running` saudável.

**Agora:**
```python
if mailing_ids and dispatch_errors:
    final_status = "partial_error"
elif mailing_ids:
    final_status = "running"
else:
    final_status = "error"
```

Combinado com fix de round 1 (insert error assignment), monitor agora pode mostrar:
- Dispatch row: `partial_error`
- Assignments rows: alguns `running`, outros `error` com `planned_count`

---

## Estado consolidado

| Bloqueador | Round 1 | Round 2 |
|---|---|---|
| 1. Validação server-side | ⏸️ Spec separado | ✅ **Implementado + 19 tests** |
| 2. Chipcare XLSX per-channel | ⚠️ Advisory note | ✅ **1 campanha/canal com slice** |
| 3. Block partial por default | ⚠️ Cosmético | ✅ **400 hard block + allow_partial flag** |
| 4. UI mostra/impede unassigned | ⏸️ Não tocado | ✅ **Banner + checkbox + button disable nos 3 wizards** |
| 5. owner_id em todos updates | ⚠️ Parcial (rollback delete only) | ✅ **7 updates corrigidos, auditoria multi-line zero** |

---

## Riscos que considero ainda válidos pra produção (transparência)

**Não-bloqueadores, mas continuam reais:**

1. **Aesir tasks em memória** — sweep no startup marca como `error`, mas não auto-resume. Pra produção com SLA real, precisa fila durável (Celery/RQ). Status atual: tolerável pra dev/staging, frágil pra produção.

2. **Monitor VendeAI paginação 20s** — pesado pra muitos owners ativos. Não é P0 bloqueador, mas afeta custo de provider quando escalar.

3. **Métricas com limit 50k** — agora flagrada (`recipients_truncated`), mas o número real continua truncado. Pra campanhas > 50k recipients, precisa agregação SQL.

4. **`refresh_numbers/channels` upsert errors silentes** — `except: pass`. Round 2 não tocou; baixo risco mas má prática.

5. **Webhook signing/IP validation** — fora deste review, mas vale lembrar antes de produção real (Chipcare/Meta webhooks).

---

## Próximo round sugerido (se quiser P1/P2)

1. Fila durável Aesir (Celery + Redis broker)
2. Agregação SQL para métricas > 50k
3. Coleta de upsert errors em refresh_numbers/channels
4. Schema migration: `aesir_dispatches.status` enum aceitar `partial_error`, `interrupted` formalmente (atualmente está como texto livre — funciona mas ideal seria CHECK constraint)
5. E2E test Playwright cobrindo: upload CSV → tentar parcial → banner aparecer → checkbox → confirmar → response com `unassigned_count`
