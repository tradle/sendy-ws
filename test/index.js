
var path = require('path')
var test = require('tape')
var WebSocketRelay = require('@tradle/ws-relay')
var WebSocketClient = require('../client')
var protobuf = require('protocol-buffers')
var Sendy = require('sendy')
var WSPacket = protobuf(require('@tradle/protobufs').ws).Packet
var strings = require('./fixtures/strings')
var BASE_PORT = 22222

test('websockets with relay', function (t) {
  var port = BASE_PORT++

  var relayPath = '/custom/relay/path'
  var relay = new WebSocketRelay({
    port: port,
    path: relayPath
  })

  var receive = Sendy.prototype.receive
  Sendy.prototype.receive = function () {
    // drop half the messages
    if (Math.random() > 0.5) {
      return receive.apply(this, arguments)
    }
  }

  var relayURL = 'http://127.0.0.1:' + port + path.join('/', relayPath)
  var names = ['bill', 'ted', 'rufus']
  var clients = names.map(function (name) {
    return new WebSocketClient({
      identifier: name,
      identifierEncoding: 'utf8',
      url: relayURL,
    })
  })

  // clients.forEach(function (c, i) {
  //   ;['connect', 'disconnect'].forEach(function (e) {
  //     c.on(e, function () {
  //       console.log(names[i], e + 'ed')
  //     })
  //   })
  // })

  setInterval(function () {
    // randomly drop connections
    var idx = Math.random() * clients.length | 0
    clients[idx]._socket.ondisconnect()
  }, 1000)

  // clients[0].once('connect', function () {
  //   clients[0]._socket.ondisconnect()
  // })

  var togo = names.length * (names.length - 1) * 2
  var numReceived = 0
  var numSent = 0
  var sIdx = 0
  names.forEach(function (me, i) {
    var client = clients[i]
    var received = {}
    client.on('message', function (msg, from) {
      msg = JSON.parse(msg)
      numReceived++
      t.notEqual(from, me) // no messages from self
      t.notOk(received[from]) // shouldn't have received this yet
      t.equal(msg.dear, me) // should be addressed to me
      received[from] = true
      done()
    })

    names.forEach(function (them, j) {
      if (i !== j) {
        client.send(them, toBuffer({
          dear: them,
          contents: strings[sIdx++ % strings.length]
        }), function () {
          numSent++
          done()
        })
      }
    })
  })

  function done () {
    if (--togo) return

    t.equal(numReceived, 6)
    t.equal(numSent, 6)
    Sendy.prototype.receive = receive
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
