import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    // apps/core's Gatsby dev server default port (`pnpm --filter core dev`).
    //https://pr-2050.d2xauiex3dlsqs.amplifyapp.com/
    //https://www.kto-dev.com/
    //http://localhost:8000/
    baseUrl: 'https://pr-2050.d2xauiex3dlsqs.amplifyapp.com/',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
  },
})
