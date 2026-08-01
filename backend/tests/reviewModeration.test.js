// backend/tests/reviewModeration.test.js
//
// Review engagement and moderation (#1349).
//
// The invariants worth pinning are the ones that were absent, plus the one
// that was actively broken:
//
//   * `is_approved` was never filtered on, so a rejected review still counted
//     toward the product's star rating;
//   * a helpful counter with no vote table can be voted up repeatedly;
//   * a report is an accusation, not a verdict, so crossing the threshold must
//     queue a review for a human rather than delete it;
//   * counters are recalculated from the vote table, not incremented, so one
//     that has drifted repairs itself.

jest.mock('../config/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../config/db');
const service = require('../services/reviewModerationService');
const {
    ReviewError,
    toPublicReview,
    SORT_OPTIONS,
    REPORT_REASONS,
    REPORT_FLAG_THRESHOLD
} = require('../services/reviewModerationService');

const AUTHOR = 'user-author';
const VOTER = 'user-voter';
const MODERATOR = 'user-admin';
const PRODUCT = 'prod-1';

function reviewRow(overrides = {}) {
    return {
        id: 7,
        product_id: PRODUCT,
        user_id: AUTHOR,
        user_name: 'Asha',
        rating: 5,
        title: 'Great',
        comment: 'Works well',
        images: null,
        is_verified: 1,
        helpful_count: 4,
        reported_count: 0,
        moderation_status: 'approved',
        created_at: '2026-01-01 00:00:00',
        ...overrides
    };
}

/**
 * A fake connection that records its statements, so tests can assert on what
 * ran and in what order rather than only on return values.
 */
function fakeConnection() {
    const statements = [];

    const connection = {
        statements,
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
        query: jest.fn(async (sql) => {
            statements.push(sql);

            if (/FOR UPDATE/i.test(sql)) {
                return [connection.__review ? [connection.__review] : []];
            }
            if (/SELECT id FROM review_votes/i.test(sql)) {
                return [connection.__existingVote ? [{ id: 1 }] : []];
            }
            if (/COUNT\(\*\) AS total\s+FROM review_votes/i.test(sql)) {
                return [[{ total: connection.__voteTotal ?? 1 }]];
            }
            if (/AVG\(rating\)/i.test(sql)) {
                return [[{ average_rating: 4.5, review_count: 2 }]];
            }
            return [{ affectedRows: 1 }];
        })
    };

    return connection;
}

function ran(connection, pattern) {
    return connection.statements.filter((sql) => pattern.test(sql));
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
});

// ---------------------------------------------------------------------------
// The defect that started this: is_approved was inert
// ---------------------------------------------------------------------------

describe('product rating aggregation', () => {
    // This is the whole point. The previous query had no status filter, so a
    // review a moderator rejected still contributed its stars.
    it('averages only approved, undeleted reviews', async () => {
        db.query.mockResolvedValueOnce([[{ average_rating: 4.5, review_count: 2 }]]);
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await service.refreshProductStats(PRODUCT);

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/moderation_status = 'approved'/);
        expect(sql).toMatch(/deleted_at IS NULL/);
    });

    it('writes the recomputed average back to the product', async () => {
        db.query.mockResolvedValueOnce([[{ average_rating: 4.5, review_count: 2 }]]);
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        const stats = await service.refreshProductStats(PRODUCT);

        expect(stats).toEqual({ averageRating: 4.5, reviewCount: 2 });
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining('UPDATE products SET rating = ?'),
            [4.5, 2, PRODUCT]
        );
    });

    it('reports zero rather than NaN for a product with no approved reviews', async () => {
        db.query.mockResolvedValueOnce([[{ average_rating: 0, review_count: 0 }]]);
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        const stats = await service.refreshProductStats(PRODUCT);

        expect(stats).toEqual({ averageRating: 0, reviewCount: 0 });
    });
});

// ---------------------------------------------------------------------------
// Public listing
// ---------------------------------------------------------------------------

describe('listProductReviews', () => {
    it('shows only approved, undeleted reviews', async () => {
        db.query.mockResolvedValueOnce([[reviewRow()]]);
        db.query.mockResolvedValueOnce([[{ total: 1 }]]);

        await service.listProductReviews(PRODUCT);

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/moderation_status = 'approved'/);
        expect(sql).toMatch(/r\.deleted_at IS NULL/);
    });

    it('paginates instead of returning every review at once', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 95 }]]);

        const result = await service.listProductReviews(PRODUCT, { page: 3, limit: 10 });

        expect(db.query.mock.calls[0][1]).toEqual([PRODUCT, 10, 20]);
        expect(result.pagination).toEqual({ page: 3, limit: 10, total: 95, pages: 10 });
    });

    it('clamps an absurd page size', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 0 }]]);

        const result = await service.listProductReviews(PRODUCT, { limit: 10000 });

        expect(result.pagination.limit).toBe(50);
    });

    it.each(Object.keys(SORT_OPTIONS))('supports sort=%s', async (sort) => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 0 }]]);

        const result = await service.listProductReviews(PRODUCT, { sort });

        expect(result.sort).toBe(sort);
        expect(db.query.mock.calls[0][0]).toContain(SORT_OPTIONS[sort]);
    });

    // The ORDER BY fragment lands directly in SQL. This repo has already had
    // one injection through exactly this shape (#1085).
    it('falls back to newest for an unrecognised sort rather than interpolating it', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 0 }]]);

        const result = await service.listProductReviews(PRODUCT, {
            sort: 'rating; DROP TABLE reviews'
        });

        expect(result.sort).toBe('newest');
        expect(db.query.mock.calls[0][0]).not.toContain('DROP TABLE');
    });

    it('does not query the vote table for an anonymous viewer', async () => {
        db.query.mockResolvedValueOnce([[reviewRow()]]);
        db.query.mockResolvedValueOnce([[{ total: 1 }]]);

        const result = await service.listProductReviews(PRODUCT);

        expect(result.reviews[0].viewerHasVotedHelpful).toBe(false);
        expect(
            db.query.mock.calls.filter(([sql]) => /FROM review_votes/.test(sql))
        ).toHaveLength(0);
    });

    // One query for the whole page, not one per review.
    it('resolves viewer votes for the whole page in a single query', async () => {
        db.query.mockResolvedValueOnce([[reviewRow({ id: 7 }), reviewRow({ id: 8 })]]);
        db.query.mockResolvedValueOnce([[{ total: 2 }]]);
        db.query.mockResolvedValueOnce([[{ review_id: 7, vote_type: 'helpful' }]]);

        const result = await service.listProductReviews(PRODUCT, { viewerId: VOTER });

        const voteQueries = db.query.mock.calls.filter(([sql]) =>
            /FROM review_votes/.test(sql)
        );

        expect(voteQueries).toHaveLength(1);
        expect(result.reviews[0].viewerHasVotedHelpful).toBe(true);
        expect(result.reviews[1].viewerHasVotedHelpful).toBe(false);
    });
});

describe('toPublicReview', () => {
    it('parses a JSON images column', () => {
        const review = toPublicReview(reviewRow({ images: '["https://a/1.jpg"]' }));
        expect(review.images).toEqual(['https://a/1.jpg']);
    });

    // A broken images column must not fail the whole review list.
    it('degrades a malformed images column to an empty list', () => {
        expect(toPublicReview(reviewRow({ images: '{not json' })).images).toEqual([]);
    });

    it('exposes verification as a boolean, not MySQL\'s TINYINT', () => {
        expect(toPublicReview(reviewRow({ is_verified: 0 })).isVerified).toBe(false);
        expect(toPublicReview(reviewRow({ is_verified: 1 })).isVerified).toBe(true);
    });
});

describe('getRatingBreakdown', () => {
    // "4.2 from a hundred reviews" and "4.2 from two" are the same number and
    // very different information.
    it('returns all five buckets even when only some have votes', async () => {
        db.query.mockResolvedValueOnce([
            [
                { rating: 5, count: 3 },
                { rating: 4, count: 1 }
            ]
        ]);
        db.query.mockResolvedValueOnce([[{ total: 4 }]]);

        const breakdown = await service.getRatingBreakdown(PRODUCT);

        expect(breakdown.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 3 });
        expect(breakdown.total).toBe(4);
        expect(breakdown.average).toBe(4.75);
    });

    it('reports zero for a product with no reviews', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 0 }]]);

        const breakdown = await service.getRatingBreakdown(PRODUCT);

        expect(breakdown.average).toBe(0);
        expect(breakdown.total).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Helpful votes
// ---------------------------------------------------------------------------

describe('voteHelpful', () => {
    it('records a vote and recounts the cached counter', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = 5;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.voteHelpful(VOTER, 7);

        expect(result).toEqual({ reviewId: 7, helpfulCount: 5, alreadyVoted: false });
        expect(ran(connection, /INSERT INTO review_votes/)).toHaveLength(1);
        expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    // A bare counter can be voted up a hundred times by one shopper. The vote
    // table is what makes this idempotent.
    it('is idempotent for a repeat vote', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__existingVote = true;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.voteHelpful(VOTER, 7);

        expect(result.alreadyVoted).toBe(true);
        expect(ran(connection, /INSERT INTO review_votes/)).toHaveLength(0);
        expect(connection.commit).not.toHaveBeenCalled();
    });

    // Recalculated, not incremented: `count = count + 1` is only correct if it
    // has been correct every time before.
    it('recalculates from the vote table rather than incrementing', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = 12;
        db.getConnection.mockResolvedValue(connection);

        await service.voteHelpful(VOTER, 7);

        expect(ran(connection, /helpful_count = helpful_count \+ 1/)).toHaveLength(0);
        expect(ran(connection, /SET helpful_count = \?/)).toHaveLength(1);
    });

    it('takes a row lock so concurrent votes cannot both write the same total', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.voteHelpful(VOTER, 7);

        expect(ran(connection, /FOR UPDATE/)).toHaveLength(1);
    });

    it('refuses a vote on your own review', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow({ user_id: VOTER });
        db.getConnection.mockResolvedValue(connection);

        await expect(service.voteHelpful(VOTER, 7)).rejects.toMatchObject({
            status: 409,
            code: 'SELF_VOTE'
        });
    });

    it('requires a signed-in voter', async () => {
        await expect(service.voteHelpful(null, 7)).rejects.toThrow(ReviewError);
    });

    it('reports an unknown review as not found', async () => {
        const connection = fakeConnection();
        connection.__review = null;
        db.getConnection.mockResolvedValue(connection);

        await expect(service.voteHelpful(VOTER, 999)).rejects.toMatchObject({
            status: 404,
            code: 'REVIEW_NOT_FOUND'
        });
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });
});

describe('unvoteHelpful', () => {
    it('removes the vote and recounts', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = 3;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.unvoteHelpful(VOTER, 7);

        expect(result.helpfulCount).toBe(3);
        expect(ran(connection, /DELETE FROM review_votes/)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

describe('reportReview', () => {
    it('records a report with its reason', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = 1;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.reportReview(VOTER, 7, { reason: 'spam' });

        expect(result.alreadyReported).toBe(false);
        expect(ran(connection, /INSERT INTO review_votes/)).toHaveLength(1);
    });

    it('coerces an unrecognised reason to "other" rather than storing it', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.reportReview(VOTER, 7, { reason: 'nonsense' });

        const insert = connection.query.mock.calls.find(([sql]) =>
            /INSERT INTO review_votes/.test(sql)
        );

        expect(insert[1]).toContain('other');
    });

    it('is idempotent for a repeat report', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__existingVote = true;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.reportReview(VOTER, 7, { reason: 'spam' });

        expect(result.alreadyReported).toBe(true);
        expect(ran(connection, /INSERT INTO review_votes/)).toHaveLength(0);
    });

    it('refuses a report on your own review', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow({ user_id: VOTER });
        db.getConnection.mockResolvedValue(connection);

        await expect(service.reportReview(VOTER, 7, {})).rejects.toMatchObject({
            code: 'SELF_REPORT'
        });
    });

    // A report is an accusation, not a verdict. One shopper must not be able
    // to hide a review they disagree with.
    it('leaves a review visible below the threshold', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = REPORT_FLAG_THRESHOLD - 1;
        db.getConnection.mockResolvedValue(connection);

        await service.reportReview(VOTER, 7, { reason: 'spam' });

        expect(ran(connection, /moderation_status = 'pending'/)).toHaveLength(0);
    });

    // ...and queues it for a human once enough people agree, rather than
    // deleting it.
    it('queues a review for moderation at the threshold', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = REPORT_FLAG_THRESHOLD;
        db.getConnection.mockResolvedValue(connection);

        await service.reportReview(VOTER, 7, { reason: 'spam' });

        expect(ran(connection, /moderation_status = 'pending'/)).toHaveLength(1);
        expect(ran(connection, /DELETE FROM reviews/)).toHaveLength(0);
    });

    // Hiding a review changes the product's rating.
    it('refreshes the product rating when a review is auto-queued', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        connection.__voteTotal = REPORT_FLAG_THRESHOLD;
        db.getConnection.mockResolvedValue(connection);

        await service.reportReview(VOTER, 7, { reason: 'spam' });

        expect(ran(connection, /UPDATE products SET rating/)).toHaveLength(1);
    });

    it('does not re-queue a review that is already pending', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow({ moderation_status: 'pending' });
        connection.__voteTotal = REPORT_FLAG_THRESHOLD + 5;
        db.getConnection.mockResolvedValue(connection);

        await service.reportReview(VOTER, 7, { reason: 'spam' });

        expect(ran(connection, /moderation_status = 'pending'/)).toHaveLength(0);
    });

    it('offers a fixed set of reasons', () => {
        expect(REPORT_REASONS).toContain('spam');
        expect(REPORT_REASONS).toContain('other');
    });
});

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

describe('moderateReview', () => {
    it.each(['approved', 'pending', 'rejected'])('accepts status=%s', async (status) => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        const result = await service.moderateReview(MODERATOR, 7, { status });

        expect(result.status).toBe(status);
        expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown status', async () => {
        await expect(
            service.moderateReview(MODERATOR, 7, { status: 'banished' })
        ).rejects.toMatchObject({ status: 400, code: 'INVALID_STATUS' });
    });

    // The legacy boolean must not fall out of step with the status, or a
    // reader that has not been updated shows the wrong thing.
    it('keeps is_approved in step with the status', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.moderateReview(MODERATOR, 7, { status: 'rejected' });

        const update = connection.query.mock.calls.find(([sql]) =>
            /SET moderation_status = \?/.test(sql)
        );

        expect(update[1][0]).toBe('rejected');
        expect(update[1][1]).toBe(0);
    });

    it('records who decided and when', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.moderateReview(MODERATOR, 7, { status: 'rejected', notes: 'Spam' });

        const update = connection.query.mock.calls.find(([sql]) =>
            /moderated_by = \?/.test(sql)
        );

        expect(update[0]).toMatch(/moderated_at = NOW\(\)/);
        expect(update[1]).toContain(MODERATOR);
        expect(update[1]).toContain('Spam');
    });

    // The defect this whole change started from.
    it('refreshes the product rating so a rejected review stops counting', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.moderateReview(MODERATOR, 7, { status: 'rejected' });

        expect(ran(connection, /UPDATE products SET rating/)).toHaveLength(1);
    });
});

describe('softDeleteReview', () => {
    // deleted_at/deleted_by were in the schema and ignored; removal was a hard
    // DELETE that left no record of who removed what, or why.
    it('marks the row deleted instead of removing it', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.softDeleteReview(MODERATOR, 7, 'Abusive');

        expect(ran(connection, /DELETE FROM reviews/)).toHaveLength(0);
        expect(ran(connection, /deleted_at = NOW\(\)/)).toHaveLength(1);
    });

    it('records the moderator and the reason', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.softDeleteReview(MODERATOR, 7, 'Abusive');

        const update = connection.query.mock.calls.find(([sql]) =>
            /deleted_by = \?/.test(sql)
        );

        expect(update[1]).toContain(MODERATOR);
        expect(update[1]).toContain('Abusive');
    });

    it('refreshes the product rating', async () => {
        const connection = fakeConnection();
        connection.__review = reviewRow();
        db.getConnection.mockResolvedValue(connection);

        await service.softDeleteReview(MODERATOR, 7, 'Abusive');

        expect(ran(connection, /UPDATE products SET rating/)).toHaveLength(1);
    });
});

describe('getModerationQueue', () => {
    it('defaults to pending and orders most-reported first', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ moderation_status: 'pending', total: 4 }]]);

        const queue = await service.getModerationQueue();

        expect(db.query.mock.calls[0][1][0]).toBe('pending');
        expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY r\.reported_count DESC/);
        expect(queue.counts.pending).toBe(4);
    });

    it('coerces an unknown status rather than passing it through', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[]]);

        await service.getModerationQueue({ status: "'; DROP TABLE reviews; --" });

        expect(db.query.mock.calls[0][1][0]).toBe('pending');
    });

    it('reports a count for every status, including ones with no rows', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ moderation_status: 'pending', total: 2 }]]);

        const queue = await service.getModerationQueue();

        expect(queue.counts).toEqual({ approved: 0, pending: 2, rejected: 0 });
    });
});

describe('getReviewReports', () => {
    it('returns the reports behind the count', async () => {
        db.query.mockResolvedValueOnce([
            [
                {
                    id: 1,
                    user_id: VOTER,
                    user_name: 'Ravi',
                    reason: 'spam',
                    details: 'link farm',
                    created_at: '2026-01-02'
                }
            ]
        ]);

        const reports = await service.getReviewReports(7);

        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({ reason: 'spam', details: 'link farm' });
    });

    it('does not break on a report whose author has been deleted', async () => {
        db.query.mockResolvedValueOnce([
            [{ id: 1, user_id: VOTER, user_name: null, reason: null, details: null }]
        ]);

        const [report] = await service.getReviewReports(7);

        expect(report.userName).toBe('Unknown');
        expect(report.reason).toBe('other');
    });
});
