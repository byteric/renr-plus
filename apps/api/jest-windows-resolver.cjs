/* eslint-disable @typescript-eslint/no-require-imports -- Jest loads resolver functions through CommonJS. */
const { existsSync } = require('node:fs');
const path = require('node:path');

module.exports = (name, options) => {
  try {
    return options.defaultResolver(name, options);
  } catch (error) {
    // Node resolves pnpm links that the native resolver can miss on long Windows paths.
    try {
      return require.resolve(name, { paths: [options.basedir] });
    } catch {
      if (!name.startsWith('.') && !path.isAbsolute(name)) throw error;
    }

    const base = path.resolve(options.basedir, name);
    for (const extension of options.extensions ?? []) {
      for (const candidate of [base + extension, path.join(base, 'index' + extension)]) {
        if (existsSync(candidate)) return candidate;
      }
    }
    throw error;
  }
};
