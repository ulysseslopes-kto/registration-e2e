/**
 * "Registration 2026" login landing (test matrix section 01, LOGIN-01..08).
 * LOGIN-05/06 (Google SSO) are skipped — `useGoogleLogin` opens a real
 * Google OAuth popup Cypress cannot drive; see apps/e2e/README.md.
 * LOGIN-01 also runs once at a mobile viewport (`iphone-x`) to catch
 * layout/interaction regressions specific to small screens.
 */
describe('Login (auth-landing)', () => {
  beforeEach(() => {
    cy.acceptCookieBanner()
  })

  it('LOGIN-01: valid CPF reveals the password field and logs in', () => {
    cy.stubGrowthbookFeatures()
    cy.stubLogin()
    cy.visit('/login/')

    cy.get('input[autocomplete="current-password"]')
      .closest('[aria-hidden]')
      .should('have.attr', 'aria-hidden', 'true')
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.get('input[autocomplete="current-password"]')
      .closest('[aria-hidden]')
      .should('have.attr', 'aria-hidden', 'false')

    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.get('button[type="submit"]').click()
    cy.wait('@login')
    cy.url().should('not.include', '/login')
  })

  it('LOGIN-01 (mobile): valid CPF reveals the password field and logs in on a mobile viewport (iPhone X)', () => {
    cy.viewport('iphone-x')
    cy.stubGrowthbookFeatures()
    cy.stubLogin()
    cy.visit('/login/')

    cy.get('input[autocomplete="current-password"]')
      .closest('[aria-hidden]')
      .should('have.attr', 'aria-hidden', 'true')
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.get('input[autocomplete="current-password"]')
      .closest('[aria-hidden]')
      .should('have.attr', 'aria-hidden', 'false')

    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.get('button[type="submit"]').click()
    cy.wait('@login')
    cy.url().should('not.include', '/login')
  })

  it('LOGIN-02: a valid e-mail is not masked, and logs in the same way', () => {
    cy.stubGrowthbookFeatures()
    cy.stubLogin()
    cy.visit('/login/')

    cy.get('input[autocomplete="username"]')
      .type('lucas@gmail.com')
      .should('have.value', 'lucas@gmail.com')
    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.get('button[type="submit"]').click()
    cy.wait('@login')
    cy.url().should('not.include', '/login')
  })

  it('LOGIN-03: a CPF with a bad check digit shows a format error, no network call', () => {
    cy.stubGrowthbookFeatures()
    cy.intercept('POST', '**/auth/login').as('login')
    cy.visit('/login/')

    // 111.444.777-36 — wrong check digit (valid one is ...-35).
    cy.get('input[autocomplete="username"]').type('11144477736')
    cy.contains('CPF inválido. Verifique os números digitados.').should(
      'be.visible',
    )
    cy.get('button[type="submit"]').should('be.disabled')
    cy.get('@login.all').should('have.length', 0)
  })

  it('LOGIN-04: the CPF-invalid message never shows for incomplete CPFs or e-mails', () => {
    cy.stubGrowthbookFeatures()
    cy.visit('/login/')

    cy.get('input[autocomplete="username"]').type('111.444.777')
    cy.contains('CPF inválido').should('not.exist')

    cy.get('input[autocomplete="username"]').clear().type('lucas@gmail.com')
    cy.contains('CPF inválido').should('not.exist')
  })

  it('LOGIN-07: a black loading screen appears before any form while GrowthBook resolves', () => {
    // `useIsGrowthBookReady` waits on GrowthBookProvider's `load()` resolving
    // `countryCheckTranslations()` (GET /country/check) and dispatching
    // GROWTHBOOK_ATTRIBUTES_SET_EVENT — not on the features fetch — so that's
    // the call to delay to actually delay `isGrowthBookReady`.
    cy.intercept('GET', '**/country/check', (req) => {
      req.continue((res) => {
        res.setDelay(2000)
      })
    }).as('countryCheckDelayed')
    cy.visit('/login/')

    cy.get('input[autocomplete="username"]').should('not.exist')

    cy.wait('@countryCheckDelayed')
    cy.get('input[autocomplete="username"]', { timeout: 10000 }).should(
      'be.visible',
    )
  })

  it('LOGIN-08: the recaptcha-solutions flag does not change visible behavior', () => {
    cy.stubGrowthbookFeatures()
    cy.stubLogin()
    cy.visit('/login/')
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.get('button[type="submit"]').click()
    cy.wait('@login')
    cy.url().should('not.include', '/login')
  })

  it('LOGIN-08b: same flow, with login_captcha_solutions set to "recaptcha"', () => {
    // `is_recaptcha_enabled` stays unset (falsy) in the base fixture, so
    // `useReCaptcha` skips waiting on a real grecaptcha script regardless —
    // this flag alone only picks which login function is called.
    cy.stubGrowthbookFeatures({
      login_captcha_solutions: { defaultValue: 'recaptcha' },
    })
    cy.stubLogin()
    cy.visit('/login/')
    cy.get('input[autocomplete="username"]').type('52998224725')
    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.get('button[type="submit"]').click()
    cy.wait('@login')
    cy.url().should('not.include', '/login')
  })

  // LOGIN-05/06 skipped — see file header.
})
