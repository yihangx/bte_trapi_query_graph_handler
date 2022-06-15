const { cloneDeep, range } = require('lodash');
const QNode = require('../query_node');
const QEdge = require('../query_edge');
const QueryResult = require('./query_results');
const { Record } = require('@biothings-explorer/api-response-transform');
const config = require('../config.js');

const gene_node_start = new QNode('n1', { categories: ['Gene'], ids: ['NCBIGene:3778'] });
       const disease_node = new QNode('n2', { categories: ['Disease'] });
       const gene_node_end = new QNode('n3', { categories: ['Gene'], ids: ['NCBIGene:7289'] });

       const edge1 = new QEdge('e01', { subject: gene_node_start, object: disease_node });
       const edge2 = new QEdge('e02', { subject: disease_node, object: gene_node_end });

       const record1 = new Record(
         {
           publications: ['PMID:123', 'PMID:1234'],
           subject: {
             original: 'SYMBOL:KCNMA1',
             normalizedInfo: [
               {
                 primaryID: 'NCBIGene:3778',
                 label: 'KCNMA1',
                 dbIDs: {
                   SYMBOL: 'KCNMA1',
                   NCBIGene: '3778',
                 },
                 curies: ['SYMBOL:KCNMA1', 'NCBIGene:3778'],
               },
             ],
           },
           object: {
             original: 'MONDO:0011122',
             normalizedInfo: [
               {
                 primaryID: 'MONDO:0011122',
                 label: 'obesity disorder',
                 dbIDs: {
                   MONDO: '0011122',
                   MESH: 'D009765',
                   name: 'obesity disorder',
                 },
                 curies: ['MONDO:0011122', 'MESH:D009765', 'name:obesity disorder'],
               },
             ],
           },
         },
         config,
         {
           predicate: 'biolink:gene_associated_with_condition',
           api_name: 'Automat Pharos',
         },
         edge1,
       );

       // NOTE: I had to switch subject and object.
       // Compare with first test of this type.
       const record2 = new Record(
         {
           publications: ['PMID:345', 'PMID:456'],
           subject: {
             original: 'SYMBOL:TULP3',
             normalizedInfo: [
               {
                 primaryID: 'NCBIGene:7289',
                 label: 'TULP3',
                 dbIDs: {
                   SYMBOL: 'TULP3',
                   NCBIGene: '7289',
                 },
                 curies: ['SYMBOL:TULP3', 'NCBIGene:7289'],
               },
             ],
           },
           object: {
             original: 'MONDO:0011122',
             normalizedInfo: [
               {
                 primaryID: 'MONDO:0011122',
                 label: 'obesity disorder',
                 dbIDs: {
                   MONDO: '0011122',
                   MESH: 'D009765',
                   name: 'obesity disorder',
                 },
                 curies: ['MONDO:0011122', 'MESH:D009765', 'name:obesity disorder'],
               },
             ],
           },
         },
         config,
         {
           predicate: 'biolink:condition_associated_with_gene',
           api_name: 'Automat Hetio',
         },
         edge2,
       );


async function extractGeneID() {
        const queryResult = new QueryResult();
        await queryResult.update({
          e01: {
            connected_to: ['e02'],
            records: [record1],
          },
          e02: {
            connected_to: ['e01'],
            records: [record2],
          },
        });
        console.log(JSON.stringify(queryResult.getResults()[0]));
           };

 console.log(extractGeneID());
