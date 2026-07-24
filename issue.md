# E-commerce Bug Report (Post Git Pull — Batch 9)

> Audit of 179 newly merged commits on `main`. All issues are in the new architectural monitoring services.

---

## Issue 1 — Critical SQL Injection in SLA Summary Endpoint

**Severity:** 🔴 Critical  
**Type:** Security — SQL Injection  
**File:** [`backend/services/buisnessSLAService.js`](file:///e:/E-commerce/backend/services/buisnessSLAService.js) — Line 307  
**Route:** `GET /api/sla/metrics/:metric/summary` ([`backend/routes/slaRoutes.js`](file:///e:/E-commerce/backend/routes/slaRoutes.js) — Line 38)

### Description

The `period` query parameter is read from the client's HTTP request and passed directly into `getMetricsSummary()` without sanitization. Inside the function, it is string-interpolated into a raw SQL query using a template literal:

**Route handler (slaRoutes.js:38):**
```js
const { period = '24h' } = req.query;  // ← attacker-controlled value
const summary = await slaService.getMetricsSummary(metric, period);
```

**SQL construction (buisnessSLAService.js:307):**
```js
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 ${period})
//                                           ^^^^^^^^
//                          Directly interpolated — never parameterized
```

### Steps to Reproduce

1. Authenticate as any user (the route only requires `authMiddleware`, not admin).
2. Send:
   ```
   GET /api/sla/metrics/checkout_completion/summary?period=HOUR) OR 1=1--
   ```
3. The final query becomes:
   ```sql
   WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR) OR 1=1--
   ```
   ...returning all rows regardless of the date filter.

### Expected Behavior

The `period` value should be validated against a whitelist of allowed values (`HOUR`, `DAY`, `WEEK`, `MONTH`) before being used in the query.

### Actual Behavior

Arbitrary SQL clauses are injected and executed by the database engine, bypassing all date-range filters.

### Fix

```js
// Whitelist valid MySQL interval units
const VALID_PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH'];
const safePeriod = VALID_PERIODS.includes(period?.toUpperCase()) ? period.toUpperCase() : 'DAY';

// Then use safePeriod in the query instead of period
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 ${safePeriod})
```

---

## Issue 2 — Guaranteed Runtime Crash: Variable Shadowing & Missing `path` Import

**Severity:** 🔴 Critical  
**Type:** Bug — TypeError / Runtime Crash  
**File:** [`backend/routes/riskRoutes.js`](file:///e:/E-commerce/backend/routes/riskRoutes.js) — Lines 98–103  
**Route:** `GET /api/risk/modules/:name`

### Description

The `path` Node.js built-in module is **never imported** at the top of `riskRoutes.js`. Additionally, in the loop that iterates over `moduleScores` (a `Map`), the destructured variable `path` shadows any outer `path` identifier:

```js
// No: const path = require('path'); at top of file

for (const [path, data] of architecturalRiskService.moduleScores) {
    //         ^^^^  path here is a STRING (the map key), not the 'path' module
    if (path.basename(path) === name) {  // ← TypeError: path.basename is not a function
        moduleData = { path, ...data };
        break;
    }
}
```

`path` is the raw string key of the `Map` (a filesystem path like `"e:/E-commerce/backend/services"`). Calling `.basename()` on a string throws immediately.

### Steps to Reproduce

1. Trigger a risk analysis first so `moduleScores` is populated: `POST /api/risk/analyze`
2. Request any module by name: `GET /api/risk/modules/cartController`
3. Server throws:
   ```
   TypeError: path.basename is not a function
       at riskRoutes.js:99
   ```
4. Response: `500 Internal Server Error`.

### Expected Behavior

The route correctly looks up the module by its basename and returns the associated risk data.

### Actual Behavior

Every request to `GET /api/risk/modules/:name` crashes with a `TypeError`.

### Fix

```js
const nodePath = require('path');  // import at top of file

// In the route handler:
for (const [modulePath, data] of architecturalRiskService.moduleScores) {
    if (nodePath.basename(modulePath) === name) {
        moduleData = { path: modulePath, ...data };
        break;
    }
}
```

---

## Issue 3 — Broken Module Coupling Calculation (Dead Logic)

**Severity:** 🟠 High  
**Type:** Bug — Logic Error / Incorrect Metric  
**File:** [`backend/services/architecturalRiskService.js`](file:///e:/E-commerce/backend/services/architecturalRiskService.js) — Lines 263–293

### Description

`calculateCoupling()` is supposed to count both **incoming** (other modules that depend on the target) and **outgoing** (modules that the target depends on) coupling. However, the `continue` statement on line 270 permanently prevents the outgoing check on line 283 from ever being reached:

```js
for (const mod of allModules) {
    if (mod === modulePath) continue;   // ← skips the current module entirely

    // ... code to calculate incoming (works correctly) ...

    // Check if target module depends on this module
    if (modulePath === mod) {           // ← DEAD CODE: this is NEVER true
        outgoing += deps.length;        //   because equal case was skipped above
    }
}
```

The `continue` on line 270 skips to the next iteration whenever `mod === modulePath`. The check `modulePath === mod` on line 283 is therefore unreachable — it can never be true in the same iteration.

### Impact

- `outgoing` is always `0` for every module.
- The total coupling `incoming + outgoing` underreports actual coupling by up to 50%.
- All architectural risk scores derived from coupling are corrupted.

### Steps to Reproduce

1. Trigger analysis: `POST /api/risk/analyze`
2. Fetch results: `GET /api/risk/report`
3. Inspect any module's coupling object — `outgoing` will always be `0`.

### Expected Behavior

`outgoing` should reflect the number of dependencies the target module has on other modules.

### Fix

The outgoing coupling must be calculated by separately iterating over the target module's own files, outside the `allModules` loop:

```js
// Calculate outgoing separately
const targetFiles = this.findFilesInModule(modulePath);
for (const file of targetFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const deps = this.extractDependencies(content);
    outgoing += deps.length;
}

// Then in the loop, only calculate incoming:
for (const mod of allModules) {
    if (mod === modulePath) continue;
    // ... incoming check only ...
}
```

---

## Issue 4 — Memory Leak in Technical Debt Analysis

**Severity:** 🟠 High  
**Type:** Bug — Memory Leak / OOM Risk  
**File:** [`backend/services/technicalDebtService.js`](file:///e:/E-commerce/backend/services/technicalDebtService.js) — Lines 241–245

### Description

`this.todoItems` and `this.deadCodeItems` are instance-level arrays initialized once in the constructor. `analyzeDebt()` is invoked on a recurring schedule. Each time it runs, new items are **appended** to these arrays without ever resetting them at the start of the run:

```js
// Constructor (once on startup):
this.todoItems = [];
this.deadCodeItems = [];

// analyzeDebt() -> analyzeCodeQuality() called on every scheduled run:
const todoMatches = content.match(/\/\/\s*TODO|#\s*TODO/g) || [];
if (todoMatches.length > 0) {
    this.todoItems.push({          // ← push without ever clearing first
        file: path.relative(this.projectRoot, file),
        count: todoMatches.length,
        content: todoMatches.join(', ')
    });
}
```

If debt analysis runs every hour across 50 source files, after 24 hours `this.todoItems` will have grown to `50 × 24 = 1200` entries — all duplicates of the same 50 files. After days, this leads to an OOM crash.

Additionally, `/api/debt/todo` returns `this.todoItems.slice(0, 50)`, so callers always receive stale, duplicated data.

### Steps to Reproduce

1. Start the server and wait for the scheduled debt analysis to run at least twice.
2. `GET /api/debt/todo` — observe duplicate entries for the same files.
3. Monitor process memory (`process.memoryUsage()`) over multiple runs — heap usage grows monotonically.

### Expected Behavior

Each analysis run produces a fresh set of findings with no duplicates.

### Fix

Reset the arrays at the beginning of each analysis:

```js
async analyzeDebt() {
    if (this.isAnalyzing) return;
    this.isAnalyzing = true;

    // Clear per-run state before starting
    this.todoItems = [];
    this.deadCodeItems = [];

    // ... rest of analysis ...
}
```

---

## Issue 5 — Event Loop Blocking in Cohesion Calculation (O(N×M) Array Filter)

**Severity:** 🟡 Medium  
**Type:** Performance — Event Loop Block / DoS Risk  
**File:** [`backend/services/architecturalRiskService.js`](file:///e:/E-commerce/backend/services/architecturalRiskService.js) — Lines 311–316

### Description

`calculateCohesion()` measures how semantically related files within a module are by checking shared keywords. For every pair of files `(i, j)`, it reads both files, tokenizes them into word arrays, and then calls `Array.filter()` + `Array.includes()` to find common words:

```js
const words1 = content1.match(/\b\w+\b/g) || [];  // e.g. 5,000 words
const words2 = content2.match(/\b\w+\b/g) || [];  // e.g. 5,000 words

const commonWords = words1.filter(w => words2.includes(w));
//                                     ^^^^^^^^^^^^^^^^^^
//                           O(M) linear scan per element of words1
//                           Total: O(N × M) per file pair
```

This runs **synchronously** on the Node.js main thread. For a module with 10 files averaging 5,000 words each:

- File pairs: `10 × 9 / 2 = 45` pairs  
- Cost per pair: `5,000 × 5,000 = 25,000,000` comparisons  
- **Total: ~1.1 billion comparisons** — blocking the event loop for several seconds

During this time, the server cannot process any incoming HTTP requests, causing timeouts for all concurrent users.

### Steps to Reproduce

1. Add a module with 10+ large source files.
2. Trigger analysis: `POST /api/risk/analyze`
3. While analysis is running, send concurrent requests to any route (e.g., `GET /api/products`).
4. Observe that all concurrent requests hang until the cohesion calculation completes.

### Expected Behavior

The analysis either runs in a worker thread or uses an efficient O(N+M) Set-based algorithm.

### Fix

Convert `words2` to a `Set` before the filter — reduces each pair's cost from O(N×M) to O(N+M):

```js
const words1 = content1.match(/\b\w+\b/g) || [];
const words2Set = new Set(content2.match(/\b\w+\b/g) || []);

// O(N) lookup instead of O(N×M)
const commonWords = words1.filter(w => words2Set.has(w));
const similarity = commonWords.length / Math.max(words1.length, words2Set.size);
```

For complete non-blocking behavior, offload the entire `analyzeRisk()` to a `worker_thread`.
