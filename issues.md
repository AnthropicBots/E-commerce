## 1. Bug: Fatal SQL Syntax Error in Wishlist Deletion

### Description
The `removeFromWishlist` function in `backend/controllers/wishlistController.js` contains a hardcoded typo in the SQL query: it uses `DeleteE FROM wishlist_items` instead of `DELETE FROM wishlist_items`. This breaks the endpoint.

---

## 2. Bug: Information Disclosure via DB Error Leak (Products)

### Description
In `backend/controllers/productController.js`, when fetching products fails, the raw `error.message` is passed directly into the JSON response at line 169. This can expose sensitive database details.

---

## 3. Bug: Typo in Exported Function Name (Products)

### Description
In `backend/controllers/productController.js`, the product deletion function is named `DeleteeProduct` (with an extra 'e') at line 421. It should be `deleteProduct`.

---

## 4. Bug: XSS Fallback in Blog Rendering

### Description
In `frontend/scripts/blog.js`, the code uses `textDiv.innerHTML = window.DOMPurify ? DOMPurify.sanitize(post.content) : post.content;`. This fallback is insecure and allows DOM-based XSS if DOMPurify fails to load.
