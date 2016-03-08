
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var io = require('socket.io-client')
var typeforce = require('typeforce')
var backoff = require('backoff')
var extend = require('xtend')
var debug = require('debug')('reliable-websocket')

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
  this._backoff = backoff.exponential({ initialDelay: 100 })

  this._connected = false
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
  if (!this._connected) {
    return this.connect()
  }

  this._socket.emit('message', data)
}

Client.prototype._reconnect = function () {
  var self = this
  if (this._connected || this._destroyed) return

  // this._debug('reconnecting', this._socket.id)

  var base = this._url.protocol + '//' + this._url.host
  this._socket = io(base, this._clientOpts)

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
    self.emit('connect')
    self._connected = true
  })

  this._socket.on('disconnect', function () {
    self._connected = false
    self.emit('disconnect')
    self._reconnect()
  })

  this._socket.on('message', function (data) {
    self.emit('receive', data)
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
