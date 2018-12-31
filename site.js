'use strict'

!(function () {
  var terminals = document.querySelectorAll('.terminal')
  terminals.forEach(function (terminal) {
  	var pre = terminal.querySelector('pre')
  	var top = document.createElement('div')
  	top.className = 'top'
  	terminal.insertBefore(top, pre)
  })
})()