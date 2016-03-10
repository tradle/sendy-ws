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
  var switchboard = new Switchboard(extend({
    decode: decode,
    encode: encode,
    clientForRecipient: getDefaultClientForRecipient
  }, opts))

  uclient.on('404', function (recipient) {
    switchboard.cancelPending(recipient)
  })

  return switchboard

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

function getDefaultClientForRecipient () {
  return new Sendy()
}
