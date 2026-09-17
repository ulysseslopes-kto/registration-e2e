import './commands'
import './commands/api'
import {
  REGISTRATION_DROPDOWN_RESPONSE,
  REGISTER_COUNTRIES_RESPONSE,
  META_JSON_RESPONSE,
} from './fixtures'

// `cy.intercept()` only sees `fetch`/`XHR` — GA4 and other analytics SDKs
// send their "collect" beacons via `navigator.sendBeacon()` instead (it
// survives page unload, which a fetch doesn't), a browser API Cypress's
// network layer cannot intercept or stub at all. Cypress still *logs* the
// resulting request (it reports all traffic for the command log), which is
// why one can show up looking like a real, unmocked call even with a
// matching `cy.intercept()` already in place — the fix has to happen before
// that point, by making the call a no-op at the source.
//
// This has to stay a hostname allowlist-of-one-way, not a blanket no-op:
// `mixpanel-tracking.cy.ts` depends on mixpanel-browser's own real
// `sendBeacon` flush actually firing (see that file's header comment) so its
// own `cy.intercept('**/track/**')` can capture it — only the noisy
// third-party hosts below are silenced; every other destination still goes
// through natively.
const SEND_BEACON_BLOCKED_HOSTS = [
  'google-analytics.com',
  'googlesyndication.com',
  'doubleclick.net',
  'axeptio-api.goadopt.io',
  'disclaimer-api.goadopt.io',
  'ingest.sentry.io',
  'google.com',
  'googletagmanager.com',
]

Cypress.on('window:before:load', (win) => {
  if (Cypress.env('mode') === 'integrated') return
  const nativeSendBeacon = win.navigator.sendBeacon.bind(win.navigator)
  win.navigator.sendBeacon = (url, data) => {
    const target = url.toString()
    if (SEND_BEACON_BLOCKED_HOSTS.some((host) => target.includes(host))) {
      return true
    }
    return nativeSendBeacon(url, data)
  }
})

// `<script src="...">` loads (GTM's own container script among them) aren't
// caught by `cy.intercept()` the way `fetch`/`XHR` are, so the real
// googletagmanager.com/gtm.js still runs even with the stub below in place —
// and it can throw its own internal errors (e.g. a custom tag inside the
// container referencing an undefined global) that have nothing to do with
// the app or the spec under test. Cypress fails a test on any uncaught
// exception by default; only swallow the ones that actually originate from
// GTM's own script, so a real app bug still fails loudly.
Cypress.on('uncaught:exception', (err) => {
  if (err.stack?.includes('googletagmanager.com')) return false
})

beforeEach(() => {
  // Set the AdOpt "already-answered" cookie globally so the consent banner
  // never renders, regardless of which spec/command visits a page — see
  // `denyCookieBanner()` in commands.ts. Must run before `cy.visit()`.
  // Unlike everything else in this hook, this isn't a network stub — AdOpt's
  // own real script reads it — so it applies in both modes. Denied, not
  // accepted, is the suite-wide default here — a spec that specifically
  // needs the accepted state calls `cy.acceptCookieBanner()` itself to
  // override it.
  cy.denyCookieBanner()

  // CY_MODE=integrated is meant to hit real backend and third-party services
  // (see cypress.config.ts) — none of the intercepts below apply there, only
  // in `mocked`.
  if (Cypress.env('mode') === 'integrated') return

  cy.intercept('GET', '**/meta.json**', META_JSON_RESPONSE)
  cy.intercept('GET', '**cdn-smr.kto.bet.br/**', { statusCode: 204, body: '' })
  cy.intercept('GET', '**accounts.google.com/gsi/**', { statusCode: 204, body: '' })
  // Any method — same story as the kambicdn/shapegamescloud/offering.sbo
  // stubs below (`ctn-api.kambi.com/offering` included).
  cy.intercept('**ctn-api.kambi.com/**', { statusCode: 204, body: '' })
  // Any method, any path, any subdomain — Kambi's sportsbook widget CDN and
  // Shape Games' config/layout-discovery calls, same "irrelevant to what's
  // under test" story as ctn-api.kambi.com above.
  cy.intercept('**kambicdn.com/**', { statusCode: 200, body: {} })
  // Kambi's sportsbook offering API — same story as the two lines above.
  cy.intercept('**offering.sbo**', { statusCode: 200, body: {} })
  cy.intercept('**shapegamescloud.com/**', { statusCode: 200, body: {} })
  cy.intercept('**cms.kto.bet.br/**', { statusCode: 204, body: '' })
  // AdOpt's own script polls/reports to these on every page load to
  // revalidate consent against its backend and can decide to re-show the
  // banner even with `AdoptConsent` already set (see
  // `dismissCookieBannerIfVisible()` in commands.ts) — short-circuiting all
  // of them removes that source of flakiness entirely. Seen under both
  // GET and POST depending on the page, so both are stubbed here.
  cy.intercept('GET', '**disclaimer-api.goadopt.io/api/tag/get-consent-changes**', {
    statusCode: 204,
    body: '',
  })
  cy.intercept('POST', '**disclaimer-api.goadopt.io/api/tag/get-consent-changes**', {
    statusCode: 200,
    body: {},
  })
  cy.intercept('POST', '**disclaimer-api.goadopt.io/api/tag/get-consent**', {
    statusCode: 200,
    body: {},
  })
  // Any method, any path under the domain.
  cy.intercept('**axeptio-api.goadopt.io/**', {
    statusCode: 204,
    body: '',
  })
  // Cloudflare's bot-management challenge script and the analytics/ads
  // beacons below fire on every page load regardless of what's under test —
  // stubbed so no spec depends on a real third party being reachable.
  cy.intercept('POST', '**/cdn-cgi/challenge-platform/**', {
    statusCode: 200,
    body: {},
  })
  // Any method, any path under the domain — GA fires several beacon shapes
  // (`/g/collect`, `/r/collect`, `/collect`, ...) and none of them matter to
  // any spec here.
  cy.intercept('**google-analytics.com/**', { statusCode: 204, body: '' })
  // Any method, any path, any subdomain — same reasoning as the GA stub
  // above.
  cy.intercept('**googlesyndication.com/**', {
    statusCode: 200,
    body: {},
  })
  // Any method, any path under the domain — Google Ads' ad-serving/
  // remarketing pixel, same "irrelevant to what's under test" story.
  cy.intercept('**ad.doubleclick.net/**', { statusCode: 200, body: {} })
  // Any method, any path — the app's own Sentry error-reporting beacon.
  // Irrelevant to any spec here, and swallowing it keeps a test's own
  // assertion failure from being buried under unrelated Sentry noise.
  cy.intercept('**ingest.sentry.io/**', { statusCode: 200, body: {} })
  // Any method, any path — reCAPTCHA verification and other www.google.com
  // calls the page's own scripts fire, irrelevant to any spec here.
  cy.intercept('**www.google.com/**', { statusCode: 200, body: {} })
  // Any method, any path — GTM's own script/container fetch, same
  // "irrelevant to what's under test" story as the analytics beacons above.
  cy.intercept('**www.googletagmanager.com/**', { statusCode: 200, body: {} })
  // Any method, any path, any subdomain — Smartico's gamification/loyalty
  // widget script and its own real-time calls, irrelevant to what's under
  // test here (distinct from our own backend's `**/smartico/players/hash`
  // proxy endpoint, which `stubActiveSession()` already covers).
  cy.intercept('**smartico**', { statusCode: 200, body: {} })
  cy.intercept( 'GET', '**/country/registration-dropdown', REGISTRATION_DROPDOWN_RESPONSE)
  cy.intercept('GET', '**/country/register', REGISTER_COUNTRIES_RESPONSE)
  // The login screen's migratable-status check (`getMigrateableStatus`,
  // `/registration/user/is-migrateable`) fails against the real dev API
  // today (401, per the fake e2e credentials in `loginBeforeVisit`) —
  // stubbing the same status keeps that deterministic instead of depending
  // on the real backend's current reply.
  cy.intercept('POST', '**/registration/user/is-migrateable', {
    statusCode: 401,
    body: { message: 'Unauthorized' },
  })
  // `authProvider.js`'s `updateRequiredData()` — read by
  // `legalAcceptanceModal`, `resetPasswordModal`, `itemsThatNeedAttention`,
  // and `ELIGIBILITY.PHONE_EMAIL` (packages/user-verification-flow). A 200
  // with everything already accepted/verified means none of those decide
  // there's something pending and open their own modal on top of whatever
  // screen a spec is actually testing.
  cy.fixture('required-data.json').then((body) => {
    cy.intercept('GET', '**/user/required-data', body)
  })
  // `getTopEvents()` (packages/core-api/src/adapters/sportsbook/top-events.api.ts)
  // — a lobby "trending events" widget call, unwrapped (`hasNestedData: false`)
  // Spring Data page envelope. It `throw`s on a non-`ok` response, so leaving
  // it unstubbed risks an uncaught exception unrelated to whatever a spec is
  // actually testing; an empty page is a safe, valid "nothing trending" reply.
  cy.intercept('GET', '**/trends/top/events**', {
    content: [],
    pageable: {
      pageNumber: 0,
      pageSize: 10,
      sort: { sorted: false, unsorted: true, empty: true },
      offset: 0,
      unpaged: false,
      paged: true,
    },
    last: true,
    totalElements: 0,
    totalPages: 0,
    first: true,
    sort: { sorted: false, unsorted: true, empty: true },
    numberOfElements: 0,
    size: 10,
    number: 0,
    empty: true,
  })
  // `GET /bff/limit/active` — the active-limits check most logged-in pages
  // fire regardless of what's under test (already in `stubActiveSession()`
  // for specs that opt into it; global here too so a spec that doesn't call
  // that command still never hits the real backend for it).
  cy.intercept('GET', '**/bff/limit/active', { data: [] })
})
