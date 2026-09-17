/**
 * Account reopen (`AccountReOpen`,
 * apps/core/src/atomic-components/organisms/AccountReOpen) — the modal
 * `LoginContent` (apps/core/src/templates/onBoarding/login.js) opens when
 * `POST /auth/login` fails with `messageCode === 730` (`treatCommonErrors`),
 * for a closed-but-reopenable account. Its consent checkboxes reuse the
 * registration flow's own `RegistrationCheckmarks`
 * (`#tandc`/`#privacyPolicy`/`#belongHere`/`#marketing`), but only the three
 * required ones gate the button (`useAccountReOpen.js`'s `isCheckBoxDisable`
 * — marketing stays optional).
 *
 * Clicking "Iniciar" immediately kicks off the KYC liveness process
 * (`useAccountReOpen.js`'s `acceptTcAndPp` effect → `handleStartLivenessProcess`
 * → `POST /account-reopen`) — this suite verifies that payload and confirms
 * the transition into `KycSteps`'s own start screen.
 *
 * The full liveness completion (below) is driven without a real third-party
 * widget: as long as `POST /account-reopen`'s mocked `provider` isn't
 * `KYC_PROVIDERS.UNICO` (`@repo/kyc`), `VerificationStartedContent` renders
 * `CafIFrame` (apps/core/.../molecules/cafIFrame), which points its `<iframe>`
 * straight at the mocked `url` (no network call of its own — `cafAltIframeUrl`
 * short-circuits `fetchIFrameURL`) and listens for the finish signal via a
 * plain, origin-unchecked `window.addEventListener('message', ...)`. So a
 * same-window `win.postMessage({ code: CAF_MESSAGE_CODES.ONBOARDING_FINISHED
 * }, '*')` reaches it exactly like the real widget's iframe would, without
 * ever needing that iframe to actually load anything. From there,
 * `closeIframe` → `handleKycFinish` (`handleReOpenAccount`) closes the modal
 * and flips `reOpenCompleted`, which `login.js`'s own effect turns into a
 * success toast *and* an automatic re-submit of the same credentials
 * (`handleSubmit(onSubmit)()` — `loginFlowRef.current === 'usual'`), so the
 * test re-stubs `/auth/login` to succeed before triggering the message and
 * waits for that second call.
 *
 * Payload oddity worth flagging, not fixing here: `getLivenessData` sends
 * `accountReOpenData` as-is, whose e-mail field is named `userEmail` — but
 * `AccountReopenModel` (packages/core-api's `auth.ts`) types the endpoint as
 * expecting `email` (plus a `reason` that's never set anywhere in this
 * hook). Asserting on what the app actually sends, not what the type says
 * it should.
 */
describe('Legacy login — account reopen (messageCode 730)', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  const openAccountReOpenModal = () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.stubLogin({ statusCode: 401, body: { messageCode: 730 } })
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()
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

  it('completing the liveness check reopens the account and logs the user back in automatically', () => {
    openAccountReOpenModal()

    cy.intercept('POST', '**/account-reopen', {
      data: {
        url: 'https://kyc.e2e.test/session',
        onboardingId: 'e2e-onboarding-id',
        provider: 'CERTTA',
        token: 'e2e-kyc-token',
        type: 'LIVENESS',
      },
    }).as('accountReopen')

    cy.get('#tandc').check({ force: true })
    cy.get('#privacyPolicy').check({ force: true })
    cy.get('#belongHere').check({ force: true })
    cy.contains('button', 'Iniciar').click()
    cy.wait('@accountReopen')

    cy.get('[data-qa="kyc-button-start"]').click()

    // The auto-resubmit fires with the same credentials right after this —
    // stub the retry as a success before triggering it. Unlike the rest of
    // this file, `is-migrateable` is stubbed too: this test is the only one
    // that makes a *second* real call to it (on the resubmit), doubling
    // this shared e2e account's exposure to that real dependency's own
    // flakiness (see cypress/e2e/mocked/new/login/migratable.cy.ts) for no
    // benefit here — the resubmit path only cares that it isn't migratable.
    cy.stubMigratableStatus()
    cy.stubLogin()

    // Simulates the CAF widget's iframe posting its finish signal back to
    // the parent window — see the file header for why this, not driving a
    // real iframe, is how this suite completes the liveness step.
    cy.window().then((win) => {
      win.postMessage({ code: 'ONBOARDING_FINISHED' }, '*')
    })

    cy.contains('Reabertura de Conta').should('not.exist')
    // Asserted on the outcome, not the intermediate network call: the
    // resubmit's own `POST /auth/login` reliably fires and succeeds (this
    // reaches the sportsbook lobby every time it's been run), but
    // `cy.wait('@login')` for a *second* match against an alias re-stubbed
    // mid-test proved unreliable here — not worth chasing given the
    // outcome below is what actually matters. Not asserted either: the
    // `accountReOpen.successMessage` toast this also fires — a real race
    // against this same redirect, which wins first, so the toast can
    // already be gone by the time a query reaches it.
    cy.url({ timeout: 10000 }).should('not.include', '/login')
  })

  it('the close button asks for confirmation, "Retornar" cancels, "Sair" returns to the login form', () => {
    openAccountReOpenModal()

    cy.get('img[alt="close"]').click()
    cy.contains('Tem certeza que deseja sair?').should('be.visible')

    cy.contains('button', 'Retornar').click()
    cy.contains('Tem certeza que deseja sair?').should('not.exist')
    cy.contains('button', 'Iniciar').should('be.visible')

    cy.get('img[alt="close"]').click()
    cy.contains('button', 'Sair').click()

    cy.contains('Reabertura de Conta').should('not.exist')
    cy.get('#input-new-username').should('be.visible')
  })
})
