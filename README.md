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

---

# 📂 Updated Project Structure

```text
E-commerce/
│
├── .agents/skills/
│   ├── accessibility-compliance/
│   ├── css/
│   ├── modern-javascript-patterns/
│   ├── responsive-design/
│   ├── semantic-html/
│   └── wcag-audit-patterns/
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── hiero-bot.yml
│
├── backend/
│   ├── config/
│   │   └── db.js
│   │
│   ├── controllers/
│   │   ├── admin.controller.js
│   │   ├── authController.js
│   │   ├── cartController.js
│   │   ├── chat.controller.js
│   │   ├── orderController.js
│   │   ├── pincodeController.js
│   │   ├── productController.js
│   │   ├── promo.controller.js
│   │   ├── recommendationController.js
│   │   └── wishlistController.js
│   │
│   ├── middleware/
|   |   ├── validators/
│   │   ├── adminMiddleware.js
│   │   ├── authMiddleware.js
│   │   ├── rateLimiter.js
│   │   └── rbacMiddleware.js
│   │
│   ├── models/
│   │   ├── Order.js
│   │   ├── Pincode.js
│   │   ├── Product.js
│   │   └── User.js
│   │
│   ├── routes/
│   │   ├── adminRoutes.js
│   │   ├── authRoutes.js
│   │   ├── cartRoutes.js
│   │   ├── chatRoutes.js
│   │   ├── index.js
│   │   ├── orderRoutes.js
│   │   ├── pincodeRoutes.js
│   │   ├── productRoutes.js
│   │   ├── promoRoutes.js
│   │   ├── recommendationRoutes.js
│   │   └── wishlistRoutes.js
│   │
│   ├── scripts/
│   │   └── seedProducts.js
│   │
│   ├── services/
│   │   ├── admin.service.js
│   │   ├── chat.service.js
│   │   ├── interactionService.js
│   │   ├── order.service.js
│   │   ├── promo.service.js
│   │   └── recommendationService.js
│   │
│   ├── sql/               # feature schemas not yet folded into migrations/
│   │   └── README.md
│   │
│   ├── scripts/
│   │   └── migrate.js
│   │
│   ├── utils/
│   │   ├── helpers.js
│   │   └── socketManager.js
│   │
│   ├── .env.example
│   ├── docker-compose.yml
│   ├── package-lock.json
│   ├── package.json
│   └── server.js
│
├── frontend/
│   ├── assets/
│   │   ├── data/
│   │   ├── images/
│   │   └── videos/
│   │
│   ├── components/
│   │   ├── cart-drawer.html
│   │   ├── footer.html
│   │   └── navbar.html
│   │
│   ├── scripts/
│   │   ├── Buy1Get1.js
│   │   ├── about.js
│   │   ├── admin.js
│   │   ├── animations.js
│   │   ├── auth.js
│   │   ├── back-to-top.js
│   │   ├── blog.js
│   │   ├── cart-drawer.js
│   │   ├── cart.js
│   │   ├── chat-widget.js
│   │   ├── checkout.js
│   │   ├── compare.js
│   │   ├── components.js
│   │   ├── config.js
│   │   ├── contact.js
│   │   ├── dashboard-orders.js
│   │   ├── dashboard-overview.js
│   │   ├── dashboard-settings.js
│   │   ├── dashboard-wishlist.js
│   │   ├── dashboard.js
│   │   ├── delivery.js
│   │   ├── early_summer.js
│   │   ├── help.js
│   │   ├── hero.js
│   │   ├── home-init.js
│   │   ├── mens.js
│   │   ├── order.js
│   │   ├── ordersHistory.js
│   │   ├── pincode.js
│   │   ├── privacy.js
│   │   ├── product-actions-home.js
│   │   ├── product-actions.js
│   │   ├── product-cards-home.js
│   │   ├── product-render.js
│   │   ├── product-reviews.js
│   │   ├── product-variants.js
│   │   ├── product.js
│   │   ├── profile.js
│   │   ├── recentlyViewed.js
│   │   ├── recommendations.js
│   │   ├── related-products.js
│   │   ├── script.js
│   │   ├── seasonal.js
│   │   ├── shop-controls.js
│   │   ├── shop.js
│   │   ├── success.js
│   │   ├── terms.js
│   │   ├── toast.js
│   │   ├── tshirt.js
│   │   ├── ui.js
│   │   ├── utils.js
│   │   ├── wishlist.js
│   │   └── womens.js
│   │
│   ├── styles/
│   │   ├── about.css
│   │   ├── admin.css
│   │   ├── animations.css
│   │   ├── auth.css
│   │   ├── back-to-top.css
│   │   ├── base.css
│   │   ├── blog.css
│   │   ├── cart.css
│   │   ├── chat-widget.css
│   │   ├── checkout.css
│   │   ├── components.css
│   │   ├── contact.css
│   │   ├── dashboard.css
│   │   ├── delivery.css
│   │   ├── early_summer.css
│   │   ├── help.css
│   │   ├── hero.css
│   │   ├── layout.css
│   │   ├── order.css
│   │   ├── privacy.css
│   │   ├── product-card.css
│   │   ├── product.css
│   │   ├── profile.css
│   │   ├── seasonal.css
│   │   ├── shop.css
│   │   ├── style.css
│   │   ├── success.css
│   │   ├── terms.css
│   │   ├── tshirt.css
│   │   └── wishlist.css
│   │
│   ├── Buy1Get1.html
│   ├── about.html
│   ├── admin.html
│   ├── blog.html
│   ├── cart.html
│   ├── checkout.html
│   ├── compare.html
│   ├── contact.html
│   ├── dashboard.html
│   ├── delivery.html
│   ├── early_summer.html
│   ├── help.html
│   ├── index.html
│   ├── mens.html
│   ├── order.html
│   ├── privacy.html
│   ├── product.html
│   ├── profile.html
│   ├── robots.html
│   ├── seasonal.html
│   ├── shop.html
│   ├── signin.html
│   ├── signup.html
│   ├── sitemap.xml
│   ├── success.html
│   ├── terms.html
│   ├── tshirt.html
│   ├── vercel.html
│   ├── wishlist.html
│   └── womens.html
│
├── .env.example  
├── .gitattributes        
├── .gitignore
├── AGENTS.md             
├── CHANGELOG.md          
├── CODE_OF_CONDUCT.md    
├── CONTRIBUTING.md
├── LICENSE        
├── README.md
├── SECURITY.md
├── TODO.md
├── docs/legacy/          # historical mysqldump, reference only — not applied
├── migrations/           # ordered schema migrations, applied by npm run migrate
├── package-lock.json
├── package.json   
├── skills-lock.json               
└── test.js                
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
