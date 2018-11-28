'use strict'

const unmarshal = require('ipfs-unixfs').unmarshal
const {
  formatCid,
  toMfsPath,
  loadNode
} = require('./utils')
const waterfall = require('async/waterfall')
const pull = require('pull-stream/pull')
const collect = require('pull-stream/sinks/collect')
const asyncMap = require('pull-stream/throughs/async-map')
const filter = require('pull-stream/throughs/filter')
const exporter = require('ipfs-unixfs-exporter')
const log = require('debug')('ipfs:mfs:stat')

const defaultOptions = {
  hash: false,
  size: false,
  withLocal: false,
  cidBase: 'base58btc'
}

module.exports = (context) => {
  return function mfsStat (path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    options = Object.assign({}, defaultOptions, options)

    log(`Fetching stats for ${path}`)

    waterfall([
      (cb) => toMfsPath(context, path, cb),
      ({ mfsPath, depth }, cb) => {
        pull(
          exporter(mfsPath, context.ipld, {
            maxDepth: depth + 1,
            fullPath: true
          }),
          filter(node => node.depth === depth),

          // load DAGNodes for each file
          asyncMap((file, cb) => {
            loadNode(context, {
              cid: file.hash
            }, (err, result) => {
              if (err) {
                return cb(err)
              }

              const {
                node, cid
              } = result

              if (options.hash) {
                return cb(null, {
                  hash: formatCid(cid, options.cidBase)
                })
              } else if (options.size) {
                return cb(null, {
                  size: node.size
                })
              }

              const meta = unmarshal(node.data)

              let blocks = node.links.length

              if (meta.type === 'file') {
                blocks = meta.blockSizes.length
              }

              cb(null, {
                hash: formatCid(cid, options.cidBase),
                size: meta.fileSize() || 0,
                cumulativeSize: node.size,
                blocks: blocks,
                type: meta.type,
                local: undefined,
                sizeLocal: undefined,
                withLocality: false
              })
            })
          }),
          collect((error, results) => {
            if (error) {
              return cb(error)
            }

            if (!results.length) {
              return cb(new Error(`${path} does not exist`))
            }

            log(`Stats for ${path}`, results[0])

            return cb(null, results[0])
          })
        )
      }
    ], callback)
  }
}
