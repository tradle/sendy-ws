
var path = require('path')
var querystring = require('querystring')
var test = require('tape')
var WebSocketRelay = require('sendy-ws-relay')
var WSClient = require('../client')
var Sendy = require('sendy')
var Connection = Sendy.Connection
var Switchboard = require('../switchboard')
var strings = require('./fixtures/strings')
var BASE_PORT = 22222

test('multi-device', function (t) {
  var port = BASE_PORT++

  var relayPath = '/custom/relay/path'
  var relay = new WebSocketRelay({
    port: port,
    path: relayPath
  })

  var relayURL = 'http://127.0.0.1:' + port + path.join('/', relayPath)
  var state = {}
  var devices = [
    { from: 'bill',  device: '1' },
    { from: 'bill',  device: '2' },
    { from: 'ted' }
  ]

  var togo = 6 // ted sends/receives 1, bills send/receive 1
  var numReceived = 0
  var numSent = 0
  var sIdx = 0

  devices.forEach(function (device) {
    var me = device.from
    var qs = querystring.stringify(device)
    var networkClient = new WSClient({
      url: relayURL + '?' + qs
    })

    var myState = state[qs] = {
      client: new Switchboard({
        identifier: device.from,
        device: device.device,
        unreliable: networkClient,
        clientForRecipient: function (recipient) {
          return new Sendy()
        }
      }),
      sent: {},
      received: {},
      networkClient: networkClient
    }

    // ;['connect', 'disconnect'].forEach(function (e) {
    //   myState.client._wsClient.on(e, function () {
    //     console.log(me, e + 'ed')
    //   })
    // })

    myState.client.on('message', function (msg, from) {
      // console.log('from', from, 'to', me)
      msg = JSON.parse(msg)
      numReceived++
      t.notOk(myState.received[from]) // shouldn't have received this yet
      t.equal(msg.dear, me) // should be addressed to me
      myState.received[from] = true
      done()
    })

    var sentTo = {}
    devices.forEach(function (them) {
      them = them.from
      if (device.from === them || sentTo[them]) return

      sentTo[them] = true
      myState.client.send(them, toBuffer({
        dear: them,
        contents: strings[sIdx++ % strings.length]
      }), function () {
        // console.log('delivered from', me, 'to', them)
        t.notOk(myState.sent[them])
        myState.sent[them] = true
        numSent++
        done()
      })
    })
  })

  function done () {
    if (--togo) return

    t.equal(numReceived, 3)
    t.equal(numSent, 3)

    for (var id in state) {
      state[id].client.destroy()
    }

    t.end()
    // Socket.IO takes ~30 seconds to clean up (timeout its connections)
    // no one wants to wait that long for tests to finish
    // process.exit(0)
  }
})

test('websockets with relay', function (t) {
  console.log('this tests recovery when more than half the packets\n' +
    'are dropped and with random disconnects so give it a minute to complete')

  var port = BASE_PORT++

  var relayPath = '/custom/relay/path'
  var relay = new WebSocketRelay({
    port: port,
    path: relayPath
  })

  var receive = Connection.prototype.receive
  Connection.prototype.receive = function () {
    // drop messages randomly
    if (Math.random() < 0.4) {
      return receive.apply(this, arguments)
    }
  }

  var relayURL = 'http://127.0.0.1:' + port + path.join('/', relayPath)
  var names = ['bill', 'ted', 'rufus']
  var state = {}
  // var devices = [
  //   { from: 'bill',  device: '1' },
  //   { from: 'bill',  device: '2' },
  //   { from: 'ted',  device: '1' },
  //   { from: 'rufus' }
  // ]

  var togo = names.length * (names.length - 1) * 2
  var numReceived = 0
  var numSent = 0
  var sIdx = 0

  names.forEach(function (me) {
    var networkClient = new WSClient({
      url: relayURL + '?' + querystring.stringify({ from: me })
    })

    var myState = state[me] = {
      client: new Switchboard({
        identifier: me,
        unreliable: networkClient,
        clientForRecipient: function (recipient) {
          return new Sendy()
        }
      }),
      sent: {},
      received: {},
      networkClient: networkClient
    }

    // ;['connect', 'disconnect'].forEach(function (e) {
    //   myState.client._wsClient.on(e, function () {
    //     console.log(me, e + 'ed')
    //   })
    // })

    myState.client.on('message', function (msg, from) {
      // console.log('from', from, 'to', me)
      msg = JSON.parse(msg)
      numReceived++
      t.notOk(myState.received[from]) // shouldn't have received this yet
      t.equal(msg.dear, me) // should be addressed to me
      myState.received[from] = true
      done()
    })

    names.forEach(function (them) {
      if (me === them) return

      myState.client.send(them, toBuffer({
        dear: them,
        contents: strings[sIdx++ % strings.length]
      }), function () {
        // console.log('delivered from', me, 'to', them)
        t.notOk(myState.sent[them])
        myState.sent[them] = true
        numSent++
        done()
      })
    })
  })

  setInterval(function () {
    // randomly drop connections
    var idx1 = Math.random() * names.length | 0
    var name = names[idx1]
    // console.log('randomly disconnecting ' + name)
    state[name].networkClient._socket.disconnect()
  }, 1000).unref()

  function done () {
    if (--togo) return

    var x = names.length * (names.length - 1)
    t.equal(numReceived, x)
    t.equal(numSent, x)
    Connection.prototype.receive = receive

    for (var me in state) {
      state[me].client.destroy()
    }

    t.end()
  }
})

test('[ignore]', function (t) {
  // Socket.IO takes ~30 seconds to clean up (timeout its connections)
  // no one wants to wait that long for tests to finish
  t.end()
  process.exit(0)
})

function toBuffer (obj) {
  return new Buffer(JSON.stringify(obj))
}
