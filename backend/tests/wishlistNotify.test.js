/**
 * Wishlist price-drop notification worker tests (#1394).
 */

jest.mock("../config/db", () => ({
    query: jest.fn()
}));

jest.mock("../services/notificationBrokerService", () => ({
    NOTIFICATION_TYPES: {
        WISHLIST_PRICE_DROP: "wishlist.price_drop"
    },
    notificationBroker: {
        publish: jest.fn(async () => ({ id: "n1" }))
    }
}));

const db = require("../config/db");
const { notificationBroker } = require("../services/notificationBrokerService");
const service = require("../services/wishlistNotifyService");
const {
    runPriceDropJob,
    startPriceDropJob,
    PRICE_DROP_CRON
} = require("../jobs/priceDropJob");

beforeEach(() => {
    jest.clearAllMocks();
});

describe("wishlistNotifyService preferences", () => {
    test("getPreferences creates defaults when missing", async () => {
        db.query
            .mockResolvedValueOnce([[]]) // select missing
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // insert
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "abc",
                updated_at: new Date()
            }]]);

        const prefs = await service.getPreferences("u1");
        expect(prefs.priceDropEmail).toBe(true);
        expect(prefs.priceDropInApp).toBe(true);
        expect(prefs.unsubscribeToken).toBeTruthy();
        expect(prefs.unsubscribeUrl).toMatch(/unsubscribe=/);
    });

    test("updatePreferences writes channel flags", async () => {
        db.query
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h",
                updated_at: new Date()
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 0,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h",
                updated_at: new Date()
            }]]);

        // ensurePreferences select + update + getPreferences select
        // getPreferences will hit ensure again
        db.query
            .mockReset()
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h",
                updated_at: new Date()
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 0,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h",
                updated_at: new Date()
            }]]);

        const prefs = await service.updatePreferences("u1", {
            priceDropEmail: false,
            priceDropInApp: true
        });
        expect(prefs.priceDropEmail).toBe(false);
        expect(prefs.priceDropInApp).toBe(true);
    });

    test("stable unsubscribe token opts the user out", async () => {
        const token = service.buildStableUnsubscribeToken("user-42");
        db.query
            .mockResolvedValueOnce([[{
                user_id: "user-42",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "x"
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const result = await service.unsubscribeWithToken(token);
        expect(result.unsubscribedAll).toBe(true);
        expect(result.userId).toBe("user-42");
    });

    test("channelsForPrefs returns empty when unsubscribed_all", () => {
        expect(
            service.channelsForPrefs({
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 1
            })
        ).toEqual([]);
    });
});

describe("wishlistNotifyService scan", () => {
    test("runPriceDropScan notifies once and respects daily dedupe", async () => {
        // syncBaselinesFromWishlist
        db.query
            .mockResolvedValueOnce([[{
                user_id: "u1",
                product_id: "p1",
                price: 80
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert baseline
            // candidates
            .mockResolvedValueOnce([[{
                user_id: "u1",
                product_id: "p1",
                baseline_price: 100,
                last_seen_price: 100,
                last_notified_price: null,
                last_notified_at: null,
                current_price: 80,
                product_name: "Tee",
                user_email: "u@example.com",
                user_name: "U",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h"
            }]])
            // ensurePreferences select
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h"
            }]])
            // alreadyNotifiedToday
            .mockResolvedValueOnce([[]])
            // recordNotificationLog insert
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            // update baseline after notify
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            // refresh last_seen bulk update
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const result = await service.runPriceDropScan();
        expect(result.notified).toBe(1);
        expect(notificationBroker.publish).toHaveBeenCalledWith(
            "wishlist.price_drop",
            expect.objectContaining({
                userId: "u1",
                productId: "p1",
                oldPrice: 100,
                newPrice: 80
            }),
            { channels: ["in_app", "email"] }
        );
    });

    test("skips when already deduped today", async () => {
        db.query
            .mockResolvedValueOnce([[]]) // sync wishlist empty
            .mockResolvedValueOnce([[{
                user_id: "u1",
                product_id: "p1",
                baseline_price: 100,
                last_seen_price: 100,
                last_notified_price: null,
                current_price: 70,
                product_name: "Tee",
                user_email: "u@example.com",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0
            }]])
            .mockResolvedValueOnce([[{
                user_id: "u1",
                price_drop_email: 1,
                price_drop_in_app: 1,
                unsubscribed_all: 0,
                unsubscribe_token_hash: "h"
            }]])
            .mockResolvedValueOnce([[{ id: 9 }]]) // already notified
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // bulk last_seen

        const result = await service.runPriceDropScan();
        expect(result.notified).toBe(0);
        expect(result.skipped).toBeGreaterThanOrEqual(1);
        expect(notificationBroker.publish).not.toHaveBeenCalled();
    });
});

describe("priceDropJob", () => {
    test("exports a cron expression", () => {
        expect(PRICE_DROP_CRON).toMatch(/\S+/);
    });

    test("startPriceDropJob is a no-op under test", () => {
        process.env.NODE_ENV = "test";
        expect(startPriceDropJob()).toBeNull();
    });

    test("runPriceDropJob returns scan summary", async () => {
        const spy = jest
            .spyOn(service, "runPriceDropScan")
            .mockResolvedValue({ candidates: 0, notified: 0, skipped: 0 });
        const result = await runPriceDropJob();
        expect(result).toEqual({ candidates: 0, notified: 0, skipped: 0 });
        spy.mockRestore();
    });
});
