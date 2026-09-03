/**
 * Shared auth-shell & UI (test matrix section 07, SHELL-01,03,05). SHELL-02
 * and SHELL-04 (CMS marketing-banner variants) are skipped — `useBanners`
 * resolves via Gatsby's build-time GraphQL static query, not a runtime
 * fetch, so there's no request to intercept from the browser; see
 * README.md.
 */
describe('Account create — shared shell & UI', () => {
  it('SHELL-01: the back button returns to the previous step', () => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.get('input[type="password"]').should('be.visible')

    cy.get('.auth-shell-back-button').click()
    cy.get('input[inputmode="numeric"]').should('be.visible')
  })

  it('SHELL-03: the auth shell always renders its own dark theme', () => {
    cy.stubGrowthbookFeatures()
    cy.startRegistration()
    // `.auth-shell-glow` only exists inside AuthShell's dark-themed wrapper —
    // a reasonable structural stand-in for "renders in the dark auth theme"
    // without depending on the host site's own light/dark toggle.
    cy.get('.auth-shell-glow').should('exist')
  })

  it('SHELL-05: a direct visit to /registro/ never flashes the legacy form while GrowthBook resolves', () => {
    // `useIsGrowthBookReady` (packages/growthbook/src/use-is-growthbook-ready.hook.ts)
    // doesn't wait on the features fetch — it waits for GrowthBookProvider's
    // `load()` (packages/growthbook/src/GrowthBookProvider.tsx) to resolve
    // `countryCheckTranslations()` (GET /country/check) and dispatch
    // GROWTHBOOK_ATTRIBUTES_SET_EVENT. Delaying that call is what actually
    // delays `isGrowthBookReady`, not delaying /api/features/.
    //
    // register.js used to render the legacy `RegisterPageContent`
    // (`#register-form`) immediately whenever
    // `isGrowthBookReady && isNewRegistration` wasn't true yet — i.e. on
    // every visit until GrowthBook resolved. Fixed by adding the same
    // `FlagLoadingScreen` guard login.js already had (LOGIN-07): a black
    // screen covers the page until `isGrowthBookReady`, so the legacy form
    // never has a chance to paint.
    cy.intercept('GET', '**/country/check', (req) => {
      req.continue((res) => {
        res.setDelay(2000)
      })
    }).as('countryCheckDelayed')
    cy.visit('/registro/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#register-form').should('not.exist')
    cy.get('input[inputmode="numeric"]').should('not.exist')

    cy.wait('@countryCheckDelayed')
    cy.get('input[inputmode="numeric"]', { timeout: 10000 }).should(
      'be.visible',
    )
    cy.get('#register-form').should('not.exist')
  })
})
