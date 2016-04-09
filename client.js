
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var io = require('socket.io-client')
var typeforce = require('typeforce')
var backoff = require('backoff')
var extend = require('xtend')
var debug = require('debug')('sendy-ws')

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

  this._connected = false
  this._connecting = false
  this._clientOpts = extend({ reconnection: false, path: this._url.pathname, query: this._url.query })
  delete this._clientOpts.url
  if (opts.autoConnect) this.connect()
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.connect = function () {
  this._reconnect()
}

Client.prototype._debug = function () {
  var args = [].slice.call(arguments)
  args.unshift(this._url)
  return debug.apply(null, args)
}

Client.prototype.send = function (data) {
  var self = this
  if (this._destroyed) throw new Error('destroyed')
  if (!this._connected) {
    // this.once('connect', this.send.bind(this, data))
    return this.connect()
  }

  this._socket.emit('message', data)
}

Client.prototype._reconnect = function () {
  var self = this
  if (this._connecting || this._connected || this._destroyed) return

  // this._debug('reconnecting', this._socket.id)

  var base = this._url.protocol + '//' + this._url.host
  this._socket = io(base, this._clientOpts)

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

  this._socket.on('connect', function () {
    self._backoff.reset()
    self._connected = true
    self._connecting = false
    self.emit('connect')
  })

  this._socket.on('disconnect', function () {
    self._connected = false
    self._connecting = false
    self.emit('disconnect')
    self._reconnect()
  })

  this._socket.on('404', function (them) {
    self._debug('recipient not found: ' + them)
    self.emit('404', them)
  })

  this._socket.on('message', function (data, ack) {
    // self._debug('received msg')
    self.emit('receive', data)
    if (ack) ack()
  })
}

Client.prototype.destroy = function () {
  if (this._destroyed) return

  this._destroyed = true

  if (this._socket) {
    this._socket.disconnect()
    this._socket = null
  }

  this.emit('destroy')
}
