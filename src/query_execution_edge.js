const helper = require('./helper');
const debug = require('debug')('biothings-explorer-trapi:QExeEdge');
const utils = require('./utils');
const reverse = require('./biolink');

module.exports = class QExeEdge {
    /**
     *
     * @param {string} id - QEdge ID
     * @param {object} info - QEdge info, e.g. subject, object, predicate
     */
    constructor(qEdge, reverse = false, prev_edge = undefined) {
        this.qEdge = qEdge;
        this.reverse = reverse;
        this.prev_edge = prev_edge;
        this.input_equivalent_identifiers = {};
        this.output_equivalent_identifiers = {};
    }

    getID() {
        return this.qEdge.getID();
    }

    getHashedEdgeRepresentation() {
        const toBeHashed =
            this.subject.getCategories() + this.predicate + this.object.getCategories() + this.getInputCurie();
        return new helper()._generateHash(toBeHashed);
    }

    getPredicate() {
        if (this.qEdge.predicate === undefined) {
            return undefined;
        }
        const predicates = utils.toArray(this.qEdge.predicate);
        return predicates
            .map((predicate) => {
                const predicateWithOutPrefix = utils.removeBioLinkPrefix(predicate);
                return this.reverse === true ? reverse.reverse(predicateWithOutPrefix) : predicateWithOutPrefix;
            })
            .filter((item) => !(typeof item === 'undefined'));
    }

    getSubject() {
        if (this.reverse) {
            return this.qEdge.object;
        }
        return this.qEdge.subject;
    }

    getObject() {
        if (this.reverse) {
            return this.qEdge.subject;
        }
        return this.qEdge.object;
    }

    isReversed() {
        return this.reverse;
    }

    getInputCurie() {
        let curie = this.qEdge.subject.getCurie() || this.qEdge.object.getCurie();
        if (Array.isArray(curie)) {
            return curie;
        }
        return [curie];
    }

    getInputNode() {
        return this.reverse ? this.qEdge.object : this.qEdge.subject;
    }

    getOutputNode() {
        return this.reverse ? this.qEdge.subject : this.qEdge.object;
    }

    hasInputResolved() {
        return !(Object.keys(this.input_equivalent_identifiers).length === 0)
    }

    hasInput() {
        if (this.reverse) {
            return this.qEdge.object.hasInput();
        }
        return this.qEdge.subject.hasInput();
    }
};
