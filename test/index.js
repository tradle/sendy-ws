
var path = require('path')
var test = require('tape')
var WebSocketRelay = require('@tradle/ws-relay')
var Client = require('../multi')
var protobuf = require('protocol-buffers')
var Sendy = require('sendy')
var Packet = protobuf(require('@tradle/protobufs').ws).Packet
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
    // if (Math.random() > 0.5) {
      return receive.apply(this, arguments)
    // }
  }

  var relayURL = 'http://127.0.0.1:' + port + path.join('/', relayPath)
  var names = ['bill', 'ted', 'rufus']
  var state = {}

  var togo = names.length * (names.length - 1) * 2
  var numReceived = 0
  var numSent = 0
  var sIdx = 0

  names.forEach(function (me) {
    state[me] = {
      client: new Client({
        url: relayURL,
        identifier: me,
      }),
      sent: {},
      received: {}
    }

    state[me].client.on('message', function (msg, from) {
      msg = JSON.parse(msg)
      numReceived++
      t.notOk(state[me].received[from]) // shouldn't have received this yet
      t.equal(msg.dear, me) // should be addressed to me
      state[me].received[from] = true
      done()
    })

    names.forEach(function (them) {
      if (me === them) return

      state[me].client.send(them, toBuffer({
        dear: them,
        contents: strings[sIdx++ % strings.length]
      }), function () {
        t.notOk(state[me].sent[them])
        state[me].sent[them] = true
        numSent++
        done()
      })
    })
  })

  // setInterval(function () {
  //   // randomly drop connections
  //   var idx1 = Math.random() * names.length | 0
  //   var idx2 = (idx1 + Math.ceil(Math.random() * (names.length - 1))) % names.length
  //   directions[names[idx1]][names[idx2]].client._socket.ondisconnect()
  // }, 1000)

  // names.forEach(function (me, i) {
  //   var client = clients[i]
  //   var received = {}
  //   client.on('message', function (msg, from) {
  //     msg = JSON.parse(msg)
  //     numReceived++
  //     t.notEqual(from, me) // no messages from self
  //     t.notOk(received[from]) // shouldn't have received this yet
  //     t.equal(msg.dear, me) // should be addressed to me
  //     received[from] = true
  //     done()
  //   })

  //   names.forEach(function (them, j) {
  //     if (i !== j) {
  //       client.send(them, toBuffer({
  //         dear: them,
  //         contents: strings[sIdx++ % strings.length]
  //       }), function () {
  //         numSent++
  //         done()
  //       })
  //     }
  //   })
  // })

  function done () {
    if (--togo) return

    var x = names.length * (names.length - 1)
    t.equal(numReceived, x)
    t.equal(numSent, x)
    Sendy.prototype.receive = receive

    for (var me in state) {
      state[me].client.destroy()
    }

    t.end()
    // Socket.IO takes ~30 seconds to clean up (timeout its connections)
    // no one wants to wait that long for tests to finish
    process.exit(0)
  }
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}

        // encode: function (data) {
        //   return Packet.encode({
        //     from: me,
        //     to: them,
        //     data: data
        //   })
        // },
        // decode: function (data) {
        //   var p = Packet.decode(data)
        //   if (p.from === 'bill') debugger
        //   if (p.from === them && p.to === me) {
        //     return p.data
        //   }
        // }
