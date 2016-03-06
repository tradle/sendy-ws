
var path = require('path')
var test = require('tape')
var WebSocketRelay = require('@tradle/ws-relay')
var WebSocketClient = require('../tradle-client')
var protobuf = require('protocol-buffers')
var WSPacket = protobuf(require('@tradle/protobufs').ws).Packet
var BASE_PORT = 22222

test('websockets with relay', function (t) {
  var port = BASE_PORT++

  var relayPath = '/custom/relay/path'
  var relay = new WebSocketRelay({
    port: port,
    path: relayPath
  })

  var relayURL = 'http://127.0.0.1:' + port + path.join('/', relayPath)
  var names = ['bill', 'ted', 'rufus']
  var clients = names.map(function (name) {
    return new WebSocketClient({
      identifier: name,
      url: relayURL,
    })
  })

  // var onmsg = bill._onmessage
  // // in this test,
  // // 4 comes at the last piece of a message
  // var errored = 4
  // bill._onmessage = function (msg, acknowledge) {
  //   if (errored-- === 0) {
  //     errored = true
  //     return acknowledge({ error: { message: WebSocketClient.OTR_ERROR } })
  //   }

  //   return onmsg.apply(bill, arguments)
  // }

  // bill.connect()
  // bill.once('connect', function () {
  //   bill._socket.ondisconnect()
  // })

  var received = {}
  names.forEach(function (me, i) {
    var client = clients[i]
    client.on('message', function (msg, from) {
      msg = JSON.parse(msg)
      console.log(me, 'got', msg, 'from', from)
      t.notEqual(from, me) // no messages from self
      t.notOk(received[from]) // shouldn't have received this yet
      t.equal(msg.hey, me) // should be addressed to me
      received[from] = true
    })

    names.forEach(function (them, j) {
      if (i !== j) {
        console.log(me, 'sending msg to', them)
        client.send(them, toBuffer({ hey: them }), function () {
          t.pass()
        })
      }
    })
  })

  function done () {
    if (--togo) return

    clients.forEach(function (c) {
      c.destroy()
    })

    t.end()
    // Socket.IO takes ~30 seconds to clean up (timeout its connections)
    // no one wants to wait that long for tests to finish
    process.exit(0)
  }
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}
