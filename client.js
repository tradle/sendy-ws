
var util = require('util')
var EventEmitter = require('events').EventEmitter
var parseURL = require('url').parse
var typeforce = require('typeforce')
var extend = require('xtend')
var debug = require('debug')('sendy-ws')
var WebSocket = require('ws')
var backoff = require('backoff')
var protobufs = require('sendy-protobufs').ws
var schema = protobufs.schema
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

  this._url = opts.url
  this._backoff = opts.backoff || backoff.exponential({
    initialDelay: 100,
    maxDelay: 5000
  })

  this._backoff.on('ready', function () {
    if (self._destroyed) return

    try {
      self._socket.close()
    } catch (err) {}

    self._reconnect()
  })

  this._connected = false
  this._connecting = false
  this._opts = extend(opts)
  this._onclose = this._onclose.bind(this)
  this._onopen = this._onopen.bind(this)
  if (opts.autoConnect) this.connect()
}

util.inherits(Client, EventEmitter)
exports = module.exports = Client

Client.prototype.connect = function () {
  this._reconnect()
}

Client.prototype._reconnect = function () {
  if (this._connecting || this._connected || this._destroyed) return

  this._connecting = true
  this._openSocket()
}

Client.prototype._openSocket = function () {
  var self = this
  this._socket = new WebSocket(this._url/*, this._wsOptions*/)
  this._socket.on('open', this._onopen)
  this._socket.on('close', this._onclose)
  this._socket.on('message', function (packet, flags) {
    if (!flags.binary) return self.emit('error', 'ignoring non-binary message')

    var dec = protobufs.decoderFor(packet)
    if (dec === schema.Error) {
      var error = protobufs.decode(packet)
      if (error.type === schema.ErrorType.RecipientNotFound) {
        self.emit('404', error.recipient)
      } else {
        var str = JSON.stringify(error)
        self._debug('received error: ' + str)
        self.emit('error', new Error(str))
      }

      return
    }

    if (dec !== schema.Packet) {
      return self._debug('ignoring unsupported packet', packet)
    }

    var msg = protobufs.decode(packet)
    self.emit('receive', msg)
  })
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

  if (this._socket) {
    this._socket.close()
    this._socket = null
  }

  this.emit('destroy')
}
