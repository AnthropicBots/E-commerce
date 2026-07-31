// backend/config/constants.js

// Wishlist share tokens are generated in wishlistController.generateShareLink
// as `crypto.randomBytes(32).toString('hex')`, i.e. exactly 64 lowercase hex
// characters.
//
// `SHARE_TOKEN_MAX_LENGTH` and `SHARE_TOKEN_REGEX` were destructured by
// routes/wishlistRoutes.js but never defined here (#1295). `SHARE_TOKEN_MAX_LENGTH`
// resolved to `undefined`, and `token.length > undefined` is always false, so
// the length guard silently accepted tokens of any size.
const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_MAX_LENGTH = SHARE_TOKEN_BYTES * 2; // hex encoding doubles the byte count

module.exports = {
  // Wishlist limits
  MAX_WISHLIST_SYNC_LIMIT: 200,
  MAX_BATCH_OPERATION_LIMIT: 50,

  // Allowed export formats
  SUPPORTED_EXPORT_FORMATS: ['csv', 'json'],

  // Wishlist share tokens
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_MAX_LENGTH,
  SHARE_TOKEN_REGEX: /^[a-f0-9]{64}$/,
};
