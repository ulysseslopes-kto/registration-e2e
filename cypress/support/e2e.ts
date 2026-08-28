import './commands'

/**
 * apps/core's gatsby-browser.js polls `meta.json` (a static file written at
 * build time by apps/core/generate-build-version.js) on every page load, to
 * detect a new deploy and force-reload the page. It 404s against any
 * environment that never ran that build step, and even a 200 depends on
 * whatever's actually deployed — stub it globally so no spec depends on
 * either.
 */
beforeEach(() => {
  cy.intercept('GET', '**/meta.json**', {
    version: '0.0.0-e2e',
    versionHash: 0,
    commitHash: 'e2e0000',
  })

  // Third-party scripts loaded unconditionally on every page (home, /login/,
  // /registro/) whenever baseUrl points at a real deployed build rather than
  // `gatsby develop` — safe to block outright at the network level, since no
  // spec exercises them:
  //
  // - Smartico (apps/core/src/context/smarticoProvider.js, mounted at the
  //   app root): its `waitForCondition` poll (apps/core/src/helpers/promise.js)
  //   times out and is caught internally (`tryCatch` + `reportSmarticoIssue`)
  //   if `window._smartico` never appears — no crash, just an internal log.
  // - Google Identity Services (`@react-oauth/google`'s GoogleOAuthProvider,
  //   wraps every account-create/login render): never actually clicked in
  //   this suite — Google SSO is deliberately skipped everywhere (see each
  //   spec's header comment).
  //
  // GTM and AdOpt (goadopt.io) are deliberately NOT blocked here, even though
  // neither is exercised by any spec either: on a real build, AdOpt loads
  // *inside* the GTM container, and it's AdOpt's own script that reads the
  // `AdoptConsent` cookie `acceptCookieBanner()` sets to suppress its banner
  // UI — block either one and nothing ever reads that cookie, so the banner
  // stays on screen and covers/blocks clicks on the page underneath it
  // (broke `account-create.cy.ts` this way once already).
  cy.intercept('GET', '**cdn-smr.kto.bet.br/**', { statusCode: 204, body: '' })
  cy.intercept('GET', '**accounts.google.com/gsi/**', { statusCode: 204, body: '' })

  // Set the AdOpt "already-answered" cookie globally so the consent banner
  // never renders, regardless of which spec/command visits a page — see
  // `acceptCookieBanner()` in commands.ts. Must run before `cy.visit()`.
  cy.acceptCookieBanner()
})
