const redisClient = require('./redis-client');
const debug = require('debug')('bte:biothings-explorer-trapi:cache_handler');
const LogEntry = require('./log_entry');
const { parentPort } = require('worker_threads');
const _ = require('lodash');
const async = require('async');
const helper = require('./helper');
const lz4 = require('lz4');
const chunker = require('stream-chunker');
const { Readable, Transform } = require('stream');

class DelimitedChunks extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this._buffer = '';
  }

  _transform(chunk, encoding, callback) {
    this._buffer += chunk;
    if (this._buffer.includes(',')) {
      const parts = this._buffer.split(',');
      this._buffer = parts.pop();
      parts.forEach((part) => {
        const parsedPart = JSON.parse(lz4.decode(Buffer.from(part, 'base64url')).toString());
        this.push(parsedPart);
      });
      callback();
    }
  }

  _flush(callback) {
    try {
      if (this._buffer.length) {
        const final = JSON.parse(lz4.decode(Buffer.from(this._buffer, 'base64url')).toString());
        callback(null, final);
      }
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = class {
  constructor(qXEdges, caching, metaKG = undefined, logs = []) {
    this.qXEdges = qXEdges;
    this.metaKG = metaKG;
    this.logs = logs;
    this.cacheEnabled =
      caching === false
        ? false
        : process.env.RESULT_CACHING !== 'false'
        ? !(process.env.REDIS_HOST === undefined) && !(process.env.REDIS_PORT === undefined)
        : false;
    this.logs.push(
      new LogEntry('DEBUG', null, `REDIS cache is ${this.cacheEnabled === true ? '' : 'not'} enabled.`).getLog(),
    );
  }

  async categorizeEdges(qXEdges) {
    if (this.cacheEnabled === false) {
      return {
        cachedRecords: [],
        nonCachedQXEdges: qXEdges,
      };
    }
    let nonCachedQXEdges = [];
    let cachedRecords = [];
    debug('Begin edge cache lookup...');
    for (let i = 0; i < qXEdges.length; i++) {
      const qXEdgeKGHashes = this._hashEdgeByKG(qXEdges[i].getHashedEdgeRepresentation());
      const cachedRecordJSON = await new Promise(async (resolve) => {
        const redisID = 'bte:edgeCache:' + qXEdgeKGHashes;
        const unlock = await redisClient.lock('redisLock:' + qXEdgeKGHashes);
        try {
          const cachedRecord = await redisClient.hgetallAsync(redisID);
          if (cachedRecord) {
            const decodedRecords = [];
            const sortedRecords = Object.entries(cachedRecord)
              .sort(([key1], [key2]) => parseInt(key1) - parseInt(key2))
              .map(([_key, val]) => {
                return val;
              });

            const recordStream = Readable.from(sortedRecords);
            recordStream
              .pipe(this.createDecodeStream())
              .on('data', (obj) => decodedRecords.push(obj))
              .on('end', () => resolve(decodedRecords));
          } else {
            resolve(null);
          }
        } catch (error) {
          resolve(null);
          debug(`Cache lookup/retrieval failed due to ${error}. Proceeding without cache.`);
        } finally {
          unlock();
        }
      });

      if (cachedRecordJSON) {
        this.logs.push(
          new LogEntry(
            'DEBUG',
            null,
            `BTE finds cached records for ${qXEdges[i].getID()}`,
            {
              type: 'cacheHit',
              edge_id: qXEdges[i].getID(),
            }
          ).getLog()
        );
        cachedRecordJSON.map((rec) => {
          rec.$edge_metadata.trapi_qEdge_obj = qXEdges[i];
        });
        cachedRecords = [...cachedRecords, ...cachedRecordJSON];
      } else {
        nonCachedQXEdges.push(qXEdges[i]);
      }
      debug(`Found (${cachedRecords.length}) cached records.`);
    }
    return { cachedRecords, nonCachedQXEdges };
  }

  _copyRecord(record) {
    const objs = {
      $input: record.$input.obj,
      $output: record.$output.obj,
    };

    const copyObjs = Object.fromEntries(
      Object.entries(objs).map(([which, nodes]) => {
        return [
          which,
          {
            original: record[which].original,
            obj: nodes.map((obj) => {
              const copyObj = Object.fromEntries(Object.entries(obj).filter(([key]) => !key.startsWith('__')));
              Object.entries(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(obj)))
                .filter(([key, descriptor]) => typeof descriptor.get === 'function' && key !== '__proto__')
                .map(([key]) => key)
                .forEach((key) => {
                  copyObj[key] = obj[key];
                });
              return copyObj;
            }),
          },
        ];
      }),
    );

    const returnVal = { ...record };
    returnVal.$edge_metadata = { ...record.$edge_metadata };
    // replaced after taking out of cache, so save some memory
    returnVal.$edge_metadata.trapi_qEdge_obj = undefined;
    returnVal.$input = copyObjs.$input;
    returnVal.$output = copyObjs.$output;
    return returnVal;
  }

  _hashEdgeByKG(qXEdgeHash) {
    if (!this.metaKG) {
      return qXEdgeHash;
    }
    const len = String(this.metaKG.ops.length);
    const allIDs = Array.from(new Set(this.metaKG.ops.map((op) => op.association.smartapi.id))).join('');
    return new helper()._generateHash(qXEdgeHash + len + allIDs);
  }

  _groupQueryRecordsByQXEdgeHash(queryRecords) {
    let groupedRecords = {};
    queryRecords.map((record) => {
      try {
        const qXEdgeKGHash = this._hashEdgeByKG(record.$edge_metadata.trapi_qEdge_obj.getHashedEdgeRepresentation());
        if (!(qXEdgeKGHash in groupedRecords)) {
          groupedRecords[qXEdgeKGHash] = [];
        }
        groupedRecords[qXEdgeKGHash].push(this._copyRecord(record));
      } catch (e) {
        debug('skipping malformed record');
      }
    });
    return groupedRecords;
  }

  createEncodeStream() {
    return new Transform({
      writableObjectMode: true,
      transform: (chunk, encoding, callback) => {
        callback(null, lz4.encode(JSON.stringify(chunk)).toString('base64url') + ',');
      },
      flush: (callback) => {
        callback();
      },
    });
  }

  createDecodeStream() {
    return new DelimitedChunks();
  }

  async cacheEdges(queryRecords) {
    if (this.cacheEnabled === false) {
      if (parentPort) {
        parentPort.postMessage({ cacheDone: true });
      }
      return;
    }
    if (parentPort) {
      parentPort.postMessage({ cacheInProgress: 1 });
    }
    debug('Start to cache query records.');
    try {
      const groupedRecords = this._groupQueryRecordsByQXEdgeHash(queryRecords);
      const qXEdgeHashes = Array.from(Object.keys(groupedRecords));
      debug(`Number of hashed edges: ${qXEdgeHashes.length}`);
      await async.eachSeries(qXEdgeHashes, async (hash) => {
        // lock to prevent caching to/reading from actively caching edge
        const unlock = await redisClient.lock('redisLock:' + hash);
        try {
          const redisID = 'bte:edgeCache:' + hash;
          await redisClient.delAsync(redisID); // prevents weird overwrite edge cases
          await new Promise((resolve) => {
            let i = 0;
            Readable.from(groupedRecords[hash])
              .pipe(this.createEncodeStream())
              .pipe(chunker(100000, { flush: true }))
              .on('data', async (chunk) => {
                await redisClient.hsetAsync(redisID, String(i++), chunk);
              })
              .on('end', () => {
                resolve();
              });
          });
          await redisClient.expireAsync(redisID, process.env.REDIS_KEY_EXPIRE_TIME || 600);
        } catch (error) {
          console.log(error);
        } finally {
          unlock(); // release lock whether cache succeeded or not
        }
      });
      debug(`Successfully cached (${queryRecords.length}) query records.`);
    } catch (error) {
      debug(`Caching failed due to ${error}. This does not terminate the query.`);
    } finally {
      if (parentPort) {
        parentPort.postMessage({ cacheDone: 1 });
      }
    }
  }
};
