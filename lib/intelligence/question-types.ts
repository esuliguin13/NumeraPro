/**
 * Shared types for the AI Suggested Questions feature.
 */

export type SuggestedAnswerType =
  | "financial"
  | "analytical"
  | "risk"
  | "comparison"
  | "strategy";

export type SuggestedCategory =
  | "Financial"
  | "Performance Drivers"
  | "Risks"
  | "Strategy / Outlook"
  | "Advanced Insights";

export const CATEGORY_ORDER: SuggestedCategory[] = [
  "Financial",
  "Performance Drivers",
  "Risks",
  "Strategy / Outlook",
  "Advanced Insights",
];

export interface SuggestedQuestionItem {
  id: string;
  question_text: string;
  category: SuggestedCategory;
  priority: number;
  rationale: string;
  default_checked: boolean;
  answer_type: SuggestedAnswerType;
}

export interface SuggestedCategoryGroup {
  name: SuggestedCategory;
  questions: SuggestedQuestionItem[];
}

export interface SuggestedQuestionsPayload {
  categories: SuggestedCategoryGroup[];
}

/** Maps AI-suggested answer type to the matrix_questions.question_type enum */
export const ANSWER_TYPE_TO_QUESTION_TYPE: Record<
  SuggestedAnswerType,
  "financial" | "operational" | "risk" | "general"
> = {
  financial: "financial",
  analytical: "operational",
  risk: "risk",
  comparison: "financial",
  strategy: "general",
};

/** Minimum priority score for a question to be recommended (and pre-checked) */
export const RECOMMENDED_PRIORITY_THRESHOLD = 80;
