
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var io = require('socket.io-client')
var wildcardMiddleware = require('socketio-wildcard')
var enableWildcardEventHandlers = wildcardMiddleware(io.Manager)
var typeforce = require('typeforce')
var bindAll = require('bindall')
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
  bindAll(this)
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

Client.prototype.sendCustomEvent = function (event /*, arg0, arg1 */) {
  const self = this
  if (!this._connected) {
    const args = [].slice.call(arguments)
    return this.once('connect', function () {
      self.sendCustomEvent.apply(self, args)
    })
  }

  this._socket.emit.apply(this._socket, arguments)
}

Client.prototype._reconnect = function () {
  var self = this
  if (this._connecting || this._connected || this._destroyed) return

  // this._debug('reconnecting', this._socket.id)

  var base = this._url.protocol + '//' + this._url.host
  if (this._socket) {
    this._stopListening()
  } else {
    this._socket = io(base, this._clientOpts)
    enableWildcardEventHandlers(this._socket)
  }

  this._connecting = true
  this._backoff.reset()
  this._backoff.removeAllListeners()
  this._backoff.backoff()
  this._backoff.on('ready', this._backoffAndConnect)
  this._listenTo(this._socket, 'connect', this._onconnect)
  this._listenTo(this._socket, 'disconnect', this._ondisconnect)
  this._listenTo(this._socket, '404', function (them) {
    self._debug('recipient not found: ' + them)
    self.emit('404', them)
  })

  this._listenTo(this._socket, 'message', function (data, ack) {
    // self._debug('received msg')
    self.emit('receive', data)
    if (ack) ack()
  })

  // this._listenTo(this._socket, 'presence', function (data))

  this._listenTo(this._socket, 'error', this._onSocketError)
  this._listenTo(this._socket, '*', function (e) {
    const data = e.data
    if (data[0] !== 'message') {
      self.emit.apply(self, data)
    }
  })
}

Client.prototype._onconnect = function () {
  this._backoff.reset()
  this._connected = true
  this._connecting = false
  this._debug('connected')
  this.emit('connect')
}

Client.prototype._ondisconnect = function () {
  var self = this
  this._connected = false
  this._connecting = false
  this._debug('disconnected')
  this.emit('disconnect')
  process.nextTick(function () {
    self._reconnect()
  })
}

Client.prototype._backoffAndConnect = function () {
  if (this._destroyed) return

  this._debug('backing off and reconnecting')
  this._backoff.backoff()
  this._socket.connect()
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

  this._listeners.length = 0
}

Client.prototype._killSocket = function () {
  var socket = this._socket
  if (!socket) return

  delete this._socket
  this._backoff.reset()
  this._connected = false
  this._connecting = false
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
  this._debug('destroying')
  this._killSocket()
  this.emit('destroy')
}
