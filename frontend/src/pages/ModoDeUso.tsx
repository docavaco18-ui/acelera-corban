import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

type GuideId =
  | "inicio"
  | "higienizacao"
  | "dashboard"
  | "crm"
  | "chatwoot"
  | "disparos"
  | "powerhub"
  | "configuracoes"
  | "rotina";

type GuideSection = {
  id: GuideId;
  label: string;
  kicker: string;
  title: string;
  summary: string;
  accent: string;
  tags: string[];
  flow?: string[];
  cards: { title: string; body: string }[];
  checklist?: string[];
  links?: { label: string; to: string }[];
};

const C = {
  bg: "#070712",
  panel: "#101225",
  panel2: "#16182e",
  line: "#252943",
  line2: "#343a5e",
  text: "#f3f4f6",
  soft: "#cbd5e1",
  muted: "#8b94aa",
  green: "#20c997",
  blue: "#38bdf8",
  purple: "#8b5cf6",
  amber: "#f6b73c",
  red: "#fb7185",
};

const guides: GuideSection[] = [
  {
    id: "inicio",
    label: "Comece aqui",
    kicker: "Visao geral",
    title: "Como o Acelera Corban organiza a operacao",
    summary:
      "O sistema junta higienizacao de bases, controle comercial, Chatwoot, disparos e enriquecimento de dados em um fluxo unico para operacoes de credito CLT.",
    accent: C.purple,
    tags: ["primeiro acesso", "operacao", "visao geral"],
    flow: ["Configurar acessos", "Subir base", "Rodar consulta", "Priorizar elegiveis", "Vender e acompanhar"],
    cards: [
      {
        title: "Antes de rodar",
        body:
          "Cadastre as credenciais do banco ou ferramenta que sera usada. Cada usuario trabalha com seus proprios acessos.",
      },
      {
        title: "Durante a operacao",
        body:
          "Acompanhe os robos, resultados ao vivo, rank de elegiveis, conversas e disparos em suas abas especificas.",
      },
      {
        title: "Depois da consulta",
        body:
          "Exporte elegiveis, priorize os maiores valores liberados, organize propostas no CRM e acione os leads pelos canais conectados.",
      },
    ],
    checklist: [
      "Entrar com usuario e senha do sistema.",
      "Salvar credenciais em Configuracoes ou dentro do disparador.",
      "Fazer um teste pequeno antes de rodar base grande.",
      "Conferir resultados e exportar os elegiveis.",
    ],
    links: [
      { label: "Configuracoes", to: "/configuracoes" },
      { label: "Higienizacao", to: "/higienizacao" },
      { label: "Dashboard", to: "/dashboard" },
    ],
  },
  {
    id: "higienizacao",
    label: "Higienizacao",
    kicker: "Base CLT",
    title: "Descobrir margem e valor liberado por CPF",
    summary:
      "A aba de Higienizacao serve para subir uma base com CPFs e consultar, banco por banco, se o cliente e elegivel, se possui margem de emprestimo CLT e qual valor pode ser liberado.",
    accent: C.green,
    tags: ["cpf", "margem", "v8", "vctex", "mercantil", "presenca"],
    flow: ["Escolher banco", "Enviar CSV", "Iniciar robos", "Acompanhar ao vivo", "Exportar elegiveis"],
    cards: [
      {
        title: "Bancos disponiveis",
        body:
          "V8, VCTex, Mercantil e Presenca consultam CPFs para identificar elegibilidade, margem e valor liberado.",
      },
      {
        title: "Geral",
        body:
          "Mostra o processamento atual ao vivo: progresso, total liberado, fases, pendentes, erros, elegiveis e inelegiveis.",
      },
      {
        title: "Historico",
        body:
          "Mostra as bases ja carregadas e registros anteriores da higienizacao, com possibilidade de revisar e baixar resultados.",
      },
      {
        title: "Rank de Elegivel",
        body:
          "Ordena os clientes elegiveis do maior valor liberado para o menor, ajudando o time a vender primeiro para quem tem mais potencial.",
      },
      {
        title: "Graficos e Todos os Resultados",
        body:
          "Graficos mostram a leitura demografica e operacional. Todos os Resultados lista tudo que voltou da consulta.",
      },
      {
        title: "Workers, Cerebro e Runs",
        body:
          "Workers ao vivo mostram os robos rodando. Cerebro e a camada que orquestra. Historico de Runs registra cada inicializacao de processamento.",
      },
    ],
    checklist: [
      "Escolha o banco no seletor superior.",
      "Clique em Carregar CSV e envie uma base com CPFs.",
      "Defina a quantidade de workers quando a tela permitir.",
      "Clique em Iniciar e acompanhe a aba Geral.",
      "Ao finalizar, use Rank de Elegivel e exporte os melhores leads.",
    ],
    links: [
      { label: "Abrir Higienizacao", to: "/higienizacao" },
      { label: "Ver Dashboard", to: "/dashboard" },
      { label: "Configurar Bancos", to: "/configuracoes" },
    ],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    kicker: "Central unificada",
    title: "Enxergar tudo que esta acontecendo",
    summary:
      "O Dashboard concentra a operacao em uma visao mais unificada, reunindo historico, bases, indicadores e andamento do que ja foi processado.",
    accent: C.blue,
    tags: ["historico", "indicadores", "base", "operacao"],
    flow: ["Abrir dashboard", "Ver bases", "Checar totais", "Baixar resultados", "Voltar ao modulo"],
    cards: [
      {
        title: "Resumo operacional",
        body:
          "Use para entender rapidamente o volume processado, valores liberados, bases ativas e historico de higienizacoes.",
      },
      {
        title: "Historico de bases",
        body:
          "Ajuda a controlar o que ja foi rodado e a recuperar arquivos/resultados sem depender de planilhas soltas.",
      },
      {
        title: "Apoio comercial",
        body:
          "Depois da consulta, o dashboard funciona como ponto de partida para decidir onde vender primeiro.",
      },
    ],
    links: [{ label: "Abrir Dashboard", to: "/dashboard" }],
  },
  {
    id: "crm",
    label: "CRM",
    kicker: "Propostas",
    title: "Organizar proposta, pagamento e prioridade",
    summary:
      "O CRM serve para controlar propostas, pagamentos, importantes, pendentes, leilao, FGTS e valores salvos, com filtros por banco e sistema.",
    accent: C.amber,
    tags: ["propostas", "pagamentos", "pendentes", "fgts", "leilao"],
    flow: ["Cadastrar proposta", "Mover no quadro", "Filtrar por banco", "Acompanhar valor", "Aprovar ou finalizar"],
    cards: [
      {
        title: "Controle de propostas",
        body:
          "Cadastre e acompanhe propostas por cliente, vendedor, banco, valor, prazo, parcela e status comercial.",
      },
      {
        title: "Organizacao por status",
        body:
          "Use as colunas para separar propostas importantes, pendentes, pagamentos, leilao e FGTS.",
      },
      {
        title: "Resumo de valor",
        body:
          "O CRM tambem mostra resumo de valores para a gestao enxergar o que esta salvo e o que precisa de acao.",
      },
    ],
    checklist: [
      "Cadastre a proposta com os dados do cliente.",
      "Use os filtros por banco ou periodo.",
      "Mova a proposta conforme o andamento.",
      "Se houver senha CRM ativa, informe a senha para acoes protegidas.",
    ],
    links: [
      { label: "Abrir CRM", to: "/crm" },
      { label: "Seguranca CRM", to: "/configuracoes" },
    ],
  },
  {
    id: "chatwoot",
    label: "CRM Chatwoot",
    kicker: "Conversas",
    title: "Trazer o que acontece no Chatwoot para dentro do sistema",
    summary:
      "Para quem usa Chatwoot, o sistema conecta com o CRM de conversas e busca em tempo real sinais de lead, gestao, abertura, aguardando resultado, erro e elegibilidade.",
    accent: C.green,
    tags: ["chatwoot", "conversas", "leads", "gestao"],
    flow: ["Salvar Chatwoot", "Rodar sincronizacao", "Ler metricas", "Filtrar leads", "Atuar nas conversas"],
    cards: [
      {
        title: "Conexao com Chatwoot",
        body:
          "Informe URL, conta, token e inboxes para o sistema cruzar os leads com conversas do atendimento.",
      },
      {
        title: "Agente de leitura",
        body:
          "A sincronizacao busca as conexoes e ajuda a entender o que esta acontecendo dentro do Chatwoot.",
      },
      {
        title: "Gestao de lead",
        body:
          "Acompanhe conversa, abertura, aguardando resultado, erro, elegivel e outros sinais importantes para venda.",
      },
    ],
    checklist: [
      "Configure URL, Account ID, token e inboxes.",
      "Inicie a sincronizacao.",
      "Aguarde o processamento, principalmente na primeira leitura.",
      "Use filtros para encontrar leads que precisam de acao.",
    ],
    links: [{ label: "Abrir CRM Chatwoot", to: "/chatwoot" }],
  },
  {
    id: "disparos",
    label: "Disparos",
    kicker: "WhatsApp",
    title: "Conectar CRM, BM e Acelera Corban para disparar",
    summary:
      "Os disparos VendeAI, Aesir e Chipcare conectam o CRM do cliente com a Meta/Facebook BM. A IA monitora qualidade, status dos numeros e andamento das campanhas.",
    accent: C.red,
    tags: ["vendeai", "aesir", "chipcare", "meta", "bm", "whatsapp"],
    flow: ["Salvar CRM", "Salvar token BM", "Atualizar status", "Subir CSV", "Confirmar disparo", "Monitorar"],
    cards: [
      {
        title: "Tres ferramentas",
        body:
          "O sistema possui Disparo VendeAI, Disparo Aesir e Disparo Chipcare. A logica central e a mesma: ligar CRM, BM e sistema.",
      },
      {
        title: "Credenciais necessarias",
        body:
          "Dependendo do CRM, sera necessario login e senha, token, ID do CRM ou apenas login/senha do CRM mais token de usuario de sistema da BM.",
      },
      {
        title: "Token Meta/BM",
        body:
          "O token de usuario de sistema da BM permite consultar numeros, qualidade, restricoes, nome de exibicao e capacidade de envio.",
      },
      {
        title: "IA de monitoramento",
        body:
          "O disparo acontece no CRM da pessoa, mas o Acelera Corban monitora a saude dos numeros, status da BM e historico da campanha.",
      },
      {
        title: "Atualizar Status",
        body:
          "Sempre que salvar ou trocar credenciais, clique em Atualizar Status para cruzar CRM e Meta e carregar os numeros disponiveis.",
      },
      {
        title: "Durante a campanha",
        body:
          "Acompanhe qualidade, numeros pausados, historico, alertas e progresso para evitar disparar por numero ruim ou bloqueado.",
      },
    ],
    checklist: [
      "Salvar credenciais do CRM usado.",
      "Salvar token Meta/BM de usuario de sistema.",
      "Clicar em Atualizar Status.",
      "Verificar se os numeros aparecem e estao saudaveis.",
      "Subir CSV, mapear campos ou variaveis e confirmar disparo.",
      "Monitorar historico e qualidade durante a execucao.",
    ],
    links: [
      { label: "Disparo VendeAI", to: "/disparo" },
      { label: "Disparo Aesir", to: "/disparo-aesir" },
      { label: "Disparo Chipcare", to: "/disparo-chipcare" },
    ],
  },
  {
    id: "powerhub",
    label: "PowerHub",
    kicker: "Enriquecimento",
    title: "Buscar telefones quentes usando CPF",
    summary:
      "PowerHub e o modulo de enriquecimento de dados. O usuario sobe uma base com CPF e o agente consulta o PowerHub para trazer dados de telefonia daquele CPF.",
    accent: C.blue,
    tags: ["telefone", "cpf", "enriquecimento", "powerhub"],
    flow: ["Subir CPFs", "Rodar enriquecimento", "Consultar PowerHub", "Encontrar telefones", "Exportar XLSX"],
    cards: [
      {
        title: "O que enviar",
        body:
          "A base precisa somente de CPF. A partir dele, o sistema consulta o PowerHub e tenta encontrar telefones vinculados.",
      },
      {
        title: "Resultado esperado",
        body:
          "Quando encontrar, o modulo retorna telefone quente e dados de telefonia para apoiar abordagem comercial.",
      },
      {
        title: "Quando usar",
        body:
          "Use quando voce tem CPF, mas precisa enriquecer a base com telefone antes de acionar o cliente.",
      },
    ],
    checklist: [
      "Abra a aba PowerHub pelo seletor de banco.",
      "Suba um CSV com CPFs.",
      "Escolha a quantidade de workers.",
      "Inicie o enriquecimento.",
      "Exporte a planilha com telefones encontrados.",
    ],
    links: [
      { label: "Abrir PowerHub", to: "/powerhub" },
      { label: "Configurar PowerHub", to: "/configuracoes" },
    ],
  },
  {
    id: "configuracoes",
    label: "Configuracoes",
    kicker: "Acessos",
    title: "Cadastrar logins, senhas, proxies e seguranca",
    summary:
      "Configuracoes e onde o usuario salva os acessos dos bancos. Quando precisar, tambem configura senha do CRM e proxies por banco.",
    accent: C.purple,
    tags: ["login", "senha", "proxy", "credenciais"],
    flow: ["Escolher banco", "Preencher login", "Preencher senha", "Salvar", "Testar modulo"],
    cards: [
      {
        title: "Credenciais por banco",
        body:
          "Cada banco tem seu proprio login e senha. Se o usuario quiser trocar a senha, basta preencher e salvar novamente.",
      },
      {
        title: "Senha CRM",
        body:
          "Administradores podem ativar senha para proteger a criacao e exclusao de propostas no CRM.",
      },
      {
        title: "Proxies",
        body:
          "Quando necessario, proxies podem ser cadastrados por banco para controlar a origem dos robos.",
      },
    ],
    checklist: [
      "Selecionar o banco correto no topo.",
      "Informar login.",
      "Informar senha quando for cadastrar ou trocar.",
      "Salvar antes de iniciar qualquer robo.",
    ],
    links: [{ label: "Abrir Configuracoes", to: "/configuracoes" }],
  },
  {
    id: "rotina",
    label: "Rotina recomendada",
    kicker: "Operacao diaria",
    title: "Sequencia simples para vender mais rapido",
    summary:
      "Uma rotina enxuta evita perda de tempo: consultar base, priorizar maior valor, organizar proposta, conversar pelo CRM e disparar com numeros saudaveis.",
    accent: C.amber,
    tags: ["rotina", "vendas", "checklist"],
    flow: ["Base nova", "Higienizar", "Rank de valor", "CRM", "Chatwoot ou disparo", "Fechamento"],
    cards: [
      {
        title: "Manha",
        body:
          "Suba bases novas, rode a higienizacao e confira erros ou pendencias antes de acionar o time comercial.",
      },
      {
        title: "Durante o dia",
        body:
          "Priorize Rank de Elegivel, mova propostas no CRM e acompanhe conversas no Chatwoot.",
      },
      {
        title: "Antes de disparar",
        body:
          "Atualize status da BM, confira qualidade dos numeros e evite campanhas em canais bloqueados ou limitados.",
      },
    ],
    checklist: [
      "Rodar uma amostra pequena quando a credencial for nova.",
      "Retentar erros antes de descartar lead.",
      "Exportar elegiveis e atacar maiores valores primeiro.",
      "Manter CRM organizado para nao perder proposta quente.",
    ],
    links: [
      { label: "Higienizacao", to: "/higienizacao" },
      { label: "CRM", to: "/crm" },
      { label: "Disparos", to: "/disparo" },
    ],
  },
];

const quickTerms = [
  "CPF",
  "margem CLT",
  "valor liberado",
  "BM",
  "token Meta",
  "elegivel",
  "Chatwoot",
  "PowerHub",
];

function normalize(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function Flow({ steps, color }: { steps: string[]; color: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 8 }}>
      {steps.map((step, i) => (
        <div key={step} style={{
          minHeight: 78,
          border: `1px solid ${i === 0 ? color : C.line}`,
          borderRadius: 8,
          padding: 12,
          background: i === 0 ? `${color}17` : "rgba(255,255,255,.025)",
          position: "relative",
        }}>
          <div style={{ color, fontSize: 11, fontWeight: 900, marginBottom: 8 }}>
            {String(i + 1).padStart(2, "0")}
          </div>
          <div style={{ color: C.text, fontSize: 13, lineHeight: 1.25, fontWeight: 750 }}>{step}</div>
        </div>
      ))}
    </div>
  );
}

function LinkButton({ to, label, color }: { to: string; label: string; color: string }) {
  return (
    <NavLink to={to} style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 34,
      padding: "0 13px",
      borderRadius: 8,
      background: `${color}17`,
      border: `1px solid ${color}55`,
      color,
      textDecoration: "none",
      fontSize: 12,
      fontWeight: 800,
      whiteSpace: "nowrap",
    }}>
      {label}
    </NavLink>
  );
}

export default function ModoDeUso() {
  const [activeId, setActiveId] = useState<GuideId>("inicio");
  const [query, setQuery] = useState("");
  const active = guides.find((g) => g.id === activeId) ?? guides[0];

  const filteredGuides = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return guides;
    return guides.filter((g) => {
      const haystack = normalize([
        g.label,
        g.title,
        g.summary,
        g.kicker,
        ...g.tags,
        ...(g.flow ?? []),
        ...g.cards.flatMap((c) => [c.title, c.body]),
        ...(g.checklist ?? []),
      ].join(" "));
      return haystack.includes(q);
    });
  }, [query]);

  const resultIds = new Set(filteredGuides.map((g) => g.id));

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      padding: "22px 24px 42px",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "280px minmax(0, 1fr)",
        gap: 18,
        alignItems: "start",
      }}>
        <aside style={{
          position: "sticky",
          top: 16,
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          padding: 14,
        }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ color: C.muted, fontSize: 11, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 8 }}>
              Guia operacional
            </div>
            <div style={{ color: C.text, fontSize: 20, fontWeight: 900, lineHeight: 1.05 }}>
              Modo de Uso
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar no guia"
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: `1px solid ${C.line2}`,
              background: "#0a0b18",
              color: C.text,
              borderRadius: 8,
              padding: "10px 11px",
              fontSize: 13,
              outline: "none",
              marginBottom: 10,
            }}
          />

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {quickTerms.map((t) => (
              <button
                key={t}
                onClick={() => setQuery(t)}
                style={{
                  border: `1px solid ${C.line}`,
                  background: "rgba(255,255,255,.025)",
                  color: C.muted,
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {guides.map((g) => {
              const selected = g.id === active.id;
              const dim = query && !resultIds.has(g.id);
              return (
                <button
                  key={g.id}
                  onClick={() => setActiveId(g.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: `1px solid ${selected ? g.accent : C.line}`,
                    background: selected ? `${g.accent}17` : "rgba(255,255,255,.018)",
                    color: dim ? "#4b5268" : selected ? C.text : C.soft,
                    borderRadius: 8,
                    padding: "10px 11px",
                    cursor: "pointer",
                    opacity: dim ? 0.45 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: g.accent, flex: "0 0 auto" }} />
                    <span style={{ fontSize: 13, fontWeight: 850 }}>{g.label}</span>
                  </div>
                  <div style={{ color: dim ? "#3c4256" : C.muted, fontSize: 11, marginTop: 4, paddingLeft: 17 }}>
                    {g.kicker}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main style={{ minWidth: 0 }}>
          <section style={{
            background: `linear-gradient(135deg, ${active.accent}1f, rgba(255,255,255,.025))`,
            border: `1px solid ${active.accent}55`,
            borderRadius: 8,
            padding: 22,
            marginBottom: 14,
            overflow: "hidden",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", marginBottom: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: active.accent, fontSize: 12, fontWeight: 950, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 8 }}>
                  {active.kicker}
                </div>
                <h1 style={{ color: C.text, fontSize: 34, lineHeight: 1.03, margin: 0, letterSpacing: 0 }}>
                  {active.title}
                </h1>
              </div>
              <div style={{
                width: 110,
                height: 110,
                borderRadius: 8,
                border: `1px solid ${active.accent}44`,
                background: `radial-gradient(circle at 35% 35%, ${active.accent}66, transparent 44%), #090a16`,
                display: "grid",
                placeItems: "center",
                flex: "0 0 auto",
              }}>
                <div style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  border: `2px solid ${active.accent}`,
                  boxShadow: `0 0 28px ${active.accent}77`,
                }} />
              </div>
            </div>

            <p style={{ color: C.soft, fontSize: 16, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 940 }}>
              {active.summary}
            </p>

            {active.links && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {active.links.map((l) => <LinkButton key={l.to} to={l.to} label={l.label} color={active.accent} />)}
              </div>
            )}
          </section>

          {active.flow && (
            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18, marginBottom: 14 }}>
              <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 12 }}>
                Fluxo recomendado
              </div>
              <Flow steps={active.flow} color={active.accent} />
            </section>
          )}

          <section style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}>
            {active.cards.map((card) => (
              <article key={card.title} style={{
                background: C.panel,
                border: `1px solid ${C.line}`,
                borderRadius: 8,
                padding: 16,
                minHeight: 128,
              }}>
                <div style={{ color: active.accent, fontSize: 13, fontWeight: 900, marginBottom: 8 }}>
                  {card.title}
                </div>
                <div style={{ color: C.soft, fontSize: 13, lineHeight: 1.55 }}>
                  {card.body}
                </div>
              </article>
            ))}
          </section>

          {active.checklist && (
            <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ color: C.muted, fontSize: 11, fontWeight: 950, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 5 }}>
                    Checklist rapido
                  </div>
                  <div style={{ color: C.text, fontSize: 18, fontWeight: 900 }}>
                    Antes de chamar suporte, confira estes passos
                  </div>
                </div>
                <span style={{
                  color: active.accent,
                  border: `1px solid ${active.accent}55`,
                  background: `${active.accent}12`,
                  borderRadius: 999,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 850,
                  whiteSpace: "nowrap",
                }}>
                  {active.checklist.length} passos
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {active.checklist.map((item, i) => (
                  <div key={item} style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr",
                    gap: 10,
                    alignItems: "start",
                    background: "rgba(255,255,255,.025)",
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: 11,
                  }}>
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      display: "grid",
                      placeItems: "center",
                      background: `${active.accent}1f`,
                      color: active.accent,
                      fontSize: 12,
                      fontWeight: 950,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ color: C.soft, fontSize: 13, lineHeight: 1.45 }}>{item}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      <style>{`
        @media (max-width: 980px) {
          div[style*="grid-template-columns: 280px minmax(0, 1fr)"] {
            grid-template-columns: 1fr !important;
          }
          aside {
            position: static !important;
          }
          section[style*="repeat(3"] {
            grid-template-columns: 1fr !important;
          }
          div[style*="repeat(2"] {
            grid-template-columns: 1fr !important;
          }
          div[style*="repeat(5"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
