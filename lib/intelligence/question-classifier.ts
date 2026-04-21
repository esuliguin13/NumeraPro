/**
 * Question Type Classifier
 *
 * Classifies a matrix question into one of three answer-format types.
 * This is distinct from the retrieval strategy (structured / retrieval / hybrid).
 * The question type drives prompt selection and cell display mode.
 *
 *   financial  — specific numeric metric requested (revenue, EBITDA, margins, EPS…)
 *   analytical — explanation + supporting metric ("What drove growth?", "Why did margins fall?")
 *   qualitative — text-based analysis (risks, strategy, management commentary, culture…)
 *
 * Rule-based — no model call. Used in the hot path for every cell execution.
 */

export type QuestionType = "financial" | "analytical" | "qualitative" | "comparison";

// ─── Keyword dictionaries ─────────────────────────────────────────────────────

/** Pure numeric metric questions — answer should lead with a number */
const FINANCIAL_PATTERNS: RegExp[] = [
  /\b(what (is|was|are|were) (the )?(total |net |gross |adjusted )?revenue)\b/i,
  /\b(revenue|sales|arr|mrr|topline|top[-\s]line)\b/i,
  /\bebitda\b/i,
  /\b(net income|net profit|net loss|bottom[-\s]line)\b/i,
  /\b(gross profit|gross margin)\b/i,
  /\b(operating income|operating (profit|loss)|ebit)\b/i,
  /\b(eps|earnings per share|diluted eps)\b/i,
  /\b(free cash flow|fcf|capex|capital expenditure)\b/i,
  /\b(guidance|full[-\s]year outlook|full[-\s]year guidance)\b/i,
  /\b(headcount|employee count|fte|full[-\s]time equivalent)\b/i,
  /\b(debt|leverage|net debt|interest (expense|coverage))\b/i,
  /\b(arpu|ltv|cac|nrr|grr|churn rate|retention rate)\b/i,
  /\bmargin\b/i,
];

/** Questions that compare two time periods or values — expect delta / % change display */
const COMPARISON_PATTERNS: RegExp[] = [
  /\b(compare|comparison)\b/i,
  /\b(vs\.?|versus)\b/i,
  /\bq[1-4]\s+(vs\.?|versus|compared to)\s+q[1-4]\b/i,
  /\b(year[-\s]over[-\s]year|yoy|qoq|quarter[-\s]over[-\s]quarter)\b/i,
  /\b(delta|change|difference) (in|between|of)\b/i,
  /\bhow (did|does|has|have) .{0,60} (change|grow|decline|move)\b/i,
  /\b(prior (year|quarter|period)|previous (year|quarter|period))\b/i,
  /\b(increased|decreased|grew|fell|rose|dropped) (by|from|to)\b/i,
];

/** Questions that need both explanation and a supporting metric */
const ANALYTICAL_PATTERNS: RegExp[] = [
  /\b(what drove|what is driving|what are driving)\b/i,
  /\b(why (did|has|have|is|are|was|were))\b/i,
  /\b(explain|describe the (reason|cause|driver|impact|trend))\b/i,
  /\b(what (caused|led to|contributed to|resulted in))\b/i,
  /\b(growth driver|growth drivers)\b/i,
  /\b(key driver|key drivers|main driver|primary driver)\b/i,
  /\b(what (is|was|are|were) (the )?(impact|contribution|effect) of)\b/i,
  /\bhow (did|has|have) .{0,40} (change|grow|decline|improve|deteriorate)\b/i,
  /\b(compare|versus|vs\.?|year[-\s]over[-\s]year breakdown)\b/i,
  /\b(breakdown of|composition of)\b/i,
  /\bperformance (vs\.?|versus|compared to)\b/i,
];

/** Purely text/qualitative questions — no numeric lead expected */
const QUALITATIVE_PATTERNS: RegExp[] = [
  /\b(risk|risks|key risk|main risk|top risk)\b/i,
  /\b(challenge|challenges|key challenge|main challenge)\b/i,
  /\b(threat|threats)\b/i,
  /\b(weakness|weaknesses|limitation|limitations)\b/i,
  /\b(opportunity|opportunities)\b/i,
  /\b(strategy|strategic (plan|direction|priority|initiative))\b/i,
  /\b(initiative|initiatives)\b/i,
  /\b(management (commentary|view|tone|discussion|perspective))\b/i,
  /\b(competitive (position|landscape|advantage|moat|pressure))\b/i,
  /\b(market position|market share narrative)\b/i,
  /\b(culture|governance|esg|diversity)\b/i,
  /\b(regulatory|compliance|legal|litigation|lawsuit)\b/i,
  /\b(product (roadmap|pipeline|strategy))\b/i,
  /\b(customer (sentiment|feedback|satisfaction))\b/i,
  /\b(what (are|were) (the )?key (takeaways|highlights|themes|points))\b/i,
  /\b(swot|strengths and weaknesses)\b/i,
  /\bqualitative\b/i,
];

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Returns the question type that should govern answer format and cell display.
 *
 * Precedence:
 *   1. Analytical beats Financial when the question asks "why/what drove + metric" —
 *      the explanation matters more than the raw number.
 *   2. If both financial and qualitative keywords match, financial wins
 *      (e.g. "What is guidance and what are the risks?" → financial).
 *   3. Qualitative is the safe default.
 */
export function classifyQuestionType(question: string): QuestionType {
  const comparisonHits = COMPARISON_PATTERNS.filter((p) => p.test(question)).length;
  const analyticalHits  = ANALYTICAL_PATTERNS.filter((p) => p.test(question)).length;
  const financialHits   = FINANCIAL_PATTERNS.filter((p) => p.test(question)).length;
  const qualitativeHits = QUALITATIVE_PATTERNS.filter((p) => p.test(question)).length;

  // Comparison: explicitly asks for a delta, %, or period-over-period change
  if (comparisonHits >= 1 && financialHits > 0) return "comparison";

  // Analytical: asks "why/what drove" + involves financial metrics
  if (analyticalHits > 0 && financialHits > 0) return "analytical";
  if (analyticalHits > 0) return "analytical";

  // Financial: pure numeric question
  if (financialHits > 0 && financialHits >= qualitativeHits) return "financial";

  // Qualitative default
  return "qualitative";
}
