/**
 * Coupon/promo code on the account-create CPF step (KIB-9237,
 * `modules/registration/src/features/account-create/steps/cpf-step/cpf-step.tsx`).
 * A collapsible field (`couponExpanded` state) below the CPF input — toggled
 * via `.cpf-coupon-toggle`, its input wrapped in
 * `[data-testid="cpf-coupon-input"]` and hidden behind `aria-hidden` while
 * collapsed. Purely optional: `canProceed` only checks `cpfValid` and the
 * four consents (`cpf-step.tsx`), so the field plays no part in the CPF
 * step's own validity.
 *
 * The value itself isn't sent at the CPF-check step — it's carried in
 * `AccountCreateValues.couponCode` all the way to the final submit, where
 * `buildRegistrationModel` (`account-create.utils.ts`) turns it into the
 * payload's `affiliateMarker` (`values.couponCode.trim().slice(0, 50) ||
 * undefined`, so an empty field sends no property at all — contrast with
 * the legacy flow's own coupon field, whose equivalent
 * `getValues('couponCode')?.slice(0, 50)` sends `''`, not omitted). Same
 * field name on the wire as legacy's `registerModel.js`, just relocated to
 * the CPF step and given its own collapsible UI instead of the legacy
 * step's always-visible one — see
 * cypress/e2e/mocked/legacy/registration/coupon-code.cy.ts for that side.
 */
describe('Account create — coupon code (CPF step)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.stubValidateToken()
    cy.stubRegister()
    cy.startRegistration()
  })

  it('the coupon field starts collapsed and expands on click, without affecting Próximo', () => {
    cy.get('[data-testid="cpf-coupon-input"]').should(
      'have.attr',
      'aria-hidden',
      'true',
    )
    cy.get('.cpf-coupon-toggle').click()
    cy.get('[data-testid="cpf-coupon-input"]').should(
      'have.attr',
      'aria-hidden',
      'false',
    )
    // Purely a UI toggle — doesn't touch the CPF/consent validity that
    // actually gates the button.
    cy.get('.step-primary-button').should('be.disabled')
  })

  it('typing a coupon code still advances the CPF step normally — it plays no part in the CPF check itself', () => {
    cy.fillCpfStep('52998224725', { couponCode: 'E2ECODE' })
    cy.wait('@cpfCheck')
    cy.get('input[type="password"]').should('be.visible')
  })

  it('a coupon code typed on the CPF step reaches registration/v4 as affiliateMarker', () => {
    cy.fillCpfStep('52998224725', { couponCode: 'E2ECODE' })
    cy.wait('@cpfCheck')

    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')
    cy.fillOtp()
    cy.wait('@validateToken')

    cy.wait('@register')
      .its('request.body')
      .should('have.property', 'affiliateMarker', 'E2ECODE')
  })

  it('a coupon code outside 4-8 characters shows the format error without blocking Próximo (isCouponCodeValid, cpf-step.utils.ts)', () => {
    cy.get('input[inputmode="numeric"]').type('52998224725').should('not.have.value', '')
    cy.get('input[type="checkbox"]').first().check({ force: true }).should('be.checked')
    cy.get('.step-primary-button').should('not.be.disabled')

    cy.get('.cpf-coupon-toggle').click()
    cy.get('[data-testid="cpf-coupon-input"] input').type('AB').blur()
    cy.contains(
      'O código promocional deve ter entre 4 e 8 caracteres.',
    ).should('be.visible')
    cy.get('.step-primary-button').should('not.be.disabled')

    cy.get('[data-testid="cpf-coupon-input"] input').clear().type('E2ECODE').blur()
    cy.contains(
      'O código promocional deve ter entre 4 e 8 caracteres.',
    ).should('not.exist')
  })

  it('no coupon code on the CPF step sends no affiliateMarker', () => {
    cy.fillCpfStep()
    cy.wait('@cpfCheck')

    cy.fillPasswordStep()
    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')
    cy.fillOtp()
    cy.wait('@validateToken')

    cy.wait('@register')
      .its('request.body')
      .should('not.have.property', 'affiliateMarker')
  })
})
