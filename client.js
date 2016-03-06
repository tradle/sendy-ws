
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var io = require('socket.io-client')
var typeforce = require('typeforce')
var backoff = require('backoff')
var debug = require('debug')('reliable-websocket')
var Sendy = require('sendy')
var protobuf = require('protocol-buffers')
var Packet = protobuf(require('@tradle/protobufs').ws).Packet

// var donothing = function (data) {
//   return data
// }

// var DEFAULT_DATA_EVENTS = ['message']

function Client (opts) {
  var self = this

  typeforce({
    url: 'String',
    identifier: 'String',
    identifierEncoding: 'String',
    autoconnect: '?Boolean',
    maxPayloadSize: '?Number',
    // encode: '?Function',
    // decode: '?Function',
    // socket: '?Object'
    // dataEvents: '?Array'
  }, opts)

  EventEmitter.call(this)

  this._identifier = opts.identifier
  this._identifierEncoding = opts.identifierEncoding
  this._identifierBuf = new Buffer(opts.identifier, opts.identifierEncoding)
  this._url = parseURL(opts.url)
  this._autoconnect = opts.autoconnect
  this._maxPayloadSize = opts.maxPayloadSize
  this._sendies = {}
  this._backoff = backoff.exponential({ initialDelay: 100 })

  // this._socket = opts.socket
  // this._encode = opts.encode || donothing
  // this._decode = opts.decode || donothing

  this._connected = false
  this._autoconnect = opts.autoconnect
  // this._dataEvents = opts.dataEvents || DEFAULT_DATA_EVENTS
  if (this._autoconnect) this.connect()
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.connect = function () {
  this._reconnect()
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._identifier)
  return debug.apply(null, args)
}

Client.prototype.send = function (to, data, ondelivered) {
  var self = this
  if (!this._connected) this.connect()

  if (!this._sendies[to]) {
    var toBuf = new Buffer(to, this._identifierEncoding)
    var sendy = this._sendies[to] = new Sendy({
      maxPayloadSize: this._maxPayloadSize
    })

    sendy.on('send', function (data) {
      if (!self._connected) return

      self._socket.emit('message', Packet.encode({
        from: self._identifierBuf,
        to: toBuf,
        data: data
      }))
    })

    sendy.on('message', function (data) {
      self.emit('message', data, to)
    })
  }

  this._sendies[to].send(data, ondelivered)
}

Client.prototype._reconnect = function () {
  var self = this
  if (this._connected) return

  // this._debug('reconnecting', this._socket.id)

  var base = this._url.protocol + '//' + this._url.host
  this._socket = io(base, { reconnection: false, path: this._url.path })

  this._backoff.reset()
  this._backoff.removeAllListeners()
  this._backoff.backoff()
  this._backoff.on('ready', function () {
    self._debug('backing off and reconnecting')
    self._backoff.backoff()
    self._socket.connect()
  })

  this._socket.on('connect', function () {
    self._backoff.reset()
    self.emit('connect')
    self._connected = true
  })

  this._socket.on('disconnect', function () {
    self._connected = false
    self.emit('disconnect')
    self._reconnect()
  })

  this._socket.on('message', function (data) {
    var packet = Packet.decode(data)
    var from = packet.from.toString(self._identifierEncoding)
    var sendy = self._sendies[from]

    if (sendy) {
      sendy.receive(packet.data)
    }
  })
}

Client.prototype.destroy = function () {
  if (this._destroyed) return

  this._destroyed = true

  if (this._socket) {
    this._socket.disconnect()
    this._socket = null
  }

  for (var id in this._sendies) {
    this._sendies[id].destroy()
  }

  this._sendies = null
}
