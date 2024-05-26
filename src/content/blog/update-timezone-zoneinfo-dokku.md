---
title: How to update timezone information (zoneinfo) on Dokku
description: How to make sure `zoneinfo` gets updated on Dokku when timezone rules change
pubDate: 'Nov 13 2019'
---

Recently, the Brazilian government abolished the daylight saving time that used to change the timezone offset went from -3 to -2.

In cases like this, an outdated `zoneinfo` Linux file can cause your application to display times in DST when it shouldn't. Ruby on Rails, for instance, uses the `tzinfo` gem, which reads Linux's `zoneinfo` to gather timezone information including DST intervals.

When using Dokku with buildpacks, just rebuilding your application won't work to get the `zoneinfo` updated, as the base Linux container image (`gliderlabs/herokuish`) will be cached by Docker. So in order for it to update the `zoneinfo`, first you need to clear Docker's cache.

The commands are:

1. `docker system prune -a` to clear the cached image
2. `dokku ps:rebuild [app-name]` to rebuild your app using the new image. The build will take longer than usual since it needs to redownload the base image.

Done!
