import typescriptParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

const readabilityRules = {
  curly: ['error', 'all'],
  'one-var': ['error', 'never']
}

export default [
  { ignores: ['node_modules/**', 'out/**', 'release/**', '.synthetic-archive/**', '.venv-ocr/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: typescriptParser },
    rules: readabilityRules
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: typescriptParser, extraFileExtensions: ['.vue'] }
    },
    rules: readabilityRules
  }
]
