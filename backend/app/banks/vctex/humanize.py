import asyncio
import random

# User agents realistas para parecer navegador humano
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
]

async def human_delay(min_sec: float = 0.5, max_sec: float = 3.0):
    """Adiciona delay aleatório para parecer humano"""
    delay = random.uniform(min_sec, max_sec)
    await asyncio.sleep(delay)

async def human_delay_between_actions(min_sec: float = 10.0, max_sec: float = 20.0):
    """Delay AGRESSIVO entre ações (simula humano lento, evita detecção)"""
    delay = random.uniform(min_sec, max_sec)
    await asyncio.sleep(delay)

def get_random_user_agent() -> str:
    """Retorna user agent aleatório"""
    return random.choice(USER_AGENTS)

def get_human_headers() -> dict:
    """Headers realistas para requisições HTTP"""
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    }

async def exponential_backoff_retry(
    func,
    *args,
    max_retries: int = 3,
    base_delay: float = 1.0,
    **kwargs
):
    """Retry com backoff exponencial (se falhar, aguarda exponencialmente + tenta novamente)"""
    for attempt in range(max_retries):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
            await asyncio.sleep(delay)
