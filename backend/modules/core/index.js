// backend/modules/core/index.js
const { DomainEventBus } = require('./domainEventBus');
const { AggregateRoot } = require('./aggregateRoot');
const { Entity } = require('./entity');
const { ValueObject } = require('./valueObject');
const { Repository } = require('./repository');
const { DomainService } = require('./domainService');

module.exports = {
    DomainEventBus,
    AggregateRoot,
    Entity,
    ValueObject,
    Repository,
    DomainService
};