---
layout: post
title: Sinon.js causing Express to never finish request in test suite
---

I was beating my brain out today trying to figure out why my error handling middleware wasn't being called inside the project test suite, but it worked when I did the request directly through the browser.

When doing the request through the browser to a route that caused an error, I would immediately receive the browser response with the error, but when the same route was called in an automated test, the request would never be finished causing a timeout on the test.

After finding the solution, I thought this could be a good first post for this blog. I hope it may help people who face the same problem. :)

As I can't post the real code here, I made a [MCV example](https://stackoverflow.com/help/mcve) to show the issue and how it can be solved. Here's a simple Express server with a route that causes an error, which is catched by an error handling middleware:

**routes/foo.js**
```js
const express = require('express')
const router = express.Router()

// route that triggers error
router.get('/error-route', (req, res, next) => {
  next(new Error('whoops!'))
})

module.exports = router
```

**server.js**
```js
const express = require('express')
const moment = require('moment')

const app = express()

app.use('/foo', require('./routes/foo'))

// hypothetical error handling middleware
app.use((err, req, res, next) => {
  res.status(500).end(`Error happened at ${moment().format('h:mm a')}!\n\n${err.stack}`)
})

app.listen(3000)
module.exports = app
```

When opening `/foo/error-route` through the browser, Express calls the route defined in **routes/foo.js** which triggers an error. This error is then passed by Express to the error handling middleware defined on **server.js**, and it then prints the error stack trace along with the current time.

In a real world scenario, this error middleware could be used to format the error properly to the user, or return a generic error message and send the error to an external tracking platform like [Sentry](https://sentry.io) in case it's unexpected.

As I said, everything worked when accessing the URL through the browser, but the request would never terminate for this endpoint when called inside the test suite, causing a timeout in my test case. After digging through the Express source code and debugging it, I found that it was stopping in a `setImmediate` call at `node_modules/express/lib/router/index.js`.

By using `console.log` to see the inners of the `setImmediate` definition, it looked like it was [monkey patched](https://en.wikipedia.org/wiki/Monkey_patch) by some library. A-ha!

It turns out that [Sinon](https://sinonjs.org/) -- the package used in the project I work for mocking data for the automated tests -- was replacing this function when calling `sinon.useFakeTimers`, a tool used to manipulate the system time for specific tests.

Below there's an example of a failing test. It basically calls the example endpoint using [supertest](https://github.com/visionmedia/supertest), then checks if it responds with 500 and also if the time is present in the response (the middlware defined on `server.js` prints it).

**test/routes/foo.js**
```js
const app = require('../../server')

const assert = require('assert')
const moment = require('moment')
const request = require('supertest')
const sinon = require('sinon')

describe('foo routes', () => {
  let clock

  before(() => {
    clock = sinon.useFakeTimers(+moment('2018-10-10 15:05:00'))
  })

  after(() => clock.restore())

  describe('GET /foo/error-route', () => {
    it('should respond with http 500 containing the current time', () => {
      return request(app)
        .get('/foo/error-route')
        .expect(500)
        .then(res => {
          assert.ok(res.error.text.indexOf('Error happened at 3:05') !== -1)
        })
    })
  })
})
```

<div class="terminal">
  <pre><span class="arrow-success">➜</span> <span class="cwd">test</span> yarn test
<span class="dark-gray">$ NODE_ENV=test mocha -b --exit</span>

  /foo routes
    GET /foo/error-route
      <span class="red">1) should respond with http 500 containing the current time</span>

  <span class="green">0 passing</span> <span class="dark-gray">(5s)</span>
  <span class="red">1 failing</span>

  1) /foo routes
       GET /foo/error-route
         should respond with http 500 containing the current time:
     <span class="red">Error: Timeout of 5000ms exceeded. For async tests and hooks, ensure "done()" is called; if returning a Promise, ensure it resolves. (/path/to/project/test/routes/foo.js)</span>
</pre>
</div>

In order to fix it, we need to tell Sinon not to replace the `setImmediate` function by manually telling which functions should be faked, as explained in [their documentation](https://sinonjs.org/releases/v7.2.2/fake-timers/). In this case, we only need the `Date` function, so we replace the clock definition part with:

```js
before(() => {
  clock = sinon.useFakeTimers({
    now: +moment('2018-10-10 15:05:00'),
    toFake: ['Date']
  })
})
```

In some older Sinon versions, you could use this signature:

```js
clock = sinon.useFakeTimers(+moment('2018-10-10 15:05:00'), 'Date')
```

After doing this, Express stops hanging and the test runs successfuly.

<div class="terminal">
  <pre><span class="arrow-success">➜</span> <span class="cwd">test</span> yarn test
<span class="dark-gray">$ NODE_ENV=test mocha -b --exit</span>

  /foo routes
    GET /foo/error-route
      <span class="green">✓</span> should respond with http 500 containing the current time

  <span class="green">1 passing</span> <span class="dark-gray">(47ms)</span></pre>
</div>

It turns out [there are developers reporting](https://github.com/sinonjs/sinon/issues/960) that `sinon.useFakeTimers` may also cause unexpected effects on other well-known libraries, so if you see your code not finishing to run when using it, be aware that it may be Sinon overwriting global functions.