export function e2eBatches(args) {
  const hasProject = args.some((value) => value === '--project' || value.startsWith('--project='));
  const hasConfig = args.some((value) => value === '--config' || value.startsWith('--config='));
  const base = [
    'test',
    ...(hasConfig ? [] : ['--config=playwright.production.config.ts']),
    ...args,
  ];
  if (!args.length)
    return ['desktop', 'mobile'].flatMap((project) => {
      const shared = [...base, `--project=${project}`];
      return [
        ...[1, 2].map((shard) => [
          ...shared,
          `--shard=${shard}/2`,
          '--grep-invert=@personas',
          `--output=test-results/e2e-${project}-${shard}`,
        ]),
        [...shared, '--grep=@personas', `--output=test-results/e2e-${project}-personas`],
      ];
    });
  return hasProject
    ? [base]
    : ['desktop', 'mobile'].map((project) => [...base, `--project=${project}`]);
}
