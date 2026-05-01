# Higienização em Lote CLT — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema Python + React para higienizar leads CLT em lote via API V8 Digital, com workers asyncio paralelos, Supabase como banco, webhook FastAPI e dashboard em tempo real idêntico ao padrão VCTex.

**Architecture:** FastAPI backend com N workers asyncio processando leads do Supabase. Cada worker: enriquece CPF → cria consentimento → autoriza → aguarda webhook via Redis pubsub → simula → salva resultado. Frontend React exibe workers ao vivo via WebSocket. Docker Compose orquestra backend + frontend + redis.

**Tech Stack:** Python 3.12, FastAPI, asyncio, httpx, Supabase, Redis, React 19, TypeScript, Recharts, Vite, Docker Compose, ngrok (dev)

---

## Estrutura de Arquivos

```
projetos/V8/
├── docker-compose.yml
├── .env.example
├── .gitignore
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── redis_client.py
│       ├── models/lead.py
│       ├── routers/leads.py
│       ├── routers/bot.py
│       ├── routers/stats.py
│       ├── routers/webhook.py
│       ├── routers/ws.py
│       └── services/
│           ├── auth_service.py
│           ├── v8_api_service.py
│           ├── worker.py
│           └── bot_service.py
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── pages/Dashboard.tsx
│       ├── components/BotControl.tsx
│       ├── components/WorkersLive.tsx
│       ├── components/MetricsDashboard.tsx
│       ├── components/UploadPanel.tsx
│       ├── components/LeadsTable.tsx
│       ├── components/WsEventFeed.tsx
│       ├── hooks/useBotWebSocket.ts
│       └── lib/api.ts
│       └── lib/types.ts
│
└── migrations/
    └── 001_schema.sql
```

---

## Task 1: Setup Docker Compose + estrutura base

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `backend/requirements.txt`
- Create: `backend/Dockerfile`

- [ ] **Step 1: Criar docker-compose.yml**

```yaml
version: "3.9"

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: .env
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    volumes:
      - ./backend:/app
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

- [ ] **Step 2: Criar .env.example**

```bash
cat > .env.example << 'EOF'
# V8 Digital
V8_USERNAME=seu@email.com
V8_PASSWORD=suasenha
V8_AUDIENCE=audience_da_v8
V8_CLIENT_ID=client_id_da_v8
V8_PROVIDER=QI
WEBHOOK_URL=https://seu-ngrok.ngrok-free.app/webhook

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Redis
REDIS_URL=redis://localhost:6379

# App
MAX_WORKERS=6
API_KEY=minha-chave-secreta
CORS_ORIGINS=http://localhost:3000
EOF
```

- [ ] **Step 3: Criar .gitignore**

```bash
cat > .gitignore << 'EOF'
.env
__pycache__/
*.pyc
node_modules/
frontend/dist/
.pytest_cache/
EOF
```

- [ ] **Step 4: Criar backend/requirements.txt**

```
fastapi==0.115.0
uvicorn==0.30.0
httpx==0.27.0
supabase==2.9.0
redis==5.0.8
python-multipart==0.0.9
pydantic-settings==2.4.0
python-dotenv==1.0.1
```

- [ ] **Step 5: Criar backend/Dockerfile**

```dockerfile
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Criar estrutura de pastas**

```bash
mkdir -p backend/app/models backend/app/routers backend/app/services
mkdir -p frontend/src/pages frontend/src/components frontend/src/hooks frontend/src/lib
mkdir -p migrations
touch backend/app/__init__.py backend/app/models/__init__.py
touch backend/app/routers/__init__.py backend/app/services/__init__.py
```

- [ ] **Step 7: Commit**

```bash
cd /Users/macbookdegabriel/projetos/V8
git init
git add .
git commit -m "chore: setup docker compose + estrutura base"
```

---

## Task 2: Schema Supabase + migração

**Files:**
- Create: `migrations/001_schema.sql`

- [ ] **Step 1: Criar migrations/001_schema.sql**

```sql
-- Tabela principal de leads
CREATE TABLE IF NOT EXISTS leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    telefone VARCHAR(20),
    nome VARCHAR(255),
    email VARCHAR(255),
    data_nascimento DATE,
    status VARCHAR(30) DEFAULT 'pendente'
        CHECK (status IN ('pendente','enriquecido','consentido','autorizado','elegivel','inelegivel','erro')),
    consult_id UUID,
    margem_disponivel NUMERIC(12,2),
    valor_liberado NUMERIC(12,2),
    valor_parcela NUMERIC(12,2),
    num_parcelas INTEGER,
    cet_mensal NUMERIC(6,4),
    erro TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico de execuções
CREATE TABLE IF NOT EXISTS bot_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'running',
    num_workers INTEGER,
    total_processed INTEGER DEFAULT 0,
    total_elegiveis INTEGER DEFAULT 0,
    total_inelegiveis INTEGER DEFAULT 0
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Executar no Supabase**

Acesse o Supabase Dashboard → SQL Editor → cole o conteúdo de `migrations/001_schema.sql` → Run.

Expected: tabelas `leads` e `bot_runs` criadas sem erro.

- [ ] **Step 3: Commit**

```bash
git add migrations/
git commit -m "feat: schema supabase leads + bot_runs"
```

---

## Task 3: Backend base — config, database, redis

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/database.py`
- Create: `backend/app/redis_client.py`

- [ ] **Step 1: Criar backend/app/config.py**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    v8_username: str
    v8_password: str
    v8_audience: str
    v8_client_id: str
    v8_provider: str = "QI"
    webhook_url: str

    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str

    redis_url: str = "redis://localhost:6379"
    max_workers: int = 6
    api_key: str
    cors_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"

settings = Settings()
```

- [ ] **Step 2: Criar backend/app/database.py**

```python
from supabase import create_client, Client
from .config import settings

_client: Client | None = None

def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client
```

- [ ] **Step 3: Criar backend/app/redis_client.py**

```python
import redis.asyncio as aioredis
from .config import settings

_redis = None

async def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis
```

- [ ] **Step 4: Testar conexões**

```bash
cd /Users/macbookdegabriel/projetos/V8/backend
cp ../.env.example ../.env  # preencha .env com valores reais
pip install -r requirements.txt
python -c "
from app.config import settings
from app.database import get_db
db = get_db()
result = db.table('leads').select('count', count='exact').execute()
print('Supabase OK, leads:', result.count)
"
```
Expected: `Supabase OK, leads: 0`

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/app/database.py backend/app/redis_client.py
git commit -m "feat: config pydantic + supabase + redis clients"
```

---

## Task 4: Models

**Files:**
- Create: `backend/app/models/lead.py`

- [ ] **Step 1: Criar backend/app/models/lead.py**

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

class LeadRecord(BaseModel):
    id: Optional[UUID] = None
    cpf: str
    telefone: Optional[str] = None
    nome: Optional[str] = None
    email: Optional[str] = None
    data_nascimento: Optional[str] = None
    status: str = "pendente"
    consult_id: Optional[UUID] = None
    margem_disponivel: Optional[float] = None
    valor_liberado: Optional[float] = None
    valor_parcela: Optional[float] = None
    num_parcelas: Optional[int] = None
    cet_mensal: Optional[float] = None
    erro: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class StatsResponse(BaseModel):
    total: int
    elegiveis: int
    inelegiveis: int
    pendentes: int
    erros: int
    em_processamento: int

class BotEvent(BaseModel):
    type: str
    worker_id: int
    cpf: Optional[str] = None
    status: Optional[str] = None
    message: Optional[str] = None
    ts: Optional[str] = None
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models/
git commit -m "feat: models LeadRecord, StatsResponse, BotEvent"
```

---

## Task 5: Serviço de autenticação V8 (auth_service.py)

**Files:**
- Create: `backend/app/services/auth_service.py`

- [ ] **Step 1: Criar backend/app/services/auth_service.py**

```python
import time
import httpx
from ..config import settings

_token: str | None = None
_expires_at: float = 0

async def get_token() -> str:
    global _token, _expires_at
    if _token and time.time() < _expires_at:
        return _token

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.v8digital.com/oauth/token",
            data={
                "grant_type": "password",
                "username": settings.v8_username,
                "password": settings.v8_password,
                "audience": settings.v8_audience,
                "scope": "offline_access",
                "client_id": settings.v8_client_id,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

    _token = data["access_token"]
    _expires_at = time.time() + data["expires_in"] - 300  # renova 5min antes
    return _token
```

- [ ] **Step 2: Testar**

```bash
python -c "
import asyncio
from app.services.auth_service import get_token
async def test():
    token = await get_token()
    print('Token OK:', token[:20] + '...')
asyncio.run(test())
"
```
Expected: `Token OK: eyJhbGciOiJIUzI1...`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/auth_service.py
git commit -m "feat: auth service OAuth2 com cache de token"
```

---

## Task 6: Serviço V8 API (v8_api_service.py)

**Files:**
- Create: `backend/app/services/v8_api_service.py`

- [ ] **Step 1: Criar backend/app/services/v8_api_service.py**

```python
import httpx
from ..config import settings
from .auth_service import get_token

BASE = "https://bff.v8sistema.com"

async def _headers() -> dict:
    token = await get_token()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

async def enrich_cpf(cpf: str) -> dict:
    """Retorna: name, birthDate, email, phoneRegionCode, phoneNumber"""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE}/private-consignment/consult/client-data/basic/{cpf}",
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

async def create_consent(cpf: str, client_data: dict, telefone: str) -> str:
    """Cria consentimento e retorna consult_id"""
    digits = telefone.replace(r"\D", "")
    digits = ''.join(c for c in telefone if c.isdigit())
    area = digits[:2] if len(digits) >= 10 else "11"
    number = digits[2:] if len(digits) >= 10 else digits

    body = {
        "borrowerDocumentNumber": cpf,
        "gender": "male",
        "birthDate": client_data["birthDate"],
        "signerName": client_data["name"],
        "signerEmail": client_data["email"],
        "signerPhone": {
            "phoneNumber": number,
            "countryCode": "55",
            "areaCode": area,
        },
        "provider": settings.v8_provider,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/private-consignment/consult",
            json=body,
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()["id"]

async def authorize_consent(consult_id: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/private-consignment/consult/{consult_id}/authorize",
            json={},
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()

async def get_simulation_config() -> dict:
    """Retorna o primeiro config de simulação disponível"""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE}/private-consignment/simulation/configs",
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()["configs"][0]

async def create_simulation(consult_id: str, config_id: str, margin: float) -> dict:
    body = {
        "consult_id": consult_id,
        "config_id": config_id,
        "installment_face_value": 0,
        "disbursed_amount": margin,
        "number_of_installments": 24,
        "provider": settings.v8_provider,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/private-consignment/simulation",
            json=body,
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()

async def register_webhook(url: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/user/webhook/private-consignment/consult",
            json={"url": url},
            headers=await _headers(),
            timeout=20,
        )
        resp.raise_for_status()
```

- [ ] **Step 2: Testar enriquecimento**

```bash
python -c "
import asyncio
from app.services.v8_api_service import enrich_cpf
async def test():
    data = await enrich_cpf('05817761190')
    print(data)
asyncio.run(test())
"
```
Expected: `{'name': 'GABRIEL LIMA SANTOS', 'birthDate': '1998-02-08', ...}`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/v8_api_service.py
git commit -m "feat: v8 api service (enrich, consent, authorize, simulate)"
```

---

## Task 7: Worker asyncio (worker.py)

**Files:**
- Create: `backend/app/services/worker.py`

- [ ] **Step 1: Criar backend/app/services/worker.py**

```python
import asyncio
import json
import logging
from datetime import datetime
from typing import Callable
from ..database import get_db
from .v8_api_service import enrich_cpf, create_consent, authorize_consent, get_simulation_config, create_simulation

logger = logging.getLogger(__name__)

class LeadWorker:
    def __init__(self, worker_id: int, redis, on_event: Callable):
        self.worker_id = worker_id
        self.redis = redis
        self.on_event = on_event

    def _emit(self, type: str, cpf: str = None, status: str = None, message: str = None):
        self.on_event({
            "type": type,
            "worker_id": self.worker_id,
            "cpf": cpf,
            "status": status,
            "message": message,
            "ts": datetime.utcnow().isoformat(),
        })

    def _update_lead(self, cpf: str, updates: dict):
        get_db().table("leads").update(updates).eq("cpf", cpf).execute()

    async def _wait_for_webhook(self, consult_id: str, timeout: int = 120) -> dict:
        """Aguarda resultado do webhook via Redis pubsub"""
        channel = f"consult:{consult_id}"
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            deadline = asyncio.get_event_loop().time() + timeout
            async for message in pubsub.listen():
                if message["type"] == "message":
                    return json.loads(message["data"])
                if asyncio.get_event_loop().time() > deadline:
                    raise TimeoutError(f"Timeout aguardando webhook para {consult_id}")
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    async def process(self, lead: dict):
        cpf = lead["cpf"]
        telefone = lead["telefone"] or ""
        self._emit("worker_start", cpf=cpf, status="enriquecendo")

        try:
            # 1. Enriquece
            client_data = await enrich_cpf(cpf.replace(r"\D", "").replace(".", "").replace("-", ""))
            raw_cpf = ''.join(c for c in cpf if c.isdigit())
            client_data_enriched = await enrich_cpf(raw_cpf)
            self._update_lead(cpf, {
                "status": "enriquecido",
                "nome": client_data_enriched["name"],
                "email": client_data_enriched["email"],
                "data_nascimento": client_data_enriched["birthDate"],
            })
            self._emit("status_update", cpf=cpf, status="enriquecido")

            # 2. Cria consentimento
            consult_id = await create_consent(raw_cpf, client_data_enriched, telefone)
            self._update_lead(cpf, {"status": "consentido", "consult_id": consult_id})
            self._emit("status_update", cpf=cpf, status="consentido")

            # 3. Autoriza
            await authorize_consent(consult_id)
            self._update_lead(cpf, {"status": "autorizado"})
            self._emit("status_update", cpf=cpf, status="autorizado", message="Aguardando webhook...")

            # 4. Aguarda webhook
            payload = await self._wait_for_webhook(consult_id)

            if payload.get("status") != "SUCCESS":
                self._update_lead(cpf, {"status": "inelegivel", "erro": payload.get("status")})
                self._emit("lead_result", cpf=cpf, status="inelegivel")
                return

            margin = float(payload["availableMarginValue"])

            # 5. Simula
            config = await get_simulation_config()
            simulation = await create_simulation(consult_id, config["id"], margin)

            option = simulation.get("disbursement_option", {})
            self._update_lead(cpf, {
                "status": "elegivel",
                "margem_disponivel": margin,
                "valor_liberado": option.get("final_disbursement_amount") or simulation.get("disbursed_issue_amount"),
                "valor_parcela": simulation.get("installment_value"),
                "num_parcelas": simulation.get("number_of_installments"),
                "cet_mensal": simulation.get("monthly_interest_rate"),
            })
            self._emit("lead_result", cpf=cpf, status="elegivel",
                      message=f"Margem R${margin:.2f} | Libera R${option.get('final_disbursement_amount', 0):.2f}")

        except Exception as e:
            logger.error(f"Erro worker {self.worker_id} CPF {cpf}: {e}")
            self._update_lead(cpf, {"status": "erro", "erro": str(e)})
            self._emit("lead_result", cpf=cpf, status="erro", message=str(e))
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/worker.py
git commit -m "feat: lead worker asyncio (enrich→consent→webhook→simulate)"
```

---

## Task 8: Bot service + coordenação de workers (bot_service.py)

**Files:**
- Create: `backend/app/services/bot_service.py`

- [ ] **Step 1: Criar backend/app/services/bot_service.py**

```python
import asyncio
import json
import uuid
from datetime import datetime
from typing import Callable
from ..database import get_db
from ..redis_client import get_redis
from ..config import settings
from .worker import LeadWorker
from .v8_api_service import register_webhook

_running = False
_task: asyncio.Task | None = None

async def _broadcast(redis, event: dict):
    await redis.publish("bot:events", json.dumps(event))

async def start_bot(num_workers: int, on_event: Callable):
    global _running, _task
    if _running:
        return {"status": "already_running"}

    _running = True
    redis = await get_redis()
    await redis.set("bot:status", "running")

    run_id = str(uuid.uuid4())
    get_db().table("bot_runs").insert({
        "id": run_id,
        "num_workers": num_workers,
        "status": "running",
    }).execute()

    async def _run():
        global _running
        try:
            # Registra webhook na V8
            await register_webhook(settings.webhook_url)

            # Busca leads pendentes
            result = get_db().table("leads").select("*").eq("status", "pendente").execute()
            leads = result.data

            # Cria fila
            queue = asyncio.Queue()
            for lead in leads:
                await queue.put(lead)

            total = len(leads)
            processed = 0

            def on_event_wrapper(event):
                nonlocal processed
                if event["type"] == "lead_result":
                    processed += 1
                asyncio.create_task(_broadcast(redis, event))
                on_event(event)

            # Inicia workers
            async def worker_loop(worker_id: int):
                worker = LeadWorker(worker_id, redis, on_event_wrapper)
                while not queue.empty():
                    try:
                        lead = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    await worker.process(lead)

            await asyncio.gather(*[worker_loop(i) for i in range(num_workers)])

            # Finaliza run
            stats = get_db().table("leads").select("status").execute()
            elegiveis = sum(1 for r in stats.data if r["status"] == "elegivel")
            inelegiveis = sum(1 for r in stats.data if r["status"] == "inelegivel")

            get_db().table("bot_runs").update({
                "status": "completed",
                "finished_at": datetime.utcnow().isoformat(),
                "total_processed": processed,
                "total_elegiveis": elegiveis,
                "total_inelegiveis": inelegiveis,
            }).eq("id", run_id).execute()

        finally:
            _running = False
            await redis.set("bot:status", "idle")
            await _broadcast(redis, {"type": "bot_status", "status": "idle"})

    _task = asyncio.create_task(_run())
    return {"status": "started", "workers": num_workers}

async def stop_bot():
    global _running, _task
    _running = False
    if _task:
        _task.cancel()
    redis = await get_redis()
    await redis.set("bot:status", "idle")
    return {"status": "stopped"}

async def get_bot_status():
    redis = await get_redis()
    status = await redis.get("bot:status") or "idle"
    return {"status": status}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/bot_service.py
git commit -m "feat: bot service com pool de workers asyncio + redis state"
```

---

## Task 9: Routers FastAPI

**Files:**
- Create: `backend/app/routers/leads.py`
- Create: `backend/app/routers/bot.py`
- Create: `backend/app/routers/stats.py`
- Create: `backend/app/routers/webhook.py`
- Create: `backend/app/routers/ws.py`

- [ ] **Step 1: Criar backend/app/routers/leads.py**

```python
import csv
import io
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from ..database import get_db

router = APIRouter(prefix="/api/leads", tags=["leads"])

@router.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    leads = []
    for row in reader:
        cpf = row.get("cpf", "").strip()
        telefone = row.get("telefone", "").strip()
        if cpf:
            leads.append({"cpf": cpf, "telefone": telefone, "status": "pendente"})

    if not leads:
        raise HTTPException(400, "Nenhum CPF encontrado no arquivo")

    # Upsert — ignora duplicatas
    get_db().table("leads").upsert(leads, on_conflict="cpf", ignore_duplicates=True).execute()
    return {"inserted": len(leads)}

@router.get("/")
async def list_leads(status: str = None, page: int = 1, limit: int = 50):
    query = get_db().table("leads").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = query.range((page - 1) * limit, page * limit - 1).execute()
    return {"data": result.data, "page": page}

@router.get("/export")
async def export_elegiveis():
    result = get_db().table("leads").select("*").eq("status", "elegivel").execute()
    leads = result.data

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "cpf", "nome", "telefone", "margem_disponivel",
        "valor_liberado", "valor_parcela", "num_parcelas", "cet_mensal"
    ])
    writer.writeheader()
    for lead in leads:
        writer.writerow({k: lead.get(k, "") for k in writer.fieldnames})

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=elegiveis_clt.csv"},
    )

@router.delete("/reset")
async def reset_leads():
    get_db().table("leads").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    return {"status": "reset"}
```

- [ ] **Step 2: Criar backend/app/routers/bot.py**

```python
from fastapi import APIRouter
from ..services import bot_service

router = APIRouter(prefix="/api/bot", tags=["bot"])
_events = []

def _on_event(event: dict):
    _events.append(event)
    if len(_events) > 500:
        _events.pop(0)

@router.post("/start")
async def start(num_workers: int = 6):
    return await bot_service.start_bot(num_workers, _on_event)

@router.post("/stop")
async def stop():
    return await bot_service.stop_bot()

@router.get("/status")
async def status():
    return await bot_service.get_bot_status()

@router.get("/events")
async def events():
    return {"events": _events[-100:]}
```

- [ ] **Step 3: Criar backend/app/routers/stats.py**

```python
from fastapi import APIRouter
from ..database import get_db

router = APIRouter(prefix="/api/stats", tags=["stats"])

@router.get("/dashboard")
async def dashboard():
    result = get_db().table("leads").select("status").execute()
    rows = result.data
    total = len(rows)
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {
        "total": total,
        "elegiveis": counts.get("elegivel", 0),
        "inelegiveis": counts.get("inelegivel", 0),
        "pendentes": counts.get("pendente", 0),
        "erros": counts.get("erro", 0),
        "em_processamento": counts.get("consentido", 0) + counts.get("autorizado", 0) + counts.get("enriquecido", 0),
    }
```

- [ ] **Step 4: Criar backend/app/routers/webhook.py**

```python
import json
from fastapi import APIRouter, Request
from ..redis_client import get_redis

router = APIRouter(tags=["webhook"])

@router.post("/webhook")
async def receive_webhook(request: Request):
    payload = await request.json()
    print(f"[webhook] {payload}")

    if payload.get("type") == "private.consignment.consult.updated":
        consult_id = payload.get("consultId")
        if consult_id:
            redis = await get_redis()
            await redis.publish(f"consult:{consult_id}", json.dumps(payload))

    return {"ok": True}
```

- [ ] **Step 5: Criar backend/app/routers/ws.py**

```python
import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..redis_client import get_redis

router = APIRouter(tags=["ws"])
_connections: list[WebSocket] = []

@router.websocket("/ws/events")
async def websocket_events(ws: WebSocket):
    await ws.accept()
    _connections.append(ws)
    redis = await get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe("bot:events")
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await ws.send_text(message["data"])
    except WebSocketDisconnect:
        _connections.remove(ws)
    finally:
        await pubsub.unsubscribe("bot:events")
        await pubsub.aclose()
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/
git commit -m "feat: routers leads, bot, stats, webhook, ws"
```

---

## Task 10: main.py FastAPI

**Files:**
- Create: `backend/app/main.py`

- [ ] **Step 1: Criar backend/app/main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import leads, bot, stats, webhook, ws

app = FastAPI(title="V8 CLT Higienização", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router)
app.include_router(bot.router)
app.include_router(stats.router)
app.include_router(webhook.router)
app.include_router(ws.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 2: Testar servidor**

```bash
cd /Users/macbookdegabriel/projetos/V8/backend
uvicorn app.main:app --reload --port 8000
```

Em outro terminal:
```bash
curl http://localhost:8000/health
```
Expected: `{"status":"ok"}`

```bash
curl http://localhost:8000/api/stats/dashboard
```
Expected: JSON com contadores zerados.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: fastapi main com todos os routers"
```

---

## Task 11: Frontend — setup React + Vite

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/tsconfig.json`
- Create: `frontend/Dockerfile`

- [ ] **Step 1: Criar projeto React**

```bash
cd /Users/macbookdegabriel/projetos/V8
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install axios recharts react-router-dom
npm install -D @types/react @types/react-dom
```

- [ ] **Step 2: Atualizar frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
```

- [ ] **Step 3: Criar frontend/Dockerfile**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 4: Criar frontend/nginx.conf**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8000;
    }
    location /ws/ {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location / {
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "chore: setup frontend react typescript + vite + nginx"
```

---

## Task 12: Frontend — types + api client

**Files:**
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Criar frontend/src/lib/types.ts**

```typescript
export interface Lead {
  id: string
  cpf: string
  telefone: string
  nome: string | null
  email: string | null
  status: 'pendente' | 'enriquecido' | 'consentido' | 'autorizado' | 'elegivel' | 'inelegivel' | 'erro'
  margem_disponivel: number | null
  valor_liberado: number | null
  valor_parcela: number | null
  num_parcelas: number | null
  cet_mensal: number | null
  created_at: string
}

export interface StatsResponse {
  total: number
  elegiveis: number
  inelegiveis: number
  pendentes: number
  erros: number
  em_processamento: number
}

export interface BotEvent {
  type: string
  worker_id: number
  cpf?: string
  status?: string
  message?: string
  ts?: string
}

export interface WorkerState {
  id: number
  cpf: string | null
  status: string
  lastMessage: string
  processedCount: number
  eligibleCount: number
  recentLog: string[]
}
```

- [ ] **Step 2: Criar frontend/src/lib/api.ts**

```typescript
import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const leadsApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/leads/upload', form)
  },
  list: (status?: string, page = 1) =>
    api.get('/leads/', { params: { status, page, limit: 50 } }),
  export: () => window.open('/api/leads/export', '_blank'),
  reset: () => api.delete('/leads/reset'),
}

export const botApi = {
  start: (numWorkers = 6) => api.post('/bot/start', null, { params: { num_workers: numWorkers } }),
  stop: () => api.post('/bot/stop'),
  status: () => api.get('/bot/status'),
}

export const statsApi = {
  dashboard: () => api.get('/stats/dashboard'),
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: types typescript + api client axios"
```

---

## Task 13: Frontend — hook WebSocket

**Files:**
- Create: `frontend/src/hooks/useBotWebSocket.ts`

- [ ] **Step 1: Criar frontend/src/hooks/useBotWebSocket.ts**

```typescript
import { useEffect, useRef, useState } from 'react'
import { BotEvent, WorkerState } from '../lib/types'

export function useBotWebSocket() {
  const [botStatus, setBotStatus] = useState<'idle' | 'running'>('idle')
  const [events, setEvents] = useState<BotEvent[]>([])
  const [workerStates, setWorkerStates] = useState<WorkerState[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/events`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const event: BotEvent = JSON.parse(e.data)

      setEvents(prev => [event, ...prev].slice(0, 200))

      if (event.type === 'bot_status') {
        setBotStatus(event.status as 'idle' | 'running')
        return
      }

      if (event.type === 'worker_start' || event.type === 'status_update' || event.type === 'lead_result') {
        setWorkerStates(prev => {
          const next = [...prev]
          const idx = next.findIndex(w => w.id === event.worker_id)
          const worker: WorkerState = idx >= 0 ? { ...next[idx] } : {
            id: event.worker_id, cpf: null, status: '', lastMessage: '', processedCount: 0, eligibleCount: 0, recentLog: []
          }
          worker.cpf = event.cpf || worker.cpf
          worker.status = event.status || worker.status
          worker.lastMessage = event.message || event.status || ''
          worker.recentLog = [worker.lastMessage, ...worker.recentLog].slice(0, 5)
          if (event.type === 'lead_result') {
            worker.processedCount++
            if (event.status === 'elegivel') worker.eligibleCount++
          }
          if (idx >= 0) next[idx] = worker
          else next.push(worker)
          return next
        })
      }
    }

    return () => ws.close()
  }, [])

  return { botStatus, events, workerStates }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat: hook websocket workers em tempo real"
```

---

## Task 14: Frontend — componentes

**Files:**
- Create: `frontend/src/components/MetricsDashboard.tsx`
- Create: `frontend/src/components/BotControl.tsx`
- Create: `frontend/src/components/WorkersLive.tsx`
- Create: `frontend/src/components/UploadPanel.tsx`
- Create: `frontend/src/components/LeadsTable.tsx`
- Create: `frontend/src/components/WsEventFeed.tsx`

- [ ] **Step 1: Criar MetricsDashboard.tsx**

```tsx
import { StatsResponse } from '../lib/types'

interface Props { stats: StatsResponse }

export function MetricsDashboard({ stats }: Props) {
  const cards = [
    { label: 'Total', value: stats.total, color: '#6366f1' },
    { label: 'Elegíveis', value: stats.elegiveis, color: '#22c55e' },
    { label: 'Inelegíveis', value: stats.inelegiveis, color: '#ef4444' },
    { label: 'Pendentes', value: stats.pendentes, color: '#f59e0b' },
    { label: 'Em processo', value: stats.em_processamento, color: '#3b82f6' },
    { label: 'Erros', value: stats.erros, color: '#dc2626' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {cards.map(c => (
        <div key={c.label} style={{ background: '#1e1e2e', borderRadius: 12, padding: 20, borderLeft: `4px solid ${c.color}` }}>
          <div style={{ color: '#aaa', fontSize: 12 }}>{c.label}</div>
          <div style={{ color: '#fff', fontSize: 32, fontWeight: 700 }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Criar BotControl.tsx**

```tsx
import { useState } from 'react'
import { botApi, leadsApi } from '../lib/api'

interface Props { status: string; onRefresh: () => void }

export function BotControl({ status, onRefresh }: Props) {
  const [workers, setWorkers] = useState(6)

  const start = async () => {
    await botApi.start(workers)
    onRefresh()
  }
  const stop = async () => {
    await botApi.stop()
    onRefresh()
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '16px 0' }}>
      <label style={{ color: '#aaa' }}>Workers:</label>
      <input
        type="number" min={1} max={20} value={workers}
        onChange={e => setWorkers(Number(e.target.value))}
        style={{ width: 60, padding: '4px 8px', borderRadius: 6, border: '1px solid #444', background: '#1e1e2e', color: '#fff' }}
      />
      <button
        onClick={start} disabled={status === 'running'}
        style={{ padding: '8px 20px', borderRadius: 8, background: '#22c55e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
      >
        ▶ Start Bot
      </button>
      <button
        onClick={stop} disabled={status !== 'running'}
        style={{ padding: '8px 20px', borderRadius: 8, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
      >
        ■ Stop
      </button>
      <button
        onClick={() => leadsApi.export()}
        style={{ padding: '8px 20px', borderRadius: 8, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
      >
        ⬇ Exportar Elegíveis
      </button>
      <span style={{ color: status === 'running' ? '#22c55e' : '#666', fontWeight: 600 }}>
        {status === 'running' ? '● Rodando' : '○ Parado'}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Criar WorkersLive.tsx**

```tsx
import { WorkerState } from '../lib/types'

interface Props { workers: WorkerState[] }

const statusColor: Record<string, string> = {
  elegivel: '#22c55e', inelegivel: '#ef4444', erro: '#dc2626',
  autorizado: '#3b82f6', consentido: '#6366f1', enriquecido: '#f59e0b', pendente: '#666'
}

export function WorkersLive({ workers }: Props) {
  if (workers.length === 0) return <p style={{ color: '#666' }}>Nenhum worker ativo</p>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
      {workers.map(w => (
        <div key={w.id} style={{ background: '#1e1e2e', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: '#fff', fontWeight: 700 }}>Worker #{w.id}</span>
            <span style={{ color: statusColor[w.status] || '#aaa', fontSize: 12 }}>{w.status}</span>
          </div>
          <div style={{ color: '#aaa', fontSize: 12, marginBottom: 4 }}>CPF: {w.cpf || '-'}</div>
          <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>
            Processados: <b style={{ color: '#fff' }}>{w.processedCount}</b> | 
            Elegíveis: <b style={{ color: '#22c55e' }}>{w.eligibleCount}</b>
          </div>
          <div style={{ background: '#111', borderRadius: 6, padding: 8, fontSize: 11, color: '#888' }}>
            {w.recentLog.slice(0, 3).map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Criar UploadPanel.tsx**

```tsx
import { useRef } from 'react'
import { leadsApi } from '../lib/api'

interface Props { onUploaded: () => void }

export function UploadPanel({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const res = await leadsApi.upload(file)
    alert(`${res.data.inserted} CPFs importados!`)
    onUploaded()
  }

  return (
    <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 24, textAlign: 'center' }}>
      <p style={{ color: '#aaa', marginBottom: 16 }}>
        Faça upload de um CSV com colunas: <code>cpf, telefone</code>
      </p>
      <input ref={inputRef} type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
      <button
        onClick={() => inputRef.current?.click()}
        style={{ padding: '12px 32px', borderRadius: 8, background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 16 }}
      >
        📂 Selecionar CSV
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Criar LeadsTable.tsx**

```tsx
import { Lead } from '../lib/types'

interface Props { leads: Lead[] }

const statusBadge: Record<string, string> = {
  elegivel: '#22c55e', inelegivel: '#ef4444', erro: '#dc2626',
  pendente: '#666', autorizado: '#3b82f6', consentido: '#6366f1', enriquecido: '#f59e0b'
}

export function LeadsTable({ leads }: Props) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            {['CPF', 'Nome', 'Telefone', 'Status', 'Margem', 'Valor Liberado', 'Parcela', 'CET'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#aaa', fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.cpf} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{l.cpf}</td>
              <td style={{ padding: '8px 12px' }}>{l.nome || '-'}</td>
              <td style={{ padding: '8px 12px' }}>{l.telefone}</td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{ background: statusBadge[l.status] || '#444', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
                  {l.status}
                </span>
              </td>
              <td style={{ padding: '8px 12px' }}>{l.margem_disponivel ? `R$ ${l.margem_disponivel.toFixed(2)}` : '-'}</td>
              <td style={{ padding: '8px 12px' }}>{l.valor_liberado ? `R$ ${l.valor_liberado.toFixed(2)}` : '-'}</td>
              <td style={{ padding: '8px 12px' }}>{l.valor_parcela ? `R$ ${l.valor_parcela.toFixed(2)}` : '-'}</td>
              <td style={{ padding: '8px 12px' }}>{l.cet_mensal ? `${l.cet_mensal}%` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Criar WsEventFeed.tsx**

```tsx
import { BotEvent } from '../lib/types'

interface Props { events: BotEvent[] }

export function WsEventFeed({ events }: Props) {
  return (
    <div style={{ background: '#111', borderRadius: 8, padding: 12, height: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
      {events.slice(0, 50).map((e, i) => (
        <div key={i} style={{ color: e.status === 'elegivel' ? '#22c55e' : e.status === 'erro' ? '#ef4444' : '#aaa', marginBottom: 2 }}>
          [{e.ts?.split('T')[1]?.slice(0, 8)}] W{e.worker_id} {e.cpf} → {e.status} {e.message ? `| ${e.message}` : ''}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: componentes dashboard (metrics, control, workers, upload, table, feed)"
```

---

## Task 15: Frontend — Dashboard page + App

**Files:**
- Create: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Criar frontend/src/pages/Dashboard.tsx**

```tsx
import { useEffect, useState } from 'react'
import { statsApi, leadsApi } from '../lib/api'
import { StatsResponse, Lead } from '../lib/types'
import { useBotWebSocket } from '../hooks/useBotWebSocket'
import { MetricsDashboard } from '../components/MetricsDashboard'
import { BotControl } from '../components/BotControl'
import { WorkersLive } from '../components/WorkersLive'
import { UploadPanel } from '../components/UploadPanel'
import { LeadsTable } from '../components/LeadsTable'
import { WsEventFeed } from '../components/WsEventFeed'

const TABS = ['Geral', 'Workers', 'Leads', 'Upload']

export function Dashboard() {
  const [tab, setTab] = useState('Geral')
  const [stats, setStats] = useState<StatsResponse>({ total: 0, elegiveis: 0, inelegiveis: 0, pendentes: 0, erros: 0, em_processamento: 0 })
  const [leads, setLeads] = useState<Lead[]>([])
  const { botStatus, events, workerStates } = useBotWebSocket()

  const refreshStats = async () => {
    const res = await statsApi.dashboard()
    setStats(res.data)
  }
  const refreshLeads = async () => {
    const res = await leadsApi.list()
    setLeads(res.data.data)
  }

  useEffect(() => {
    refreshStats()
    refreshLeads()
    const t = setInterval(refreshStats, 10000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (events.length > 0 && tab === 'Leads') refreshLeads()
  }, [events.length])

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f1a', color: '#fff', fontFamily: 'system-ui' }}>
      <div style={{ background: '#1e1e2e', padding: '16px 32px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }}>V8 CLT Higienizador</span>
        <span style={{ color: '#666', fontSize: 14 }}>Crédito Privado CLT</span>
      </div>

      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600,
                background: tab === t ? '#6366f1' : '#1e1e2e', color: tab === t ? '#fff' : '#aaa' }}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'Geral' && (
          <>
            <BotControl status={botStatus} onRefresh={refreshStats} />
            <div style={{ marginTop: 24 }}>
              <MetricsDashboard stats={stats} />
            </div>
            <div style={{ marginTop: 24 }}>
              <h3 style={{ color: '#aaa', marginBottom: 12 }}>Feed de Eventos</h3>
              <WsEventFeed events={events} />
            </div>
          </>
        )}

        {tab === 'Workers' && (
          <>
            <h3 style={{ color: '#aaa', marginBottom: 16 }}>Workers ao Vivo — {workerStates.length} ativos</h3>
            <WorkersLive workers={workerStates} />
          </>
        )}

        {tab === 'Leads' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={refreshLeads} style={{ padding: '6px 16px', borderRadius: 6, background: '#1e1e2e', color: '#aaa', border: '1px solid #333', cursor: 'pointer' }}>
                🔄 Atualizar
              </button>
            </div>
            <LeadsTable leads={leads} />
          </>
        )}

        {tab === 'Upload' && (
          <UploadPanel onUploaded={() => { refreshStats(); refreshLeads() }} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar frontend/src/App.tsx**

```tsx
import { Dashboard } from './pages/Dashboard'

export default function App() {
  return <Dashboard />
}
```

- [ ] **Step 3: Atualizar frontend/src/main.tsx**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 4: Testar frontend**

```bash
cd /Users/macbookdegabriel/projetos/V8/frontend
npm run dev
```
Abra `http://localhost:5173` — deve exibir o dashboard com tabs Geral, Workers, Leads, Upload.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: dashboard completo com tabs geral/workers/leads/upload"
```

---

## Task 16: Teste end-to-end com Docker Compose

- [ ] **Step 1: Preencher .env com credenciais reais**

Copie `.env.example` → `.env` e preencha V8, Supabase e Redis.

- [ ] **Step 2: Iniciar ngrok**

```bash
npx ngrok http 8000
```
Copie a URL (ex: `https://abc123.ngrok-free.app`) e atualize `WEBHOOK_URL` no `.env`.

- [ ] **Step 3: Criar data/input.csv de teste**

```bash
cat > /tmp/test_leads.csv << 'EOF'
cpf,telefone
05817761190,92987314552
EOF
```

- [ ] **Step 4: Subir Docker Compose**

```bash
cd /Users/macbookdegabriel/projetos/V8
docker compose up --build
```
Expected: backend na 8000, frontend na 3000, redis na 6379.

- [ ] **Step 5: Upload do CSV e start bot**

1. Abra `http://localhost:3000`
2. Clique na tab **Upload** → selecione `/tmp/test_leads.csv`
3. Clique **Start Bot** (1 worker)
4. Observe tab **Workers** em tempo real
5. Aguarde o lead aparecer como **elegivel** ou **inelegivel** na tab **Leads**

- [ ] **Step 6: Verificar Supabase**

No Supabase Dashboard → Table Editor → `leads` — deve mostrar o CPF com status e dados da simulação preenchidos.

- [ ] **Step 7: Exportar elegíveis**

Clique em **⬇ Exportar Elegíveis** — deve baixar CSV com os dados completos de simulação.

- [ ] **Step 8: Commit final**

```bash
git add .
git commit -m "feat: sistema completo v8 clt higienizacao - e2e validado"
```

---

## Self-Review

**Spec coverage:**
- ✅ Python + FastAPI + asyncio
- ✅ Supabase (leads + bot_runs)
- ✅ Redis (pubsub webhook + state)
- ✅ Docker Compose (backend + frontend + redis)
- ✅ Dashboard React com upload CSV, workers ao vivo, tabela de leads, exportação
- ✅ Workers paralelos configuráveis
- ✅ Webhook FastAPI → Redis pubsub → worker
- ✅ Simulação completa (valor_liberado, parcela, CET)
- ✅ Exportação CSV de elegíveis

**Sem placeholders:** todas as tasks têm código completo e executável.

**Consistência de tipos:**
- `LeadWorker.process(lead: dict)` recebe dict do Supabase ✅
- `BotEvent` no backend e `BotEvent` TypeScript alinhados ✅
- `WorkerState` inicializado com todos os campos antes de uso ✅
- `on_event` callback flui: `LeadWorker` → `bot_service` → Redis pubsub → WebSocket → frontend ✅
