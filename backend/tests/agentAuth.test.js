const agentController = require('../controllers/agentController');
const AgentIdentity = require('../models/AgentIdentity');
const AgentIdentityService = require('../services/agentIdentityService');
const TrustScoringService = require('../services/trustScoringService');
const ReputationService = require('../services/reputationService');
const AgentTransaction = require('../models/AgentTransaction');

jest.mock('../models/AgentIdentity');
jest.mock('../services/agentIdentityService');
jest.mock('../services/trustScoringService');
jest.mock('../services/reputationService');
jest.mock('../models/AgentTransaction');

describe('Agent Controller Authorization Checks', () => {
    let req;
    let res;

    beforeEach(() => {
        req = {
            params: { agentId: 'agent-123' },
            query: {},
            user: { id: 'user-1', role: 'customer' }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        jest.clearAllMocks();
    });

    test('getAgent should return 403 when user does not own the agent', async () => {
        AgentIdentityService.getAgentIdentity.mockResolvedValue({
            agent: { agentId: 'agent-123', ownerId: 'user-2' },
            trustScore: { score: 95 }
        });

        await agentController.getAgent(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('Access denied')
        }));
    });

    test('getAgent should return 200 when user is the owner', async () => {
        AgentIdentityService.getAgentIdentity.mockResolvedValue({
            agent: { agentId: 'agent-123', ownerId: 'user-1' },
            trustScore: { score: 95 }
        });

        await agentController.getAgent(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true
        }));
    });

    test('getAgent should return 200 when user is an admin', async () => {
        req.user = { id: 'admin-user', role: 'admin' };
        AgentIdentityService.getAgentIdentity.mockResolvedValue({
            agent: { agentId: 'agent-123', ownerId: 'user-2' },
            trustScore: { score: 95 }
        });

        await agentController.getAgent(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('getTransactions should return 403 when user does not own the agent', async () => {
        AgentIdentity.findOne.mockResolvedValue({ agentId: 'agent-123', ownerId: 'user-2' });

        await agentController.getTransactions(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
