
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var io = require('socket.io-client')
var typeforce = require('typeforce')
var backoff = require('backoff')
var extend = require('xtend')
var debug = require('debug')('sendy:ws:client')

var CLIENTS = {}

exports = module.exports = Client
exports.createClient = function (opts) {
  var url = opts.url
  var cli = CLIENTS[url]
  if (!cli) {
    cli = CLIENTS[url] = new Client(opts)
    cli.once('destroy', function () {
      delete CLIENTS[url]
    })
  }

  return cli
}

function Client (opts) {
  var self = this

  typeforce({
    url: 'String',
    autoConnect: '?Boolean'
  }, opts)

  EventEmitter.call(this)

  this._url = parseURL(opts.url)
  this._backoff = backoff.exponential({
    initialDelay: 100,
    maxDelay: 6000
  })

  this._listeners = []
  this._connected = false
  this._connecting = false
  this._clientOpts = extend({
    reconnection: false,
    path: this._url.pathname,
    query: this._url.query,
    forceBase64: opts.forceBase64
  })

  delete this._clientOpts.url
  this._onSocketError = this._onSocketError.bind(this)
  if (opts.autoConnect) this.connect()
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.connect = function () {
  this._reconnect()
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._url.href)
  return debug.apply(null, args)
}

Client.prototype.send = function (data) {
  var self = this
  if (this._destroyed) throw new Error('destroyed')
  if (!this._connected) {
    // this.once('connect', this.send.bind(this, data))
    return this.connect()
  }

  try {
    this._socket.emit('message', data)
  } catch (err) {
    this._onSocketError(err)
  }
}

Client.prototype._reconnect = function () {
  var self = this
  if (this._connecting || this._connected || this._destroyed) return

  // this._debug('reconnecting', this._socket.id)

  var base = this._url.protocol + '//' + this._url.host
  if (!this._socket) {
    this._socket = io(base, this._clientOpts)
  }

  this._connecting = true
  this._backoff.reset()
  this._backoff.removeAllListeners()
  this._backoff.backoff()
  this._backoff.on('ready', function () {
    if (self._destroyed) return

    self._debug('backing off and reconnecting')
    self._backoff.backoff()
    self._socket.connect()
  })

  this._listenTo(this._socket, 'connect', function () {
    self._backoff.reset()
    self._connected = true
    self._connecting = false
    self._debug('connected')
    self.emit('connect')
  })

  this._listenTo(this._socket, 'disconnect', function () {
    self._connected = false
    self._connecting = false
    self._debug('disconnected')
    self.emit('disconnect')
    process.nextTick(function () {
      self._reconnect()
    })
  })

  this._listenTo(this._socket, '404', function (them) {
    self._debug('recipient not found: ' + them)
    self.emit('404', them)
  })

  this._listenTo(this._socket, 'message', function (data, ack) {
    // self._debug('received msg')
    self.emit('receive', data)
    if (ack) ack()
  })

  this._listenTo(this._socket, 'error', this._onSocketError)
}

Client.prototype._listenTo = function (emitter, event, handler) {
  emitter.on(event, handler)
  this._listeners.push({
    emitter: emitter,
    event: event,
    handler: handler
  })
}

Client.prototype._stopListening = function () {
  var listeners = this._listeners.slice()
  listeners.forEach(function (info) {
    info.emitter.off(info.event, info.handler)
  })
}

Client.prototype._killSocket = function () {
  this._debug('destroying')
  var socket = this._socket
  delete this._socket
  socket.disconnect()
  this._stopListening()
}

Client.prototype._onSocketError = function (err) {
  this._debug('socket experienced error', err)
  this._killSocket()
  this._reconnect()
}

Client.prototype.destroy = function () {
  if (this._destroyed) return

  this._destroyed = true

  if (this._socket) {
    this._socket.disconnect()
    this._killSocket()
  }

  this.emit('destroy')
}
