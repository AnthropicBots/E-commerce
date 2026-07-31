// backend/tests/productQA.test.js
//
// Product Q&A (#1353).
//
// The properties worth pinning:
//
//   * asking has NO purchase check -- that asymmetry with reviews is the whole
//     feature, and a well-meaning future change could easily "fix" it;
//   * an answerer's standing is resolved server-side and stored, so a client
//     cannot claim to be a verified owner and a later refund cannot rewrite
//     what was true when they answered;
//   * answers rank by standing before votes, so a confident guess does not
//     outrank someone holding the product;
//   * a page of questions costs one query for answers and one for votes, not
//     one per question.

jest.mock('../config/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../config/db');
const service = require('../services/productQAService');
const {
    QAError,
    AUTHOR_RANK,
    REPORT_REASONS,
    REPORT_FLAG_THRESHOLD,
    MIN_QUESTION_LENGTH,
    MAX_QUESTION_LENGTH
} = require('../services/productQAService');

const PRODUCT = 'prod-1';
const ASKER = 'user-asker';
const ANSWERER = 'user-answerer';
const ADMIN = 'user-admin';

const GOOD_QUESTION = 'Does this fit a 15-inch laptop?';

function questionRow(overrides = {}) {
    return {
        id: 'q-1',
        product_id: PRODUCT,
        user_id: ASKER,
        user_name: 'Asha',
        body: GOOD_QUESTION,
        answer_count: 2,
        helpful_count: 5,
        status: 'approved',
        created_at: '2026-03-01 09:00:00',
        ...overrides
    };
}

function answerRow(overrides = {}) {
    return {
        id: 'a-1',
        question_id: 'q-1',
        user_id: ANSWERER,
        user_name: 'Ravi',
        body: 'Yes, mine holds a 15-inch easily.',
        author_type: 'owner',
        helpful_count: 3,
        status: 'approved',
        created_at: '2026-03-01 10:00:00',
        ...overrides
    };
}

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
                return [connection.__locked ? [connection.__locked] : []];
            }
            if (/FROM orders o/i.test(sql)) {
                return [connection.__hasPurchase ? [{ id: 'order-1' }] : []];
            }
            if (/SELECT id FROM product_qa_votes/i.test(sql)) {
                return [connection.__existingVote ? [{ id: 1 }] : []];
            }
            if (/COUNT\(\*\) AS total\s+FROM product_qa_votes/i.test(sql)) {
                return [[{ total: connection.__voteTotal ?? 1 }]];
            }
            if (/COUNT\(\*\) AS total\s+FROM product_answers/i.test(sql)) {
                return [[{ total: connection.__answerTotal ?? 1 }]];
            }
            if (/SELECT question_id FROM product_answers/i.test(sql)) {
                return [[{ question_id: 'q-1' }]];
            }
            return [{ affectedRows: connection.__affected ?? 1 }];
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
// Asking — the asymmetry with reviews is the whole point
// ---------------------------------------------------------------------------

describe('askQuestion', () => {
    // If this test ever fails because somebody added a purchase check "for
    // consistency with reviews", the feature is gone: the asker has not bought
    // yet, and that is precisely who this is for.
    it('does not require a purchase', async () => {
        db.query.mockResolvedValueOnce([[{ id: PRODUCT }]]); // product exists
        db.query.mockResolvedValueOnce([{ insertId: 1 }]); // insert
        db.query.mockResolvedValueOnce([[questionRow()]]); // read back

        await service.askQuestion(ASKER, PRODUCT, GOOD_QUESTION);

        const purchaseChecks = db.query.mock.calls.filter(([sql]) =>
            /FROM orders/.test(sql)
        );

        expect(purchaseChecks).toHaveLength(0);
    });

    it('stores the question and returns it', async () => {
        db.query.mockResolvedValueOnce([[{ id: PRODUCT }]]);
        db.query.mockResolvedValueOnce([{ insertId: 1 }]);
        db.query.mockResolvedValueOnce([[questionRow()]]);

        const question = await service.askQuestion(ASKER, PRODUCT, GOOD_QUESTION);

        expect(question.body).toBe(GOOD_QUESTION);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO product_questions'),
            expect.arrayContaining([PRODUCT, ASKER, GOOD_QUESTION])
        );
    });

    it('requires a signed-in asker', async () => {
        await expect(service.askQuestion(null, PRODUCT, GOOD_QUESTION)).rejects.toThrow(
            QAError
        );
    });

    // "?" and "hi" are not questions, and a page of them is worse than an
    // empty section.
    it('rejects a question that is too short to be one', async () => {
        await expect(service.askQuestion(ASKER, PRODUCT, 'hi?')).rejects.toMatchObject({
            code: 'QUESTION_TOO_SHORT'
        });
    });

    it('rejects a question longer than the column', async () => {
        await expect(
            service.askQuestion(ASKER, PRODUCT, 'x'.repeat(MAX_QUESTION_LENGTH + 1))
        ).rejects.toMatchObject({ code: 'QUESTION_TOO_LONG' });
    });

    it('rejects a question about a product that does not exist', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await expect(
            service.askQuestion(ASKER, 'ghost', GOOD_QUESTION)
        ).rejects.toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    });

    it('accepts a question exactly at the minimum length', async () => {
        db.query.mockResolvedValueOnce([[{ id: PRODUCT }]]);
        db.query.mockResolvedValueOnce([{ insertId: 1 }]);
        db.query.mockResolvedValueOnce([[questionRow()]]);

        await expect(
            service.askQuestion(ASKER, PRODUCT, 'x'.repeat(MIN_QUESTION_LENGTH))
        ).resolves.toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// Answering and author standing
// ---------------------------------------------------------------------------

describe('resolveAuthorType', () => {
    // Same query createProductReview runs, so the two badges cannot come to
    // mean different things.
    it('marks someone with a delivered order as an owner', async () => {
        db.query.mockResolvedValueOnce([[{ id: 'order-1' }]]);

        await expect(
            service.resolveAuthorType({ id: ANSWERER, role: 'user' }, PRODUCT)
        ).resolves.toBe('owner');

        expect(db.query.mock.calls[0][0]).toMatch(/o\.status = 'delivered'/);
    });

    it('marks everyone else as a shopper', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await expect(
            service.resolveAuthorType({ id: ANSWERER, role: 'user' }, PRODUCT)
        ).resolves.toBe('shopper');
    });

    it.each([
        ['seller', 'seller'],
        ['admin', 'staff'],
        ['support', 'staff']
    ])('maps role %s to %s without a purchase lookup', async (role, expected) => {
        await expect(
            service.resolveAuthorType({ id: ANSWERER, role }, PRODUCT)
        ).resolves.toBe(expected);

        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('answerQuestion', () => {
    it('stores the resolved standing on the row', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', product_id: PRODUCT, user_id: ASKER, status: 'approved' };
        connection.__hasPurchase = true;
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[answerRow()]]);

        await service.answerQuestion(
            { id: ANSWERER, role: 'user' },
            'q-1',
            'Yes, it fits.'
        );

        const insert = connection.query.mock.calls.find(([sql]) =>
            /INSERT INTO product_answers/.test(sql)
        );

        expect(insert[1]).toContain('owner');
    });

    // A client must not be able to claim it is a verified owner.
    it('ignores an author_type sent by the client', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', product_id: PRODUCT, user_id: ASKER, status: 'approved' };
        connection.__hasPurchase = false;
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[answerRow({ author_type: 'shopper' })]]);

        await service.answerQuestion(
            { id: ANSWERER, role: 'user', authorType: 'seller' },
            'q-1',
            'Yes, it fits.'
        );

        const insert = connection.query.mock.calls.find(([sql]) =>
            /INSERT INTO product_answers/.test(sql)
        );

        expect(insert[1]).toContain('shopper');
        expect(insert[1]).not.toContain('seller');
    });

    it('updates the question answer count', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', product_id: PRODUCT, user_id: ASKER, status: 'approved' };
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[answerRow()]]);

        await service.answerQuestion({ id: ANSWERER }, 'q-1', 'Yes.');

        expect(ran(connection, /SET answer_count = \?/)).toHaveLength(1);
    });

    // An answer to a question nobody can see helps nobody, and would silently
    // reappear if the question were later approved.
    it('refuses to answer a question that is not approved', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', product_id: PRODUCT, user_id: ASKER, status: 'pending' };
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.answerQuestion({ id: ANSWERER }, 'q-1', 'Yes.')
        ).rejects.toMatchObject({ code: 'QUESTION_NOT_OPEN' });
    });

    it('rejects an empty answer', async () => {
        await expect(
            service.answerQuestion({ id: ANSWERER }, 'q-1', '   ')
        ).rejects.toMatchObject({ code: 'ANSWER_TOO_SHORT' });
    });

    it('reports an unknown question as not found', async () => {
        const connection = fakeConnection();
        connection.__locked = null;
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.answerQuestion({ id: ANSWERER }, 'ghost', 'Yes.')
        ).rejects.toMatchObject({ status: 404 });
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('listQuestions', () => {
    it('shows only approved, undeleted questions', async () => {
        db.query.mockResolvedValueOnce([[questionRow()]]);
        db.query.mockResolvedValueOnce([[{ total: 1 }]]);
        db.query.mockResolvedValueOnce([[answerRow()]]);

        await service.listQuestions(PRODUCT);

        expect(db.query.mock.calls[0][0]).toMatch(/q\.status = 'approved'/);
        expect(db.query.mock.calls[0][0]).toMatch(/q\.deleted_at IS NULL/);
    });

    // The N+1 this shape exists to avoid.
    it('loads the answers for a whole page in one query', async () => {
        db.query.mockResolvedValueOnce([
            [questionRow({ id: 'q-1' }), questionRow({ id: 'q-2' }), questionRow({ id: 'q-3' })]
        ]);
        db.query.mockResolvedValueOnce([[{ total: 3 }]]);
        db.query.mockResolvedValueOnce([[answerRow({ question_id: 'q-1' })]]);

        await service.listQuestions(PRODUCT);

        const answerQueries = db.query.mock.calls.filter(([sql]) =>
            /FROM product_answers/.test(sql)
        );

        expect(answerQueries).toHaveLength(1);
    });

    it('attaches each answer to its own question', async () => {
        db.query.mockResolvedValueOnce([[questionRow({ id: 'q-1' }), questionRow({ id: 'q-2' })]]);
        db.query.mockResolvedValueOnce([[{ total: 2 }]]);
        db.query.mockResolvedValueOnce([
            [answerRow({ id: 'a-1', question_id: 'q-1' }), answerRow({ id: 'a-2', question_id: 'q-2' })]
        ]);

        const result = await service.listQuestions(PRODUCT);

        expect(result.questions[0].answers).toHaveLength(1);
        expect(result.questions[0].answers[0].id).toBe('a-1');
        expect(result.questions[1].answers[0].id).toBe('a-2');
    });

    it('paginates', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 42 }]]);

        const result = await service.listQuestions(PRODUCT, { page: 2, limit: 10 });

        expect(result.pagination).toEqual({ page: 2, limit: 10, total: 42, pages: 5 });
    });

    it('can filter to unanswered questions', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 0 }]]);

        await service.listQuestions(PRODUCT, { unansweredOnly: true });

        expect(db.query.mock.calls[0][0]).toMatch(/q\.answer_count = 0/);
    });

    // This fragment lands in an ORDER BY; #1085 was an injection through
    // exactly this shape.
    it('falls back to a known sort rather than interpolating an unknown one', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[{ total: 0 }]]);

        const result = await service.listQuestions(PRODUCT, {
            sort: 'body; DROP TABLE product_questions'
        });

        expect(result.sort).toBe('helpful');
        expect(db.query.mock.calls[0][0]).not.toContain('DROP TABLE');
    });

    it('does not query votes for an anonymous viewer', async () => {
        db.query.mockResolvedValueOnce([[questionRow()]]);
        db.query.mockResolvedValueOnce([[{ total: 1 }]]);
        db.query.mockResolvedValueOnce([[answerRow()]]);

        await service.listQuestions(PRODUCT);

        expect(
            db.query.mock.calls.filter(([sql]) => /FROM product_qa_votes/.test(sql))
        ).toHaveLength(0);
    });

    it('resolves questions and answers the viewer voted on in one query', async () => {
        db.query.mockResolvedValueOnce([[questionRow()]]);
        db.query.mockResolvedValueOnce([[{ total: 1 }]]);
        db.query.mockResolvedValueOnce([[answerRow()]]);
        db.query.mockResolvedValueOnce([
            [{ target_type: 'question', target_id: 'q-1', vote_type: 'helpful' }]
        ]);

        const result = await service.listQuestions(PRODUCT, { viewerId: ANSWERER });

        expect(
            db.query.mock.calls.filter(([sql]) => /FROM product_qa_votes/.test(sql))
        ).toHaveLength(1);
        expect(result.questions[0].viewerHasVotedHelpful).toBe(true);
    });
});

describe('answer ranking', () => {
    // An answer from someone holding the product must not sit below a
    // confident guess that happened to be posted earlier.
    it('ranks an owner above a shopper with more votes', async () => {
        db.query.mockResolvedValueOnce([
            [
                answerRow({ id: 'guess', author_type: 'shopper', helpful_count: 99 }),
                answerRow({ id: 'owned', author_type: 'owner', helpful_count: 1 })
            ]
        ]);

        const grouped = await service.getAnswersFor(['q-1']);

        expect(grouped['q-1'][0].id).toBe('owned');
    });

    it('ranks a seller above an owner', async () => {
        db.query.mockResolvedValueOnce([
            [
                answerRow({ id: 'owned', author_type: 'owner', helpful_count: 50 }),
                answerRow({ id: 'sold', author_type: 'seller', helpful_count: 0 })
            ]
        ]);

        const grouped = await service.getAnswersFor(['q-1']);

        expect(grouped['q-1'][0].id).toBe('sold');
    });

    it('falls back to votes within the same standing', async () => {
        db.query.mockResolvedValueOnce([
            [
                answerRow({ id: 'low', author_type: 'owner', helpful_count: 1 }),
                answerRow({ id: 'high', author_type: 'owner', helpful_count: 9 })
            ]
        ]);

        const grouped = await service.getAnswersFor(['q-1']);

        expect(grouped['q-1'][0].id).toBe('high');
    });

    it('does not query at all for an empty page', async () => {
        await expect(service.getAnswersFor([])).resolves.toEqual({});
        expect(db.query).not.toHaveBeenCalled();
    });

    it('ranks seller and staff equally', () => {
        expect(AUTHOR_RANK.seller).toBe(AUTHOR_RANK.staff);
        expect(AUTHOR_RANK.owner).toBeLessThan(AUTHOR_RANK.seller);
        expect(AUTHOR_RANK.shopper).toBeLessThan(AUTHOR_RANK.owner);
    });
});

describe('toPublicAnswer', () => {
    // Surfaced separately so a client cannot forget to distinguish an answer
    // from someone holding the product from a guess.
    it('flags a verified owner', () => {
        const answer = service.toPublicAnswer(answerRow({ author_type: 'owner' }));

        expect(answer.isVerifiedOwner).toBe(true);
        expect(answer.isSeller).toBe(false);
    });

    it('flags a seller and staff alike', () => {
        expect(service.toPublicAnswer(answerRow({ author_type: 'seller' })).isSeller).toBe(true);
        expect(service.toPublicAnswer(answerRow({ author_type: 'staff' })).isSeller).toBe(true);
    });

    it('flags a plain shopper as neither', () => {
        const answer = service.toPublicAnswer(answerRow({ author_type: 'shopper' }));

        expect(answer.isVerifiedOwner).toBe(false);
        expect(answer.isSeller).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Voting and reporting
// ---------------------------------------------------------------------------

describe('vote', () => {
    it('records a helpful vote and recounts the cached counter', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        connection.__voteTotal = 6;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'helpful'
        });

        expect(result).toEqual({ targetId: 'q-1', alreadyVoted: false, count: 6 });
        expect(ran(connection, /INSERT INTO product_qa_votes/)).toHaveLength(1);
    });

    it('recalculates rather than incrementing', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        db.getConnection.mockResolvedValue(connection);

        await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'helpful'
        });

        expect(ran(connection, /helpful_count = helpful_count \+ 1/)).toHaveLength(0);
        expect(ran(connection, /SET helpful_count = \?/)).toHaveLength(1);
    });

    it('is idempotent for a repeat vote', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        connection.__existingVote = true;
        db.getConnection.mockResolvedValue(connection);

        const result = await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'helpful'
        });

        expect(result.alreadyVoted).toBe(true);
        expect(ran(connection, /INSERT INTO product_qa_votes/)).toHaveLength(0);
    });

    it('refuses a vote on your own post', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ANSWERER, status: 'approved' };
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.vote(ANSWERER, {
                targetType: 'question',
                targetId: 'q-1',
                voteType: 'helpful'
            })
        ).rejects.toMatchObject({ code: 'SELF_VOTE' });
    });

    it('rejects an unknown target type rather than building SQL from it', async () => {
        await expect(
            service.vote(ANSWERER, {
                targetType: 'products; DROP TABLE users',
                targetId: 'q-1',
                voteType: 'helpful'
            })
        ).rejects.toMatchObject({ code: 'INVALID_TARGET' });

        expect(db.getConnection).not.toHaveBeenCalled();
    });

    it('takes a row lock', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        db.getConnection.mockResolvedValue(connection);

        await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'helpful'
        });

        expect(ran(connection, /FOR UPDATE/)).toHaveLength(1);
    });
});

describe('reporting', () => {
    it('coerces an unrecognised reason to "other"', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        db.getConnection.mockResolvedValue(connection);

        await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'report',
            reason: 'nonsense'
        });

        const insert = connection.query.mock.calls.find(([sql]) =>
            /INSERT INTO product_qa_votes/.test(sql)
        );

        expect(insert[1]).toContain('other');
    });

    // One shopper must not be able to hide a question they dislike.
    it('leaves an item visible below the threshold', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        connection.__voteTotal = REPORT_FLAG_THRESHOLD - 1;
        db.getConnection.mockResolvedValue(connection);

        await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'report'
        });

        expect(ran(connection, /SET status = 'pending'/)).toHaveLength(0);
    });

    it('queues an item at the threshold instead of deleting it', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'q-1', user_id: ASKER, status: 'approved' };
        connection.__voteTotal = REPORT_FLAG_THRESHOLD;
        db.getConnection.mockResolvedValue(connection);

        await service.vote(ANSWERER, {
            targetType: 'question',
            targetId: 'q-1',
            voteType: 'report'
        });

        expect(ran(connection, /SET status = 'pending'/)).toHaveLength(1);
        expect(ran(connection, /DELETE FROM product_questions/)).toHaveLength(0);
    });

    // Hiding an answer changes its question's answer count.
    it('recounts the question when an answer is auto-queued', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'a-1', user_id: ANSWERER, status: 'approved' };
        connection.__voteTotal = REPORT_FLAG_THRESHOLD;
        db.getConnection.mockResolvedValue(connection);

        await service.vote(ASKER, {
            targetType: 'answer',
            targetId: 'a-1',
            voteType: 'report'
        });

        expect(ran(connection, /SET answer_count = \?/)).toHaveLength(1);
    });

    it('offers a fixed reason vocabulary', () => {
        expect(REPORT_REASONS).toContain('spam');
        expect(REPORT_REASONS).toContain('other');
    });
});

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

describe('moderate', () => {
    it.each(['approved', 'pending', 'rejected'])('accepts status=%s', async (status) => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        const result = await service.moderate(ADMIN, {
            targetType: 'question',
            targetId: 'q-1',
            status
        });

        expect(result.status).toBe(status);
    });

    it('rejects an unknown status', async () => {
        await expect(
            service.moderate(ADMIN, {
                targetType: 'question',
                targetId: 'q-1',
                status: 'banished'
            })
        ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });

    it('records who decided and when', async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.moderate(ADMIN, {
            targetType: 'question',
            targetId: 'q-1',
            status: 'rejected',
            notes: 'Spam'
        });

        const update = connection.query.mock.calls.find(([sql]) =>
            /moderated_by = \?/.test(sql)
        );

        expect(update[0]).toMatch(/moderated_at = NOW\(\)/);
        expect(update[1]).toContain(ADMIN);
        expect(update[1]).toContain('Spam');
    });

    it('recounts the question when an answer is moderated', async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.moderate(ADMIN, {
            targetType: 'answer',
            targetId: 'a-1',
            status: 'rejected'
        });

        expect(ran(connection, /SET answer_count = \?/)).toHaveLength(1);
    });

    it('reports an unknown target as not found', async () => {
        const connection = fakeConnection();
        connection.__affected = 0;
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.moderate(ADMIN, {
                targetType: 'question',
                targetId: 'ghost',
                status: 'approved'
            })
        ).rejects.toMatchObject({ status: 404 });
    });
});

describe('softDelete', () => {
    it('marks the row deleted rather than removing it', async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.softDelete(ADMIN, {
            targetType: 'question',
            targetId: 'q-1',
            reason: 'Abusive'
        });

        expect(ran(connection, /DELETE FROM product_questions/)).toHaveLength(0);
        expect(ran(connection, /deleted_at = NOW\(\)/)).toHaveLength(1);
    });

    it('records the moderator and the reason', async () => {
        const connection = fakeConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.softDelete(ADMIN, {
            targetType: 'question',
            targetId: 'q-1',
            reason: 'Abusive'
        });

        const update = connection.query.mock.calls.find(([sql]) => /deleted_by = \?/.test(sql));

        expect(update[1]).toContain(ADMIN);
        expect(update[1]).toContain('Abusive');
    });
});

describe('getModerationQueue', () => {
    // A moderator works one queue, and an answer is usually only judgeable
    // next to its question.
    it('returns questions and answers together', async () => {
        db.query.mockResolvedValueOnce([[questionRow({ status: 'pending' })]]);
        db.query.mockResolvedValueOnce([[answerRow({ status: 'pending' })]]);

        const queue = await service.getModerationQueue();

        expect(queue.questions).toHaveLength(1);
        expect(queue.answers).toHaveLength(1);
    });

    it('coerces an unknown status rather than passing it through', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[]]);

        const queue = await service.getModerationQueue({ status: "'; DROP TABLE --" });

        expect(queue.status).toBe('pending');
        expect(db.query.mock.calls[0][1][0]).toBe('pending');
    });

    it('orders most-reported first', async () => {
        db.query.mockResolvedValueOnce([[]]);
        db.query.mockResolvedValueOnce([[]]);

        await service.getModerationQueue();

        expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY q\.reported_count DESC/);
    });
});
