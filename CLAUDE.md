# ACELERA CORBAN — Instruções para Claude

## Modo de trabalho

**Modo autônomo.** Não pedir confirmação pra edits e bash. Só perguntar antes de:
- Deletar arquivos ou diretórios
- `git reset --hard`, `git push --force`, `--no-verify`
- Dropar tabelas, truncate, migrations destrutivas
- Ações irreversíveis em produção (VPS, Cloudflare, Supabase)
- Mudanças que afetam outros usuários (ex: alterar credenciais alheias)

Em tudo que é local/reversível: tomar decisão e executar.

## Contexto rápido

- Stack: FastAPI (Python 3.12) + React/Vite + Supabase + Redis
- Local dev: ports 3002 (front), 8002 (back), 6381 (redis)
- Produção: VPS Hostinger 177.7.58.154, domínio `aceleracorban.com.br` (Caddy + Cloudflare)
- Detalhes completos: `PROGRESS.md` (gitignored, tem credenciais)
- Spec do refactor multi-banco em curso: `docs/superpowers/specs/2026-05-02-multibank-refactor-design.md`

## Convenções

- Commits: português, prefixo `feat:`/`fix:`/`docs:`/`chore:` etc, descrição curta no "porquê"
- Co-author em commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Backend: tudo em `backend/app/`, módulos por banco em `backend/app/banks/<code>/`
- Frontend: pages em `frontend/src/pages/`, componentes por banco em `frontend/src/banks/<code>/`
