var extend = require('xtend')
var typeforce = require('typeforce')
var protobuf = require('protocol-buffers')
var Switchboard = require('sendy').Switchboard
var Packet = protobuf(require('sendy-protobufs').ws).Packet

module.exports = function switchboard (opts) {
  typeforce({
    identifier: 'String'
  }, opts)

  var identifier = opts.identifier
  return new Switchboard(extend({
    decode: decode,
    encode: encode
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
  return Packet.decode(msg)
}
