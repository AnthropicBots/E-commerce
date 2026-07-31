# Bugfix Requirements Document

## Introduction

When a user removes an item from the cart, it is permanently lost — there is no way to save it for purchasing later. The cart UI exposes a `move-wishlist-btn` button in the item template, but clicking it produces no observable result: the handler reads the wishlist correctly, but the button carries no visual label or icon indicating it moves the item to the wishlist, the toast notification is never shown with the "Moved to Wishlist ♡" message, and the `♡ Move to Wishlist` label is absent from the rendered button. This leads to accidental permanent item loss and contributes to cart abandonment. The fix must wire up the complete "Move to Wishlist" flow using the existing `AppUtils.getWishlist()`, `AppUtils.saveWishlist()`, and `AppUtils.notify()` utilities — with no backend changes required.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user clicks the action button next to a cart item intended to move it to the wishlist THEN the system removes the item from the cart without displaying a "Moved to Wishlist ♡" toast notification

1.2 WHEN a user views a cart item THEN the system renders a plain button with no heart icon and no "Move to Wishlist" label, giving no affordance that the action saves the item to the wishlist

1.3 WHEN a user clicks the move-to-wishlist button on an item that is already present in the wishlist THEN the system adds a duplicate entry to the wishlist instead of skipping the add

1.4 WHEN a user removes a cart item using the "Remove" button THEN the system permanently discards the item with no path to recover or save it to the wishlist

### Expected Behavior (Correct)

2.1 WHEN a user clicks the "♡ Move to Wishlist" button on a cart item THEN the system SHALL remove the item from the cart, add it to the wishlist in localStorage, and display a toast notification reading "Moved to Wishlist ♡" via `AppUtils.notify()`

2.2 WHEN a cart item is rendered THEN the system SHALL display a clearly labelled "♡ Move to Wishlist" button with a heart icon that communicates its purpose to the user

2.3 WHEN a user clicks the "♡ Move to Wishlist" button on a cart item whose `id`, `color`, and `size` already exist in the wishlist THEN the system SHALL remove the item from the cart only, skip adding a duplicate to the wishlist, and still display the "Moved to Wishlist ♡" toast notification

2.4 WHEN the move-to-wishlist action completes THEN the system SHALL re-render the cart and sync shared cart UI so item counts and totals reflect the removal

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user clicks the "Remove" button on a cart item THEN the system SHALL CONTINUE TO remove the item from the cart and display the undo toast as before

3.2 WHEN a user clicks the "Save for Later" button on a cart item THEN the system SHALL CONTINUE TO move the item to the "Saved for Later" section stored under `savedForLater` in localStorage

3.3 WHEN a user adjusts item quantity using the increase or decrease buttons THEN the system SHALL CONTINUE TO update the cart quantity and re-render totals correctly

3.4 WHEN a user applies a coupon code THEN the system SHALL CONTINUE TO validate and apply the discount to cart totals without interference from the move-to-wishlist feature

3.5 WHEN a user views the wishlist page after moving an item there THEN the system SHALL CONTINUE TO display all previously wishlisted items alongside the newly moved item without duplication

3.6 WHEN the cart is empty after all items are moved or removed THEN the system SHALL CONTINUE TO render the empty cart state with the "Continue Shopping" button

---

## Bug Condition Pseudocode

**Bug Condition Function** — identifies the inputs that trigger the defect:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type CartItemAction
  OUTPUT: boolean

  // The bug fires when the user attempts to move a cart item to the wishlist
  RETURN X.action = "move-to-wishlist"
       AND X.cartItem EXISTS
END FUNCTION
```

**Property: Fix Checking** — verifies the defect is resolved for all buggy inputs:

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  result ← handleMoveToWishlist'(X)
  ASSERT cartNoLongerContains(result.cart, X.cartItem)
  ASSERT wishlistContains(result.wishlist, X.cartItem)
  ASSERT toastShown(result, "Moved to Wishlist ♡")
  ASSERT noDuplicatesIn(result.wishlist)
END FOR
```

**Property: Preservation Checking** — verifies non-buggy interactions are unaffected:

```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
