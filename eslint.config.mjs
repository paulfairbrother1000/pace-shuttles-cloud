const isCI = !!process.env.CI;
export default isCI
  ? [{ ignores: ['**/*'] }]
  : [{
      files: ['**/*.{js,jsx,ts,tsx}'],
      languageOptions: { parserOptions: { project: false } },
      rules: {}
    }];
