
var util = require('util')
var EventEmitter = require('events').EventEmitter
var typeforce = require('typeforce')
var BaseClient = require('./client')
var protobuf = require('protocol-buffers')
var WSPacket = protobuf(require('@tradle/protobufs').ws).Packet

function Client (opts) {
  var self = this

  typeforce({
    identifier: 'String',
    url: 'String'
  }, opts)

  EventEmitter.call(this)

  this._url = opts.url
  this._socket = null
  this._clients = {}
  this._identifier = new Buffer(opts.identifier)
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.send = function (to, msg, ondelivered) {
  if (!this._clients[to]) {
    this._createClient(to)
  }

  var client = this._clients[to]
  return client.send(msg, ondelivered)
}

Client.prototype._createClient = function (to) {
  var self = this

  // TODO:
  // figure out how to make sure utp connections
  // don't overlap. Maybe they already can't
  var identifier = this._identifier
  var client = this._clients[to] = new BaseClient({
    url: this._url,
    encode: function (msg) {
      return WSPacket.encode({
        from: identifier,
        to: new Buffer(to),
        data: msg
      })
    },
    decode: function (msg) {
      return WSPacket.decode(msg).data
    }
  })

  client.on('message', function (msg) {
    self.emit('message', msg, to)
  })
}

Client.prototype.destroy = function () {
  if (this._destroyed) return

  for (var id in this._clients) {
    this._clients[id].destroy()
  }

  this._destroyed = true
  this._clients = null
}
