// backend/tests/newsletter.test.js
//
// The newsletter list (#1459).
//
// There was nothing to test before: three frontend handlers validated an
// address, waited, and claimed success without making a request. `grep -ri
// newsletter backend/ migrations/` returned nothing.
//
// Two properties carry most of the weight here and are easy to lose in a later
// edit, so both are asserted directly:
//
//   - subscribe answers identically whatever the address turns out to be, so
//     the form is not a membership oracle;
//   - only a `confirmed` row is ever mailed, so the list cannot be filled with
//     addresses whose owners never asked for anything.

jest.mock('../config/db', () => ({
    query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    getConnection: jest.fn()
}));

jest.mock('../config/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../services/notificationEmailService', () => ({
    sendNotificationEmail: jest.fn().mockResolvedValue({
        delivered: true,
        channel: 'smtp'
    })
}));

const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../config/logger');
const { sendNotificationEmail } = require('../services/notificationEmailService');
const newsletterService = require('../services/newsletterService');
const newsletterController = require('../controllers/newsletterController');

const EMAIL = 'reader@example.com';

const makeRes = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
});

/** The first statement matching a fragment, with its parameters. */
const statementMatching = (fragment) =>
    db.query.mock.calls.find(([sql]) =>
        String(sql).replace(/\s+/g, ' ').includes(fragment));

/** Everything the controller could be observed to say. */
const post = async (handler, body) => {
    const res = makeRes();
    await handler({ body, query: {}, ip: '203.0.113.7', user: null }, res);
    return { statusCode: res.statusCode, body: res.body };
};

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    sendNotificationEmail.mockResolvedValue({ delivered: true, channel: 'smtp' });
});

describe('address handling', () => {
    test('lowercases and trims, because the column is UNIQUE', async () => {
        // Without this, "A@x.com" and "a@x.com" are two rows and the mailer
        // sends to both.
        await newsletterService.subscribe({ email: '  READER@Example.COM  ' });

        expect(statementMatching('INSERT INTO newsletter_subscribers')[1][0])
            .toBe(EMAIL);
    });

    test.each([
        ['', 'empty'],
        ['   ', 'whitespace'],
        ['not-an-email', 'no @'],
        ['no@domain', 'no dot'],
        [null, 'null'],
        [undefined, 'undefined']
    ])('refuses %p (%s) without touching the database', async (value) => {
        const result = await newsletterService.subscribe({ email: value });

        expect(result.accepted).toBe(false);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('refuses an address longer than the column', async () => {
        const tooLong = `${'a'.repeat(250)}@example.com`;

        expect(tooLong.length).toBeGreaterThan(newsletterService.MAX_EMAIL_LENGTH);
        expect(newsletterService.normalizeEmail(tooLong)).toBeNull();
    });
});

describe('double opt-in', () => {
    test('a new address is stored pending, not subscribed', async () => {
        // A form anyone can type any address into is a form anyone can use to
        // sign somebody else up.
        await newsletterService.subscribe({ email: EMAIL });

        const insert = statementMatching('INSERT INTO newsletter_subscribers');
        expect(String(insert[0])).toContain("'pending'");
    });

    test('a new address is mailed a confirmation link', async () => {
        await newsletterService.subscribe({ email: EMAIL });

        expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
        const message = sendNotificationEmail.mock.calls[0][0];
        expect(message.to).toBe(EMAIL);
        expect(message.text).toContain('newsletter.html?action=confirm&token=');
    });

    test('an already-confirmed address is not mailed again', async () => {
        // Otherwise anyone could trigger repeated mail to a known subscriber by
        // resubmitting their address. mysql2 reports 0 affected rows when the
        // ON DUPLICATE KEY UPDATE changes nothing, which is that exact case.
        db.query.mockResolvedValue([{ affectedRows: 0 }]);

        const result = await newsletterService.subscribe({ email: EMAIL });

        expect(result.outcome).toBe('already_confirmed');
        expect(sendNotificationEmail).not.toHaveBeenCalled();
    });

    test('the confirmation token expires', async () => {
        await newsletterService.subscribe({ email: EMAIL });

        const params = statementMatching('INSERT INTO newsletter_subscribers')[1];
        const expiry = params[2];

        expect(expiry).toBeInstanceOf(Date);
        expect(expiry.getTime()).toBeGreaterThan(Date.now());
        expect(expiry.getTime())
            .toBeLessThanOrEqual(Date.now() + newsletterService.CONFIRM_TOKEN_TTL_MS + 1000);
    });

    test('records where and when consent was given', async () => {
        await newsletterService.subscribe({
            email: EMAIL,
            sourcePage: '/blog.html',
            ip: '203.0.113.7'
        });

        const params = statementMatching('INSERT INTO newsletter_subscribers')[1];
        expect(params).toContain('/blog.html');
        expect(params).toContain('203.0.113.7');
    });
});

describe('tokens', () => {
    test('only digests are stored, never the value in the link', async () => {
        // Both tokens are bearer credentials -- one for adding an address to
        // the list, one for removing it. A database dump should contain neither
        // in a replayable form.
        await newsletterService.subscribe({ email: EMAIL });

        const params = statementMatching('INSERT INTO newsletter_subscribers')[1];
        const confirmDigest = params[1];
        const unsubscribeDigest = params[3];

        for (const digest of [confirmDigest, unsubscribeDigest]) {
            expect(digest).toMatch(/^[0-9a-f]{64}$/);
        }

        // The raw token that went in the mail must not be the stored value.
        const link = sendNotificationEmail.mock.calls[0][0].text;
        const rawToken = link.match(/token=([0-9a-f]+)/)[1];
        expect(rawToken).not.toBe(confirmDigest);
        expect(newsletterService.hashToken(rawToken)).toBe(confirmDigest);
    });

    test('the two tokens are different', async () => {
        await newsletterService.subscribe({ email: EMAIL });

        const params = statementMatching('INSERT INTO newsletter_subscribers')[1];
        expect(params[1]).not.toBe(params[3]);
    });

    test('two sign-ups do not produce the same token', async () => {
        await newsletterService.subscribe({ email: EMAIL });
        const first = statementMatching('INSERT INTO newsletter_subscribers')[1][1];

        jest.clearAllMocks();
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await newsletterService.subscribe({ email: 'other@example.com' });
        const second = statementMatching('INSERT INTO newsletter_subscribers')[1][1];

        expect(first).not.toBe(second);
    });
});

describe('confirming', () => {
    test('looks the token up by digest, not by the value in the link', async () => {
        await newsletterService.confirm('abc123');

        const update = statementMatching('UPDATE newsletter_subscribers');
        expect(update[1][0])
            .toBe(crypto.createHash('sha256').update('abc123').digest('hex'));
    });

    test('only a pending, unexpired row can be confirmed', async () => {
        await newsletterService.confirm('abc123');

        const sql = String(statementMatching('UPDATE newsletter_subscribers')[0]);
        expect(sql).toMatch(/status\s*=\s*'pending'/);
        expect(sql).toMatch(/confirm_token_expires_at\s*>\s*NOW\(\)/);
    });

    test('clears the token so a link cannot be used twice', async () => {
        await newsletterService.confirm('abc123');

        expect(String(statementMatching('UPDATE newsletter_subscribers')[0]))
            .toMatch(/confirm_token\s*=\s*NULL/);
    });

    test('an unknown token is reported as invalid', async () => {
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[]]);

        const result = await newsletterService.confirm('nope');

        expect(result).toEqual({ confirmed: false, reason: 'invalid_token' });
    });

    test('a known but spent or expired token is told apart from an unknown one', async () => {
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[{ status: 'pending' }]]);

        const result = await newsletterService.confirm('stale');

        expect(result.reason).toBe('expired');
    });

    test('an empty token never reaches the database', async () => {
        const result = await newsletterService.confirm('');

        expect(result.confirmed).toBe(false);
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('unsubscribing', () => {
    test('keeps the row and marks it, rather than deleting it', async () => {
        // Deleting makes the address eligible to be re-added by anyone who
        // types it into the form, and loses the record that they asked not to
        // be mailed.
        await newsletterService.unsubscribe('abc123');

        const sql = String(statementMatching('newsletter_subscribers')[0]);
        expect(sql).toMatch(/UPDATE newsletter_subscribers/);
        expect(sql).toMatch(/status\s*=\s*'unsubscribed'/);
        expect(sql).not.toMatch(/DELETE FROM/i);
    });

    test('keeps the original unsubscribe timestamp when clicked twice', async () => {
        await newsletterService.unsubscribe('abc123');

        expect(String(statementMatching('newsletter_subscribers')[0]))
            .toMatch(/unsubscribed_at\s*=\s*COALESCE\(unsubscribed_at, NOW\(\)\)/);
    });

    test('an unknown token is reported as invalid', async () => {
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[]]);

        const result = await newsletterService.unsubscribe('nope');

        expect(result).toEqual({ unsubscribed: false, reason: 'invalid_token' });
    });

    test('clicking a second time still succeeds', async () => {
        // A link that errors the second time reads as "that did not work", and
        // the reasonable response to that is to click it again -- or to mark
        // the next mailing as spam.
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[{ id: 4 }]]);

        const result = await newsletterService.unsubscribe('already-used');

        expect(result.unsubscribed).toBe(true);
    });
});

describe('the mailing list', () => {
    test('is confirmed rows and nothing else', async () => {
        // The single definition of "on the list", so a future mailer cannot get
        // it wrong by writing its own WHERE clause.
        db.query.mockResolvedValue([[]]);

        await newsletterService.listConfirmed();

        const sql = String(db.query.mock.calls[0][0]);
        expect(sql).toMatch(/status\s*=\s*'confirmed'/);
        expect(sql).not.toMatch(/'pending'/);
        expect(sql).not.toMatch(/'unsubscribed'/);
    });
});

describe('POST /api/newsletter/subscribe says nothing about the address', () => {
    test('a new address and an already-subscribed one get identical replies', async () => {
        const fresh = await post(newsletterController.subscribe, { email: EMAIL });

        db.query.mockResolvedValue([{ affectedRows: 0 }]);
        const existing = await post(newsletterController.subscribe, { email: EMAIL });

        expect(fresh).toEqual(existing);
        expect(fresh.statusCode).toBe(200);
    });

    test('a malformed address gets the same reply too', async () => {
        const good = await post(newsletterController.subscribe, { email: EMAIL });
        const bad = await post(newsletterController.subscribe, { email: 'nope' });

        expect(bad).toEqual(good);
    });

    test('a database failure gets the same reply', async () => {
        // A 500 for a real address and a 200 for a malformed one is the same
        // oracle in a slower form.
        db.query.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));
        const broken = await post(newsletterController.subscribe, { email: EMAIL });

        db.query.mockResolvedValue([{ affectedRows: 1 }]);
        const fine = await post(newsletterController.subscribe, { email: EMAIL });

        expect(broken).toEqual(fine);
    });

    test('a missing body gets the same reply', async () => {
        const res = makeRes();
        await newsletterController.subscribe({ query: {}, ip: '1.1.1.1' }, res);

        expect({ statusCode: res.statusCode, body: res.body })
            .toEqual(await post(newsletterController.subscribe, { email: EMAIL }));
    });

    test('the copy is honest about the confirmation step', async () => {
        // The old frontend said "Thanks for subscribing!" over a request it had
        // never made. Nothing is subscribed until the link is followed.
        const { body } = await post(newsletterController.subscribe, { email: EMAIL });

        expect(body.message.toLowerCase()).toMatch(/confirm/);
        expect(body.message.toLowerCase()).not.toMatch(/thanks for subscribing/);
    });
});

describe('confirm and unsubscribe do report what happened', () => {
    // Unlike subscribe: the caller is holding a token that was mailed to the
    // address, so they have already shown they are entitled to know.

    test('a confirmed subscription is a 200', async () => {
        const { statusCode, body } = await post(
            newsletterController.confirm,
            { token: 'abc' }
        );

        expect(statusCode).toBe(200);
        expect(body.success).toBe(true);
    });

    test('an expired link is a 410, not a generic failure', async () => {
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[{ status: 'pending' }]]);

        const { statusCode, body } = await post(
            newsletterController.confirm,
            { token: 'stale' }
        );

        expect(statusCode).toBe(410);
        expect(body.message).toMatch(/expired|already been used/i);
    });

    test('an invalid confirm token is a 400', async () => {
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[]]);

        expect((await post(newsletterController.confirm, { token: 'nope' })).statusCode)
            .toBe(400);
    });

    test('an invalid unsubscribe token is a 400', async () => {
        db.query
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[]]);

        expect((await post(newsletterController.unsubscribe, { token: 'nope' })).statusCode)
            .toBe(400);
    });

    test('unsubscribing succeeds', async () => {
        const { statusCode, body } = await post(
            newsletterController.unsubscribe,
            { token: 'abc' }
        );

        expect(statusCode).toBe(200);
        expect(body.success).toBe(true);
    });
});

describe('mail delivery', () => {
    test('a send failure does not fail the sign-up', async () => {
        // The row is already recorded and the caller gets the same answer
        // either way; reporting a send failure would say "this address got as
        // far as the send", which only happens for addresses not on the list.
        sendNotificationEmail.mockRejectedValue(new Error('smtp down'));

        const result = await newsletterService.subscribe({ email: EMAIL });

        expect(result.accepted).toBe(true);
        expect(logger.error).toHaveBeenCalled();
    });

    test('an unconfigured SMTP is called out in the log', async () => {
        // notificationEmailService writes the message to the log instead. Worth
        // a line, so "the confirmation mail never arrives" does not turn into a
        // hunt through the newsletter code.
        sendNotificationEmail.mockResolvedValue({ delivered: false, channel: 'log' });

        await newsletterService.subscribe({ email: EMAIL });

        expect(logger.warn.mock.calls[0][0]).toMatch(/SMTP unconfigured/);
    });
});

describe('the migration', () => {
    const fs = require('fs');
    const path = require('path');

    const sql = fs.readFileSync(
        path.join(__dirname, '..', '..', 'migrations', '0044_newsletter_subscribers.sql'),
        'utf8'
    );

    test('one row per address', () => {
        expect(sql).toMatch(/UNIQUE KEY uniq_newsletter_email \(email\)/);
    });

    test('rows start pending', () => {
        expect(sql).toMatch(/DEFAULT 'pending'/);
    });

    test('indexes both token lookups, which are unauthenticated', () => {
        expect(sql).toMatch(/idx_newsletter_confirm_token/);
        expect(sql).toMatch(/idx_newsletter_unsubscribe_token/);
    });

    test('does not cascade the subscription away with the account', () => {
        // A subscription is to an address, not to an account. Closing an
        // account must not silently drop the address off the list.
        expect(sql).not.toMatch(/REFERENCES\s+users/i);
    });
});
