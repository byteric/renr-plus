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
      const shardCount = 4;
      return [
        ...Array.from({ length: shardCount }, (_, index) => [
          ...shared,
          '--fully-parallel',
          `--shard=${index + 1}/${shardCount}`,
          '--grep-invert=@personas',
          `--output=test-results/e2e-${project}-${index + 1}`,
        ]),
        [...shared, '--grep=@personas', `--output=test-results/e2e-${project}-personas`],
      ];
    });
  return hasProject
    ? [base]
    : ['desktop', 'mobile'].map((project) => [...base, `--project=${project}`]);
}
