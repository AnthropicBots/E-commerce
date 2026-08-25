-- ============================================
-- A SPENT CONFIRMATION TOKEN IS STILL A KEY
-- ============================================
--
-- `newsletterService.confirm()` is written to tell a subscriber who follows the
-- link twice that they are already confirmed, rather than that their link is
-- broken. Its own comment says so:
--
--     Already-confirmed is not a failure from the subscriber's point of view --
--     clicking the link twice should not look broken.
--
-- The successful branch then destroys the value the second branch looks up
-- (#1612):
--
--     SET status = 'confirmed', confirm_token = NULL, ...
--      WHERE confirm_token = ? AND status = 'pending' ...
--
--     -- and, when that matched nothing:
--     SELECT status FROM newsletter_subscribers WHERE confirm_token = ?
--
-- After a successful confirmation no row carries that digest any more, so the
-- second click falls through to `invalid_token`. The already-confirmed arm is
-- unreachable: dead code guarding the exact case it was written for.
--
-- This is not a wording nit. Double-clicking a link in a mail client is
-- ordinary, and several mail security scanners follow links in a message before
-- the recipient ever sees it -- so the scanner spends the token and the human
-- is told their confirmation link is invalid for a subscription that is, in
-- fact, live. The natural response is to submit the form again, which (
-- correctly, by design) mails nothing to an already-confirmed address, so the
-- page stays broken from their point of view forever.
--
-- WHY NOT SIMPLY KEEP `confirm_token`
--
-- Because a consumed confirm token is a bearer credential for putting an
-- address on a mailing list. Leaving it live in the column that the confirm
-- UPDATE matches on means the only thing standing between a leaked link and a
-- re-confirmation is the `status = 'pending'` guard -- one clause, in one query,
-- forever. Moving the digest to a column that no write path ever matches on
-- makes it an audit key and nothing else: findable, not usable.
--
-- The same move happens on unsubscribe, which also clears `confirm_token`. A
-- confirmation link followed after unsubscribing can then be answered
-- truthfully instead of as an invalid link.
--
-- Nullable with no default: existing rows have no recorded spent token and
-- there is nothing to reconstruct one from. They keep answering `invalid_token`
-- for a second click, which is what they do today; every row confirmed from
-- here on answers correctly.

ALTER TABLE newsletter_subscribers
    ADD COLUMN spent_confirm_token CHAR(64) NULL
        COMMENT 'SHA-256 of a confirm token that has been consumed. Audit key only; no write path matches on it.'
        AFTER confirm_token_expires_at;

-- Both token lookups on this table are single-row fetches by an exact hash and
-- both are reachable unauthenticated, so neither may become a scan. Same
-- reasoning as idx_newsletter_confirm_token in 0044.
CREATE INDEX idx_newsletter_spent_confirm_token
    ON newsletter_subscribers (spent_confirm_token);
