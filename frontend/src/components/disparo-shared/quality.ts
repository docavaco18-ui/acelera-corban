// Lógica de qualidade unificada — REGRA PADRÃO pros 3 disparadores.
// Toda mudança aqui afeta Aesir + VendeAI + Chipcare.

export type AlertLevel = 'red' | 'yellow' | 'green' | 'gray';

export const ALERT_COLOR: Record<AlertLevel, string> = {
  red: '#ef4444', yellow: '#f59e0b', green: '#10b981', gray: '#64748b',
};

export interface Restriction { code: number; label: string; entity?: string; }

export interface StatusCard { label: string; value: string; level: AlertLevel; sub?: string; }

/** Qualidade EFETIVA considerando todos os sinais.
 *  Só retorna GREEN se tudo OK; qualquer LIMITED/restriction/débito = YELLOW. */
export function effectiveQuality(inst: any): 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' {
  const r = (inst.quality_rating || 'UNKNOWN').toUpperCase();
  const cs = (inst.can_send || 'UNKNOWN').toUpperCase();
  const restrictions: Restriction[] = inst.restrictions || [];

  if (inst.has_payment_issue) return 'RED';
  if (cs === 'BLOCKED') return 'RED';
  if (r === 'RED') return 'RED';
  if (restrictions.length > 0) return 'YELLOW';
  if (cs === 'LIMITED') return 'YELLOW';
  if (inst.display_name_pending) return 'YELLOW';
  if (r === 'YELLOW') return 'YELLOW';
  if (r === 'GREEN' && cs === 'AVAILABLE') return 'GREEN';
  if (r === 'GREEN') return 'GREEN';
  return 'UNKNOWN';
}

/** 4 cards de status: Capacidade · Qualidade · Pagamento · Nome de exibição. */
export function statusCards(inst: any): StatusCard[] {
  const r = (inst.quality_rating || 'UNKNOWN').toUpperCase();
  const cs = (inst.can_send || 'UNKNOWN').toUpperCase();
  const ns = (inst.name_status || '').toUpperCase();

  // Capacidade
  const tier = inst.messaging_tier || inst.daily_limit || '—';
  const tierNum = typeof tier === 'string' ? tier.replace(/\D/g, '') : tier;
  const sentToday = inst.sent_today || 0;
  let capLevel: AlertLevel = 'green';
  if (cs === 'BLOCKED') capLevel = 'red';
  else if (cs === 'LIMITED') capLevel = 'yellow';

  // Qualidade
  let qText = 'Indisponível', qLevel: AlertLevel = 'gray';
  if (r === 'GREEN') { qText = 'Saudável'; qLevel = 'green'; }
  else if (r === 'YELLOW') { qText = 'Atenção'; qLevel = 'yellow'; }
  else if (r === 'RED') { qText = 'Crítica'; qLevel = 'red'; }

  // Pagamento
  let pText = 'OK', pLevel: AlertLevel = 'green', pSub = 'sem pendências';
  if (inst.has_payment_issue) { pText = 'Pendente'; pLevel = 'red'; pSub = 'conta bloqueada'; }
  else if (cs === 'BLOCKED') { pText = 'Verificar'; pLevel = 'yellow'; pSub = 'pode ser cobrança'; }

  // Nome de exibição
  let nText = '—', nLevel: AlertLevel = 'gray', nSub = '';
  if (ns === 'APPROVED') { nText = 'Aprovado'; nLevel = 'green'; }
  else if (ns === 'AVAILABLE_WITHOUT_REVIEW') { nText = 'Liberado'; nLevel = 'green'; nSub = 'sem necessidade de revisão'; }
  else if (ns === 'PENDING_REVIEW') { nText = 'Em análise'; nLevel = 'yellow'; nSub = 'Meta avaliando'; }
  else if (ns === 'DECLINED') { nText = 'Reprovado'; nLevel = 'red'; nSub = 'submeta novo nome'; }
  else if (ns === 'EXPIRED') { nText = 'Expirado'; nLevel = 'red'; nSub = 'renove'; }

  return [
    { label: 'Capacidade', value: `${tierNum || '—'}/dia`, level: capLevel, sub: `${sentToday} enviadas hoje` },
    { label: 'Qualidade', value: qText, level: qLevel, sub: r === 'UNKNOWN' ? '' : `nível ${r.toLowerCase()}` },
    { label: 'Pagamento', value: pText, level: pLevel, sub: pSub },
    { label: 'Nome exibição', value: nText, level: nLevel, sub: nSub },
  ];
}

/** Avisos extras (badges) — só os que não estão cobertos pelos cards. */
export function extraWarnings(inst: any): Array<{ level: AlertLevel; text: string }> {
  const out: Array<{ level: AlertLevel; text: string }> = [];
  const ars = (inst.account_review_status || '').toUpperCase();
  const bvs = (inst.business_verification_status || '').toLowerCase();

  if (ars === 'SUSPENDED' || ars === 'DISABLED') out.push({ level: 'red', text: 'Conta suspensa pela Meta' });
  else if (ars === 'PENDING' || ars === 'IN_REVIEW') out.push({ level: 'yellow', text: 'Conta em revisão Meta' });
  else if (ars === 'APPROVED') out.push({ level: 'green', text: 'Conta Meta aprovada' });

  if (bvs === 'expired') out.push({ level: 'red', text: 'BM expirada · renove' });
  else if (bvs === 'failed' || bvs === 'rejected') out.push({ level: 'red', text: 'BM rejeitada' });
  else if (bvs === 'pending' || bvs === 'pending_need_more_info') out.push({ level: 'yellow', text: 'BM em verificação' });
  else if (bvs === 'verified') out.push({ level: 'green', text: 'BM verificada' });

  const restrictions: Restriction[] = inst.restrictions || [];
  restrictions.forEach((rs) => {
    if (!rs || !rs.code) return;
    if ([130472, 131048, 133015].includes(rs.code)) return;
    out.push({ level: 'yellow', text: rs.label });
  });

  return out;
}

export function topLevel(inst: any): AlertLevel {
  const cards = statusCards(inst);
  const warns = extraWarnings(inst);
  const all = [...cards, ...warns];
  if (all.some(c => c.level === 'red')) return 'red';
  if (all.some(c => c.level === 'yellow')) return 'yellow';
  if (all.some(c => c.level === 'green')) return 'green';
  return 'gray';
}

/** Classificação dos problemas:
 *  - GRAVE: bloqueado, qualidade RED, conta suspensa, BM expirada/falhou
 *  - LEVE:  pendência de pagamento, problema de nome de exibição, tier limitado
 *  - OK:    qualidade GREEN + can_send AVAILABLE + sem problemas
 */
export function isProblemGrave(inst: any): boolean {
  const cs = (inst.can_send || '').toUpperCase();
  const r = (inst.quality_rating || '').toUpperCase();
  const ars = (inst.account_review_status || '').toUpperCase();
  const bvs = (inst.business_verification_status || '').toLowerCase();
  if (cs === 'BLOCKED') return true;
  if (r === 'RED') return true;
  if (ars === 'SUSPENDED' || ars === 'DISABLED') return true;
  if (bvs === 'expired' || bvs === 'failed' || bvs === 'rejected') return true;
  return false;
}

export function isProblemLeve(inst: any): boolean {
  if (isProblemGrave(inst)) return false;
  const cs = (inst.can_send || '').toUpperCase();
  const ns = (inst.name_status || '').toUpperCase();
  if (inst.has_payment_issue) return true;
  if (inst.display_name_pending) return true;
  if (cs === 'LIMITED') return true;
  if (['DECLINED', 'EXPIRED', 'PENDING_REVIEW'].includes(ns)) return true;
  return false;
}

export function isOk(inst: any): boolean {
  if (isProblemGrave(inst) || isProblemLeve(inst)) return false;
  const cs = (inst.can_send || '').toUpperCase();
  const r = (inst.quality_rating || '').toUpperCase();
  return r === 'GREEN' && cs === 'AVAILABLE';
}

export interface BMSummaryStats {
  total: number;
  capacityActive: number;   // soma daily_limit dos não-pausados e não-graves
  okCount: number;
  graveCount: number;
  leveCount: number;
  unknownCount: number;
}

export function bmSummary(instances: any[]): BMSummaryStats {
  const out: BMSummaryStats = {
    total: instances.length,
    capacityActive: 0,
    okCount: 0, graveCount: 0, leveCount: 0, unknownCount: 0,
  };
  for (const i of instances) {
    if (isProblemGrave(i)) out.graveCount++;
    else if (isProblemLeve(i)) out.leveCount++;
    else if (isOk(i)) out.okCount++;
    else out.unknownCount++;

    // Capacidade: número precisa estar ativo (não pausado, não grave)
    if (!i.is_paused && !isProblemGrave(i)) {
      const lim = parseInt(String(i.daily_limit || '0')) || 0;
      out.capacityActive += lim;
    }
  }
  return out;
}
