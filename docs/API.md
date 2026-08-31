\# 📡 API Endpoints Documentation



This document provides detailed documentation for the major REST API endpoints available in the E-commerce backend.



> \*\*Note:\*\* Endpoint paths below are shown relative to the backend API base path. Check the project configuration for the complete base URL.



\---



\## 📑 Table of Contents



\* \[Authentication](#authentication)

\* \[Products](#products)

\* \[Cart](#cart)

\* \[Checkout](#checkout)

\* \[Orders](#orders)

\* \[Wishlist](#wishlist)

\* \[Addresses](#addresses)

\* \[Promotions](#promotions)

\* \[Common Response Format](#common-response-format)

\* \[Authentication Requirements](#authentication-requirements)



\---



\## 🔐 Authentication



Base path: `/auth`



\### GET `/auth/status`



Checks whether the authentication API is running.



\*\*Authentication:\*\* Not required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Auth API running",

&#x20; "timestamp": "2026-01-01T00:00:00.000Z",

&#x20; "version": "2.1.0"

}

```



\*\*Common Errors:\*\*



\* `500` — Server error



\---



\### POST `/auth/signup`



Starts the user registration process and sends an OTP to the provided email address.



\*\*Authentication:\*\* Not required



\*\*Request Body:\*\*



```json

{

&#x20; "name": "John Doe",

&#x20; "email": "user@example.com",

&#x20; "password": "Password@123"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "OTP sent to email",

&#x20; "userId": "user-id"

}

```



\*\*Common Errors:\*\*



\* `400` — Missing or invalid fields

\* `429` — Too many OTP requests

\* `500` — Failed to send OTP



\---



\### POST `/auth/verify-signup`



Verifies the OTP sent during registration and creates the user account.



\*\*Authentication:\*\* Not required



\*\*Request Body:\*\*



```json

{

&#x20; "email": "user@example.com",

&#x20; "otp": "123456"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Account created successfully",

&#x20; "cartMerged": false

}

```



\*\*Common Errors:\*\*



\* `400` — Missing fields

\* `400` — Invalid OTP

\* `400` — Expired OTP

\* `500` — Server error during verification



\---



\### POST `/auth/login`



Authenticates an existing user.



\*\*Authentication:\*\* Not required



\*\*Request Body:\*\*



```json

{

&#x20; "email": "user@example.com",

&#x20; "password": "Password@123"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Login successful",

&#x20; "accessToken": "<access-token>",

&#x20; "refreshToken": "<refresh-token>",

&#x20; "familyId": "<session-family-id>",

&#x20; "user": {

&#x20;   "id": "user-id",

&#x20;   "name": "John Doe",

&#x20;   "email": "user@example.com",

&#x20;   "role": "user"

&#x20; }

}

```



\*\*Common Errors:\*\*



\* `400` — Missing or invalid fields

\* `401` — Invalid credentials

\* `403` — Account deactivated

\* `429` — Too many failed login attempts

\* `500` — Server error



\---



\### POST `/auth/forgot-password`



Requests a password-reset OTP.



\*\*Authentication:\*\* Not required



\*\*Request Body:\*\*



```json

{

&#x20; "email": "user@example.com"

}

```



\*\*Success Response:\*\*



The endpoint intentionally returns a generic successful response to avoid revealing whether an email address is registered.



\*\*Common Errors:\*\*



\* `200` — Generic response for valid or unknown email addresses

\* `429` — Too many password-reset requests



\---



\### POST `/auth/reset-password`



Resets the user's password using the OTP received by email.



\*\*Authentication:\*\* Not required



\*\*Request Body:\*\*



```json

{

&#x20; "userId": "appwrite-user-id",

&#x20; "otp": "123456",

&#x20; "newPassword": "NewPassword@123"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Password reset successfully. You can now login."

}

```



\*\*Common Errors:\*\*



\* `400` — Missing required fields

\* `400` — Invalid OTP

\* `400` — Invalid password

\* `400` — Invalid or expired OTP

\* `500` — Failed to reset password



\---



\### POST `/auth/refresh-token`



Rotates a refresh token and issues a new access token.



\*\*Authentication:\*\* Refresh token required



\*\*Request Body:\*\*



```json

{

&#x20; "refreshToken": "<refresh-token>"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Token refreshed",

&#x20; "accessToken": "<new-access-token>",

&#x20; "refreshToken": "<new-refresh-token>",

&#x20; "familyId": "<session-family-id>"

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid refresh token format

\* `401` — Missing or invalid refresh token

\* `403` — Account deactivated

\* `500` — Server error



\---



\### POST `/auth/logout`



Logs out the current user and invalidates the presented session.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "refreshToken": "<refresh-token>"

}

```



To log out from all devices:



```json

{

&#x20; "allDevices": true

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Logged out successfully",

&#x20; "timestamp": "2026-01-01T00:00:00.000Z"

}

```



\*\*Common Errors:\*\*



\* `401` — Missing or invalid authentication

\* `500` — Server error



\---



\### GET `/auth/me`



Returns the currently authenticated user's basic information.



\*\*Authentication:\*\* Required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "user": {

&#x20;   "id": "user-id",

&#x20;   "name": "John Doe",

&#x20;   "email": "user@example.com",

&#x20;   "role": "user"

&#x20; }

}

```



\*\*Common Errors:\*\*



\* `401` — Missing or invalid token

\* `403` — Account deactivated

\* `404` — User not found

\* `500` — Server error



\---



\### GET `/auth/profile`



Returns the authenticated user's editable profile.



\*\*Authentication:\*\* Required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "profile": {

&#x20;   "name": "John Doe",

&#x20;   "email": "user@example.com"

&#x20; }

}

```



\*\*Common Errors:\*\*



\* `401` — Missing or invalid token

\* `403` — Account deactivated

\* `404` — Account not found

\* `500` — Server error



\---



\### PUT `/auth/profile`



Updates the authenticated user's profile.



Only fields provided in the request body are updated.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "name": "John Smith"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Profile updated",

&#x20; "profile": {

&#x20;   "name": "John Smith"

&#x20; }

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid, unknown, or non-editable field

\* `401` — Missing or invalid token

\* `404` — Account not found

\* `500` — Server error



\---



\### POST `/auth/change-password`



Changes the password for an authenticated user.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "currentPassword": "OldPassword@123",

&#x20; "newPassword": "NewPassword@123"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Password changed successfully. Please login again on all devices."

}

```



\*\*Common Errors:\*\*



\* `400` — Missing required fields

\* `400` — Invalid password

\* `401` — Current password is incorrect

\* `404` — User not found

\* `500` — Server error



\---



\## 🛍️ Products



Base path: `/products`



\### GET `/products`



Returns a paginated list of products.



\*\*Authentication:\*\* Not required unless specified by the route configuration.



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "products": \[],

&#x20; "pagination": {

&#x20;   "page": 1,

&#x20;   "limit": 20

&#x20; }

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid query parameters

\* `500` — Server error



\---



\### GET `/products/{id}`



Returns details for a specific product.



\*\*Authentication:\*\* Not required unless specified by the route configuration.



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "product": {}

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid product ID

\* `404` — Product not found

\* `500` — Server error



\---



\### GET `/products/status/check`



Checks whether the product API is running.



\*\*Authentication:\*\* Not required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true

}

```



\*\*Common Errors:\*\*



\* `500` — Server error



\---



\## 🛒 Cart



Base path: `/cart`



\### GET `/cart`



Returns the authenticated user's shopping cart.



\*\*Authentication:\*\* Required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "cart": \[]

}

```



\*\*Common Errors:\*\*



\* `401` — Unauthorized

\* `500` — Server error



\---



\### POST `/cart/add`



Adds a product to the authenticated user's cart.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "productId": "product-id",

&#x20; "quantity": 1

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Item added to cart"

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid request

\* `401` — Unauthorized

\* `409` — Inventory conflict

\* `500` — Server error



\---



\### POST `/cart/sync`



Synchronizes a client-side cart with the server cart.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "items": \[]

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "message": "Cart synced"

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid cart data

\* `401` — Unauthorized

\* `500` — Server error



\---



\## 💳 Checkout



Base path: `/checkout`



\### POST `/checkout/quote`



Creates a server-authoritative quote for the current basket.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "items": \[]

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "quote": {}

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid basket

\* `401` — Unauthorized

\* `409` — Unable to price basket

\* `500` — Server error



\---



\### POST `/checkout/challenge/issue`



Issues a bot-resistance proof-of-work challenge.



\*\*Authentication:\*\* Required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "challenge": {}

}

```



\*\*Common Errors:\*\*



\* `401` — Unauthorized

\* `500` — Server error



\---



\## 📦 Orders



Base path: `/orders`



\### POST `/orders`



Creates an order using the supported payment methods.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "items": \[],

&#x20; "paymentMethod": "COD"

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "order": {}

}

```



\*\*Common Errors:\*\*



\* `400` — Validation failed

\* `401` — Unauthorized

\* `409` — Inventory or total mismatch

\* `500` — Server error



\---



\### POST `/orders/create-payment-intent`



Creates an order and Stripe payment intent.



\*\*Authentication:\*\* Required



\*\*Request Body:\*\*



```json

{

&#x20; "items": \[]

}

```



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "paymentIntent": {}

}

```



\*\*Common Errors:\*\*



\* `400` — Invalid request

\* `401` — Unauthorized

\* `409` — Inventory or total mismatch

\* `500` — Server error



\---



\### GET `/orders/my-orders`



Returns the authenticated user's orders.



\*\*Authentication:\*\* Required



\*\*Success Response:\*\*



```json

{

&#x20; "success": true,

&#x20; "orders": \[]

}

```



\*\*Common Errors:\*\*



\* `401` — Unauthorized

\* `500` — Server error



\---



\## ❤️ Wishlist



Base path: `/wishlist`



Wishlist endpoints are used to manage products saved by authenticated users.



\*\*Authentication:\*\* Required for user-specific wishlist operations.



Common operations include:



\* Adding a product to the wishlist

\* Removing a product from the wishlist

\* Viewing saved products

\* Managing wishlist sharing features



\*\*Common Errors:\*\*



\* `400` — Invalid product or request data

\* `401` — Unauthorized

\* `404` — Product or wishlist item not found

\* `500` — Server error



\---



\## 📍 Addresses



Base path: `/addresses`



Address endpoints manage the authenticated user's saved delivery addresses.



\*\*Authentication:\*\* Required



Common operations include:



\* Creating an address

\* Updating an address

\* Removing an address

\* Listing saved addresses



\*\*Common Errors:\*\*



\* `400` — Invalid address data

\* `401` — Unauthorized

\* `404` — Address not found

\* `500` — Server error



\---



\## 🏷️ Promotions



Base path: `/promos`



Promotion endpoints handle promotional codes and offers.



\*\*Authentication:\*\* Depends on the individual endpoint.



Common operations include:



\* Validating promo codes

\* Applying promotional offers

\* Retrieving available promotions



\*\*Common Errors:\*\*



\* `400` — Invalid promo code or request

\* `404` — Promotion not found

\* `500` — Server error



\---



\## 🔒 Authentication Requirements



Protected endpoints require a valid JWT access token.



The access token should normally be supplied using the authentication mechanism configured by the backend.



Example:



```http

Authorization: Bearer <access-token>

```



Some authentication flows also use refresh tokens through the request body or cookies.



\### Public endpoints



Examples of endpoints that do not require an authenticated user:



\* `GET /auth/status`

\* `POST /auth/signup`

\* `POST /auth/verify-signup`

\* `POST /auth/login`

\* `POST /auth/forgot-password`

\* `POST /auth/reset-password`



\### Protected endpoints



Examples:



\* `POST /auth/logout`

\* `GET /auth/me`

\* `GET /auth/profile`

\* `PUT /auth/profile`

\* `POST /auth/change-password`

\* Cart operations

\* Checkout operations

\* Order operations

\* User-specific wishlist operations

\* User address operations



\---



\## 📋 Common Response Format



Successful requests generally return a JSON response containing a `success` property.



Example:



```json

{

&#x20; "success": true,

&#x20; "message": "Operation completed successfully"

}

```



Error responses generally include:



```json

{

&#x20; "success": false,

&#x20; "message": "Error description"

}

```



HTTP status codes are used to indicate the result of the request:



| Status Code | Meaning                                        |

| ----------- | ---------------------------------------------- |

| `200`       | Request completed successfully                 |

| `201`       | Resource created successfully                  |

| `400`       | Invalid request or validation error            |

| `401`       | Authentication required or invalid credentials |

| `403`       | Access forbidden or account deactivated        |

| `404`       | Resource not found                             |

| `409`       | Resource or inventory conflict                 |

| `429`       | Rate limit exceeded                            |

| `500`       | Internal server error                          |



\---



\## 🔗 Related Documentation



\* `README.md` — Project overview and API endpoint summary

\* `backend/openapi/ecommerce.openapi.yaml` — OpenAPI specification

\* `backend/routes/` — Backend route definitions

\* `backend/controllers/` — Request handling and response logic

\* `backend/middleware/` — Authentication and request validation



> \*\*Maintenance:\*\* When adding or changing a major API endpoint, update this document and the OpenAPI specification where applicable.



