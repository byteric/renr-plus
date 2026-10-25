import type { AssessmentResultNode } from '@renr/contracts';
export type ResultQuestion = {
  id: string;
  label: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'ORDINAL_CHOICE';
  required: boolean;
  options: { id: string; label: string }[];
};
export type ResultResponse = { answers: { questionId: string; optionIds: unknown }[] };
export type ResultInput = {
  id: string;
  name: string;
  nodeType: AssessmentResultNode['nodeType'];
  status?: 'DRAFT' | 'OPEN' | 'CLOSED';
  responses: ResultResponse[];
  children: ResultInput[];
};
const unsafe = (count: number, minimum: number) => count > 0 && count < minimum;
/** Protect the entire family before callers select a unit. Never aggregate only visible cells. */
export function projectAssessment(
  input: ResultInput,
  questions: ResultQuestion[],
  minimum: number,
): AssessmentResultNode {
  const children = input.children.map((child) => projectAssessment(child, questions, minimum));
  const count = input.responses.length;
  let availability: AssessmentResultNode['availability'];
  if (input.status === 'DRAFT') availability = 'NOT_STARTED';
  else if (input.status === 'OPEN') availability = 'COLLECTING';
  else if (children.some((c) => c.availability === 'SUPPRESSED')) availability = 'SUPPRESSED';
  else if (children.some((c) => c.availability === 'COLLECTING')) availability = 'COLLECTING';
  else if (children.some((c) => c.availability === 'NOT_STARTED')) availability = 'NOT_STARTED';
  else if (count === 0)
    availability = input.status === 'CLOSED' || children.length ? 'NO_RESPONSES' : 'NOT_STARTED';
  else availability = count < minimum ? 'SUPPRESSED' : 'AVAILABLE';
  const projected = questions.map((q) => {
    const answers = input.responses.flatMap((r) =>
      r.answers.filter(
        (a) => a.questionId === q.id && Array.isArray(a.optionIds) && a.optionIds.length > 0,
      ),
    );
    const answerCount = answers.length;
    const options = q.options.map((o) => {
      const selected = answers.filter((a) => (a.optionIds as string[]).includes(o.id)).length;
      return {
        id: o.id,
        label: o.label,
        count: selected,
        percentage: answerCount ? (selected / answerCount) * 100 : 0,
      };
    });
    const inherited = children.some(
      (c) => c.questions.find((item) => item.id === q.id)?.availability === 'SUPPRESSED',
    );
    const suppress =
      availability !== 'AVAILABLE' ||
      inherited ||
      unsafe(answerCount, minimum) ||
      unsafe(count - answerCount, minimum) ||
      options.some((o) => unsafe(o.count, minimum) || unsafe(answerCount - o.count, minimum));
    const state =
      availability === 'NO_RESPONSES'
        ? 'NO_RESPONSES'
        : suppress
          ? 'SUPPRESSED'
          : answerCount === 0
            ? 'NO_RESPONSES'
            : 'AVAILABLE';
    return {
      id: q.id,
      label: q.label,
      type: q.type,
      required: q.required,
      availability: state as 'NO_RESPONSES' | 'SUPPRESSED' | 'AVAILABLE',
      answerCount: state === 'AVAILABLE' ? answerCount : null,
      options: state === 'AVAILABLE' ? options : [],
    };
  });
  return {
    id: input.id,
    name: input.name,
    nodeType: input.nodeType,
    availability,
    responseCount: availability === 'AVAILABLE' ? count : null,
    questions: projected,
    children,
  };
}
