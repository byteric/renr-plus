import {
  projectAssessment,
  type ResultQuestion,
  type ResultInput,
} from '../src/modules/assessments/assessment-projection';
const q: ResultQuestion = {
  id: 'q',
  label: 'Collective',
  type: 'MULTIPLE_CHOICE',
  required: false,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
};
const response = (options: string[]) => ({
  answers: options.length ? [{ questionId: 'q', optionIds: options }] : [],
});
const cycle = (id: string, responses: ReturnType<typeof response>[]): ResultInput => ({
  id,
  name: id,
  nodeType: 'CYCLE',
  status: 'CLOSED',
  responses,
  children: [],
});
describe('Conservative assessment projection', () => {
  it('protects multiple-choice complements of 9/10 and optional omissions 7/10', () => {
    const multi = projectAssessment(
      cycle('multi', [...Array.from({ length: 9 }, () => response(['a', 'b'])), response(['b'])]),
      [q],
      5,
    );
    expect(multi.responseCount).toBe(10);
    expect(multi.questions[0]).toMatchObject({
      availability: 'SUPPRESSED',
      answerCount: null,
      options: [],
    });
    const optional = projectAssessment(
      cycle('optional', [
        ...Array.from({ length: 7 }, () => response(['a'])),
        ...Array.from({ length: 3 }, () => response([])),
      ]),
      [q],
      5,
    );
    expect(optional.questions[0]?.availability).toBe('SUPPRESSED');
  });
  it('suppresses ancestors before selecting a visible unit and propagates protected questions', () => {
    const a = cycle(
      'a',
      Array.from({ length: 8 }, () => response(['a'])),
    );
    const b = cycle(
      'b',
      Array.from({ length: 2 }, () => response(['b'])),
    );
    const family = projectAssessment(
      {
        id: 'org',
        name: 'org',
        nodeType: 'ORGANIZATION',
        responses: [...a.responses, ...b.responses],
        children: [
          { ...a, nodeType: 'UNIT', children: [a] },
          { ...b, nodeType: 'UNIT', children: [b] },
        ],
      },
      [q],
      5,
    );
    expect(family.availability).toBe('SUPPRESSED');
    expect(family.responseCount).toBeNull();
    expect(family.children[0]?.responseCount).toBe(8);
    const small = cycle('small', [
      response(['a']),
      ...Array.from({ length: 9 }, () => response(['b'])),
    ]);
    expect(
      projectAssessment({ ...small, nodeType: 'GROUP', children: [small] }, [q], 5).questions[0]
        ?.availability,
    ).toBe('SUPPRESSED');
  });
  it('distinguishes states without exposing counts or denominators', () => {
    for (const [status, availability] of [
      ['DRAFT', 'NOT_STARTED'],
      ['OPEN', 'COLLECTING'],
      ['CLOSED', 'NO_RESPONSES'],
    ] as const) {
      const node = projectAssessment({ ...cycle('empty', []), status }, [q], 5);
      expect(node.availability).toBe(availability);
      expect(node.responseCount).toBeNull();
      expect(node.questions[0]?.answerCount).toBeNull();
    }
  });
  it('exhaustively preserves threshold and complement invariants across small populations', () => {
    for (let minimum = 2; minimum <= 10; minimum++)
      for (let total = 0; total <= 30; total++)
        for (let selected = 0; selected <= total; selected++) {
          const raw = cycle('generated', [
            ...Array.from({ length: selected }, () => response(['a'])),
            ...Array.from({ length: total - selected }, () => response(['b'])),
          ]);
          const node = projectAssessment(raw, [q], minimum);
          const question = node.questions[0]!;
          if (node.responseCount !== null)
            expect(node.responseCount).toBeGreaterThanOrEqual(minimum);
          if (question.availability === 'AVAILABLE')
            for (const cell of question.options) {
              expect(cell.count === 0 || cell.count >= minimum).toBe(true);
              const complement = question.answerCount! - cell.count;
              expect(complement === 0 || complement >= minimum).toBe(true);
            }
          else expect(question.options).toEqual([]);
          expect(
            projectAssessment({ ...raw, responses: [...raw.responses].reverse() }, [q], minimum),
          ).toEqual(node);
        }
  });
});
