# Instalar disparo automatico do bot V8 às 6h

Esse projeto não tem scheduler interno (foi revertido em `db28adf`). O start automático é feito via cron na VPS.

## Instalação (uma vez só)

Acesse o **Terminal Web da Hostinger** (SSH externo bloqueado), entre como root e rode:

```bash
chmod +x /root/acelera-corban/scripts/bot-start.sh
mkdir -p /root/acelera-corban/logs
( crontab -l 2>/dev/null; echo "0 6 * * * /root/acelera-corban/scripts/bot-start.sh >> /root/acelera-corban/logs/bot-cron.log 2>&1" ) | crontab -
crontab -l
```

A última linha mostra o crontab pra confirmar que entrou.

## O que acontece às 06:00

- Cron chama `bot-start.sh`
- Script loga no Supabase, pega JWT, chama `POST https://aceleracorban.com.br/api/bot/start?num_workers=10`
- Bot pega TODOS os leads `pendente` do user e processa
- Log fica em `/root/acelera-corban/logs/bot-cron.log`

## Variáveis ajustáveis

```bash
WORKERS=15 /root/acelera-corban/scripts/bot-start.sh   # se cap subir pra 15
API_URL=http://outro-host /root/acelera-corban/scripts/bot-start.sh  # outro endpoint
```

## Como confirmar que ta rodando

- `tail -f /root/acelera-corban/logs/bot-cron.log` no dia seguinte às 06:00
- Ou aba "📜 Histórico de Runs" no dashboard — vai aparecer uma run iniciada às ~06:00 automaticamente

## Remover

```bash
crontab -e   # apaga a linha do bot-start.sh, salva
```
