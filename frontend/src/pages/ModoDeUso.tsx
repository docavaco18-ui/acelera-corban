import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  C, G, glassCard, sectionTitle, INPUT_STYLE, SHARED_CSS,
  PulseDot, GradientBar,
} from "../components/disparo-shared";

type GuideId =
  | "inicio"
  | "higienizacao"
  | "dashboard"
  | "crm"
  | "chatwoot"
  | "disparos"
  | "powerhub"
  | "central-controle"
  | "configuracoes"
  | "rotina";

type GuideSection = {
  id: GuideId;
  label: string;
  kicker: string;
  title: string;
  summary: string;
  icon: string;
  gradient: string;
  accent: string;
  tags: string[];
  flow?: string[];
  cards: { title: string; body: string }[];
  checklist?: string[];
  links?: { label: string; to: string }[];
};

const guides: GuideSection[] = [
  {
    id: "inicio",
    label: "Comece aqui",
    kicker: "Visão geral",
    title: "Como o Acelera Corban organiza a operação",
    summary:
      "O sistema junta higienização de bases, controle comercial, Chatwoot, disparos e enriquecimento de dados em um fluxo único para operações de crédito CLT.",
    icon: "🚀",
    gradient: G.purple,
    accent: "#a78bfa",
    tags: ["primeiro acesso", "operacao", "visao geral"],
    flow: ["Configurar acessos", "Subir base", "Rodar consulta", "Priorizar elegíveis", "Vender e acompanhar"],
    cards: [
      { title: "Antes de rodar", body: "Cadastre as credenciais do banco ou ferramenta que será usada. Cada usuário trabalha com seus próprios acessos." },
      { title: "Durante a operação", body: "Acompanhe os robôs, resultados ao vivo, rank de elegíveis, conversas e disparos em suas abas específicas." },
      { title: "Depois da consulta", body: "Exporte elegíveis, priorize os maiores valores liberados, organize propostas no CRM e acione os leads pelos canais conectados." },
    ],
    checklist: [
      "Entrar com usuário e senha do sistema.",
      "Salvar credenciais em Configurações ou dentro do disparador.",
      "Fazer um teste pequeno antes de rodar base grande.",
      "Conferir resultados e exportar os elegíveis.",
    ],
    links: [
      { label: "Configurações", to: "/configuracoes" },
      { label: "Higienização", to: "/higienizacao" },
      { label: "Dashboard", to: "/dashboard" },
    ],
  },
  {
    id: "higienizacao",
    label: "Higienização",
    kicker: "Base CLT",
    title: "Descobrir margem e valor liberado por CPF",
    summary:
      "A aba de Higienização serve para subir uma base com CPFs e consultar, banco por banco, se o cliente é elegível, se possui margem de empréstimo CLT e qual valor pode ser liberado.",
    icon: "🧬",
    gradient: G.green,
    accent: C.green,
    tags: ["cpf", "margem", "v8", "vctex", "mercantil", "presenca"],
    flow: ["Escolher banco", "Enviar CSV", "Iniciar robôs", "Acompanhar ao vivo", "Exportar elegíveis"],
    cards: [
      { title: "Bancos disponíveis", body: "V8, VCTex, Mercantil e Presença consultam CPFs para identificar elegibilidade, margem e valor liberado." },
      { title: "Geral", body: "Mostra o processamento atual ao vivo: progresso, total liberado, fases, pendentes, erros, elegíveis e inelegíveis." },
      { title: "Histórico", body: "Mostra as bases já carregadas e registros anteriores da higienização, com possibilidade de revisar e baixar resultados." },
      { title: "Rank de Elegível", body: "Ordena os clientes elegíveis do maior valor liberado para o menor, ajudando o time a vender primeiro para quem tem mais potencial." },
      { title: "Gráficos e Resultados", body: "Gráficos mostram a leitura demográfica e operacional. Todos os Resultados lista tudo que voltou da consulta." },
      { title: "Workers, Cérebro e Runs", body: "Workers ao vivo mostram os robôs rodando. Cérebro é a camada que orquestra. Histórico de Runs registra cada inicialização." },
    ],
    checklist: [
      "Escolha o banco no seletor superior.",
      "Clique em Carregar CSV e envie uma base com CPFs.",
      "Defina a quantidade de workers quando a tela permitir.",
      "Clique em Iniciar e acompanhe a aba Geral.",
      "Ao finalizar, use Rank de Elegível e exporte os melhores leads.",
    ],
    links: [
      { label: "Abrir Higienização", to: "/higienizacao" },
      { label: "Ver Dashboard", to: "/dashboard" },
      { label: "Configurar Bancos", to: "/configuracoes" },
    ],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    kicker: "Central unificada",
    title: "Enxergar tudo que está acontecendo",
    summary:
      "O Dashboard concentra a operação em uma visão unificada, reunindo histórico, bases, indicadores e andamento do que já foi processado.",
    icon: "📊",
    gradient: G.cyan,
    accent: "#06b6d4",
    tags: ["historico", "indicadores", "base", "operacao"],
    flow: ["Abrir dashboard", "Ver bases", "Checar totais", "Baixar resultados", "Voltar ao módulo"],
    cards: [
      { title: "Resumo operacional", body: "Use para entender rapidamente o volume processado, valores liberados, bases ativas e histórico de higienizações." },
      { title: "Histórico de bases", body: "Ajuda a controlar o que já foi rodado e a recuperar arquivos/resultados sem depender de planilhas soltas." },
      { title: "Apoio comercial", body: "Depois da consulta, o dashboard funciona como ponto de partida para decidir onde vender primeiro." },
    ],
    links: [{ label: "Abrir Dashboard", to: "/dashboard" }],
  },
  {
    id: "crm",
    label: "CRM",
    kicker: "Propostas",
    title: "Organizar proposta, pagamento e prioridade",
    summary:
      "O CRM serve para controlar propostas, pagamentos, importantes, pendentes, leilão, FGTS e valores salvos, com filtros por banco e sistema.",
    icon: "💼",
    gradient: G.yellow,
    accent: C.yellow,
    tags: ["propostas", "pagamentos", "pendentes", "fgts", "leilao"],
    flow: ["Cadastrar proposta", "Mover no quadro", "Filtrar por banco", "Acompanhar valor", "Aprovar ou finalizar"],
    cards: [
      { title: "Controle de propostas", body: "Cadastre e acompanhe propostas por cliente, vendedor, banco, valor, prazo, parcela e status comercial." },
      { title: "Organização por status", body: "Use as colunas para separar propostas importantes, pendentes, pagamentos, leilão e FGTS." },
      { title: "Resumo de valor", body: "O CRM também mostra resumo de valores para a gestão enxergar o que está salvo e o que precisa de ação." },
    ],
    checklist: [
      "Cadastre a proposta com os dados do cliente.",
      "Use os filtros por banco ou período.",
      "Mova a proposta conforme o andamento.",
      "Se houver senha CRM ativa, informe a senha para ações protegidas.",
    ],
    links: [
      { label: "Abrir CRM", to: "/crm" },
      { label: "Segurança CRM", to: "/configuracoes" },
    ],
  },
  {
    id: "chatwoot",
    label: "CRM Chatwoot",
    kicker: "Conversas",
    title: "Trazer o que acontece no Chatwoot pra dentro do sistema",
    summary:
      "Para quem usa Chatwoot, o sistema conecta com o CRM de conversas e busca em tempo real sinais de lead, gestão, abertura, aguardando resultado, erro e elegibilidade.",
    icon: "💬",
    gradient: G.neon,
    accent: "#00ff88",
    tags: ["chatwoot", "conversas", "leads", "gestao"],
    flow: ["Salvar Chatwoot", "Rodar sincronização", "Ler métricas", "Filtrar leads", "Atuar nas conversas"],
    cards: [
      { title: "Conexão com Chatwoot", body: "Informe URL, conta, token e inboxes para o sistema cruzar os leads com conversas do atendimento." },
      { title: "Agente de leitura", body: "A sincronização busca as conexões e ajuda a entender o que está acontecendo dentro do Chatwoot." },
      { title: "Gestão de lead", body: "Acompanhe conversa, abertura, aguardando resultado, erro, elegível e outros sinais importantes para venda." },
    ],
    checklist: [
      "Configure URL, Account ID, token e inboxes.",
      "Inicie a sincronização.",
      "Aguarde o processamento, principalmente na primeira leitura.",
      "Use filtros para encontrar leads que precisam de ação.",
    ],
    links: [{ label: "Abrir CRM Chatwoot", to: "/chatwoot" }],
  },
  {
    id: "disparos",
    label: "Disparos",
    kicker: "WhatsApp",
    title: "Conectar CRM, BM e Acelera Corban para disparar",
    summary:
      "Os disparos VendeAI, Aesir e Chipcare conectam o CRM do cliente com a Meta/Facebook BM. A IA monitora qualidade, status dos números e andamento das campanhas.",
    icon: "📡",
    gradient: G.red,
    accent: C.red,
    tags: ["vendeai", "aesir", "chipcare", "meta", "bm", "whatsapp"],
    flow: ["Salvar CRM", "Salvar token BM", "Atualizar status", "Subir CSV", "Confirmar disparo", "Monitorar"],
    cards: [
      { title: "Três ferramentas", body: "O sistema possui Disparo VendeAI, Disparo Aesir e Disparo Chipcare. A lógica central é a mesma: ligar CRM, BM e sistema." },
      { title: "Credenciais necessárias", body: "Dependendo do CRM, será necessário login e senha, token, ID do CRM ou apenas login/senha do CRM mais token de usuário de sistema da BM." },
      { title: "Token Meta/BM", body: "O token de usuário de sistema da BM permite consultar números, qualidade, restrições, nome de exibição e capacidade de envio." },
      { title: "IA de monitoramento", body: "O disparo acontece no CRM da pessoa, mas o Acelera Corban monitora a saúde dos números, status da BM e histórico da campanha." },
      { title: "Atualizar Status", body: "Sempre que salvar ou trocar credenciais, clique em Atualizar Status para cruzar CRM e Meta e carregar os números disponíveis." },
      { title: "Durante a campanha", body: "Acompanhe qualidade, números pausados, histórico, alertas e progresso para evitar disparar por número ruim ou bloqueado." },
    ],
    checklist: [
      "Salvar credenciais do CRM usado.",
      "Salvar token Meta/BM de usuário de sistema.",
      "Clicar em Atualizar Status.",
      "Verificar se os números aparecem e estão saudáveis.",
      "Subir CSV, mapear campos ou variáveis e confirmar disparo.",
      "Monitorar histórico e qualidade durante a execução.",
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
      "PowerHub é o módulo de enriquecimento de dados. O usuário sobe uma base com CPF e o agente consulta o PowerHub para trazer dados de telefonia daquele CPF.",
    icon: "📞",
    gradient: G.cyan,
    accent: "#06b6d4",
    tags: ["telefone", "cpf", "enriquecimento", "powerhub"],
    flow: ["Subir CPFs", "Rodar enriquecimento", "Consultar PowerHub", "Encontrar telefones", "Exportar XLSX"],
    cards: [
      { title: "O que enviar", body: "A base precisa somente de CPF. A partir dele, o sistema consulta o PowerHub e tenta encontrar telefones vinculados." },
      { title: "Resultado esperado", body: "Quando encontrar, o módulo retorna telefone quente e dados de telefonia para apoiar abordagem comercial." },
      { title: "Quando usar", body: "Use quando você tem CPF mas precisa enriquecer a base com telefone antes de acionar o cliente." },
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
    id: "central-controle",
    label: "Central de Controle",
    kicker: "Diagnóstico operacional",
    title: "Painel único de saúde da operação de disparo",
    summary:
      "A Central de Controle é a tela onde o Acelera Corban audita, em tempo real, se a operação de disparo está saudável. Em um lugar só você vê score geral, capacidade de envio do dia, canais em risco, templates aprovados, incidentes e auditoria do token Meta dos três disparadores (VendeAI, Aesir e Chipcare).",
    icon: "🧠",
    gradient: G.primary,
    accent: "#7c3aed",
    tags: ["score", "saude", "bm", "meta", "diagnostico", "auditoria", "templates", "incidentes"],
    flow: ["Abrir Central", "Ler score", "Cumprir checklist", "Auditar Meta ao vivo", "Resolver incidentes"],
    cards: [
      {
        title: "Score Operacional",
        body:
          "Nota de 0 a 100 que resume a saúde da operação naquele momento. Verde acima de 75, amarelo entre 50 e 74, vermelho abaixo de 50. O número pondera health check, canais em risco, checklist e incidentes críticos.",
      },
      {
        title: "Linha de KPIs",
        body:
          "Canais saudáveis, canais em risco crítico, capacidade de envio segura para hoje e templates aprovados. É o primeiro corte do que você precisa saber pra liberar disparo.",
      },
      {
        title: "Checklist pré-disparo",
        body:
          "Cinco itens objetivos: tokens Meta válidos, canais saudáveis disponíveis, nenhum canal crítico, templates aprovados e capacidade suficiente. Verde = OK, amarelo = atenção, vermelho = bloqueia.",
      },
      {
        title: "Simulador de capacidade",
        body:
          "Você digita o tamanho da campanha (por exemplo 10.000 envios) e o sistema diz quantos podem sair hoje com segurança, em quantos dias termina e qual ritmo seguro por hora.",
      },
      {
        title: "Alerta de risco de bloqueio",
        body:
          "Lê qualidade dos números (RED/YELLOW), problemas de pagamento e nome de exibição pendente, e classifica o risco como baixo, médio ou alto antes de você apertar disparar.",
      },
      {
        title: "Health check das integrações",
        body:
          "Lista item por item: credenciais de banco (V8, VCTex, Mercantil, Presença, PowerHub), Chatwoot, credenciais de CRM dos três disparadores, tokens Meta e quantos números estão saudáveis em cada disparador.",
      },
      {
        title: "Central de incidentes",
        body:
          "Junta tudo que está crítico ou em atenção em uma fila ordenada por severidade, com a ação recomendada pra cada incidente. Se a lista está vazia, a operação está limpa.",
      },
      {
        title: "Entregabilidade BM",
        body:
          "Cada número WABA dos três disparadores listado com qualidade, status de envio, limite diário, restante e barra de uso. Ordenado por risco para você atacar o que está pior primeiro.",
      },
      {
        title: "Radar de erros por motivo",
        body:
          "Agrupa as causas recorrentes (qualidade ruim, pagamento, nome pendente, campanhas em erro, falhas de assignment) e mostra contagem e exemplos. Serve para você atacar a causa, não o sintoma.",
      },
      {
        title: "Auditoria de token Meta",
        body:
          "Modo cache lê rápido o que está sincronizado. Modo ao vivo chama a Graph API da Meta e confirma WABAs, números e templates de verdade. Use o ao vivo quando desconfiar do token ou após salvar credencial nova.",
      },
      {
        title: "Monitor de templates",
        body:
          "Contagem por categoria (marketing, utility, authentication) e lista detalhada com nome, idioma, WABA, variáveis e status (aprovado, rejeitado, pausado). Útil para decidir qual template usar e identificar reprovados.",
      },
    ],
    checklist: [
      "Abrir a Central de Controle no menu superior.",
      "Conferir o Score Geral — meta é ficar verde acima de 75.",
      "Ler o Checklist pré-disparo. Se algo está em Bloqueia, resolva antes.",
      "Olhar o Alerta de Risco. Risco alto = pausar campanha ou rebalancear números.",
      "Resolver incidentes críticos antes de qualquer disparo grande.",
      "Quando o token Meta foi trocado, rodar 'Auditar Meta ao vivo' para confirmar.",
      "Usar o Simulador de Capacidade pra planejar campanhas acima de 5 mil envios.",
    ],
    links: [
      { label: "Abrir Central de Controle", to: "/central-controle" },
      { label: "Ir para Disparos", to: "/disparo" },
      { label: "Configurar tokens", to: "/configuracoes" },
    ],
  },
  {
    id: "configuracoes",
    label: "Configurações",
    kicker: "Acessos",
    title: "Cadastrar logins, senhas, proxies e segurança",
    summary:
      "Configurações é onde o usuário salva os acessos dos bancos. Quando precisar, também configura senha do CRM e proxies por banco.",
    icon: "⚙️",
    gradient: G.purple,
    accent: "#a78bfa",
    tags: ["login", "senha", "proxy", "credenciais"],
    flow: ["Escolher banco", "Preencher login", "Preencher senha", "Salvar", "Testar módulo"],
    cards: [
      { title: "Credenciais por banco", body: "Cada banco tem seu próprio login e senha. Se o usuário quiser trocar a senha, basta preencher e salvar novamente." },
      { title: "Senha CRM", body: "Administradores podem ativar senha para proteger a criação e exclusão de propostas no CRM." },
      { title: "Proxies", body: "Quando necessário, proxies podem ser cadastrados por banco para controlar a origem dos robôs." },
    ],
    checklist: [
      "Selecionar o banco correto no topo.",
      "Informar login.",
      "Informar senha quando for cadastrar ou trocar.",
      "Salvar antes de iniciar qualquer robô.",
    ],
    links: [{ label: "Abrir Configurações", to: "/configuracoes" }],
  },
  {
    id: "rotina",
    label: "Rotina recomendada",
    kicker: "Operação diária",
    title: "Sequência simples para vender mais rápido",
    summary:
      "Uma rotina enxuta evita perda de tempo: consultar base, priorizar maior valor, organizar proposta, conversar pelo CRM e disparar com números saudáveis.",
    icon: "🌅",
    gradient: G.yellow,
    accent: C.yellow,
    tags: ["rotina", "vendas", "checklist"],
    flow: ["Base nova", "Higienizar", "Rank de valor", "CRM", "Chatwoot ou disparo", "Fechamento"],
    cards: [
      { title: "Manhã", body: "Suba bases novas, rode a higienização e confira erros ou pendências antes de acionar o time comercial." },
      { title: "Durante o dia", body: "Priorize Rank de Elegível, mova propostas no CRM e acompanhe conversas no Chatwoot." },
      { title: "Antes de disparar", body: "Abra a Central de Controle, atualize status da BM, confira qualidade dos números e evite campanhas em canais bloqueados ou limitados." },
    ],
    checklist: [
      "Rodar uma amostra pequena quando a credencial for nova.",
      "Retentar erros antes de descartar lead.",
      "Exportar elegíveis e atacar maiores valores primeiro.",
      "Manter CRM organizado pra não perder proposta quente.",
      "Olhar Central de Controle antes de campanhas grandes.",
    ],
    links: [
      { label: "Higienização", to: "/higienizacao" },
      { label: "CRM", to: "/crm" },
      { label: "Central de Controle", to: "/central-controle" },
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
  "score",
  "elegivel",
  "Chatwoot",
  "PowerHub",
];

function normalize(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ── Componentes ──────────────────────────────────────────────────────────────

function BrainBadge({ color, gradient }: { color: string; gradient: string }) {
  return (
    <div style={{
      position: 'relative', width: 88, height: 88, flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        border: `2px dashed ${color}55`, animation: `ai-spin 16s linear infinite`,
      }} />
      <div style={{
        position: 'absolute', inset: 12, borderRadius: '50%',
        border: `1.5px dotted ${color}88`, animation: `ai-spin-rev 11s linear infinite`,
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 42, height: 42, borderRadius: '50%',
        background: gradient,
        transform: 'translate(-50%, -50%)',
        animation: `ai-orb-pulse 2.6s ease-in-out infinite`,
        filter: 'blur(.4px)',
      }} />
    </div>
  );
}

function Flow({ steps, color }: { steps: string[]; color: string }) {
  return (
    <div className="mu-flow spot-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 10 }}>
      {steps.map((step, i) => (
        <div key={step} className="spot-card" style={{
          minHeight: 92,
          background: 'rgba(255,255,255,.02)',
          border: `1px solid rgba(255,255,255,.07)`,
          borderRadius: 12,
          padding: 14,
          position: "relative",
          overflow: 'hidden',
          '--spot-color': color,
        } as any}>
          <div className="spot-glow" />
          <div className="spot-shine" />
          <div style={{
            position: 'absolute', inset: 0, opacity: i === 0 ? .18 : .06, pointerEvents: 'none',
            background: `radial-gradient(circle at top left, ${color} 0%, transparent 65%)`,
          }} />
          <div style={{
            position: 'relative', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          }}>
            <span style={{
              color: '#fff', fontSize: 11, fontWeight: 900, letterSpacing: '.1em',
              background: color, padding: '3px 7px', borderRadius: 6,
              boxShadow: `0 2px 6px ${color}55`,
            }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            {i === 0 && (
              <span style={{
                color: '#fff', fontSize: 9, fontWeight: 900, letterSpacing: '.1em',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <PulseDot color={color} />
                INÍCIO
              </span>
            )}
          </div>
          <div style={{ position: 'relative', color: C.text, fontSize: 13, lineHeight: 1.3, fontWeight: 700 }}>{step}</div>
        </div>
      ))}
    </div>
  );
}

function LinkButton({ to, label, color, gradient }: { to: string; label: string; color: string; gradient: string }) {
  return (
    <NavLink to={to} className="ds-btn" style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 38,
      padding: "0 16px",
      borderRadius: 10,
      backgroundImage: `linear-gradient(rgba(8,8,20,.92), rgba(8,8,20,.92)) padding-box, ${gradient} border-box`,
      border: '1.5px solid transparent',
      color: '#fff',
      textDecoration: "none",
      fontSize: 13,
      fontWeight: 800,
      whiteSpace: "nowrap",
      letterSpacing: '.02em',
      boxShadow: `0 2px 10px ${color}33`,
      textShadow: '0 1px 2px rgba(0,0,0,.4)',
    }}>
      {label}
    </NavLink>
  );
}

function ChecklistRow({ idx, item, color, gradient }: { idx: number; item: string; color: string; gradient: string }) {
  return (
    <div className="spot-row" style={{
      display: "grid",
      gridTemplateColumns: "32px 1fr",
      gap: 12,
      alignItems: "start",
      background: 'rgba(255,255,255,.02)',
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 10,
      padding: 12,
      position: 'relative',
      '--spot-color': color,
    } as any}>
      <div className="spot-glow" />
      <div style={{
        width: 28, height: 28, borderRadius: 999,
        display: "grid", placeItems: "center",
        background: gradient,
        color: '#fff',
        fontSize: 12,
        fontWeight: 900,
        boxShadow: `0 4px 12px ${color}55`,
        position: 'relative',
      }}>
        {idx + 1}
      </div>
      <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5, position: 'relative' }}>{item}</div>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function ModoDeUso() {
  const [activeId, setActiveId] = useState<GuideId>("inicio");
  const [query, setQuery] = useState("");
  const active = guides.find((g) => g.id === activeId) ?? guides[0];

  const filteredGuides = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return guides;
    return guides.filter((g) => {
      const haystack = normalize([
        g.label, g.title, g.summary, g.kicker,
        ...g.tags,
        ...(g.flow ?? []),
        ...g.cards.flatMap((c) => [c.title, c.body]),
        ...(g.checklist ?? []),
      ].join(" "));
      return haystack.includes(q);
    });
  }, [query]);

  const resultIds = new Set(filteredGuides.map((g) => g.id));
  const totalProgress = ((guides.findIndex((g) => g.id === active.id) + 1) / guides.length) * 100;

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      color: C.text,
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      padding: "22px 24px 56px",
    }}>
      <style>{SHARED_CSS}{MU_CSS}</style>

      <div className="mu-grid" style={{
        display: "grid",
        gridTemplateColumns: "300px minmax(0, 1fr)",
        gap: 20,
        alignItems: "start",
      }}>
        {/* ── Sidebar ── */}
        <aside style={{ position: "sticky", top: 16 }}>
          <div style={glassCard(G.primary, 18)}>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <BrainBadge color="#7c3aed" gradient={G.primary} />
              <div style={{ minWidth: 0 }}>
                <div style={{ ...sectionTitle(G.primary), marginBottom: 4, fontSize: 11 }}>
                  Guia operacional
                </div>
                <div style={{ color: C.text, fontSize: 18, fontWeight: 900, lineHeight: 1.05 }}>
                  Modo de Uso
                </div>
              </div>
            </div>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍 Buscar no guia"
              className="ds-input"
              style={{ ...INPUT_STYLE, fontSize: 13, marginBottom: 12 }}
            />

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {quickTerms.map((t) => (
                <button
                  key={t}
                  onClick={() => setQuery(t)}
                  style={{
                    border: '1px solid rgba(255,255,255,.08)',
                    background: 'rgba(255,255,255,.02)',
                    color: C.sec,
                    borderRadius: 999,
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ color: C.sec, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                Progresso do guia
              </div>
              <GradientBar pct={totalProgress} gradient={G.primary} height={5} />
              <div style={{ color: C.sec, fontSize: 11, marginTop: 6 }}>
                {guides.findIndex((g) => g.id === active.id) + 1} de {guides.length} seções
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {guides.map((g) => {
                const selected = g.id === active.id;
                const dim = query.length > 0 && !resultIds.has(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveId(g.id)}
                    className="ds-row mu-side-btn"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: '1px solid transparent',
                      background: selected
                        ? `linear-gradient(rgba(15,15,35,.92), rgba(15,15,35,.92)) padding-box, ${g.gradient} border-box`
                        : 'rgba(255,255,255,.018)',
                      color: dim ? "#4b5268" : selected ? C.text : C.sec,
                      borderRadius: 10,
                      padding: "10px 12px",
                      cursor: "pointer",
                      opacity: dim ? 0.45 : 1,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                  >
                    <span style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: selected ? g.gradient : 'rgba(255,255,255,.04)',
                      display: 'grid', placeItems: 'center',
                      fontSize: 15, flexShrink: 0,
                      boxShadow: selected ? `0 4px 12px ${g.accent}55` : 'none',
                    }}>{g.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.1 }}>{g.label}</div>
                      <div style={{ color: dim ? '#3c4256' : C.sec, fontSize: 10, marginTop: 2, fontWeight: 600 }}>
                        {g.kicker}
                      </div>
                    </div>
                    {selected && <PulseDot color={g.accent} />}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ minWidth: 0 }}>
          {/* Hero */}
          <section style={{ ...glassCard(active.gradient, 28), marginBottom: 18 }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 22,
              alignItems: "flex-start",
              marginBottom: 18,
            }} className="mu-hero">
              <div style={{ minWidth: 0 }}>
                <div style={{ ...sectionTitle(active.gradient), marginBottom: 6 }}>
                  {active.kicker}
                </div>
                <h1 style={{ color: C.text, fontSize: 34, lineHeight: 1.05, margin: 0, letterSpacing: 0, fontWeight: 800 }}>
                  {active.title}
                </h1>
              </div>
              <BrainBadge color={active.accent} gradient={active.gradient} />
            </div>

            <p style={{ color: C.sec, fontSize: 15, lineHeight: 1.65, margin: "0 0 18px", maxWidth: 940 }}>
              {active.summary}
            </p>

            {active.links && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {active.links.map((l) => (
                  <LinkButton key={l.to} to={l.to} label={l.label} color={active.accent} gradient={active.gradient} />
                ))}
              </div>
            )}
          </section>

          {/* Flow */}
          {active.flow && (
            <section style={{ ...glassCard(active.gradient, 22), marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, background: active.gradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0, boxShadow: `0 4px 12px ${active.accent}55`,
                }}>🗺</div>
                <h2 style={{
                  margin: 0, color: '#fff', fontSize: 14, fontWeight: 900,
                  textTransform: 'uppercase', letterSpacing: '.14em',
                }}>
                  Fluxo recomendado
                </h2>
              </div>
              <Flow steps={active.flow} color={active.accent} />
            </section>
          )}

          {/* Cards */}
          <section style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '0 4px' }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, background: active.gradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, flexShrink: 0,
              }}>{active.icon}</div>
              <h2 style={{
                margin: 0, color: '#fff', fontSize: 14, fontWeight: 900,
                textTransform: 'uppercase', letterSpacing: '.14em',
              }}>
                Como funciona
              </h2>
              <span style={{ color: C.sec, fontSize: 11, marginLeft: 'auto' }}>
                {active.cards.length} blocos
              </span>
            </div>
            <div className="mu-cards spot-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}>
              {active.cards.map((card) => (
                <article key={card.title} className="spot-card" style={{
                  background: 'rgba(255,255,255,.02)',
                  border: '1px solid rgba(255,255,255,.07)',
                  borderRadius: 12,
                  padding: 18,
                  minHeight: 140,
                  position: 'relative',
                  overflow: 'hidden',
                  '--spot-color': active.accent,
                } as any}>
                  <div className="spot-glow" />
                  <div className="spot-shine" />
                  <div style={{
                    position: 'absolute', inset: 0, opacity: .08, pointerEvents: 'none',
                    background: `radial-gradient(circle at top right, ${active.accent} 0%, transparent 60%)`,
                  }} />
                  <div style={{
                    position: 'relative',
                    color: active.accent, fontSize: 13, fontWeight: 900, marginBottom: 10,
                    letterSpacing: '.02em',
                  }}>
                    {card.title}
                  </div>
                  <div style={{ position: 'relative', color: C.sec, fontSize: 13, lineHeight: 1.6 }}>
                    {card.body}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Checklist */}
          {active.checklist && (
            <section style={glassCard(active.gradient, 22)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 10, background: active.gradient,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, flexShrink: 0, boxShadow: `0 4px 12px ${active.accent}55`,
                  }}>✓</div>
                  <div>
                    <div style={{
                      color: active.accent, fontSize: 11, fontWeight: 900,
                      textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 4,
                    }}>
                      Checklist rápido
                    </div>
                    <div style={{ color: C.text, fontSize: 16, fontWeight: 800 }}>
                      Antes de chamar suporte, confira estes passos
                    </div>
                  </div>
                </div>
                <span style={{
                  color: active.accent,
                  border: `1px solid ${active.accent}55`,
                  background: `${active.accent}12`,
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <PulseDot color={active.accent} />
                  {active.checklist.length} passos
                </span>
              </div>
              <div className="mu-check spot-list" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {active.checklist.map((item, i) => (
                  <ChecklistRow key={item} idx={i} item={item} color={active.accent} gradient={active.gradient} />
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

const MU_CSS = `
  .mu-side-btn:hover { background: rgba(255,255,255,.05) !important; }
  @media (max-width: 1024px) {
    .mu-grid { grid-template-columns: 1fr !important; }
    .mu-hero { grid-template-columns: 1fr !important; }
    .mu-cards { grid-template-columns: repeat(2, 1fr) !important; }
    .mu-flow { grid-template-columns: repeat(2, 1fr) !important; }
    .mu-check { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 640px) {
    .mu-cards { grid-template-columns: 1fr !important; }
    .mu-flow { grid-template-columns: 1fr !important; }
  }
`;
