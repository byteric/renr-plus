module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.tsx?$': [require.resolve('ts-jest'), { tsconfig: 'tsconfig.test.json' }] },
  ...(process.platform === 'win32' && { resolver: require.resolve('./jest-windows-resolver.cjs') }),
  clearMocks: true,
};
