// backend/tests/baseRepository.test.js
//
// `findOne()` could not return a record (#1564).
//
// It destructured the return value of `findAll()`, which is the rows array
// itself and not the driver's `[rows, fields]` tuple. So `rows` bound to
// element 0 of the row set: the row object on a hit (whose `.length` is
// undefined, so the guard failed and it returned null) and `undefined` on a
// miss (so reading `.length` threw). Both outcomes are the opposite of the
// intended one, which is why the first two tests here are worth stating
// separately -- fixing only one of them would still leave the method broken.

// Mocked so requiring the repository does not open a real pool. Every test
// below replaces `repo.db` with its own double anyway; this only keeps the
// module-level `require('../config/db')` from reaching mysql2.
jest.mock('../config/db', () => ({
    promise: { query: jest.fn() },
    withTransaction: jest.fn()
}));

const BaseRepository = require('../repositories/baseRepository');

/** A repository whose `db` is a recording double. */
const repoWith = (rows = [], options = {}) => {
    const repo = new BaseRepository('widgets', 'id', options);
    repo.db = { query: jest.fn().mockResolvedValue([rows, []]) };
    return repo;
};

/** Every statement the repository sent, whitespace collapsed for matching. */
const executedSql = (repo) =>
    repo.db.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());

describe('BaseRepository.findOne', () => {
    test('returns the row when one matches', async () => {
        const row = { id: 7, email: 'someone@example.com' };
        const repo = repoWith([row]);

        await expect(repo.findOne({ email: 'someone@example.com' }))
            .resolves.toEqual(row);
    });

    test('returns null when nothing matches, instead of throwing', async () => {
        const repo = repoWith([]);

        await expect(repo.findOne({ email: 'nobody@example.com' }))
            .resolves.toBeNull();
    });

    test('asks for a single row', async () => {
        const repo = repoWith([{ id: 1 }]);

        await repo.findOne({ email: 'someone@example.com' });

        const [sql, params] = repo.db.query.mock.calls[0];
        expect(sql.replace(/\s+/g, ' ')).toMatch(/LIMIT \? OFFSET \?/i);
        // filter value, then limit, then offset
        expect(params).toEqual(['someone@example.com', 1, 0]);
    });

    test('takes the first row when the driver hands back several', async () => {
        // A caller can pass a filter that is not unique; "one of these" is a
        // defensible answer, "null" is not.
        const first = { id: 1 };
        const repo = repoWith([first, { id: 2 }]);

        await expect(repo.findOne({ role: 'admin' })).resolves.toEqual(first);
    });

    test('survives a subclass whose findAll does not return an array', async () => {
        const repo = repoWith([]);
        repo.findAll = jest.fn().mockResolvedValue(undefined);

        await expect(repo.findOne({ id: 1 })).resolves.toBeNull();
    });

    test('applies no filters when given none', async () => {
        const repo = repoWith([{ id: 1 }]);

        await repo.findOne();

        expect(executedSql(repo)[0]).not.toMatch(/WHERE/i);
    });
});

describe('BaseRepository.update with nothing to write', () => {
    test('sends no UPDATE rather than "SET  WHERE"', async () => {
        const repo = repoWith([{ id: 1, name: 'unchanged' }]);

        await repo.update(1, {});

        expect(executedSql(repo).some((sql) => /^UPDATE/i.test(sql))).toBe(false);
    });

    test('returns the row unchanged', async () => {
        const row = { id: 1, name: 'unchanged' };
        const repo = repoWith([row]);

        await expect(repo.update(1, {})).resolves.toEqual(row);
    });

    test('still writes when there is something to write', async () => {
        const repo = repoWith([{ id: 1, name: 'after' }]);

        await repo.update(1, { name: 'after' });

        const update = repo.db.query.mock.calls.find(([sql]) => /^UPDATE/i.test(sql));
        expect(update[0].replace(/\s+/g, ' ')).toMatch(/UPDATE widgets SET name = \? WHERE id = \?/i);
        expect(update[1]).toEqual(['after', 1]);
    });

    test('re-reads past the cache after writing', async () => {
        // The entry is dropped before the read, but a concurrent findById
        // between the two could repopulate it with the pre-update row.
        const repo = repoWith([{ id: 1, name: 'stale' }]);
        repo.cache.set(1, { row: { id: 1, name: 'stale' }, expiresAt: Date.now() + 60_000 });
        repo.db.query.mockResolvedValue([[{ id: 1, name: 'fresh' }], []]);

        await expect(repo.update(1, { name: 'fresh' }))
            .resolves.toEqual({ id: 1, name: 'fresh' });
    });

    test('a non-object payload is treated as empty rather than crashing', async () => {
        const repo = repoWith([{ id: 1 }]);

        await expect(repo.update(1, null)).resolves.toEqual({ id: 1 });
        expect(executedSql(repo).some((sql) => /^UPDATE/i.test(sql))).toBe(false);
    });
});

describe('BaseRepository.create with nothing to insert', () => {
    test('refuses by name instead of emitting "INSERT INTO t () VALUES ()"', async () => {
        const repo = repoWith([]);

        await expect(repo.create({})).rejects.toThrow(/no columns were supplied/i);
        expect(repo.db.query).not.toHaveBeenCalled();
    });

    test('reloads a UUID-keyed row by its supplied key, not by insertId 0', async () => {
        // products, orders and users are all CHAR(36); insertId is 0 for them,
        // and reloading by 0 returns the wrong row or none at all.
        const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
        const repo = repoWith([]);
        repo.db.query
            .mockResolvedValueOnce([{ insertId: 0, affectedRows: 1 }, []])
            .mockResolvedValueOnce([[{ id, name: 'widget' }], []]);

        await expect(repo.create({ id, name: 'widget' }))
            .resolves.toEqual({ id, name: 'widget' });

        const select = repo.db.query.mock.calls[1];
        expect(select[1]).toEqual([id]);
    });

    test('still uses insertId for auto-increment tables', async () => {
        const repo = repoWith([]);
        repo.db.query
            .mockResolvedValueOnce([{ insertId: 42, affectedRows: 1 }, []])
            .mockResolvedValueOnce([[{ id: 42, name: 'widget' }], []]);

        await repo.create({ name: 'widget' });

        expect(repo.db.query.mock.calls[1][1]).toEqual([42]);
    });
});

describe('BaseRepository identity cache', () => {
    test('serves a second read from memory', async () => {
        const repo = repoWith([{ id: 1, name: 'widget' }]);

        await repo.findById(1);
        await repo.findById(1);

        expect(repo.db.query).toHaveBeenCalledTimes(1);
    });

    test('evicts the oldest entry once the cap is reached', async () => {
        // The repositories are process-lifetime singletons; an unbounded map is
        // a leak that grows with traffic.
        const repo = repoWith([], { cacheMaxEntries: 2 });

        for (const id of [1, 2, 3]) {
            repo.db.query.mockResolvedValue([[{ id }], []]);
            await repo.findById(id);
        }

        expect(repo.cache.size).toBe(2);
        expect(repo.cache.has(1)).toBe(false);
        expect(repo.cache.has(3)).toBe(true);
    });

    test('re-reads once an entry has expired', async () => {
        const repo = repoWith([{ id: 1, name: 'widget' }], { cacheTtlMs: 1 });

        await repo.findById(1);
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
        await repo.findById(1);

        expect(repo.db.query).toHaveBeenCalledTimes(2);
        Date.now.mockRestore();
    });

    test('an expired entry is dropped, not merely ignored', async () => {
        const repo = repoWith([{ id: 1 }], { cacheTtlMs: 1 });
        repo.cache.set(1, { row: { id: 1 }, expiresAt: Date.now() - 1 });

        repo._cacheGet(1);

        expect(repo.cache.has(1)).toBe(false);
    });

    test('caching can still be turned off entirely', async () => {
        const repo = repoWith([{ id: 1 }]);
        repo.setCacheEnabled(false);

        await repo.findById(1);
        await repo.findById(1);

        expect(repo.db.query).toHaveBeenCalledTimes(2);
        expect(repo.cache.size).toBe(0);
    });

    test('subclasses can still invalidate with cache.delete(id)', async () => {
        // productRepository, userRepository and orderRepository all do exactly
        // this after a write, so the map has to stay keyed by primary key.
        const repo = repoWith([{ id: 1 }]);

        await repo.findById(1);
        repo.cache.delete(1);
        await repo.findById(1);

        expect(repo.db.query).toHaveBeenCalledTimes(2);
    });
});
