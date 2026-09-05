# 🛒 E-Commerce Website — Full-Stack Open Source Project

> A modern, responsive, and feature-rich full-stack e-commerce platform built using **Node.js, Express.js, MySQL, JWT, HTML, CSS, and Vanilla JavaScript**.

This project includes:
- User authentication system
- Product browsing & filtering
- Shopping cart & checkout flow
- Wishlist system
- Admin dashboard
- Order management
- Responsive modern UI
- Open source contribution support

---

# 🌐 Live Demo

🚀 Live Website:  
https://e-commerce-git-main-bhuvanshs-projects.vercel.app

---

# 📌 Features

## 👤 Authentication
- User Signup & Login
- JWT Authentication
- Refresh Token System
- Protected Routes
- Admin Role Support

## 🛍️ Shopping Features
- Product Listing
- Product Detail Page
- Search & Filtering
- Category Filtering
- Sorting System
- Recently Viewed Products
- Wishlist System
- Cart Drawer
- Full Cart Management

## 💳 Checkout & Orders
- Checkout Validation
- Order Placement
- Order History
- Address Management
- Shipping Calculation
- Tax Calculation

## ⚙️ Admin Features
- Add Products
- Edit Products
- Deletee Products
- Dashboard Overview
- User Management
- Order Monitoring

## 🎨 UI/UX
- Fully Responsive Design
- Modern Product Cards
- Toast Notifications
- Ripple Effects
- Smooth Animations
- Mobile Navigation
- Lazy Loaded Images

## 🔒 Security Improvements
- Helmet Security Middleware
- Request Rate Limiting
- Input Validation
- JWT Authentication
- Secure Cart & Checkout Flow
- Backend Total Verification

---

# 🛠️ Tech Stack

| Technology | Usage |
|---|---|
| Node.js | Backend Runtime |
| Express.js | API Framework |
| MySQL | Database |
| JWT | Authentication |
| HTML5 | Frontend Structure |
| CSS3 | Styling |
| JavaScript | Frontend Logic |
| Vercel | Frontend Deployment |

### 📌 Key Directory Guide

- **`.github/`** – Contains GitHub issue templates and repository automation configuration.
- **`.agents/`** – Contains reusable agent skills and development guidance.
- **`backend/`** – Contains the server-side application, API routes, controllers, services, database logic, middleware, and backend tests.
- **`frontend/`** – Contains the client-side assets, reusable components, JavaScript, and styles.
- **`docs/`** – Contains project documentation and supporting references.
- **`migrations/`** – Contains ordered database schema migrations.
- **`scripts/`** – Contains repository-level development and utility scripts.

---

# 📂 Updated Project Structure

The repository is organized into separate frontend and backend directories, along with documentation, database migrations, development scripts, and project configuration files.

```text
E-commerce/
├── .agents/
│   └── skills/
│       ├── accessibility-compliance/
│       ├── css/
│       ├── modern-javascript-patterns/
│       ├── responsive-design/
│       ├── semantic-html/
│       └── wcag-audit-patterns/
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── hiero-bot.yml
│
├── backend/
│   ├── config/              # Application and database configuration
│   ├── constants/           # Shared backend constants
│   ├── controllers/         # Request and business logic controllers
│   ├── core/                # Core backend functionality
│   ├── docs/                # Backend-specific documentation
│   ├── jobs/                # Background and scheduled jobs
│   ├── middleware/          # Authentication, validation, and request middleware
│   ├── models/              # Database models
│   ├── modules/             # Feature-specific backend modules
│   ├── openapi/             # OpenAPI/API specifications
│   ├── plugins/             # Backend plugins and extensions
│   ├── repositories/        # Data access and repository logic
│   ├── routes/              # API route definitions
│   │   ├── v1/              # Version 1 API routes
│   │   ├── v2/              # Version 2 API routes
│   │   ├── v3/              # Version 3 API routes
│   │   ├── authRoutes.js
│   │   ├── cartRoutes.js
│   │   ├── checkoutRoutes.js
│   │   ├── orderRoutes.js
│   │   ├── productRoutes.js
│   │   ├── wishlistRoutes.js
│   │   └── index.js
│   ├── scripts/             # Backend utility and maintenance scripts
│   ├── services/            # Business and external service integrations
│   ├── sql/                 # SQL-related resources
│   ├── tests/               # Backend test suites
│   ├── utils/               # Shared backend utilities
│   └── validators/           # Request and data validation logic
│
├── frontend/
│   ├── assets/              # Images, data, videos, and other assets
│   ├── components/          # Reusable HTML components
│   ├── scripts/             # Frontend JavaScript files
│   └── styles/              # Frontend CSS stylesheets
│
├── docs/                    # Project documentation and legacy references
├── migrations/              # Ordered database schema migrations
├── scripts/                 # Repository-level development scripts
│
├── .env.example             # Example environment configuration
├── .gitattributes           # Git attribute configuration
├── .gitignore               # Git ignore rules
├── AGENTS.md                # Agent and automation instructions
├── CHANGELOG.md             # Project change history
├── CODE_OF_CONDUCT.md       # Community guidelines
├── CONTRIBUTING.md          # Contribution guidelines
├── LICENSE                  # Project license
├── package-lock.json        # Root dependency lock file
├── package.json             # Root project configuration and scripts
├── SECURITY.md              # Security policy
├── skills-lock.json         # Skills dependency lock file
├── test.js                  # Project test entry point
└── TODO.md                  # Pending tasks and improvements

     
```

---

# 🚀 Local Setup Guide

## 📋 Prerequisites

Before starting, make sure you have the following installed:

* Node.js (v18 or higher recommended)
* npm
* MySQL Server
* Git
* VS Code (recommended)

Verify installation:

```bash
node -v
npm -v
mysql --version
git --version
```

---

## 1️⃣ Clone Repository

```bash
git clone https://github.com/AnthropicBots/E-commerce.git
cd E-commerce
```

---

# ⚙️ Backend Setup

## 2️⃣ Navigate to Backend Folder

```bash
cd backend
```

---

## 3️⃣ Install Dependencies

```bash
npm install
```

Wait for all packages to install successfully.

---

## 4️⃣ Create MySQL Database

Login to MySQL:

```bash
mysql -u root -p
```

Enter your MySQL password when prompted.

Create the database:

```sql
CREATE DATABASE ecommerce;
```

Verify database creation:

```sql
SHOW DATABASES;
```

You should see:

```text
ecommerce
```

---

## 5️⃣ Apply Database Migrations

Inside the backend folder run:

```bash
npm run migrate
```

This creates every table the application needs, in order, and records what it
applied in a `schema_migrations` table. Re-running it is safe: already-applied
migrations are skipped.

To see what would run without changing anything:

```bash
npm run migrate:status
```

If your database predates the migration sequence and already has the tables,
adopt the baseline first so it is not applied a second time:

```bash
npm run migrate:baseline
npm run migrate
```

---

## 6️⃣ Create Environment File

Create a `.env` file inside the `backend/` folder.

Copy values from `.env.example`.

Example:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=ecommerce

JWT_SECRET=your_secret_key

PORT=5000
FRONTEND_URL=http://127.0.0.1:5500
```

### ⚠️ Important

If your MySQL root account has a password:

```env
DB_PASSWORD=your_mysql_password
```

If your MySQL root account has no password:

```env
DB_PASSWORD=
```

---

## 7️⃣ Start Backend Server

Run:

```bash
npm run dev
```

If the above command is unavailable:

```bash
npm start
```

Backend will run at:

```text
http://localhost:5000
```

---

## 8️⃣ Verify Backend Setup

A successful startup should show messages similar to:

```text
Database connected successfully
Server running on port 5000
```

If you see these messages, your backend setup is complete.

---

# 🌐 Frontend Setup

## 9️⃣ Open Frontend Folder

Open the project in VS Code.

Navigate to:

```text
frontend/
```

---

## 🔟 Run Frontend

Using VS Code Live Server:

1. Open `index.html`
2. Right Click
3. Select **Open with Live Server**

Frontend will run at:

```text
http://127.0.0.1:5500
```

---

## 📡 API Endpoints Reference

The backend API is organized into feature-based route groups. Below is a quick overview of the major endpoint categories.

| Category | Base Path | Purpose |
|----------|-----------|---------|
| Authentication | `/auth` | User registration, login, logout, password management, and authentication status. |
| Products | `/products` | Product listing, search, details, reviews, and product management. |
| Orders | `/orders` | Order creation, tracking, history, invoices, and order management. |
| Cart | `/cart` | Add, update, remove, restore, and manage shopping cart items. |
| Wishlist | `/wishlist` | Manage user wishlists, sharing, and wishlist analytics. |
| Wishlist Notifications | `/wishlist-notify` | Notification preferences and wishlist alert management. |
| Recommendations | `/recommendations` | Product recommendations and user interaction tracking. |
| Checkout | `/checkout` | Checkout workflow, quotes, and order verification. |
| Promotions | `/promos` | Promo code validation and promotional offers. |
| Refunds | `/refunds` | Refund requests and refund management. |
| Addresses | `/addresses` | User address book management. |
| Pincode | `/pincode` | Delivery availability lookup using postal codes. |
| Subscriptions | `/subscriptions` | Subscribe, pause, resume, and cancel subscriptions. |
| Chat | `/chat` | Customer support conversations and messaging. |
| Admin | `/admin` | Administrative operations and management endpoints. |
| Contact | `/contact` | Contact form submission and customer inquiries. |
| Interactions | `/interactions` | Record user interactions for analytics and recommendations. |
| Courier Webhooks | `/courier-webhooks` | Receive webhook events from courier partners. |

### Route Source Files

The primary route definitions are located under `backend/routes/`:

- `index.js`
- `authRoutes.js`
- `productRoutes.js`
- `orderRoutes.js`
- `cartRoutes.js`
- `wishlistRoutes.js`
- `wishlistNotifyRoutes.js`
- `recommendationRoutes.js`
- `checkoutRoutes.js`
- `promoRoutes.js`
- `refundRoutes.js`
- `addressRoutes.js`
- `subscriptionRoutes.js`
- `pincodeRoutes.js`
- `chatRoutes.js`
- `adminRoutes.js`
- `contactRoutes.js`
- `interactionRoutes.js`
- `courierWebhookRoutes.js`

> **Note:** The project supports API versioning (`/v1`, `/v2`, and `/v3`). All versions currently share the same route definitions through a common router while allowing future version-specific customization.

### 📚 Detailed API Documentation

For detailed HTTP methods, authentication requirements, request examples,
success responses, and common error responses, see the
[Detailed API Documentation](docs/API.md).

### 🔐 Authentication & Authorization

Most protected API endpoints require a valid JWT access token.

Include the token in the request headers:

```http
Authorization: Bearer <your_jwt_token>
```

Administrative endpoints require both authentication and the appropriate admin role or permissions.

### 📝 Example API Request

#### Login

**Request**

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your_password"
}
```

> **Response:** On successful authentication, the server returns a JSON response containing authentication details (such as access tokens and/or user information). The exact response structure depends on the API version and implementation.

---

# 🔧 Common Setup Issues

## MySQL Access Denied

Error:

```text
Access denied for user 'root'@'localhost'
```

Solution:

* Verify MySQL is running
* Check `DB_USER`
* Check `DB_PASSWORD`
* Test login manually:

```bash
mysql -u root -p
```

---

## Unknown Database 'ecommerce'

Error:

```text
Unknown database 'ecommerce'
```

Solution:

```sql
CREATE DATABASE ecommerce;
```

Then apply the migrations:

```bash
cd backend
npm run migrate
```

---

## Cannot Find Module

Error:

```text
Cannot find module ...
```

Solution:

```bash
npm install
```

inside the backend folder.

---

## Port Already In Use

Error:

```text
EADDRINUSE
```

Solution:

Change:

```env
PORT=5001
```

inside `.env`.

---

## Still Facing Issues?

Please create a GitHub issue and include:

* Operating System
* Node.js version
* npm version
* Screenshot of terminal
* Full error message
* Steps already tried

Maintainers will help you resolve the issue.

---

## 🎯 Learning Goals

This project demonstrates:

* Full-stack web development fundamentals
* REST API development using Node.js & Express
* MySQL database integration and query handling
* JWT-based authentication & authorization
* Frontend UI/UX design and responsive layouts
* DOM manipulation and dynamic rendering
* Cart, checkout, and order management systems
* Admin dashboard development
* Real-world e-commerce application architecture
* API integration between frontend and backend
* Open-source project structuring and collaboration
* Debugging, validation, and error handling

---

## 👨‍💻 Maintainers & Organization

This project is developed under the **[Anthropic Bots](https://github.com/AnthropicBots)** organization.

### 👑 Organization Owner
**[Mohit Yadav](https://github.com/mohityadav8)**

- Founder & Owner of Anthropic Bots
- Passionate about Full-Stack Development & Software Engineering
- Focused on building scalable real-world applications

---

### 🛠️ Project Maintainer
**[Bhuvansh Kataria](https://github.com/BHUVANSH855)**

- Active maintainer of this E-Commerce project
- Responsible for feature development, backend integration, bug fixes, and open-source improvements
- Contributing towards improving project structure, security, and overall user experience

---
💡 This project is actively maintained and improved through open-source collaboration.

Contributions, suggestions, and improvements are always welcome.

---

## 📜 License

This project is licensed under the MIT License and is free to use for learning and educational purposes.

---

⭐ If you like this project, consider giving it a star on GitHub and supporting the repository!
