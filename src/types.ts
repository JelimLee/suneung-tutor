// Shared domain types for the 수능 영어 독해 튜터.

// The question types present in the `problems` table. '무관' exists in the data
// even though it has no dedicated procedure yet (falls through to ComingSoon).
export type QuestionType = '빈칸' | '순서' | '삽입' | '어법' | '어휘' | '무관'

export interface ProblemTypeInfo {
  type: QuestionType
  title: string
  description: string
}

// UI title/description mapping, keyed by question_type. Used by ProblemSelect
// for filter pills and by Solve/ComingSoon for headings.
export const PROBLEM_TYPES: ProblemTypeInfo[] = [
  {
    type: '빈칸',
    title: '빈칸 추론',
    description: '사전 독해 → 문장 극성 → 주제 회상 → 선지 처리',
  },
  {
    type: '순서',
    title: '글의 순서',
    description: '주어진 글 고정 → 첫 단어·연결사 스캔 → 배열',
  },
  {
    type: '삽입',
    title: '문장 삽입',
    description: '지시어·연결사 분석 → 단절 지점 탐색',
  },
  {
    type: '어법',
    title: '어법',
    description: '밑줄 5곳 → 받는 요소 X-체크',
  },
  {
    type: '어휘',
    title: '어휘',
    description: '글 전체 부호(±) → 밑줄 단어 충돌 체크',
  },
  {
    type: '무관',
    title: '무관한 문장',
    description: '주제 흐름에서 벗어난 문장 찾기',
  },
]

export function problemTypeTitle(type: QuestionType): string {
  return PROBLEM_TYPES.find((t) => t.type === type)?.title ?? type
}
