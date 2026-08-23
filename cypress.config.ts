import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    // apps/core's Gatsby dev server default port (`pnpm --filter core dev`).
    baseUrl: 'http://localhost:8000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
  },
})
