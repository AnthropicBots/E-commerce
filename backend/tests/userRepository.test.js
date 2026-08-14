// backend/tests/userRepository.test.js
//
// userRepository queried a `users.status` column and a `user_profiles` table,
// and the schema has neither (#1566).
//
// `users` carries `is_active TINYINT(1)` (0001_baseline_schema.sql:37); there is
// no `status`, and no `CREATE TABLE user_profiles` anywhere in migrations/. So
// getActive, updateStatus, getStats and findWithProfile all threw before
// returning -- four of the nine methods in the class, including the one the
// admin dashboard reads its numbers from.

jest.mock('../config/db', () => ({
    promise: { query: jest.fn() },
    withTransaction: jest.fn()
}));

const userRepo = require('../repositories/userRepository');

const USER_ID = '9f8b7a60-1c2d-4e3f-8a9b-0c1d2e3f4a5b';

/** The statement most recently sent, whitespace collapsed for matching. */
const lastSql = () => {
    const calls = userRepo.db.query.mock.calls;
    return String(calls[calls.length - 1][0]).replace(/\s+/g, ' ').trim();
};

/** The parameters of the statement most recently sent. */
const lastParams = () => {
    const calls = userRepo.db.query.mock.calls;
    return calls[calls.length - 1][1];
};

beforeEach(() => {
    userRepo.db = { query: jest.fn().mockResolvedValue([[], []]) };
    userRepo.clearCache();
});

describe('the account flag is is_active, not status', () => {
    test('getActive filters on is_active', async () => {
        await userRepo.getActive(30);

        expect(lastSql()).toMatch(/is_active = 1/i);
        expect(lastSql()).not.toMatch(/status = 'active'/i);
    });

    test('getStats aggregates is_active', async () => {
        userRepo.db.query.mockResolvedValue([[{ total_users: 3 }], []]);

        await userRepo.getStats();

        expect(lastSql()).toMatch(/WHEN is_active = 1 THEN 1/i);
        expect(lastSql()).not.toMatch(/WHEN status = 'active'/i);
    });

    test('updateStatus writes is_active', async () => {
        userRepo.db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

        await userRepo.updateStatus(USER_ID, 'active');

        expect(lastSql()).toMatch(/SET is_active = \?/i);
        expect(lastParams()).toEqual([1, USER_ID]);
    });

    test('updateStatus still understands the old status vocabulary', async () => {
        userRepo.db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

        for (const [input, expected] of [
            ['active', 1],
            ['inactive', 0],
            ['suspended', 0],
            ['disabled', 0],
            [true, 1],
            [false, 0],
            [1, 1],
            [0, 0]
        ]) {
            await userRepo.updateStatus(USER_ID, input);
            expect(lastParams()[0]).toBe(expected);
        }
    });

    test('updateStatus refuses a value it does not recognise', async () => {
        // Coercing an unknown string to 0 would silently deactivate the
        // account, which is the worst available reading of a typo.
        await expect(userRepo.updateStatus(USER_ID, 'actve'))
            .rejects.toThrow(/Unrecognised account status/i);

        expect(userRepo.db.query).not.toHaveBeenCalled();
    });

    test('updateStatus reports whether a row changed', async () => {
        userRepo.db.query.mockResolvedValue([{ affectedRows: 0 }, []]);

        await expect(userRepo.updateStatus(USER_ID, 'active')).resolves.toBe(false);
    });
});

describe('findWithProfile', () => {
    const user = {
        id: USER_ID,
        name: 'Someone',
        email: 'someone@example.com',
        phone: '9876543210',
        city: 'Pune',
        state: 'Maharashtra',
        zip: '411001',
        country: 'India',
        address: '12 Example Road',
        avatar: null
    };

    test('does not query a user_profiles table', async () => {
        userRepo.db.query.mockResolvedValue([[user], []]);

        await userRepo.findWithProfile(USER_ID);

        const statements = userRepo.db.query.mock.calls.map(([sql]) => String(sql));
        expect(statements.some((sql) => /user_profiles/i.test(sql))).toBe(false);
    });

    test('returns the profile as an object, not an array', async () => {
        // The old destructuring bound `profile` to the rows array, and `[]` is
        // truthy -- so a user with no profile was reported as `profile: []`.
        userRepo.db.query.mockResolvedValue([[user], []]);

        const result = await userRepo.findWithProfile(USER_ID);

        expect(Array.isArray(result.profile)).toBe(false);
        expect(result.profile).toEqual({
            avatar: null,
            phone: '9876543210',
            address: '12 Example Road',
            city: 'Pune',
            state: 'Maharashtra',
            zip: '411001',
            country: 'India'
        });
    });

    test('keeps the user fields alongside it', async () => {
        userRepo.db.query.mockResolvedValue([[user], []]);

        const result = await userRepo.findWithProfile(USER_ID);

        expect(result.id).toBe(USER_ID);
        expect(result.email).toBe('someone@example.com');
    });

    test('reports absent profile fields as null rather than undefined', async () => {
        userRepo.db.query.mockResolvedValue([[{ id: USER_ID, name: 'Someone' }], []]);

        const result = await userRepo.findWithProfile(USER_ID);

        expect(result.profile.phone).toBeNull();
        expect(result.profile.city).toBeNull();
    });

    test('returns null for a user who does not exist', async () => {
        userRepo.db.query.mockResolvedValue([[], []]);

        await expect(userRepo.findWithProfile(USER_ID)).resolves.toBeNull();
    });
});

describe('logged_in_today means today', () => {
    test('it counts accounts whose last sign-in was today', async () => {
        userRepo.db.query.mockResolvedValue([[{ logged_in_today: 2 }], []]);

        await userRepo.getStats();

        expect(lastSql()).toMatch(/DATE\(last_login\) = CURDATE\(\)/i);
    });

    test('and no longer counts distinct timestamps across all time', async () => {
        userRepo.db.query.mockResolvedValue([[{}], []]);

        await userRepo.getStats();

        expect(lastSql()).not.toMatch(/COUNT\(DISTINCT last_login\)/i);
    });
});

describe('deactivated accounts stay out of the reads', () => {
    const readsThatMustFilter = [
        ['findByEmail', () => userRepo.findByEmail('someone@example.com')],
        ['findByRole', () => userRepo.findByRole('admin')],
        ['getActive', () => userRepo.getActive()],
        ['search', () => userRepo.search('someone')],
        ['getStats', () => userRepo.getStats()]
    ];

    test.each(readsThatMustFilter)('%s excludes soft-deleted rows', async (_name, run) => {
        userRepo.db.query.mockResolvedValue([[{}], []]);

        await run();

        expect(lastSql()).toMatch(/deleted_at IS NULL/i);
    });

    test('the repository declares the soft-delete column', () => {
        // Without this, BaseRepository.delete() hard-deletes the row and takes
        // every order, review and address that cascades off it.
        expect(userRepo.softDeleteColumn).toBe('deleted_at');
    });
});

describe('search terms are not read as LIKE patterns', () => {
    test('a percent sign is escaped', async () => {
        await userRepo.search('%');

        expect(lastParams()[0]).toBe('%\\%%');
        expect(lastSql()).toMatch(/ESCAPE/i);
    });

    test('an underscore is escaped', async () => {
        await userRepo.search('a_b');

        expect(lastParams()[0]).toBe('%a\\_b%');
    });

    test('an ordinary term is unchanged', async () => {
        await userRepo.search('someone');

        expect(lastParams()[0]).toBe('%someone%');
    });

    test('name and email get the same escaped term', async () => {
        await userRepo.search('%');

        const [name, email] = lastParams();
        expect(name).toBe(email);
    });
});
