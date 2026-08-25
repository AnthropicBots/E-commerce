// backend/tests/newsletterStatusPage.test.js
//
// The page at the end of a newsletter link (#1612), driven for real in jsdom.
//
// `newsletterService.confirm()` and the controller decide what happened;
// `frontend/scripts/newsletter-status.js` is where a subscriber actually finds
// out. The symptom of #1612 was not a wrong return value, it was this page
// telling somebody with a live subscription that their link was invalid -- so
// the outcomes are asserted here too, at the layer where a person reads them.
//
// The page is loaded whole and given a stand-in `AppUtils.apiRequest` that
// answers exactly what the controller answers for each outcome. Nothing is
// mocked below that; the real script parses the query string, chooses the
// action, makes the call and writes the DOM.
//
// One property worth stating plainly: `success` decides the tone, not the fact
// that the await returned. `apiRequest` resolves with `{ success: false }` on a
// non-2xx rather than rejecting, and a page that keyed off the promise settling
// would report every one of these as a success.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATUS_JS = path.join(REPO_ROOT, 'frontend', 'scripts', 'newsletter-status.js');
const NEWSLETTER_HTML = path.join(REPO_ROOT, 'frontend', 'newsletter.html');

const source = fs.readFileSync(STATUS_JS, 'utf8');

// The two elements the script writes into, lifted from the real page so a
// rename there fails this suite rather than silently skipping it.
const pageMarkup = fs.readFileSync(NEWSLETTER_HTML, 'utf8');

/**
 * Exactly what `newsletterController.confirm` returns for each outcome.
 *
 * Copied as literals rather than imported, deliberately: this suite is about
 * the contract between the two layers, and a shared constant would let both
 * sides drift together without a test noticing.
 */
const CONTROLLER_RESPONSES = Object.freeze({
    confirmed: {
        status: 200,
        body: { success: true, message: "You're subscribed. Thanks for signing up." }
    },
    already_confirmed: {
        status: 200,
        body: { success: true, message: "You're already subscribed — nothing more to do." }
    },
    already_unsubscribed: {
        status: 409,
        body: {
            success: false,
            message:
                'This address has unsubscribed. Sign up again if you would '
                + 'like to start receiving the newsletter.'
        }
    },
    expired: {
        status: 410,
        body: {
            success: false,
            message: 'That confirmation link has expired. Sign up again to get a new one.'
        }
    },
    invalid_token: {
        status: 400,
        body: { success: false, message: 'That confirmation link is not valid.' }
    }
});

const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Load the status page with a given query string and a canned API answer.
 *
 * @param {object} options
 * @param {string} options.search e.g. '?action=confirm&token=abc'
 * @param {object|null} options.response what apiRequest resolves with
 * @param {Error} [options.rejectWith] make apiRequest reject instead
 */
const mountStatusPage = async ({ search, response = null, rejectWith = null } = {}) => {
    const dom = new JSDOM(
        `<!doctype html><html><body>
            <h1 id="newsletter-status-heading">Newsletter</h1>
            <p id="newsletter-status-message"></p>
        </body></html>`,
        { url: `https://shop.example/newsletter.html${search}`, runScripts: 'outside-only' }
    );

    const { window } = dom;
    const requests = [];

    window.AppUtils = {
        apiRequest: async (url, options) => {
            requests.push({ url, options });
            if (rejectWith) throw rejectWith;
            return response;
        }
    };

    window.eval(source);
    await settle();

    const message = window.document.getElementById('newsletter-status-message');
    const heading = window.document.getElementById('newsletter-status-heading');

    return {
        window,
        requests,
        text: () => message.textContent,
        tone: () => message.className,
        heading: () => heading.textContent,
        title: () => window.document.title
    };
};

describe('the page the real markup provides', () => {
    it('has the two elements the script writes into', () => {
        expect(pageMarkup).toMatch(/id="newsletter-status-heading"/);
        expect(pageMarkup).toMatch(/id="newsletter-status-message"/);
    });

    it('loads the script with defer, which the script is written for', () => {
        // The script initialises against document.readyState rather than
        // registering a bare DOMContentLoaded listener, which is what makes
        // defer safe here.
        expect(pageMarkup).toMatch(/<script defer src="scripts\/newsletter-status\.js">/);
        expect(source).toMatch(/document\.readyState === "loading"/);
    });
});

describe('confirming', () => {
    it('reports a first confirmation as a success', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.confirmed.body
        });

        expect(page.text()).toBe("You're subscribed. Thanks for signing up.");
        expect(page.tone()).toBe('newsletter-status-success');
    });

    it('reports an already-confirmed link as a success, not an error', async () => {
        // This is #1612 at the layer a person sees. Before the fix the service
        // answered invalid_token here and this line read "That confirmation
        // link is not valid" for a live subscription.
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.already_confirmed.body
        });

        expect(page.text()).toMatch(/already subscribed/i);
        expect(page.tone()).toBe('newsletter-status-success');
        expect(page.text()).not.toMatch(/not valid|expired|went wrong/i);
    });

    it('reports an unsubscribed address as an error pointing back at the form', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.already_unsubscribed.body
        });

        expect(page.text()).toMatch(/sign up again/i);
        expect(page.tone()).toBe('newsletter-status-error');
    });

    it('reports an expired link without claiming it may have been used', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.expired.body
        });

        expect(page.text()).toMatch(/expired/i);
        expect(page.text()).not.toMatch(/already been used/i);
        expect(page.tone()).toBe('newsletter-status-error');
    });

    it('reports an unknown token as an error', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.invalid_token.body
        });

        expect(page.text()).toBe('That confirmation link is not valid.');
        expect(page.tone()).toBe('newsletter-status-error');
    });
});

describe('the request it makes', () => {
    it('POSTs the token rather than following the link as a GET', async () => {
        // A GET is followed by mail clients and security scanners that prefetch
        // links, which would confirm subscriptions nobody clicked -- the whole
        // point of the confirmation step.
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.confirmed.body
        });

        expect(page.requests).toHaveLength(1);
        expect(page.requests[0].url).toBe('/newsletter/confirm');
        expect(page.requests[0].options.method).toBe('POST');
        expect(JSON.parse(page.requests[0].options.body)).toEqual({ token: 'abc' });
    });

    it('routes an unsubscribe link to the unsubscribe endpoint', async () => {
        const page = await mountStatusPage({
            search: '?action=unsubscribe&token=xyz',
            response: { success: true, message: 'You have been unsubscribed.' }
        });

        expect(page.requests[0].url).toBe('/newsletter/unsubscribe');
        expect(page.heading()).toBe('Unsubscribe');
        expect(page.tone()).toBe('newsletter-status-success');
    });

    it('treats any other action as a confirm', async () => {
        const page = await mountStatusPage({
            search: '?action=something-else&token=abc',
            response: CONTROLLER_RESPONSES.confirmed.body
        });

        expect(page.requests[0].url).toBe('/newsletter/confirm');
        expect(page.heading()).toBe('Confirm your subscription');
    });

    it('does not call the API at all without a token', async () => {
        const page = await mountStatusPage({ search: '?action=confirm', response: null });

        expect(page.requests).toHaveLength(0);
        expect(page.text()).toMatch(/incomplete/i);
        expect(page.tone()).toBe('newsletter-status-error');
    });

    it('trims a token that arrived with whitespace around it', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=%20abc%20',
            response: CONTROLLER_RESPONSES.confirmed.body
        });

        expect(JSON.parse(page.requests[0].options.body)).toEqual({ token: 'abc' });
    });
});

describe('when the call itself fails', () => {
    it('says so rather than leaving the page blank', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            rejectWith: new Error('network down')
        });

        expect(page.text()).toMatch(/went wrong/i);
        expect(page.tone()).toBe('newsletter-status-error');
    });

    it('falls back to its own copy when the server sends none', async () => {
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: { success: false }
        });

        expect(page.text()).toMatch(/not one we recognise/i);
        expect(page.tone()).toBe('newsletter-status-error');
    });

    it('keys the tone off success, not off the promise settling', async () => {
        // apiRequest resolves with { success: false } on a non-2xx rather than
        // rejecting, so a page that keyed off the await returning would report
        // every failure above as a success.
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: { success: false, message: 'nope' }
        });

        expect(page.tone()).toBe('newsletter-status-error');
    });
});

describe('the page identifies itself', () => {
    it('titles itself for the action it is performing', async () => {
        const confirmPage = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: CONTROLLER_RESPONSES.confirmed.body
        });
        expect(confirmPage.title()).toMatch(/^Confirm your subscription \|/);

        const unsubscribePage = await mountStatusPage({
            search: '?action=unsubscribe&token=abc',
            response: { success: true, message: 'Done.' }
        });
        expect(unsubscribePage.title()).toMatch(/^Unsubscribe \|/);
    });

    it('writes the message as text, never as markup', async () => {
        // The message comes from the API, and a status line is not somewhere
        // anyone should have to reason about markup.
        const page = await mountStatusPage({
            search: '?action=confirm&token=abc',
            response: { success: true, message: '<img src=x onerror=alert(1)>' }
        });

        const node = page.window.document.getElementById('newsletter-status-message');
        expect(node.querySelector('img')).toBeNull();
        expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    });
});
