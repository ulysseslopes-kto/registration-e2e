/**
 * "Registration 2026"'s refer-a-friend handling (KIB-9238) — not in the
 * original test matrix (KIB-8932), same as `mixpanel-tracking.cy.ts` and
 * `login/{self-excluded,migratable}.cy.ts`.
 *
 * A materially different mechanism from the legacy flow covered in
 * `mocked/legacy/registration/refer-a-friend.cy.ts`, which reads
 * `?referrerCode=` off the URL and forwards it to `registration/v4`
 * synchronously, on every registration. Here:
 * - `AccountCreateRoute` (`apps/core/src/atomic-components/organisms/
 *   registration2026/AccountCreateRoute.js`) only shows a dedicated
 *   `ReferAFriendLanding` screen (`modules/registration`) when a
 *   `?referrerCode=` is present on `/registro/` *and* the `fe_igp_refer_a_friend`
 *   GrowthBook flag is on (`useIsReferAFriendEnabled`,
 *   `apps/core/src/hooks/useReferAFriend.js` — its `fe_igp_override_raf_unavailability`
 *   test-user bypass isn't covered here, since it depends on a logged-in
 *   user that doesn't exist pre-registration).
 * - The code is only ever captured if the user actually clicks through that
 *   screen's "Registre-se agora!" CTA (`continueFromReferAFriendLanding`),
 *   which calls `persistReferralToken` (`modules/registration/src/shared/
 *   utils/referral.ts`) to stash it in `sessionStorage` and strips
 *   `referrerCode` off the URL via `history.replaceState` before swapping
 *   into `AccountCreateFlow`. With the flag off, the code sits unused in the
 *   URL and is never persisted — a `?referrerCode=` on the link alone,
 *   without the flag, sends no `referralToken` at all (unlike the legacy
 *   flow, which forwards it regardless of any flag).
 * - The final `registration/v4` submit reads it back via `resolveReferralToken`
 *   (`buildRegistrationModel`, `account-create.utils.ts` →
 *   `referralToken: resolveReferralToken()`), decoded and stripped of a
 *   *leading* slash only (`LEADING_SLASH = /^\//`) — not the trailing slash
 *   the dedicated `/refer-a-friend/` landing page appends when redirecting
 *   into `/registro/` (`apps/core/src/templates/referAFriend/index.js`).
 *   That page also pre-sets the same `sessionStorage` key directly before
 *   redirecting, so following its actual redirect chain would race two
 *   different write paths — not exercised here, same rationale as the
 *   legacy spec: tested directly on `/registro/` with a clean code instead
 *   of chasing that page's env/locale-specific slug.
 */
describe('Registration 2026 — refer a friend', () => {
  const visitRegistration = (query = '') => {
    cy.acceptCookieBanner()
    cy.visit(`/registro/${query}`)
    cy.dismissCookieBannerIfVisible()
  }

  describe('referral landing screen', () => {
    it('shows when a ?referrerCode is present and fe_igp_refer_a_friend is on', () => {
      cy.stubGrowthbookFeatures({
        fe_igp_refer_a_friend: { defaultValue: true },
      })
      visitRegistration('?referrerCode=E2E-FRIEND-CODE')
      cy.get('.refer-a-friend-landing-frame', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.contains('Você foi indicado por um amigo').should('be.visible')
      cy.contains('Que bom ter você aqui! Registre-se e comece a diversão!').should(
        'be.visible',
      )
      cy.contains('Registre-se agora!').should('be.visible')
    })

    it('skips straight to the CPF step when fe_igp_refer_a_friend is off, even with a referral code', () => {
      cy.stubGrowthbookFeatures() // fe_igp_refer_a_friend absent -> off
      visitRegistration('?referrerCode=E2E-FRIEND-CODE')
      cy.get('input[inputmode="numeric"]', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.get('.refer-a-friend-landing-frame').should('not.exist')
    })

    it('skips straight to the CPF step when there is no referral code, even with the flag on', () => {
      cy.stubGrowthbookFeatures({
        fe_igp_refer_a_friend: { defaultValue: true },
      })
      visitRegistration()
      cy.get('input[inputmode="numeric"]', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.get('.refer-a-friend-landing-frame').should('not.exist')
    })
  })

  describe('continuing past the landing screen', () => {
    it('proceeds into the CPF step and strips referrerCode off the URL', () => {
      cy.stubGrowthbookFeatures({
        fe_igp_refer_a_friend: { defaultValue: true },
      })
      visitRegistration('?referrerCode=E2E-FRIEND-CODE')
      cy.get('.refer-a-friend-landing-frame', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.contains('Registre-se agora!').click()
      cy.get('input[inputmode="numeric"]', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.get('.refer-a-friend-landing-frame').should('not.exist')
      cy.location('search').should('not.include', 'referrerCode')
    })
  })

  describe('referral code carried into the registration payload', () => {
    beforeEach(() => {
      cy.stubCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
      cy.stubRegister()
    })

    it('is sent as registration/v4\'s referralToken once continued past the landing screen', () => {
      cy.stubGrowthbookFeatures({
        fe_igp_refer_a_friend: { defaultValue: true },
      })
      visitRegistration('?referrerCode=E2E-FRIEND-CODE')
      cy.get('.refer-a-friend-landing-frame', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.contains('Registre-se agora!').click()

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
        .should('have.property', 'referralToken', 'E2E-FRIEND-CODE')
    })

    it('is sent as registration/v4\'s referralToken on a desktop viewport too', () => {
      cy.viewport(1000, 660)
      cy.stubGrowthbookFeatures({
        fe_igp_refer_a_friend: { defaultValue: true },
      })
      visitRegistration('?referrerCode=E2E-FRIEND-CODE')
      cy.get('.refer-a-friend-landing-frame', { timeout: 10000 }).should(
        'be.visible',
      )
      cy.contains('Registre-se agora!').click()

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
        .should('have.property', 'referralToken', 'E2E-FRIEND-CODE')
    })

    it('is omitted when fe_igp_refer_a_friend is off, even with a referral code on the URL', () => {
      cy.stubGrowthbookFeatures() // fe_igp_refer_a_friend absent -> off, landing never shown, code never persisted
      visitRegistration('?referrerCode=E2E-FRIEND-CODE')

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
        .should('not.have.property', 'referralToken')
    })

    it('is omitted when there is no referral code at all', () => {
      cy.stubGrowthbookFeatures({
        fe_igp_refer_a_friend: { defaultValue: true },
      })
      visitRegistration()

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
        .should('not.have.property', 'referralToken')
    })
  })
})
