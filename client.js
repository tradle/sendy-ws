
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var typeforce = require('typeforce')
var extend = require('xtend')
var debug = require('debug')('sendy-ws')
var WebSocket = global.WebSocket || require('ws/lib/WebSocket')
var backoff = require('backoff')
var protobufs = require('sendy-protobufs').ws
var schema = protobufs.schema
var CLIENTS = {}
var noop = function () { debugger }

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

  this._url = opts.url
  this._backoff = opts.backoff || backoff.exponential({
    initialDelay: 100,
    maxDelay: 5000
  })

  this._backoff.on('ready', function () {
    if (self._destroyed) return

    self._closeSocket()
    self._reconnect()
  })

  this._connected = false
  this._connecting = false
  this._opts = extend(opts)
  this._onclose = this._onclose.bind(this)
  this._onopen = this._onopen.bind(this)
  this._onmessage = this._onmessage.bind(this)
  if (opts.autoConnect) this.connect()
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.connect = function () {
  this._backoff.reset()
  this._reconnect()
}

Client.prototype._reconnect = function () {
  if (this._connecting || this._connected || this._destroyed) return

  printStack(this._url)
  this._openSocket()
}

Client.prototype._openSocket = function () {
  this._closeSocket()
  this._connecting = true
  this._socket = new WebSocket(this._url/*, this._wsOptions*/)
  this._socket.onopen = this._onopen
  this._socket.onclose = this._onclose
  this._socket.onmessage = this._onmessage
}

Client.prototype._onmessage = function (e, flags) {
  var packet = global.WebSocket ? e.data : e
  if (packet instanceof ArrayBuffer) {
    packet = new Buffer(packet)
  }

  if (!Buffer.isBuffer(packet)) {
    return this.emit('error', 'ignoring non-binary message')
  }

  var dec = protobufs.decoderFor(packet)
  if (dec === schema.Error) {
    var error = protobufs.decode(packet)
    if (error.type === schema.ErrorType.RecipientNotFound) {
      this.emit('404', error.recipient)
    } else {
      var str = JSON.stringify(error)
      this._debug('received error: ' + str)
      this.emit('error', new Error(str))
    }

    return
  }

  if (dec !== schema.Packet) {
    return this._debug('ignoring unsupported packet', packet)
  }

  var msg = protobufs.decode(packet)
  this.emit('receive', msg)
}

Client.prototype._closeSocket = function () {
  if (this._socket) {
    try {
      this._socket.onclose = noop
      this._socket.close()
    } catch (err) {}

    delete this._socket
  }
}

Client.prototype._onopen = function () {
  this._backoff.reset()
  this._connected = true
  this._connecting = false
  this.emit('connect')
}

Client.prototype._onclose = function () {
  this._connected = false
  this._connecting = false
  this.emit('disconnect')
  this._backoff.backoff()
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
    if (!this._connecting) this.connect()

    return
  }

  try {
    this._socket.send(data, { binary: true, mask: this._opts.mask !== false }, function (err) {
      if (err) self.emit('error', err)
    })
  } catch (err) {
    this._debug('failed to send', err)
  }
}

Client.prototype.destroy = function () {
  if (this._destroyed) return

  this._destroyed = true
  this._closeSocket()
  this.emit('destroy')
}
