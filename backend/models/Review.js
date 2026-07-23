const db = require("../config/db");
const NodeCache = require('node-cache');

const reviewCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const MAX_COMMENT_LENGTH = 1000;
const MIN_RATING = 1;
const MAX_RATING = 5;

const REVIEW_SORT_OPTIONS = Object.freeze({
  newest: "created_at DESC",
  oldest: "created_at ASC",
  rating_high: "rating DESC",
  rating_low: "rating ASC",
});

class Review {
  constructor(review) {
    this.validate(review);

    this.id = review.id || null;
    this.productId = review.productId || review.product_id;
    this.userId = review.userId || review.user_id;
    this.userName = this.sanitize(review.userName || review.user_name || review.name || "");
    this.rating = review.rating ?? 0;
    this.comment = this.sanitize(review.comment || "");
    this.createdAt = this.parseDate(review.createdAt || review.created_at || new Date());
    this.updatedAt = this.parseDate(review.updatedAt || review.updated_at || new Date());
    this.isDeleted = review.isDeleted !== undefined ? review.isDeleted : review.is_deleted || false;
    this.deletedAt = review.deletedAt || review.deleted_at || null;
  }

  sanitize(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/[<>]/g, '');
  }

  parseDate(value) {
    try {
      const date = new Date(value);
      return isNaN(date.getTime()) ? new Date() : date;
    } catch (error) {
      return new Date();
    }
  }

  static getSafeSort(sort) {
    if (typeof sort !== "string") {
      return REVIEW_SORT_OPTIONS.newest;
    }

    return REVIEW_SORT_OPTIONS[sort] || REVIEW_SORT_OPTIONS.newest;
  }

  static validate(review) {
    const errors = [];

    if (!review.productId && !review.product_id) {
      errors.push("Product ID is required");
    }

    if (!review.userId && !review.user_id) {
      errors.push("User ID is required");
    }

    const rating = review.rating ?? 0;
    if (rating < MIN_RATING || rating > MAX_RATING) {
      errors.push(`Rating must be between ${MIN_RATING} and ${MAX_RATING}`);
    }

    if (review.comment && review.comment.length > MAX_COMMENT_LENGTH) {
      errors.push(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`);
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
    };
  }

  static validateAndThrow(review) {
    const result = Review.validate(review);
    if (!result.isValid) {
      throw new Error(result.errors.join(', '));
    }
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      product_id: this.productId,
      user_id: this.userId,
      user_name: this.userName,
      rating: this.rating,
      comment: this.comment,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      is_deleted: this.isDeleted,
      deleted_at: this.deletedAt,
    };
  }

  isRecent() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return new Date(this.createdAt) >= sevenDaysAgo;
  }

  isHighRating() {
    return this.rating >= 4;
  }

  isLowRating() {
    return this.rating <= 2;
  }

  update(updates) {
    if (updates.rating !== undefined) {
      if (updates.rating < MIN_RATING || updates.rating > MAX_RATING) {
        throw new Error(`Rating must be between ${MIN_RATING} and ${MAX_RATING}`);
      }
      this.rating = updates.rating;
    }

    if (updates.comment !== undefined) {
      if (updates.comment.length > MAX_COMMENT_LENGTH) {
        throw new Error(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`);
      }
      this.comment = this.sanitize(updates.comment);
    }

    if (updates.userName !== undefined) {
      this.userName = this.sanitize(updates.userName);
    } else if (updates.user_name !== undefined) {
      this.userName = this.sanitize(updates.user_name);
    }

    this.updatedAt = new Date();
    return this;
  }

  delete() {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.updatedAt = new Date();
    return this;
  }

  restore() {
    this.isDeleted = false;
    this.deletedAt = null;
    this.updatedAt = new Date();
    return this;
  }

  // ============================================
  // DATABASE OPERATIONS
  // ============================================

  static async findById(id) {
    try {
      const cacheKey = `review_${id}`;
      const cached = reviewCache.get(cacheKey);
      if (cached) return cached;

      const [rows] = await db.query(
        `SELECT * FROM reviews WHERE id = ? AND is_deleted = FALSE`,
        [id]
      );

      if (rows.length === 0) return null;
      const review = new Review(rows[0]);
      reviewCache.set(cacheKey, review);
      return review;
    } catch (error) {
      console.error('Review.findById error:', error.message);
      throw error;
    }
  }

  static async findByProduct(productId, options = {}) {
    try {
      const { limit = 20, offset = 0, sort = "newest", rating = null } = options;
      const safeSort = Review.getSafeSort(sort);

      let query = `SELECT * FROM reviews WHERE product_id = ? AND is_deleted = FALSE`;
      const params = [productId];

      if (rating) {
        query += ` AND rating = ?`;
        params.push(rating);
      }

      query += ` ORDER BY ${safeSort} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const [rows] = await db.query(query, params);
      return rows.map((row) => new Review(row));
    } catch (error) {
      console.error("Review.findByProduct error:", error.message);
      throw error;
    }
  }

  static async findByUser(userId, options = {}) {
    try {
      const { limit = 20, offset = 0, sort = "newest" } = options;
      const safeSort = Review.getSafeSort(sort);

      const [rows] = await db.query(
        `SELECT * FROM reviews WHERE user_id = ? AND is_deleted = FALSE ORDER BY ${safeSort} LIMIT ? OFFSET ?`,
        [userId, limit, offset]
      );

      return rows.map((row) => new Review(row));
    } catch (error) {
      console.error("Review.findByUser error:", error.message);
      throw error;
    }
  }

  async save() {
    try {
      Review.validateAndThrow(this);

      if (this.id) {
        await db.query(
          `UPDATE reviews SET 
            rating = ?, comment = ?, user_name = ?, updated_at = NOW()
           WHERE id = ?`,
          [this.rating, this.comment, this.userName, this.id]
        );
        reviewCache.del(`review_${this.id}`);
        return this;
      } else {
        const [result] = await db.query(
          `INSERT INTO reviews (product_id, user_id, user_name, rating, comment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [this.productId, this.userId, this.userName, this.rating, this.comment]
        );
        this.id = result.insertId;
        return this;
      }
    } catch (error) {
      console.error('Review.save error:', error.message);
      throw error;
    }
  }

  async deletePermanent() {
    try {
      if (!this.id) throw new Error('Review ID is required');
      await db.query(`DELETE FROM reviews WHERE id = ?`, [this.id]);
      reviewCache.del(`review_${this.id}`);
      return true;
    } catch (error) {
      console.error('Review.deletePermanent error:', error.message);
      throw error;
    }
  }

  // ============================================
  // STATIC BULK OPERATIONS
  // ============================================

  static async getProductRatingSummary(productId) {
    try {
      const cacheKey = `rating_summary_${productId}`;
      const cached = reviewCache.get(cacheKey);
      if (cached) return cached;

      const [rows] = await db.query(
        `SELECT 
          COUNT(*) as total_reviews,
          AVG(rating) as average_rating,
          SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
          SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
          SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
          SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
         FROM reviews 
         WHERE product_id = ? AND is_deleted = FALSE`,
        [productId]
      );

      const result = rows[0] || {};
      result.rating_distribution = {
        5: parseInt(result.five_star) || 0,
        4: parseInt(result.four_star) || 0,
        3: parseInt(result.three_star) || 0,
        2: parseInt(result.two_star) || 0,
        1: parseInt(result.one_star) || 0,
      };
      result.average_rating = parseFloat(result.average_rating || 0).toFixed(1);

      reviewCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Review.getProductRatingSummary error:', error.message);
      throw error;
    }
  }

  static async bulkCreate(reviews) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const inserted = [];
      for (const reviewData of reviews) {
        const review = new Review(reviewData);
        await review.save();
        inserted.push(review);
      }

      await connection.commit();
      return inserted;
    } catch (error) {
      await connection.rollback();
      console.error('Review.bulkCreate error:', error.message);
      throw error;
    } finally {
      connection.release();
    }
  }

  static async deleteByProduct(productId) {
    try {
      const [result] = await db.query(
        `UPDATE reviews SET is_deleted = TRUE, deleted_at = NOW() WHERE product_id = ?`,
        [productId]
      );
      reviewCache.flushAll();
      return result.affectedRows;
    } catch (error) {
      console.error('Review.deleteByProduct error:', error.message);
      throw error;
    }
  }

  static async getRecentReviews(limit = 10) {
    try {
      const [rows] = await db.query(
        `SELECT * FROM reviews WHERE is_deleted = FALSE ORDER BY created_at DESC LIMIT ?`,
        [limit]
      );
      return rows.map(row => new Review(row));
    } catch (error) {
      console.error('Review.getRecentReviews error:', error.message);
      throw error;
    }
  }

  static async getTopRated(limit = 10, minReviews = 5) {
    try {
      const [rows] = await db.query(
        `SELECT product_id, AVG(rating) as avg_rating, COUNT(*) as review_count
         FROM reviews 
         WHERE is_deleted = FALSE
         GROUP BY product_id
         HAVING review_count >= ?
         ORDER BY avg_rating DESC
         LIMIT ?`,
        [minReviews, limit]
      );
      return rows;
    } catch (error) {
      console.error('Review.getTopRated error:', error.message);
      throw error;
    }
  }

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  static clearCache(productId = null) {
    if (productId) {
      reviewCache.del(`review_${productId}`);
      reviewCache.del(`rating_summary_${productId}`);
    } else {
      reviewCache.flushAll();
    }
    console.log('Review cache cleared');
    return true;
  }

  static getCacheStats() {
    return {
      keys: reviewCache.keys(),
      size: reviewCache.keys().length,
      hits: reviewCache.getStats?.().hits || 0,
      misses: reviewCache.getStats?.().misses || 0
    };
  }
}

module.exports = Review;