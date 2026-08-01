// src/utils/dateRangeValidator.js

const validateDateRange = (startDate, endDate, options = {}) => {
  const { maxRangeDays = 365, allowFutureDates = false } = options;

  // 1. Check if both dates are provided
  if (!startDate || !endDate) {
    throw new Error('Both startDate and endDate are required.');
  }

  // 2. Check if dates are valid date strings
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime())) {
    throw new Error(`Invalid startDate provided: "${startDate}". Please use a valid date format.`);
  }
  if (isNaN(end.getTime())) {
    throw new Error(`Invalid endDate provided: "${endDate}". Please use a valid date format.`);
  }

  // 3. Check if start date is after end date
  if (start.getTime() > end.getTime()) {
    throw new Error('Start date cannot be later than end date.');
  }

  // 4. (Optional) Reject future dates for admin logs
  if (!allowFutureDates) {
    const now = new Date();
    if (end.getTime() > now.getTime()) {
      throw new Error('End date cannot be in the future.');
    }
  }

  // 5. Check for maximum date range (Prevent overly expensive queries)
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays > maxRangeDays) {
    throw new Error(`Date range cannot exceed ${maxRangeDays} days. You requested ${diffDays} days.`);
  }

  return { start, end };
};

module.exports = { validateDateRange };