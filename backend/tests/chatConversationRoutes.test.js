// Conversation ids, and the three routes that refused every one of them
// (#1527).
//
// `chat_conversations.id` is `INT AUTO_INCREMENT`. `chat.service` has always
// treated it as one -- `findOrCreateConversation` returns `result.insertId`
// and `validateConversationId` is `parseInt` -- but `chat.controller`
// validated it with `safeUUID`, which every integer fails. So every request
// naming a real conversation was refused as "Invalid ID format" before the
// service was reached: the shopper's own chat history, and both admin actions.

jest.mock("../services/chat.service", () => ({
    getConversationList: jest.fn(),
    getConversationMessages: jest.fn(),
    verifyConversationAccess: jest.fn(),
    updateConversationStatus: jest.fn(),
    assignConversation: jest.fn(),
    getUnreadCount: jest.fn(),
    getActiveConnections: jest.fn(),
    getTotalConnectionCount: jest.fn(),
    getDashboardStats: jest.fn()
}));

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const fs = require("fs");
const path = require("path");

const chatService = require("../services/chat.service");
const chatController = require("../controllers/chat.controller");

const ADMIN = { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", role: "admin" };
const SHOPPER = { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302", role: "user" };

// What findOrCreateConversation hands out: an auto-increment integer, arriving
// back as the string a URL parameter always is.
const CONVERSATION_ID = 42;
const CONVERSATION_PARAM = "42";

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        set(name, value) {
            this.headers[name] = value;
            return this;
        }
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    chatService.verifyConversationAccess.mockResolvedValue(true);
    chatService.getConversationMessages.mockResolvedValue({
        messages: [{ id: 1, message: "Hello" }],
        total: 1,
        limit: 50,
        offset: 0
    });
    chatService.updateConversationStatus.mockResolvedValue(true);
    chatService.assignConversation.mockResolvedValue(true);
    chatService.getUnreadCount.mockResolvedValue(3);
});

describe("an integer conversation id", () => {
    test("is accepted when reading a conversation", async () => {
        const res = mockRes();

        await chatController.getConversationDetails(
            { params: { id: CONVERSATION_PARAM }, query: {}, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(chatService.getConversationMessages).toHaveBeenCalled();
    });

    test("is accepted when changing status", async () => {
        const res = mockRes();

        await chatController.updateStatus(
            {
                params: { id: CONVERSATION_PARAM },
                body: { status: "closed" },
                user: ADMIN
            },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(chatService.updateConversationStatus).toHaveBeenCalledWith(
            CONVERSATION_ID,
            "closed"
        );
    });

    test("is accepted when assigning an admin", async () => {
        const res = mockRes();

        await chatController.assignAdmin(
            { params: { id: CONVERSATION_PARAM }, user: ADMIN },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(chatService.assignConversation).toHaveBeenCalledWith(
            CONVERSATION_ID,
            ADMIN.id
        );
    });

    test("reaches the service as a number, not the string from the URL", async () => {
        await chatController.getConversationDetails(
            { params: { id: CONVERSATION_PARAM }, query: {}, user: SHOPPER },
            mockRes()
        );

        const [id] = chatService.verifyConversationAccess.mock.calls[0];

        expect(id).toBe(CONVERSATION_ID);
        expect(typeof id).toBe("number");
    });
});

describe("an id that is not a conversation id", () => {
    test.each([
        ["a word", "latest"],
        ["empty", ""],
        ["zero", "0"],
        ["negative", "-1"],
        ["a number with a tail", "42-and-a-half"]
    ])("%s is refused with 400", async (_label, value) => {
        const res = mockRes();

        await chatController.getConversationDetails(
            { params: { id: value }, query: {}, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(400);
        expect(chatService.getConversationMessages).not.toHaveBeenCalled();
    });

    test("a UUID is refused too — these ids have never been UUIDs", async () => {
        const res = mockRes();

        await chatController.updateStatus(
            {
                params: { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3303" },
                body: { status: "closed" },
                user: ADMIN
            },
            res
        );

        expect(res.statusCode).toBe(400);
        expect(chatService.updateConversationStatus).not.toHaveBeenCalled();
    });
});

describe("access control still applies", () => {
    test("a shopper reading somebody else's conversation gets 403", async () => {
        chatService.verifyConversationAccess.mockResolvedValue(false);

        const res = mockRes();

        await chatController.getConversationDetails(
            { params: { id: CONVERSATION_PARAM }, query: {}, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(403);
        expect(chatService.getConversationMessages).not.toHaveBeenCalled();
    });

    test("a shopper cannot assign a conversation", async () => {
        const res = mockRes();

        await chatController.assignAdmin(
            { params: { id: CONVERSATION_PARAM }, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(403);
        expect(chatService.assignConversation).not.toHaveBeenCalled();
    });
});

describe("reading a conversation", () => {
    test("answers in the shape the chat widget reads", async () => {
        const res = mockRes();

        await chatController.getConversationDetails(
            { params: { id: CONVERSATION_PARAM }, query: {}, user: SHOPPER },
            res
        );

        // frontend/scripts/chat-widget.js does `res.messages.length`, which was
        // reading `undefined` off a body whose messages were nested two deep.
        expect(Array.isArray(res.body.messages)).toBe(true);
        expect(res.body.messages).toHaveLength(1);
        // The nested shape is still served, so anything reading `data` keeps
        // working.
        expect(res.body.data.messages).toEqual(res.body.messages);
    });

    test("passes the requested page through to the service", async () => {
        await chatController.getConversationDetails(
            {
                params: { id: CONVERSATION_PARAM },
                query: { limit: "20", offset: "40" },
                user: SHOPPER
            },
            mockRes()
        );

        // Neither was passed before, so a conversation longer than the default
        // fifty messages could not be read past its first page from anywhere.
        expect(chatService.getConversationMessages).toHaveBeenCalledWith(
            CONVERSATION_ID,
            20,
            40
        );
    });
});

describe("the unread count", () => {
    test("counts for the caller", async () => {
        const res = mockRes();

        await chatController.getUnreadCount(
            { query: {}, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.count).toBe(3);
        expect(chatService.getUnreadCount).toHaveBeenCalledWith(SHOPPER.id, null);
    });

    test("cannot be asked for somebody else's inbox", async () => {
        await chatController.getUnreadCount(
            // A userId in the query is ignored: the count is scoped to the
            // session, not to a parameter.
            { query: { userId: ADMIN.id }, user: SHOPPER },
            mockRes()
        );

        const [userId] = chatService.getUnreadCount.mock.calls[0];

        expect(userId).toBe(SHOPPER.id);
    });

    test("scoped to one conversation only after an access check", async () => {
        chatService.verifyConversationAccess.mockResolvedValue(false);

        const res = mockRes();

        await chatController.getUnreadCount(
            { query: { conversationId: CONVERSATION_PARAM }, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(403);
        expect(chatService.getUnreadCount).not.toHaveBeenCalled();
    });

    test("refuses a conversation id that is not one", async () => {
        const res = mockRes();

        await chatController.getUnreadCount(
            { query: { conversationId: "latest" }, user: SHOPPER },
            res
        );

        expect(res.statusCode).toBe(400);
    });
});

describe("the routes", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "routes", "chatRoutes.js"),
        "utf8"
    );

    test.each([
        ["/unread-count", "the chat widget asks for it on every page load"],
        ["/stats", "the handler was exported and unreachable"],
        ["/telemetry", "the handler was exported and unreachable"]
    ])("%s is mounted", (route) => {
        expect(source).toContain(`"${route}"`);
    });

    test("every handler the controller exports has a route", () => {
        const mounted = [...source.matchAll(/,\s*(\w+)\);?$/gm)].map((m) => m[1]);

        for (const handler of Object.keys(chatController)) {
            expect(mounted).toContain(handler);
        }
    });

    test("the admin-only routes stay admin-only", () => {
        for (const line of source.split("\n")) {
            if (!/router\.(get|patch|post|delete)/.test(line)) continue;
            if (/unread-count|conversations\/:id"/.test(line)) continue;

            expect(line).toMatch(/authorizeRoles\(ROLES\.ADMIN\)/);
        }
    });
});
