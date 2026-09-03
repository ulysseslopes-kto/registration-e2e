import './commands'
// Backend setup/teardown commands. Loaded in both modes (declaring a command
// costs nothing until it is called); every one of them reads its host and key
// from `Cypress.env`, and an integrated run without those is refused at config
// time — see cypress.config.ts.
import './commands/api'

/**
 * apps/core's gatsby-browser.js polls `meta.json` (a static file written at
 * build time by apps/core/generate-build-version.js) on every page load, to
 * detect a new deploy and force-reload the page. It 404s against any
 * environment that never ran that build step, and even a 200 depends on
 * whatever's actually deployed — stub it globally so no spec depends on
 * either.
 */
beforeEach(() => {
  // Set the AdOpt "already-answered" cookie globally so the consent banner
  // never renders, regardless of which spec/command visits a page — see
  // `acceptCookieBanner()` in commands.ts. Must run before `cy.visit()`.
  // Unlike everything else in this hook, this isn't a network stub — AdOpt's
  // own real script reads it — so it applies in both modes.
  cy.acceptCookieBanner()

  // CY_MODE=integrated is meant to hit real backend and third-party services
  // (see cypress.config.ts) — none of the intercepts below apply there, only
  // in `mocked`.
  if (Cypress.env('mode') === 'integrated') return

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
  // Kambi's own offering API (odds/live-event data for the actual sportsbook
  // widget content) — real third-party calls, once the widget bootstraps, to
  // a Kambi-owned CDN outside our backend entirely. `ncid` in the query
  // string is a per-request cache-buster, so this is a path/host match, not
  // an exact URL. No spec asserts on any betting-odds content.
  cy.intercept('GET', '**ctn-api.kambi.com/**', { statusCode: 204, body: '' })

  // Kambi's worker script (modules/sportsbook/worker/dist/sportsbook.worker.js,
  // loaded once KambiSessionProvider bootstraps — see stubLogin()'s Kambi note
  // in commands.ts) is a committed, pre-built bundle with PRODUCTION URLs
  // baked in at build time (PAYLOAD_CMS_URL, GATSBY_KTO_API, ...), independent
  // of FE_TARGET — so it calls the real cms.kto.bet.br even against
  // local/dev/pr. `useTrunfoThemeQuery` and friends already treat a
  // missing/failed CMS response as non-fatal (cached/bundled fallback,
  // `shouldRetryOnError: false`), so blocking it outright is safe.
  cy.intercept('**cms.kto.bet.br/**', { statusCode: 204, body: '' })

  // `TranslationProvider` (@repo/translation, mounted at the app root — every
  // page gets it) fires `GET /country/registration-dropdown` and `GET
  // /country/register` on load (TranslationProvider.tsx), and on a real
  // deployed build these two land on api.kto.bet.br the same way the CMS
  // call above does — a real backend call from every single spec regardless
  // of what it's testing.
  // - `/country/registration-dropdown` -> `countriesArray`: feeds
  //   `uniquePhoneCodes` (the new flow's phone step already falls back to
  //   `+55` alone if this is empty — phone-step.tsx) AND, for the legacy
  //   register flow, `useRegisterData`'s `safeSetCountry('Brazil', ...)`,
  //   which is NOT optional there — it's what loads the regions/cities the
  //   address step's CEP autofill validates against. A single real-shaped
  //   Brazil entry keeps that working; an empty array would silently break
  //   every legacy address-step test instead.
  // - `/country/register` -> `Countries` (a NAME->id map): only consumed by
  //   the withdraw/payment components (method.js, directa.js), neither of
  //   which any spec here touches — content doesn't matter, kept for shape
  //   consistency with the other one.
  cy.intercept('GET', '**/country/registration-dropdown', {
    data: [
      {
        // Brazil's real id on api.kto-dev.com — not an arbitrary stand-in.
        // `getCountryRegions`/`getCountryCities` (useRegisterData.js) call
        // the REAL `/country/{id}/regions` and `/city?country_id={id}` with
        // whatever id lands here; a made-up id like `1` gets a real
        // `{ data: [] }` back (verified against the real API), silently
        // leaving the address step's state/city dropdowns empty for any
        // spec that doesn't route around them via a real CEP lookup.
        id: 31,
        name: 'Brazil',
        code: 'BR',
        phone_prefix: '55',
        default_country_currency: 'BRL',
      },
    ],
  })
  cy.intercept('GET', '**/country/register', {
    data: [{ id: '1', name: 'Brazil' }],
  })
})
