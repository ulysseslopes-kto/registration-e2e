import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    // apps/core's Gatsby dev server default port (`pnpm --filter core dev`).
    //https://pr-2050.d2xauiex3dlsqs.amplifyapp.com/
    //https://www.kto-dev.com/
    //http://localhost:8000/
    baseUrl: 'https://pr-2170.d2xauiex3dlsqs.amplifyapp.com/',
    // Mobile-first default: most users hit this flow on a phone, so every
    // spec runs at iPhone X's dimensions unless it explicitly overrides with
    // `cy.viewport(...)` — only a handful of tests do that, to also cover a
    // desktop viewport for their flow.
    viewportWidth: 375,
    viewportHeight: 812,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    setupNodeEvents(on) {
      // Chrome's autofill/password-manager can steal focus or interrupt
      // `.type()` mid-keystroke on fields like the e-mail input
      // (autoComplete="email" is a real, deliberate UX feature — kept as-is
      // in the app; this only disables the browser-side behavior inside the
      // isolated Cypress test browser, not in production).
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.family === 'chromium' && browser.name !== 'electron') {
          launchOptions.preferences = {
            ...launchOptions.preferences,
            credentials_enable_service: false,
            password_manager_enabled: false,
          }
          launchOptions.args.push('--disable-features=AutofillServerCommunication,PasswordManagerRedesign')
        }
        return launchOptions
      })
    },
  },
})
