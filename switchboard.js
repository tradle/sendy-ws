var extend = require('xtend')
var typeforce = require('typeforce')
var protobuf = require('protocol-buffers')
var Sendy = require('sendy')
var Switchboard = Sendy.Switchboard
var Packet = protobuf(require('sendy-protobufs').ws).Packet

module.exports = function switchboard (opts) {
  typeforce({
    identifier: 'String'
  }, opts)

  var identifier = opts.identifier
  var uclient = opts.unreliable
  return new Switchboard(extend({
    decode: decode,
    encode: encode,
    clientForRecipient: getDefaultClientForRecipient
  }, opts))

  function encode (msg, recipient) {
    return Packet.encode({
      from: identifier,
      to: recipient,
      data: msg
    })
  }
}

function decode (msg) {
  if (msg instanceof ArrayBuffer) msg = new Buffer(msg)

  return Packet.decode(msg)
}

function getDefaultClientForRecipient () {
  return new Sendy()
}
