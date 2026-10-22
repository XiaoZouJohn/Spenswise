import parser from '@typescript-eslint/parser'
import plugin from '@typescript-eslint/eslint-plugin'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/client/generated/**', 'test-results/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' } },
    plugins: { '@typescript-eslint': plugin },
    rules: { ...plugin.configs.recommended.rules, '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': 'error' },
  },
  {
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/client/generated/**'], message: '页面请通过 lib/api 或 lib/familyApi 调用生成的客户端。' }] }],
      'no-restricted-syntax': ['error', { selector: "CallExpression[callee.name='fetch']", message: '页面请通过公共 API 客户端发起请求。' }],
    },
  },
]
