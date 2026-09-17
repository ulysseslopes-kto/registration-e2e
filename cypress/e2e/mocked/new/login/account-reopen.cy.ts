/**
 * Account reopen (`AccountReOpen` — shared with the legacy flow, see
 * cypress/e2e/mocked/legacy/login/account-reopen.cy.ts for the component
 * itself and the header comment on its payload/scope caveats) opens from
 * the "Registration 2026" auth landing (`AuthLandingRoute.js`) the same
 * way: `POST /auth/login` failing with `messageCode === 730` sets
 * `accountReOpenData.canDoReOpen`, which mounts the exact same modal here
 * as in the legacy form.
 *
 * Unlike the legacy flow's 730 handling (present since release 1.321.0),
 * this is brand new — added to `AuthLandingRoute.js` by KIB-9285
 * ("feat: add account-reopen modal on new login flow"), still unmerged as
 * of writing (mono-fe PR #2241). Verify against that PR's preview
 * (`FE_PR=2241`), not `main` or any older PR — an older build silently
 * falls through to the generic login-error branch instead (no visible
 * error at all for an unmapped code like 730, `treatLoginErrors`), which
 * looks like "nothing happened" rather than an obvious failure.
 *
 * `is-migrateable` is explicitly stubbed here (`cy.stubMigratableStatus()`)
 * — unlike the legacy suite, which relies on the real backend for it (see
 * that file's header) — matching this flow's own established convention
 * (cypress/e2e/mocked/new/login/migratable.cy.ts).
 *
 * Login-form selectors follow cypress/e2e/mocked/new/login/login.cy.ts
 * (`input[autocomplete="username"]`/`current-password`,
 * `button[type="submit"]`) — everything from the modal opening onward
 * (content, consent gating, KYC-kickoff payload, close/confirm) is
 * identical to the legacy suite since it's the same component with the
 * same hook (`useAccountReOpen.js`); this file exists to confirm the entry
 * point wires up correctly here too.
 */
describe('Registration 2026 login — account reopen (messageCode 730)', () => {
  const openAccountReOpenModal = () => {
    cy.stubGrowthbookFeatures()
    cy.stubMigratableStatus()
    cy.stubLogin({ statusCode: 401, body: { messageCode: 730 } })
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('input[autocomplete="username"]').type('e2e-test@example.com')
    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('button[type="submit"]').click()
    cy.wait('@migratableStatus')
    cy.wait('@login')

    cy.contains('Reabertura de Conta').should('be.visible')
  }

  it('opens with step 1 content, and "Iniciar" stays disabled until all three required consents are checked', () => {
    openAccountReOpenModal()

    cy.contains(
      'Sua conta foi fechada. Para reabri-la, precisamos verificar sua identidade.',
    ).should('be.visible')
    cy.contains('button', 'Iniciar').should('be.disabled')

    cy.get('#tandc').check({ force: true })
    cy.contains('button', 'Iniciar').should('be.disabled')
    cy.get('#privacyPolicy').check({ force: true })
    cy.contains('button', 'Iniciar').should('be.disabled')
    cy.get('#belongHere').check({ force: true })
    cy.contains('button', 'Iniciar').should('not.be.disabled')
  })

  it('"Iniciar" starts the account-reopen KYC process with the exact payload and transitions into verification', () => {
    openAccountReOpenModal()

    cy.intercept('POST', '**/account-reopen', {
      data: {
        url: 'https://kyc.e2e.test/session',
        onboardingId: 'e2e-onboarding-id',
        provider: 'e2e-provider',
        token: 'e2e-kyc-token',
        type: 'LIVENESS',
      },
    }).as('accountReopen')

    cy.get('#tandc').check({ force: true })
    cy.get('#privacyPolicy').check({ force: true })
    cy.get('#belongHere').check({ force: true })
    cy.contains('button', 'Iniciar').click()

    cy.wait('@accountReopen')
      .its('request.body')
      .should('deep.equal', {
        userEmail: 'e2e-test@example.com',
        acceptTcAndPp: true,
        marketingConsent: false,
      })

    cy.contains(
      'Para sua segurança, precisamos verificar sua conta antes de reabri-la, garantindo que é realmente você.',
    ).should('be.visible')
  })

  it('the close button asks for confirmation, "Retornar" cancels, "Sair" returns to the auth-landing form', () => {
    openAccountReOpenModal()

    cy.get('img[alt="close"]').click()
    cy.contains('Tem certeza que deseja sair?').should('be.visible')

    cy.contains('button', 'Retornar').click()
    cy.contains('Tem certeza que deseja sair?').should('not.exist')
    cy.contains('button', 'Iniciar').should('be.visible')

    cy.get('img[alt="close"]').click()
    cy.contains('button', 'Sair').click()

    cy.contains('Reabertura de Conta').should('not.exist')
    cy.get('input[autocomplete="username"]').should('be.visible')
  })
})
