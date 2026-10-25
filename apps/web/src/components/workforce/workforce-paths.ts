export const resource = (kind: 'colaboradores' | 'grupos') =>
  kind === 'colaboradores' ? 'employees' : 'assessment-groups';
