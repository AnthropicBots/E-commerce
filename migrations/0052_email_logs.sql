-- ============================================
-- SOMEWHERE FOR THE EMAIL AUDIT TRAIL TO GO
-- ============================================
--
-- `emailService` reads from and writes to a table called `email_logs`. Nothing
-- has ever created it (#1699). Before this file, `grep -rn email_logs
-- migrations/` returned nothing at all, and the only two references in the repo
-- were the INSERT and the SELECT in the service itself.
--
-- The failure was invisible by construction. The insert is written as
--
--     await db.query(`INSERT INTO email_logs ...`).catch(() => {});
--
-- so MySQL's ER_NO_SUCH_TABLE is discarded and `recordEmailLog` returns as if
-- it had succeeded, and `getEmailLogs` catches the same error on the SELECT and
-- quietly answers from `emailLogBuffer`, a 100-entry array in module scope.
-- That buffer is empty after every restart or deploy, and in a multi-instance
-- deployment each process sees only its own sends -- so `admin-email-logs.html`
-- is an audit view that cannot audit anything older than whichever process
-- happened to answer. There is no record anywhere of a *failed* delivery once
-- the process recycles, which is exactly what an operator needs when a customer
-- says their confirmation never arrived.
--
-- COLUMNS
--
-- The shape is dictated by the service, not invented here:
--
--   recordEmailLog() INSERTs recipient, subject, order_id, status, channel,
--   error -- and nothing else. getEmailLogs() SELECTs id, recipient, subject,
--   order_id, status, channel, sent_at, error.
--
-- `sent_at` is therefore written by the column default rather than by the
-- service: it is selected and ordered on but never inserted, so without a
-- default every row would sort as NULL and "recent logs" would be meaningless.
--
-- `order_id` is nullable and carries no foreign key. recordEmailLog passes null
-- whenever the caller has no order, and a log entry must outlive the thing it
-- describes -- an order erased under a data-deletion request should not take
-- the record of what was mailed about it with it, and ON DELETE CASCADE would
-- do exactly that. CHAR(36) matches `orders.id`, which is a UUID.
--
-- `status` and `channel` are VARCHAR rather than ENUM. The service already
-- writes four statuses ('sent', 'failed', 'logged' and whatever a caller
-- passes) and two channels, and a new transport should not need a migration
-- before it can log that it ran.
--
-- `error` is TEXT: it holds whatever the transport threw, and SMTP failures are
-- routinely longer than 255 characters.
--
-- INDEXES
--
-- `idx_email_logs_sent_at` serves the only query the service makes today,
-- `ORDER BY sent_at DESC LIMIT ?`, which is a filesort over the whole table
-- without it. The other two serve the questions an operator actually arrives
-- with: "what was mailed about this order" and "what failed".

CREATE TABLE IF NOT EXISTS email_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    recipient VARCHAR(320) NOT NULL,
    subject VARCHAR(255) NOT NULL,

    order_id CHAR(36) NULL,

    status VARCHAR(32) NOT NULL DEFAULT 'sent',
    channel VARCHAR(32) NOT NULL DEFAULT 'log',

    error TEXT NULL,

    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_email_logs_sent_at (sent_at),
    INDEX idx_email_logs_order (order_id),
    INDEX idx_email_logs_status (status, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
