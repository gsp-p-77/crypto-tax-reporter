# GSwPersonalWebPage
My personal web page (just started, to be continued soon)

## Recommended prerequisites
Server with running docker engine

## Usage with docker engine
### Build and run container
- clone and cd into repository
- docker build -t web-page .
- To run docker container just in current power on:
  - docker run -d -p 80:3000 web-page
- To run docker container always at every power up
  - docker run --restart always -d -p 80:3000 web-page

### Open web page
Use browser and open the web page, use IP of your server

## Misc
Refer to https://github.com/gsp-p-77/meta-rpi3-docker-engine for a docker engine on a RPI3
 
