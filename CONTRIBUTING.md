# Contributing to E-Commerce Project

Thank you for your interest in contributing! This guide will help you set up your environment and follow best practices.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Branching Strategy](#branching-strategy)
3. [Coding Standards](#coding-standards)
4. [Testing](#testing)
5. [Pull Request Guidelines](#pull-request-guidelines)
6. [Environment Setup](#environment-setup)
7. [Database Setup](#database-setup)
8. [Frontend Guidelines](#frontend-guidelines)

---

## Getting Started

1. Fork the repository.
2. Clone your fork:
```
git clone https://github.com/<your-username>/E-commerce.git
```
```
cd E-commerce
```

3. Install backend dependencies:
```
cd backend
npm install
```

4. Install frontend dependencies:
```
cd ../frontend
npm install
```

---

## Branching Strategy

- ```main``` → production-ready
- ```develop``` → latest development
- Feature branches → ```feature/<feature-name>```
- Fix branches → ```fix/<issue-number>```

---

## Coding Standards
- Use ES6+ syntax for JS.
- All API responses must have this structure:

```
{
  "success": true,
  "message": "Descriptive message",
  "data": {}
}
```

- Always handle null/undefined values in frontend.
- Use utils.js helpers for notifications, API calls, and localStorage.

### Database transactions
Use ```withTransaction``` from ```backend/config/db```:

```js
const { withTransaction } = require("../config/db");

const orderId = await withTransaction(async (connection) => {
    const [result] = await connection.query("INSERT INTO orders ...", params);
    await connection.query("INSERT INTO order_items ...", moreParams);
    return result.insertId;
});
```

Returning commits, throwing rolls back, and the connection is released on every
path. Use the connection the callback is handed for every statement in the
transaction — a query sent to the pool instead goes to a different connection
and is not part of it.

Never issue ```START TRANSACTION```, ```COMMIT``` or ```ROLLBACK``` as a pool
query. The pool hands each query whichever connection is free, so the statements
of one transaction can be spread across several connections while another
request's statements land in the middle of them.

Do work that is not a database write — HTTP calls, cache updates, sending mail —
outside the callback. Anything inside it holds a connection and its row locks
until it finishes.

---

## Testing
- Backend: test endpoints using Postman.
- Frontend: test forms, cart, checkout, orders, wishlist, and profile.
- Ensure all features work both logged-in and logged-out.

---

## Pull Request Guidelines
1. PR must be from a feature/fix branch to develop.
2. Include screenshots if UI changes.
3. Reference the related issue in PR description.
4. Ensure no console errors or warnings in browser.
5. Code must pass linter checks.

---

## Environment Setup
1. Copy ```.env.example``` to ```.env```:
```cp backend/.env.example backend/.env```
2. Fill in the required values:
- DB_HOST
- DB_USER
- DB_PASSWORD
- DB_NAME
- JWT_SECRET
- PORT (default: 5000)
- FRONTEND_URL (default: http://localhost:3000)

---

## Database Setup
1. Create an empty MySQL database.
2. Apply the migrations:
```
cd backend
npm run migrate
```
3. Check the result with ```npm run migrate:status```, which lists applied and
pending migrations without changing anything.

Do not pipe SQL files into ```mysql``` by hand. Applying SQL outside the runner
leaves no record of what ran, and the runner will then try to apply it again.

### Adopting migrations on an existing database
A database created before the migration sequence existed already has the
baseline tables. Record the baseline as applied without re-running it, then
migrate normally:
```
cd backend
npm run migrate:baseline
npm run migrate
```

### Adding a migration
- Create ```migrations/<next-number>_<short_name>.sql``` — four-digit prefix,
one number higher than the last.
- Never edit a migration that has been applied anywhere. The runner checksums
each file and refuses to run if an applied one changed. Add a new migration
instead.
- Write forward-only SQL and assume it runs exactly once.

---

## Frontend Guidelines
- Use ```utils.js``` for:
 - Notifications: ```notify(message, type)```
 - Safe localStorage: ```getJSON(key)``` / ```setJSON(key, value)```
 - API calls: ```apiRequest(url, options)```
 - Price formatting: ```formatPrice(price)```
- Always check for element existence before updating the DOM.
- Use fallback values for product info (name, image, price) to prevent crashes.

---

## Thank you for contributing! 🎉

---