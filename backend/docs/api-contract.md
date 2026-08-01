# API contract suite (#1395)

Published OpenAPI lives at [`../openapi/ecommerce.openapi.yaml`](../openapi/ecommerce.openapi.yaml).

## Run

```bash
cd backend
npm test -- --testPathPattern=contract --coverage=false
```

Optional Spectral lint (downloads CLI via npx when needed):

```bash
cd backend
npm run lint:openapi
```

## Layout

| Path | Purpose |
|------|---------|
| `openapi/ecommerce.openapi.yaml` | Source of truth for auth/cart/checkout/products/orders |
| `tests/contract/*.test.js` | Document, fixture, and consumer (Pact-like) checks |
| `tests/contract/fixtures/` | Example 401 / 409 / 422 (+ happy-path) payloads |

When you change a response envelope, update the OpenAPI schema **and** the matching fixture or consumer expectation in the same PR.
