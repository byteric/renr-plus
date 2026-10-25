export function e2eBatches(args) {
  const hasProject = args.some((value) => value === '--project' || value.startsWith('--project='));
  const hasConfig = args.some((value) => value === '--config' || value.startsWith('--config='));
  const base = [
    'test',
    ...(hasConfig ? [] : ['--config=playwright.production.config.ts']),
    ...args,
  ];
  return hasProject
    ? [base]
    : ['desktop', 'mobile'].map((project) => [...base, `--project=${project}`]);
}
