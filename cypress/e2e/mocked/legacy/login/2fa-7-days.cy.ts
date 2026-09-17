/**
 * Login's own 2FA (`Login2faContent`,
 * apps/core/src/atomic-components/organisms/Login2faContent) — `POST
 * /auth/login` failing with `messageCode === 455` (`login.js`'s `onSubmit`)
 * sets `is2faVerificationPending`, swapping the whole login screen for
 * this one. Same backend endpoints, same `messageCode`, and (per
 * `Login2faContent/utils.js`) the same too-many-attempts codes (604/1214)
 * as the new flow's equivalent
 * (cypress/e2e/mocked/new/login/2fa-7-days.cy.ts) — this is a near-verbatim
 * port of that older component.
 *
 * One real behavioral difference from the new flow, tested below:
 * `selectedMethod`'s initial state here only ever comes from a *persisted*
 * `two_fa_method` in storage — unlike the new flow's hook, it never
 * auto-picks the sole channel just because `allowedMethods.length === 1`,
 * so a single available channel still shows the (one-item) choice screen
 * on a fresh session.
 *
 * A correct code's `onSuccess(formData)` calls
 * `handleSubmit(onSubmit)` — react-hook-form's `handleSubmit` ignores the
 * argument and just re-validates+resubmits the *current* form fields, so
 * completing 2FA here also replays the original login a second time, same
 * as `cypress/e2e/mocked/legacy/login/account-reopen.cy.ts`'s
 * liveness-completion test and for the same reason: `is-migrateable` is
 * stubbed for that retry (this suite's other tests don't, per the
 * account-reopen file's own header), and the outcome (redirected away from
 * `/login`) is asserted instead of counting network calls or catching the
 * transient `twoFa.email.success`/`twoFa.sms.success` toast.
 *
 * A wrong (but not too-many-attempts) code only ever shows a toast here
 * (`toast.error(...)`, no inline state) — and, on the email path
 * specifically, the *SMS* error copy (`twoFa.sms.errorSent`), a copy-paste
 * artifact in `EmailVerification/index.js` worth flagging, not fixing
 * here. Not asserted, same reasoning as the success toast above; this
 * suite instead confirms the wrong-code case by staying on the OTP screen.
 */
describe('Legacy login — 2FA (messageCode 455)', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  const openTwoFa = (availableChannels: Array<'EMAIL' | 'SMS'>) => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.stubLogin({
      statusCode: 401,
      body: { messageCode: 455, data: { availableChannels } },
    })
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()
    cy.wait('@login')
  }

  it('two available channels show the method-choice screen; choosing EMAIL sends the code and shows its OTP screen', () => {
    cy.stubTwoFaSendEmail()
    openTwoFa(['EMAIL', 'SMS'])

    cy.contains('Precisamos verificar').should('be.visible')
    cy.contains('sua conta').should('be.visible')
    cy.contains('EMAIL').should('be.visible')
    cy.contains('SMS').should('be.visible')
    cy.contains('EMAIL').click()

    cy.wait('@sendTwoFaEmail')
    cy.contains('Você deve receber um e-mail para').should('be.visible')
    cy.contains('e2e-test@example.com').should('be.visible')
  })

  it('entering the correct code logs the user in', () => {
    cy.stubTwoFaSendEmail()
    openTwoFa(['EMAIL', 'SMS'])
    cy.contains('EMAIL').click()
    cy.wait('@sendTwoFaEmail')

    cy.stubTwoFaValidateEmail()
    // See the file header — the resubmit this triggers makes its own real
    // is-migrateable call otherwise.
    cy.stubMigratableStatus()
    cy.stubLogin()
    cy.get('#otp-input').type('1234')
    cy.wait('@validateTwoFaEmail')

    cy.url({ timeout: 10000 }).should('not.include', '/login')
  })

  it('entering a wrong code stays on the OTP screen, no navigation', () => {
    cy.stubTwoFaSendEmail()
    openTwoFa(['EMAIL', 'SMS'])
    cy.contains('EMAIL').click()
    cy.wait('@sendTwoFaEmail')

    cy.stubTwoFaValidateEmail({ statusCode: 400, messageCode: 999 })
    cy.get('#otp-input').type('0000')
    cy.wait('@validateTwoFaEmail')

    cy.contains('Você deve receber um e-mail para').should('be.visible')
    cy.url().should('include', '/login')
  })

  it('a single available channel (SMS) still shows the choice screen on a fresh session (no persisted method)', () => {
    openTwoFa(['SMS'])

    cy.contains('Precisamos verificar').should('be.visible')
    cy.contains('SMS').should('be.visible')
  })

  it('too many SMS attempts drops back to the plain login form (onFail)', () => {
    cy.stubTwoFaSendSms()
    openTwoFa(['EMAIL', 'SMS'])
    cy.contains('SMS').click()
    cy.wait('@sendTwoFaSms')

    cy.stubTwoFaValidateSms({ statusCode: 429, messageCode: 604 })
    cy.get('#otp-input').type('1234')
    cy.wait('@validateTwoFaSms')

    cy.get('#input-new-username').should('be.visible')
    cy.contains('Precisamos verificar').should('not.exist')
  })
})
