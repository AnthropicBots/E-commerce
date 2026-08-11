# Production Deployment Guide

This guide explains how to deploy the E-Commerce application outside the local development environment. It covers the backend, MySQL database, Redis, frontend hosting, environment variables, migrations, CORS configuration, deployment verification, and common production issues.

## Overview

The application consists of:

* **Backend:** Node.js and Express.js
* **Database:** MySQL
* **Cache / supporting service:** Redis
* **Frontend:** Static HTML, CSS, and JavaScript
* **Frontend deployment:** Vercel
* **Database migrations:** Managed through the project's migration scripts

The backend starts from `backend/server.js` and listens on the configured `PORT`. The default port is `5000`.

---

## 1. Production Prerequisites

Before deploying, make sure the production environment provides:

* Node.js 18 or later
* npm
* MySQL 8.x
* Redis 7.x when Redis-backed features are enabled
* Git
* A production hosting environment for the backend
* A frontend hosting provider such as Vercel
* A production domain or URL for the frontend and backend

The repository's frontend is a static site, so it does not require a separate frontend build step.

---

## 2. Environment Configuration

Do not commit production credentials or secrets to the repository.

The backend environment file should be created from:

```text
backend/.env.example
```

Create:

```text
backend/.env
```

and provide production values.

### Core server configuration

```env
NODE_ENV=production
PORT=5000

FRONTEND_URL=https://your-frontend-domain.example
API_URL=https://your-backend-domain.example
```

Replace the example URLs with the actual production URLs.

### Database configuration

```env
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_NAME=ecommerce
DB_SSL=false
```

Use the database credentials provided by the production database service.

### JWT secrets

Both JWT secrets are required and must be different.

```env
JWT_SECRET=your-long-random-access-token-secret
JWT_REFRESH_SECRET=your-different-long-random-refresh-secret
```

Use strong random values and do not reuse development secrets.

### Redis configuration

If Redis-backed functionality is enabled:

```env
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0
REDIS_URL=redis://your-redis-host:6379
```

Use the Redis connection details supplied by the production Redis service.

### CORS configuration

Set the production frontend origin instead of the local development origin.

```env
CORS_ORIGIN=https://your-frontend-domain.example
CORS_CREDENTIALS=true
```

The backend should allow the deployed frontend URL to access the API.

---

## 3. Optional External Services

The backend environment template contains configuration for several optional integrations, including:

* SMTP/email
* AWS S3
* Stripe
* AssemblyAI
* OpenAI
* Google APIs
* webhook integrations
* application monitoring and metrics

Only configure the services that are enabled and required by the production deployment.

Keep all API keys, webhook secrets, SMTP credentials, and cloud credentials outside source control.

---

## 4. Database Configuration

The application uses MySQL.

Create the production database before running the application.

The migration files are stored in:

```text
migrations/
```

Run the migrations from the backend directory:

```bash
cd backend
npm install
npm run migrate
```

To inspect migration status:

```bash
npm run migrate:status
```

If an existing database already contains the application's schema and needs to be adopted by the migration system, use the project's baseline command only after confirming that the existing schema matches the expected application state:

```bash
npm run migrate:baseline
```

Do not use the baseline command as a replacement for applying new migrations to an existing managed database.

### Migration safety

Before applying migrations to a production database:

1. Back up the database.
2. Confirm the target database and credentials.
3. Review pending migrations.
4. Apply the migrations.
5. Verify the application can connect successfully.

---

## 5. Redis Configuration

Redis is included in the project's Docker Compose configuration and is used for supporting application functionality such as caching, rate limiting, and sessions.

For a production deployment, use a managed or properly secured Redis instance when appropriate.

Verify that the backend environment variables point to the production Redis service:

```env
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0
REDIS_URL=redis://your-redis-host:6379
```

Do not expose Redis publicly without appropriate network and authentication controls.

---

## 6. Backend Deployment

Clone the repository on the backend hosting environment:

```bash
git clone <repository-url>
cd E-commerce
```

Install the backend dependencies:

```bash
cd backend
npm ci
```

Create and configure:

```text
backend/.env
```

Apply the database migrations:

```bash
npm run migrate
```

Start the backend:

```bash
npm start
```

The backend uses the configured `PORT` environment variable and defaults to port `5000` when it is not specified.

For production, use the process-management and restart capabilities provided by the selected hosting platform.

---

## 7. Backend Health Verification

After the backend starts, verify that the server is reachable through its health endpoint:

```text
https://your-backend-domain.example/health
```

A successful response indicates that the backend server has started and is responding to HTTP requests.

Also verify that:

* The database connection succeeds.
* Redis connectivity succeeds when enabled.
* No required environment variable errors appear in the logs.
* The application reports the expected production environment.
* API requests can reach the backend.

---

## 8. Frontend Deployment

The frontend is a collection of static HTML, CSS, and JavaScript files under:

```text
frontend/
```

The repository already contains:

```text
frontend/vercel.json
```

which provides the Vercel routing and security-header configuration.

### Vercel deployment

Create a new Vercel project and connect it to the repository.

Configure the project so that the frontend directory is used as the deployment root:

```text
frontend/
```

Because the frontend is static, no framework-specific build command is required unless the deployment platform configuration introduces one.

After deployment, verify that the main pages and required static assets load correctly.

---

## 9. Frontend and Backend URLs

The frontend must communicate with the deployed backend rather than the local development server.

Update the production frontend configuration wherever the API URL is defined so that requests point to:

```text
https://your-backend-domain.example
```

The backend should use the corresponding frontend URL:

```env
FRONTEND_URL=https://your-frontend-domain.example
```

Keep production URLs separate from local URLs such as:

```text
http://localhost:5000
http://localhost:5500
```

---

## 10. CORS Configuration

CORS must allow the deployed frontend origin.

For example:

```env
CORS_ORIGIN=https://your-frontend-domain.example
CORS_CREDENTIALS=true
```

Do not blindly copy the development origins from the example configuration into production.

If the frontend is moved to a different domain, update the backend CORS configuration accordingly.

### CORS verification

Open the deployed frontend and perform an API-backed operation such as:

* signing in,
* loading products,
* viewing the cart,
* or loading an authenticated page.

If the browser reports a CORS error, verify that the exact frontend origin is configured on the backend.

---

## 11. Production Security Checklist

Before exposing the application publicly:

* Set `NODE_ENV=production`.
* Use strong, unique JWT secrets.
* Never commit `.env` files.
* Use HTTPS for production URLs.
* Configure the production frontend origin.
* Use secure database credentials.
* Restrict database network access.
* Secure the Redis instance.
* Keep API keys and webhook secrets private.
* Disable development-only debugging.
* Review production logs for startup or configuration errors.
* Keep dependencies updated according to the project's maintenance process.

The backend already distinguishes some development-only behavior using `NODE_ENV`, so setting the production environment correctly is important.

---

## 12. Deployment Verification

After deploying both applications, perform the following checks.

### Backend

```text
GET https://your-backend-domain.example/health
```

Verify that the endpoint responds successfully.

### Frontend

Open:

```text
https://your-frontend-domain.example
```

Verify that:

* The homepage loads.
* CSS and JavaScript assets load.
* Product pages work.
* Authentication pages load.
* API requests reach the production backend.
* No browser CORS errors occur.

### Database

Verify that:

* The production database is reachable.
* Required migrations have been applied.
* Application queries succeed.

### Redis

If Redis is enabled, verify that the backend can connect to the configured Redis instance.

### Logs

Check the backend hosting platform's logs for:

* startup errors,
* database connection errors,
* Redis connection errors,
* missing environment variables,
* CORS errors,
* authentication configuration errors.

---

## 13. Common Production Problems

### Database connection failed

Check:

```env
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
```

Also verify that the production server is allowed to connect to the MySQL instance.

---

### JWT configuration error

Make sure both values are configured:

```env
JWT_SECRET=...
JWT_REFRESH_SECRET=...
```

Use different strong secrets for each value.

---

### CORS error in the browser

Verify:

```env
FRONTEND_URL=https://your-frontend-domain.example
CORS_ORIGIN=https://your-frontend-domain.example
```

Make sure the origin matches the deployed frontend URL exactly.

---

### Backend starts locally but not in production

Check:

1. `NODE_ENV` is configured correctly.
2. Required environment variables are present.
3. Node.js version is supported.
4. Dependencies were installed with `npm ci`.
5. The configured `PORT` is available to the hosting platform.
6. The hosting platform is starting the backend with `npm start`.

---

### Database tables are missing

Run:

```bash
cd backend
npm run migrate
```

Then check the migration status:

```bash
npm run migrate:status
```

---

### Frontend cannot reach the API

Check that the frontend is using the production backend URL instead of:

```text
http://localhost:5000
```

Also verify the backend CORS configuration.

---

## 14. Production Deployment Summary

The recommended deployment flow is:

```text
1. Prepare production infrastructure
        ↓
2. Configure backend/.env
        ↓
3. Configure MySQL
        ↓
4. Configure Redis when required
        ↓
5. Install backend dependencies
        ↓
6. Run database migrations
        ↓
7. Start the backend
        ↓
8. Deploy frontend/ to Vercel
        ↓
9. Configure frontend → backend URL
        ↓
10. Configure backend CORS
        ↓
11. Verify /health and application flows
        ↓
12. Monitor logs and production services
```

For every production deployment, keep credentials and secrets outside the repository and verify the backend, frontend, database, and supporting services independently before considering the deployment complete.
