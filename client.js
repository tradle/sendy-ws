
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var io = require('socket.io-client')
var typeforce = require('typeforce')
var backoff = require('backoff')
var debug = require('debug')('reliable-websocket')
var Sendy = require('sendy')
var donothing = function (data) {
  return data
}

var DEFAULT_DATA_EVENTS = ['message']

function Client (opts) {
  var self = this

  typeforce({
    url: '?String',
    autoconnect: '?Boolean',
    maxPayloadSize: '?Number',
    encode: '?Function',
    decode: '?Function',
    // socket: '?Object'
    // dataEvents: '?Array'
  }, opts)

  EventEmitter.call(this)

  this._url = parseURL(opts.url)
  this._autoconnect = opts.autoconnect
  this._queued = []
  this._backoff = backoff.exponential({ initialDelay: 100 })
  this._sendy = new Sendy({
    maxPayloadSize: opts.maxPayloadSize
  })

  // this._socket = opts.socket
  this._encode = opts.encode || donothing
  this._decode = opts.decode || donothing
  this._sendy.on('send', function (data) {
    if (self._connected) {
      self._socket.emit('message', self._encode(data))
    }
  })

  this._sendy.on('message', function (data) {
    self.emit('message', data)
  })

  this._connected = false
  // this._dataEvents = opts.dataEvents || DEFAULT_DATA_EVENTS
  if (this._autoconnect !== false) this.connect()
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.connect = function () {
  var self = this

  if (this._connected) return
  if (this._socket) return this._reconnect()

  var base = this._url.protocol + '//' + this._url.host
  this._socket = io(base, { reconnection: false, path: this._url.path })

  this._socket.on('connect', function () {
    self.emit('connect')
    self._connected = true
  })

  this._socket.on('disconnect', function () {
    self._connected = false
    self.emit('disconnect')
    if (self._autoconnect) self._reconnect()
  })

  this._socket.on('message', function (data) {
    self._sendy.receive(self._decode(data))
  })

  // this._dataEvents.forEach(event, function (e) {
  //   self._socket.on(e, function (data) {
  //     self._sendy.receive(data)
  //   })
  // })
}

Client.prototype.send = function (data, ondelivered) {
  if (!this._connected) this.connect()

  this._sendy.send(data, ondelivered)
}

Client.prototype._reconnect = function () {
  var self = this
  this._backoff.reset()
  this._backoff.removeAllListeners()
  this._backoff.backoff()
  this._backoff.on('ready', function () {
    debug('backing off and reconnecting')
    self._backoff.backoff()
    self._socket.connect()
  })

  this._socket.once('connect', function () {
    self._backoff.reset()
  })
}

Client.prototype.destroy = function () {
  if (this._socket) this._socket.disconnect()

  this._sendy.destroy()
}
