/**
 * Legacy login (`LoginContent`, apps/core/src/templates/onBoarding/login.js)
 * against the REAL backend — `cypress/e2e/mocked/legacy/login/login.cy.ts`'s
 * counterpart for `CY_MODE=integrated`. Only runs when the integrated spec
 * pattern picks it up; `if (Cypress.env('mode') !== 'integrated') return`
 * below is a second, defensive guard in case this file is ever targeted
 * directly with the wrong `CY_MODE`.
 *
 * `POST /auth/login` hits the real API — nothing here is
 * `cy.intercept()`-stubbed for it, and this spec doesn't even use a
 * pass-through `cy.intercept(...).as(...)` on it to key a `cy.wait()`: sync
 * is done by waiting on the URL leaving `/login` instead. GrowthBook features
 * are REAL here (no `cy.stubGrowthbookFeatures()`), and so is `GET
 * /country/check` (no `cy.stubCountryCheck()` either) — this spec relies on
 * whatever `fe_igp_registration_new_ui_experience` actually is in the target
 * environment rendering the legacy UI; if that flag flips to `true` there,
 * this spec starts failing on the `#input-new-username` selectors below, and
 * that failure is the signal, not a bug in the spec. A real country-check
 * response that isn't `active: true` sends `SplitBannerLayout` straight to
 * `/blocked` instead — also a real signal, not a spec bug.
 *
 * Like `cypress/e2e/integrated/new/login.cy.ts` (the new flow's
 * counterpart), this spec does not create or recycle any account — it logs
 * in with `FLOW_TEST_LOGIN_EMAIL`/`FLOW_USER_PASSWORD` (.env) as an EXISTING
 * identity, and expects one to already be there (the two flows share the
 * same `/auth/login`, so either integrated register spec having created it
 * without letting its `after()` recycle it works). Running this straight
 * after a full register run (which recycles the identity in its own
 * `after()`) will fail here with invalid credentials — that's expected, not
 * a bug in this spec.
 *
 * `FLOW_TEST_LOGIN_EMAIL` is that account's e-mail, not the epoch-derived
 * one `freshIdentity()` generates for a new registration — it has to be kept
 * in sync by hand with whatever e-mail the real account behind
 * `FLOW_TEST_CPF` actually has.
 */
describe('Legacy login — real backend', () => {
  before(function () {
    if (Cypress.env('mode') !== 'integrated') {
      this.skip()
    }
  })

  it('logs in with the real test identity', () => {
    cy.acceptCookieBanner()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type(String(Cypress.env('testLoginEmail')))
    cy.get('#input-new-password').type(String(Cypress.env('flowPassword')))
    // AdOpt can re-show the banner with a delay, after the initial
    // post-visit check already ran clean — check again right before this
    // click, which is exactly where it's been seen covering the button.
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()

    // No network alias to wait on (see file header) — leaving `/login` is
    // only reachable once the real `doLogin` call succeeds.
    cy.url({ timeout: 30000 }).should('not.include', '/login')
  })
})
