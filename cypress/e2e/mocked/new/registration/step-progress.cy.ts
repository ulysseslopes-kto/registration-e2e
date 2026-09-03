/**
 * Step-progress bar (`.auth-step-progress`, `@repo/ui`'s `StepProgressBar`) —
 * not part of the official "Matriz de Testes". Rendered by every account-create
 * step (account-create.hook.tsx `progress` memo) with two groups: the
 * "registration-phase" track (`completedSteps: index + 1` out of the flow's
 * total step count) and a static "activation-phase" track
 * (`completedSteps: 0` of 1) that never moves during this flow. Each track is
 * a `role="progressbar"` with `aria-valuenow` set to the rounded percentage —
 * that's what's asserted here, since the raw completed/total counts
 * themselves aren't in the DOM.
 */
describe('Account create — step progress bar', () => {
  const registrationTrack = () =>
    cy.get('.auth-step-progress [role="progressbar"]').eq(0)
  const activationTrack = () =>
    cy.get('.auth-step-progress [role="progressbar"]').eq(1)

  it('a 3-step flow (CPF, password, e-mail verification) advances 33% → 67% → 100%', () => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck() // mobilePrefixAndNumberRequired: false — no phone step
    cy.startRegistration()

    registrationTrack().should('have.attr', 'aria-valuenow', '33')
    activationTrack().should('have.attr', 'aria-valuenow', '0')

    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    registrationTrack().should('have.attr', 'aria-valuenow', '67')

    cy.fillPasswordStep()
    // Now on the e-mail verification step's "method" sub-view — still the
    // same flow step, so the bar shouldn't have moved again.
    registrationTrack().should('have.attr', 'aria-valuenow', '100')
    activationTrack().should('have.attr', 'aria-valuenow', '0')
  })

  it('a 4-step flow (CPF, password, e-mail verification, phone) advances 33% → 50% → 75% → 100%', () => {
    cy.stubGrowthbookFeatures() // default post-password order: email_verification, then phone
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.stubValidateToken()
    cy.startRegistration()

    // The phone step only joins the flow once the CPF check resolves and
    // reports `mobilePrefixAndNumberRequired` — until then the flow doesn't
    // know about it yet, so this still reads as a 3-step flow (1/3 = 33%).
    registrationTrack().should('have.attr', 'aria-valuenow', '33')

    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    // Now on the password step, with the phone step counted in: 2/4.
    registrationTrack().should('have.attr', 'aria-valuenow', '50')

    cy.fillPasswordStep()
    registrationTrack().should('have.attr', 'aria-valuenow', '75')

    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@sendToken')
    cy.fillOtp()
    cy.wait('@validateToken')
    registrationTrack().should('have.attr', 'aria-valuenow', '100')
  })

  it('the back button moves the bar backward by exactly one step', () => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    registrationTrack().should('have.attr', 'aria-valuenow', '67')

    cy.get('.auth-shell-back-button').click()
    registrationTrack().should('have.attr', 'aria-valuenow', '33')
  })

  it("the aria-label reports the group id and the same percentage as aria-valuenow", () => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    registrationTrack().should(
      'have.attr',
      'aria-label',
      'Group registration-phase: 33%',
    )
    activationTrack().should(
      'have.attr',
      'aria-label',
      'Group activation-phase: 0%',
    )
  })
})
