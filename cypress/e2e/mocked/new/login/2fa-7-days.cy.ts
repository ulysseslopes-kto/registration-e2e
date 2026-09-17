/**
 * Login's own 2FA (`Login2fa`, modules/registration/src/features/login-2fa)
 * — `POST /auth/login` failing with `messageCode === 455`
 * (`AuthLandingRoute.js`'s `onLogin`) sets `twoFactorData.isPending`, which
 * swaps the whole auth-landing screen for this one. `useLogin2fa`
 * auto-picks the sole channel and skips straight to its OTP screen when
 * only one is available (`allowedMethods.length === 1`) — contrast with
 * the legacy suite (cypress/e2e/mocked/legacy/login/2fa-7-days.cy.ts),
 * whose equivalent only does that when a method is already persisted in
 * storage, a genuine behavioral difference between the two, not a copy
 * gap in this suite.
 *
 * A correct code's `onSuccess()` doesn't reach the network at all by
 * itself — it resets `twoFactorData` and replays the original credentials
 * through `onLogin` again (`onTwoFactorSuccess`), so completing 2FA here
 * is really "log in a second time, this time past the check" — same
 * shape as `cypress/e2e/mocked/new/login/account-reopen.cy.ts`'s
 * liveness-completion test, and same fix applied here up front:
 * `is-migrateable` stubbed for the retry too, and the outcome (redirected
 * away from `/login`) asserted instead of counting network calls.
 */
describe('Registration 2026 login — 2FA (messageCode 455)', () => {
  const openTwoFa = (availableChannels: Array<'EMAIL' | 'SMS'>) => {
    cy.stubGrowthbookFeatures()
    cy.stubMigratableStatus()
    cy.stubLogin({
      statusCode: 401,
      body: { messageCode: 455, data: { availableChannels } },
    })
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('input[autocomplete="username"]').type('e2e-test@example.com')
    cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('button[type="submit"]').click()
    cy.wait('@migratableStatus')
    cy.wait('@login')
  }

  it('two available channels show the method-choice screen; choosing E-mail sends the code and shows its OTP screen', () => {
    cy.stubTwoFaSendEmail()
    openTwoFa(['EMAIL', 'SMS'])

    cy.contains('Precisamos verificar sua conta').should('be.visible')
    cy.get('.verification-method-row').should('have.length', 2)
    cy.get('.verification-method-row').eq(0).click()

    cy.wait('@sendTwoFaEmail')
    cy.contains(
      'Você deve receber um e-mail para e2e-test@example.com com um código de verificação em breve.',
    ).should('be.visible')
  })

  it('entering the correct code logs the user in', () => {
    cy.stubTwoFaSendEmail()
    openTwoFa(['EMAIL', 'SMS'])
    cy.get('.verification-method-row').eq(0).click()
    cy.wait('@sendTwoFaEmail')

    cy.stubTwoFaValidateEmail()
    cy.stubLogin()
    cy.fillOtp('1234')
    cy.wait('@validateTwoFaEmail')

    cy.url({ timeout: 10000 }).should('not.include', '/login')
  })

  it('entering a wrong code shows the inline error and stays on the OTP screen', () => {
    cy.stubTwoFaSendEmail()
    openTwoFa(['EMAIL', 'SMS'])
    cy.get('.verification-method-row').eq(0).click()
    cy.wait('@sendTwoFaEmail')

    cy.stubTwoFaValidateEmail({ statusCode: 400, messageCode: 999 })
    cy.fillOtp('0000')
    cy.wait('@validateTwoFaEmail')

    cy.contains('Código inválido. Confira e tente novamente.').should(
      'be.visible',
    )
    cy.url().should('include', '/login')
  })

  it('a single available channel (SMS) skips the choice screen and requests its code automatically', () => {
    cy.stubTwoFaSendSms()
    openTwoFa(['SMS'])

    cy.wait('@sendTwoFaSms')
    cy.get('.verification-method-row').should('not.exist')
    cy.contains(
      'com o código de verificação.',
    ).should('be.visible')
  })

  it('too many SMS attempts drops back to the login form (onFail)', () => {
    cy.stubTwoFaSendSms()
    openTwoFa(['SMS'])
    cy.wait('@sendTwoFaSms')

    cy.stubTwoFaValidateSms({ statusCode: 429, messageCode: 604 })
    cy.fillOtp('1234')
    cy.wait('@validateTwoFaSms')

    cy.get('input[autocomplete="username"]').should('be.visible')
    cy.contains('Precisamos verificar sua conta').should('not.exist')
  })
})
