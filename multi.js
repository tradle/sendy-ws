
var util = require('util')
var EventEmitter = require('events').EventEmitter
var typeforce = require('typeforce')
var extend = require('xtend/mutable')
var protobuf = require('protocol-buffers')
var Sendy = require('sendy')
var Packet = protobuf(require('@tradle/protobufs').ws).Packet
var WS = require('./client')

function WSManager (opts) {
  var self = this

  typeforce({
    identifier: 'String',
    url: 'String',
    wsOpts: '?Object',
    sendyOpts: '?Object'
  }, opts)

  EventEmitter.call(this)

  this._url = opts.url
  this._identifier = opts.identifier
  this._sendyOpts = opts.sendyOpts || {}
  this._sendies = {}

  this._wsClient = new WS.Client(extend({
    url: opts.url
  }, opts.wsOpts || {}))

  this._wsClient.on('receive', function (msg) {
    msg = Packet.decode(msg)
    var sendy = self._sendyFor(msg.from)
    sendy.receive(msg.data)
  })
}

util.inherits(WSManager, EventEmitter)
exports = module.exports = WSManager
var proto = WSManager.prototype

proto.send = function (recipient, msg, ondelivered) {
  var sendy = this._sendyFor(recipient)
  sendy.send(msg, ondelivered)
}

proto._sendyFor = function (recipient) {
  var self = this
  var sendy = this._sendies[recipient]
  if (sendy) return sendy

  sendy = this._sendies[recipient] = new Sendy(this._sendyOpts)

  sendy.on('receive', function (msg) {
    // emit message from whoever `recipient` is
    self.emit('message', msg, recipient)
  })

  sendy.on('send', function (msg) {
    msg = Packet.encode({
      from: self._identifier,
      to: recipient,
      data: msg
    })

    self._wsClient.send(msg)
  })

  return sendy
}

proto.destroy = function () {
  for (var recipient in this._sendies) {
    this._sendies[recipient].destroy()
  }

  this._wsClient.destroy()
  delete this._sendies
  delete this._wsClient
}
